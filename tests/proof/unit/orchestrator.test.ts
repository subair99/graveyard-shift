// Requirements: 1.1, 1.2, 1.5, 2.2, 2.3, 3.5, 3.6, 3.9, 3.10, 4.4, 5.7, 8.3, 8.4, 10.4, 12.2, 12.3, 13.28
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmitter } from "../../../src/proof/shell/emit";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import type { Executor, ExecutorFactory, ExecutorOptions } from "../../../src/proof/shell/executor/types";
import { runProofOfLife, validateRequest } from "../../../src/proof/shell/orchestrator";
import { canonicalReport } from "../../../src/proof/serialize/canonicalReport";
import { deserializeReport } from "../../../src/proof/serialize/deserialize";
import { RequestValidationError } from "../../../src/proof/types";
import type { HarnessConfig, ProofDeps, ProofRequest } from "../../../src/proof/types";
import { buildSyntheticTarball, tarballOf } from "../helpers/buildTarball";
import { BEHAVIORS, mutate, packageFiles, writePackage } from "../helpers/syntheticPackage";
import type { BehaviorId, BehaviorParams, FunctionSpec, SyntheticPackageSpec } from "../helpers/syntheticPackage";

let root: string;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gs-orch-test-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const PARAMS: BehaviorParams = {
  constant: 2,
  text: "alpha",
  errorClass: "Error",
  time: 0,
  variant: null,
  extraParam: false,
};

function fn(behavior: BehaviorId, index: number): FunctionSpec {
  return { exportName: `${behavior}${index}`, behavior, params: { ...PARAMS } };
}

function pkg(...functions: FunctionSpec[]): SyntheticPackageSpec {
  return { name: "synth-1", version: "1.0.0", functions };
}

interface Fixture {
  tempRoot: string;
  originalPath: string;
  integrity: string;
}

/** Fresh temp root (for the engine's work directory) and the Original tarball on disk. */
function fixture(original: SyntheticPackageSpec): Fixture {
  const dir = join(root, `case${counter++}`);
  mkdirSync(dir);
  const tempRoot = join(dir, "tmp");
  mkdirSync(tempRoot);
  const built = buildSyntheticTarball(original);
  const originalPath = join(dir, "original.tgz");
  writeFileSync(originalPath, built.bytes);
  return { tempRoot, originalPath, integrity: built.integrity };
}

function harnessFor(spec: SyntheticPackageSpec, overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  const functions: HarnessConfig["functions"] = Object.fromEntries(
    spec.functions.map((f) => [f.exportName, { args: BEHAVIORS[f.behavior].args }]),
  );
  return {
    package: spec.name,
    seed: 42,
    caseCount: 10,
    perCallTimeoutMs: 1000,
    heapLimitMb: 64,
    outputLimitBytes: 100_000,
    maxRestarts: 5,
    shrinkBudget: 50,
    functions,
    deltas: [],
    ...overrides,
  };
}

function resurrectionDir(spec: SyntheticPackageSpec): string {
  const dir = join(root, `res${counter++}`);
  writePackage(spec, dir);
  return dir;
}

interface Spy {
  factory: ExecutorFactory;
  opens: () => number;
  disposes: () => number;
}

function spyFactory(): Spy {
  const inner = createInProcessExecutorFactory({ acknowledgeUnsandboxed: true });
  let opens = 0;
  let disposes = 0;
  return {
    factory: {
      create(options: ExecutorOptions): Executor {
        const executor = inner.create(options);
        return {
          get mechanism() {
            return executor.mechanism;
          },
          probe: () => executor.probe(),
          open: (spec) => {
            opens += 1;
            return executor.open(spec);
          },
          dispose: () => {
            disposes += 1;
            return executor.dispose();
          },
        };
      },
    },
    opens: () => opens,
    disposes: () => disposes,
  };
}

function request(
  f: Fixture,
  original: SyntheticPackageSpec,
  resurrection: ProofRequest["resurrection"],
  extra: Partial<ProofRequest> = {},
): ProofRequest {
  return {
    original: { name: original.name, version: original.version, tarballPath: f.originalPath, integrity: f.integrity },
    resurrection,
    harness: harnessFor(original),
    executorFactory: createInProcessExecutorFactory({ acknowledgeUnsandboxed: true }),
    ...extra,
  };
}

