import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canonicalizeNode, nodeJson } from "../../../src/proof/child/codec/canonical";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import { verifyIntegrity, computeSri } from "../../../src/proof/shell/integrity";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { fc, fcParams } from "../../engine/helpers/fc";
import { buildSyntheticTarball } from "../helpers/buildTarball";
import {
  ALL_BEHAVIORS,
  BEHAVIORS,
  POLLUTED_KEY,
  POLLUTE_INPUT,
  expectedArity,
  expectedExportNames,
  listMutations,
  mutate,
  mutatedPackageArb,
  syntheticPackageArb,
  writePackage,
} from "../helpers/syntheticPackage";
import type { BehaviorId, FunctionSpec, SyntheticPackageSpec } from "../helpers/syntheticPackage";

type Fn = (...args: unknown[]) => unknown;

let root = "";
let seq = 0;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gs-synth-test-"));
  seq = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Writes the package to a fresh directory and loads it with `createRequire` (CommonJS). */
function load(spec: SyntheticPackageSpec): Record<string, Fn> {
  const dir = join(root, `p${seq++}`);
  writePackage(spec, dir);
  const mod: unknown = createRequire(join(dir, "index.js"))(dir);
  if (!isRecord(mod)) throw new Error("module did not export an object");
  const out: Record<string, Fn> = {};
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v !== "function") throw new Error(`export ${k} is not a function`);
    out[k] = v as Fn;
  }
  return out;
}

function enc(v: unknown): string {
  const r = encodeValue(v, { budget: 10_000_000 });
  if (!r.ok) throw new Error("encoding failed");
  return nodeJson(canonicalizeNode(r.node));
}

/** Return value or thrown error (awaited) plus the argument post-state, as canonical JSON. */
async function observe(fn: Fn, args: unknown[]): Promise<string> {
  let out: string;
  try {
    out = `return:${enc(await fn(...args))}`;
  } catch (e) {
    out = `throw:${enc(e)}`;
  }
  return `${out}|args:${enc(args)}`;
}

function countUnencodable(json: string): { cycle: number; getter: number; proxy: number } {
  const counts = { cycle: 0, getter: 0, proxy: 0 };
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRecord(v)) {
      if (v["t"] === "unencodable") {
        const reason = v["reason"];
        if (reason === "cycle" || reason === "getter" || reason === "proxy") counts[reason] += 1;
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(JSON.parse(json));
  return counts;
}

function fnOf(behavior: BehaviorId, variant: string | null = null): FunctionSpec {
  return {
    exportName: `${behavior}0`,
    behavior,
    params: { constant: 3, text: "alpha", errorClass: "TypeError", time: 1000, variant, extraParam: false },
  };
}

function specOf(...functions: FunctionSpec[]): SyntheticPackageSpec {
  return { name: "synth-1", version: "1.2.3", functions };
}

function expectSurface(mod: Record<string, Fn>, spec: SyntheticPackageSpec): void {
  expect(Object.keys(mod).sort()).toEqual(expectedExportNames(spec));
  for (const fn of spec.functions) {
    const exported = mod[fn.exportName];
    expect(exported?.length).toBe(expectedArity(fn));
    expect(exported?.name).toBe(fn.exportName);
  }
}

describe("syntheticPackage: loading", () => {
  it("loads a package with every menu behavior and exposes the documented names and arity", () => {
    const spec = specOf(...ALL_BEHAVIORS.map((b) => fnOf(b)));
    const mod = load(spec);
    expectSurface(mod, spec);
    for (const b of ALL_BEHAVIORS) expect(mod[`${b}0`]?.length).toBe(BEHAVIORS[b].arity);
  });

  it("writes CommonJS: package.json has main and no type", () => {
    const dir = join(root, "pkg");
    writePackage(specOf(fnOf("identity")), dir);
    const pkg: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg).toEqual({ name: "synth-1", version: "1.2.3", main: "index.js", license: "MIT" });
  });

  it("generated packages load and match their spec", () => {
    fc.assert(
      fc.property(syntheticPackageArb({ behaviors: ALL_BEHAVIORS, maxFunctions: 6 }), (spec) => {
        expectSurface(load(spec), spec);
      }),
      fcParams(),
    );
  });

  it("is deterministic: the same spec renders the same bytes", () => {
    const spec = specOf(fnOf("sum"), fnOf("alwaysThrow"));
    expect(buildSyntheticTarball(spec).bytes).toEqual(buildSyntheticTarball(spec).bytes);
  });
});