function deps(f: Fixture, lines: string[] = [], env: ProofDeps["env"] = {}): Partial<ProofDeps> {
  return { tempRoot: f.tempRoot, env, sink: (line) => void lines.push(line) };
}

describe("runProofOfLife (InProcess_Executor)", () => {
  const original = pkg(fn("sum", 0), fn("concat", 1));

  it("identical package as directory: alive, zero divergences, work directory removed", async () => {
    const f = fixture(original);
    const run = await runProofOfLife(request(f, original, { kind: "directory", path: resurrectionDir(original) }), deps(f));
    expect(run.report.harnessErrors).toEqual([]);
    expect(run.report.verdict).toBe("alive");
    expect(run.report.divergences).toEqual([]);
    expect(run.report.original).toMatchObject({ verified: true, integrity: f.integrity });
    expect(run.report.resurrection.source).toBe("directory");
    expect(run.report.resurrection.treeHash).toMatch(/^sha512-/);
    expect(run.report.sandbox.mechanism).toBe("in-process");
    expect(run.report.functionsTested).toEqual(["concat1", "sum0"]);
    expect(run.report.casesPerFunction.every((c) => c.cases === 10)).toBe(true);
    expect(readdirSync(f.tempRoot)).toEqual([]);
    expect(deserializeReport(run.json).ok).toBe(true);
    expect(run.json).toBe(canonicalReport(run.report));
  });

  it("identical package as tarball: alive, same Tree_Hash as the directory form", async () => {
    const f = fixture(original);
    const dir = await runProofOfLife(request(f, original, { kind: "directory", path: resurrectionDir(original) }), deps(f));
    const tgz = join(root, `res${counter++}.tgz`);
    writeFileSync(tgz, tarballOf(packageFiles(original)).bytes);
    const tar = await runProofOfLife(request(f, original, { kind: "tarball", path: tgz }), deps(f));
    expect(tar.report.verdict).toBe("alive");
    expect(tar.report.resurrection.source).toBe("tarball");
    expect(tar.report.resurrection.treeHash).toBe(dir.report.resurrection.treeHash);
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("integrity mismatch: inconclusive and no side is opened", async () => {
    const f = fixture(original);
    const spy = spyFactory();
    const wrong = tarballOf([{ path: "x.txt", bytes: new Uint8Array([1]) }]).integrity;
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) }, { executorFactory: spy.factory });
    req.original.integrity = wrong;
    const run = await runProofOfLife(req, deps(f));
    expect(run.report.verdict).toBe("inconclusive");
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["integrity-mismatch"]);
    expect(run.report.harnessErrors[0]?.message).toContain(wrong);
    expect(run.report.original.verified).toBe(false);
    expect(run.report.resurrection.treeHash).toBeNull();
    expect(spy.opens()).toBe(0);
    expect(spy.disposes()).toBe(1);
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("invalid integrity string: invalid-integrity", async () => {
    const f = fixture(original);
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) });
    req.original.integrity = "sha1-abc";
    const run = await runProofOfLife(req, deps(f));
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["invalid-integrity"]);
    expect(run.report.verdict).toBe("inconclusive");
  });

  it("unknown function in the Haunting_Radius: inconclusive", async () => {
    const f = fixture(original);
    const run = await runProofOfLife(
      request(f, original, { kind: "directory", path: resurrectionDir(original) }, { haunting: ["sum0", "nope"] }),
      deps(f),
    );
    expect(run.report.verdict).toBe("inconclusive");
    expect(run.report.harnessErrors).toMatchObject([{ kind: "unknown-function", function: "nope" }]);
    expect(run.report.functionsTested).toEqual([]);
  });

  it("a function without generator that is not excluded: missing-generator", async () => {
    const f = fixture(original);
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) });
    req.harness = harnessFor(original, { functions: { sum0: { args: BEHAVIORS.sum.args } } });
    const run = await runProofOfLife(req, deps(f));
    expect(run.report.harnessErrors).toMatchObject([{ kind: "missing-generator", function: "concat1" }]);
    expect(run.report.verdict).toBe("inconclusive");
  });

  it("changed return value: restless with a divergence and replay parameters", async () => {
    const f = fixture(original);
    const changed = mutate(original, { kind: "change-constant", target: 0 }).spec;
    const run = await runProofOfLife(request(f, original, { kind: "directory", path: resurrectionDir(changed) }), deps(f));
    expect(run.report.harnessErrors).toEqual([]);
    expect(run.report.verdict).toBe("restless");
    const d = run.report.divergences.find((x) => x.function === "sum0");
    expect(d).toBeDefined();
    expect(d?.kind).toBe("unexplained");
    if (d !== undefined && d.kind !== "api-surface") {
      expect(d.replay.phase).toBe("generated");
      expect(d.differences.length).toBeGreaterThan(0);
    }
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("API surface change is a divergence (restless)", async () => {
    const f = fixture(original);
    const changed = mutate(original, { kind: "change-arity", target: 0 }).spec;
    const run = await runProofOfLife(request(f, original, { kind: "directory", path: resurrectionDir(changed) }), deps(f));
    expect(run.report.verdict).toBe("restless");
    expect(run.report.divergences.some((d) => d.kind === "api-surface" && d.function === "sum0")).toBe(true);
  });

  it("an excluded function is reported with its reason and not tested", async () => {
    const f = fixture(original);
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) });
    req.harness = harnessFor(original, {
      functions: { sum0: { args: BEHAVIORS.sum.args }, concat1: { excluded: true, reason: "not needed here" } },
    });
    const run = await runProofOfLife(req, deps(f));
    expect(run.report.verdict).toBe("alive");
    expect(run.report.excludedFunctions).toEqual([{ function: "concat1", reason: "not needed here" }]);
    expect(run.report.functionsTested).toEqual(["sum0"]);
  });

  it("every function excluded: no-functions-tested, never alive", async () => {
    const f = fixture(original);
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) });
    req.harness = harnessFor(original, {
      functions: { sum0: { excluded: true, reason: "a" }, concat1: { excluded: true, reason: "b" } },
    });
    const run = await runProofOfLife(req, deps(f));
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["no-functions-tested"]);
    expect(run.report.verdict).toBe("inconclusive");
  });

  it('"type": "module" in the Resurrection: unloadable-module before any side opens', async () => {
    const f = fixture(original);
    const dir = resurrectionDir(original);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "synth-1", version: "1.0.0", main: "index.js", type: "module" }));
    const spy = spyFactory();
    const run = await runProofOfLife(request(f, original, { kind: "directory", path: dir }, { executorFactory: spy.factory }), deps(f));
    expect(run.report.verdict).toBe("inconclusive");
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["unloadable-module"]);
    expect(spy.opens()).toBe(0);
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("a load exception in the Resurrection is unloadable-module", async () => {
    const f = fixture(original);
    const dir = resurrectionDir(original);
    writeFileSync(join(dir, "index.js"), "throw new ReferenceError('boom');\n");
    const run = await runProofOfLife(request(f, original, { kind: "directory", path: dir }), deps(f));
    expect(run.report.harnessErrors).toMatchObject([{ kind: "unloadable-module" }]);
    expect(run.report.verdict).toBe("inconclusive");
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("a corrupt Resurrection tarball: invalid-archive", async () => {
    const f = fixture(original);
    const bad = join(root, `bad${counter++}.tgz`);
    writeFileSync(bad, new Uint8Array([1, 2, 3, 4]));
    const run = await runProofOfLife(request(f, original, { kind: "tarball", path: bad }), deps(f));
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["invalid-archive"]);
    expect(run.report.verdict).toBe("inconclusive");
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("an executor whose probe fails: sandbox-unavailable, nothing runs", async () => {
    const f = fixture(original);
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) });
    let opens = 0;
    req.executorFactory = {
      create: (): Executor => ({
        mechanism: "node-permission",
        probe: () =>
          Promise.resolve({ ok: false, error: { kind: "sandbox-unavailable", message: "the permission model is not usable" } }),
        open: () => {
          opens += 1;
          return Promise.reject(new Error("open must not be called"));
        },
        dispose: () => Promise.resolve(),
      }),
    };
    const run = await runProofOfLife(req, deps(f));
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["sandbox-unavailable"]);
    expect(run.report.verdict).toBe("inconclusive");
    expect(opens).toBe(0);
  });

  it("same seed: byte-identical report across two runs", async () => {
    const f = fixture(original);
    const dir = resurrectionDir(mutate(original, { kind: "change-constant", target: 0 }).spec);
    const a = await runProofOfLife(request(f, original, { kind: "directory", path: dir }), deps(f));
    const b = await runProofOfLife(request(f, original, { kind: "directory", path: dir }), deps(f));
    expect(a.json).toBe(b.json);
  });
});

describe("identity values and emit", () => {
  const original = pkg(fn("sum", 0));
  const HOME = "C:\\Users\\zoeblue";
  const env = { USERNAME: "zoeblue", USERPROFILE: HOME };

  it("an identity value in an error message never reaches the sink, the report or the JSON", async () => {
    const f = fixture(original);
    const lines: string[] = [];
    const run = await runProofOfLife(
      request(f, original, { kind: "directory", path: resurrectionDir(original) }, { haunting: [`${HOME}\\work\\zoeblue`] }),
      { ...deps(f, lines, env), platform: "win32" },
    );
    expect(run.report.harnessErrors.map((e) => e.kind)).toEqual(["unknown-function"]);
    expect(lines.length).toBeGreaterThan(0);
    for (const text of [...lines, run.json]) {
      expect(text).not.toContain("zoeblue");
      expect(text).not.toContain(HOME);
    }
    expect(lines.join("\n")).toContain("<user-home>");
  });

  it("a validation message is redacted too and thrown before any file is touched", async () => {
    const f = fixture(original);
    const lines: string[] = [];
    const req = request(f, original, { kind: "directory", path: resurrectionDir(original) });
    Object.assign(req, { [`${HOME}\\zoeblue`]: 1 });
    const error: unknown = await runProofOfLife(req, { ...deps(f, lines, env), platform: "win32" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestValidationError);
    expect((error as Error).message).not.toContain("zoeblue");
    expect(lines.join("\n")).not.toContain("zoeblue");
    expect(readdirSync(f.tempRoot)).toEqual([]);
  });

  it("createEmitter redacts, writes the final text and returns it", () => {
    const lines: string[] = [];
    const emit = createEmitter({ pathValues: [HOME], userName: "zoeblue" }, "win32", (l) => void lines.push(l));
    const out = emit(`failed in ${HOME}\\pkg for zoeblue`);
    expect(out).toBe("failed in <user-home>\\pkg for <user>");
    expect(lines).toEqual([out]);
    expect(emit.leaks()).toBe(0);
  });
});

describe("validateRequest", () => {
  const original = pkg(fn("sum", 0));

  function valid(): ProofRequest {
    const f = fixture(original);
    return request(f, original, { kind: "directory", path: "x" });
  }

  it("accepts a well-formed request", () => {
    expect(() => validateRequest(valid())).not.toThrow();
  });

  it.each([
    ["resurrection", (r: Record<string, unknown>) => void delete r["resurrection"]],
    ["original", (r: Record<string, unknown>) => void delete r["original"]],
    ["harness", (r: Record<string, unknown>) => void delete r["harness"]],
    ["harness.caseCount", (r: Record<string, unknown>) => void ((r["harness"] as Record<string, unknown>)["caseCount"] = 0)],
    ["harness.perCallTimeoutMs", (r: Record<string, unknown>) => void ((r["harness"] as Record<string, unknown>)["perCallTimeoutMs"] = 0)],
    ["harness.seed", (r: Record<string, unknown>) => void ((r["harness"] as Record<string, unknown>)["seed"] = 2 ** 31)],
    ["dependencyRoot", (r: Record<string, unknown>) => void (r["dependencyRoot"] = "/x")],
  ])("rejects a bad %s before any I/O", (field, mutateRequest) => {
    const r = valid() as unknown as Record<string, unknown>;
    r["harness"] = { ...(r["harness"] as Record<string, unknown>) };
    mutateRequest(r);
    let thrown: unknown;
    try {
      validateRequest(r);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RequestValidationError);
    expect(`${(thrown as Error).message}`).toContain(field.split(".").pop() ?? field);
  });

  it("rejects a non-arbitrary args and a relative harness path", () => {
    const r = valid();
    r.harness = { ...r.harness, functions: { sum0: { args: {} as never } } };
    expect(() => validateRequest(r)).toThrow(RequestValidationError);
    const s = valid();
    s.harness = { ...s.harness, setupModule: "relative/setup.js" };
    expect(() => validateRequest(s)).toThrow(RequestValidationError);
  });
});