describe("syntheticPackage: menu behaviors", () => {
  const mod = (): Record<string, Fn> => load(specOf(...ALL_BEHAVIORS.map((b) => fnOf(b))));
  const call = (m: Record<string, Fn>, b: BehaviorId, ...args: unknown[]): unknown => m[`${b}0`]?.(...args);

  it("pure value functions", () => {
    const m = mod();
    expect(call(m, "identity", 7)).toBe(7);
    expect(call(m, "sum", 1, 2)).toBe(6); // a + b + constant (3)
    expect(call(m, "sortCopy", [3, 1, 2])).toEqual([1, 2, 3]);
    expect(call(m, "concat", "a", "b")).toBe("abalpha");
    expect(call(m, "upper", "ab")).toBe("AB");
    expect(call(m, "mapFilter", [1, 2, 4])).toEqual([6, 12]);
    expect(call(m, "objectMerge", { k: 1 }, { k: 2, m: 3 })).toEqual({ k: 2, m: 3 });
    expect(call(m, "returnsUndefined", 1)).toBeUndefined();
  });

  it("sortCopy leaves its argument untouched", () => {
    const arr = [3, 1];
    mod()["sortCopy0"]?.(arr);
    expect(arr).toEqual([3, 1]);
  });

  it("argument mutations", () => {
    const m = mod();
    const arr = [1];
    expect(call(m, "pushArg", arr, 5)).toBe(2);
    expect(arr).toEqual([1, 5]);
    const obj: Record<string, unknown> = {};
    expect(call(m, "setPropArg", obj, 9)).toBe(9);
    expect(obj).toEqual({ touched: 9 });
    const target = { other: 1 };
    expect(call(m, "pathSet", target, "p.q", 4)).toBe(target);
    expect(target).toEqual({ other: 1, p: { q: 4 } });
  });

  it("typed errors and async outcomes", async () => {
    const m = mod();
    expect(() => call(m, "alwaysThrow", 1)).toThrow(new TypeError("alpha"));
    expect(() => call(m, "throwsOdd", 3)).toThrow(TypeError);
    expect(call(m, "throwsOdd", 4)).toBe(4);
    await expect(call(m, "asyncResolve", 5)).resolves.toBe(5);
    await expect(call(m, "asyncReject", 5)).rejects.toThrow(new TypeError("alpha"));
  });

  it("codec coverage values", () => {
    const m = mod();
    const nanZero = call(m, "nanZero", 1);
    expect(Array.isArray(nanZero) && Object.is(nanZero[0], NaN) && Object.is(nanZero[1], -0)).toBe(true);
    const holes = call(m, "holes", 1);
    expect(Array.isArray(holes) && !(1 in holes) && holes.length === 3).toBe(true);
    const ms = call(m, "mapSet", 1);
    expect(Array.isArray(ms) && ms[0] instanceof Map && ms[1] instanceof Set).toBe(true);
    const dr = call(m, "dateRegex", 1);
    expect(Array.isArray(dr) && dr[0] instanceof Date && dr[1] instanceof RegExp).toBe(true);
    expect(call(m, "typedArray", 1)).toBeInstanceOf(Uint8Array);
  });

  it("shared references are the same object; the cyclic value is cyclic", () => {
    const m = mod();
    const shared = call(m, "sharedRefs", 1);
    expect(Array.isArray(shared) && shared[0] === shared[1]).toBe(true);
    const cyc = call(m, "cyclic", 1);
    expect(isRecord(cyc) && cyc["self"] === cyc).toBe(true);
  });

  it("flaky behaviors differ between calls", () => {
    const m = mod();
    expect(call(m, "counter", 1)).not.toBe(call(m, "counter", 1));
    expect(call(m, "random", 1)).not.toBe(call(m, "random", 1));
  });

  it("absOfNegative returns its input; the delta variant returns the absolute value", () => {
    expect(call(mod(), "absOfNegative", -3)).toBe(-3);
    expect(load(specOf(fnOf("absOfNegative", "declared-delta")))["absOfNegative0"]?.(-3)).toBe(3);
  });

  it("pollutesPrototype pollutes Object.prototype only for its flagged input", () => {
    const m = mod();
    try {
      call(m, "pollutesPrototype", "harmless");
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, POLLUTED_KEY)).toBe(false);
      call(m, "pollutesPrototype", POLLUTE_INPUT);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, POLLUTED_KEY)).toBe(true);
    } finally {
      Reflect.deleteProperty(Object.prototype, POLLUTED_KEY);
    }
  });

  for (const id of ALL_BEHAVIORS) {
    it(`unencodable oracle matches the codec: ${id}`, async () => {
      const fn = load(specOf(fnOf(id)))[`${id}0`] as Fn;
      await fc.assert(
        fc.asyncProperty(BEHAVIORS[id].args, async (args) => {
          if (id === "pollutesPrototype") args = ["harmless"];
          // A thrown error is an Outcome too; `observe` encodes it.
          const outcome = (await observe(fn, args)).split("|args:")[0] ?? "";
          expect(countUnencodable(outcome.slice(outcome.indexOf(":") + 1))).toEqual(BEHAVIORS[id].unencodable);
        }),
        fcParams(),
      );
    });
  }
});

describe("syntheticPackage: mutate", () => {
  it("does not modify the input spec", () => {
    const spec = specOf(fnOf("sum"), fnOf("alwaysThrow"));
    const snapshot = structuredClone(spec);
    for (const request of listMutations(spec)) mutate(spec, request);
    expect(spec).toEqual(snapshot);
  });

  for (const id of ALL_BEHAVIORS) {
    for (const m of BEHAVIORS[id].mutations) {
      it(`${id} / ${m.kind}: changes behavior on its witness${m.observableOn === "all-inputs" ? " and on every generated input" : ""}`, async () => {
        const original = specOf(fnOf(id));
        const mutated = mutate(original, { kind: m.kind, target: 0 });
        expect(mutated.info.observableOn).toBe(m.observableOn);
        expect(mutated.info.declaredDelta).toBe(m.declaredDelta === true);
        const a = load(original)[`${id}0`] as Fn;
        const b = load(mutated.spec)[`${id}0`] as Fn;
        const witness = mutated.info.witness;
        if (witness === null) throw new Error("behavior mutation without witness");
        expect(await observe(a, witness())).not.toBe(await observe(b, witness()));
        if (m.observableOn === "all-inputs") {
          await fc.assert(
            fc.asyncProperty(BEHAVIORS[id].args, async (args) => {
              expect(await observe(a, structuredClone(args))).not.toBe(await observe(b, structuredClone(args)));
            }),
            fcParams(),
          );
        }
      });
    }
  }

  it("API mutations change the export surface", () => {
    const spec = specOf({ ...fnOf("sum"), exportName: "sum0" }, { ...fnOf("identity"), exportName: "identity1" });
    const names = (s: SyntheticPackageSpec): string[] => Object.keys(load(s)).sort();
    const rename = mutate(spec, { kind: "rename-export", target: 0 });
    expect(rename.info).toMatchObject({ exportName: "sum0", mutatedExportName: "sum0Renamed" });
    expect(names(rename.spec)).toEqual(["identity1", "sum0Renamed"]);
    const removed = mutate(spec, { kind: "remove-export", target: 1 });
    expect(names(removed.spec)).toEqual(["sum0"]);
    const added = mutate(spec, { kind: "add-export", target: 0 });
    expect(added.info.exportName).toBe("added2");
    expect(names(added.spec)).toEqual(["added2", "identity1", "sum0"]);
    const arity = mutate(spec, { kind: "change-arity", target: 0 });
    expect(load(arity.spec)["sum0"]?.length).toBe(3);
    expect(() => mutate(specOf(fnOf("sum")), { kind: "remove-export", target: 0 })).toThrow();
  });

  it("every generated mutation is observable on its witness or in the export surface", async () => {
    await fc.assert(
      fc.asyncProperty(mutatedPackageArb({ behaviors: ALL_BEHAVIORS.filter((b) => BEHAVIORS[b].deterministic) }), async ({ original, mutated }) => {
        expect(mutated.info.declaredDelta).toBe(false);
        const a = load(original);
        const b = load(mutated.spec);
        const { info } = mutated;
        if (info.effect === "api") {
          if (info.kind === "change-arity") expect(b[info.exportName]?.length).not.toBe(a[info.exportName]?.length);
          else expect(Object.keys(a).sort()).not.toEqual(Object.keys(b).sort());
          return;
        }
        const name = info.exportName;
        if (info.witness === null) throw new Error("missing witness");
        const before = a[name] as Fn;
        const after = b[name] as Fn;
        // pollutesPrototype has no mutation, so calling is safe here.
        expect(await observe(before, info.witness())).not.toBe(await observe(after, info.witness()));
      }),
      fcParams(),
    );
  });
});

describe("syntheticPackage: tarball", () => {
  it("extracts through the real extractor and verifies against its SRI", async () => {
    await fc.assert(
      fc.asyncProperty(syntheticPackageArb({ behaviors: ALL_BEHAVIORS }), async (spec) => {
        const { bytes, integrity } = buildSyntheticTarball(spec);
        expect(integrity).toBe(computeSri(bytes));
        expect(verifyIntegrity(bytes, integrity).ok).toBe(true);

        const dest = join(root, `x${seq++}`);
        mkdirSync(dest);
        const result = await extractTarball(bytes, dest);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((f) => f.path).sort()).toEqual(["index.js", "package.json"]);

        const dir = join(root, `p${seq++}`);
        writePackage(spec, dir);
        for (const file of ["index.js", "package.json"]) {
          expect(readFileSync(join(dest, file), "utf8")).toBe(readFileSync(join(dir, file), "utf8"));
        }
        const mod: unknown = createRequire(join(dest, "index.js"))(dest);
        expect(isRecord(mod) && Object.keys(mod).sort()).toEqual(expectedExportNames(spec));
      }),
      fcParams(),
    );
  }, 60_000);

  it("a flipped byte fails the integrity check", () => {
    const { bytes, integrity } = buildSyntheticTarball(specOf(fnOf("identity")));
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(verifyIntegrity(tampered, integrity).ok).toBe(false);
  });
});
