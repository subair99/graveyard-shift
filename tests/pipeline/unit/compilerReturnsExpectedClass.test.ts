// Requirements: 4.2, 4.13, 4.14, 4.15, 4.16, 4.20, 3.6, 3.7, 4.8, 4.10
// The `returns-expected-class` lowering and the preset delta allowlist, compiled against small test
// presets injected through `CompileInput.presets` (the real ip class comes in task 12.11).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compileHarness,
  compileHarnessFiles,
  type CompileError,
  type CompileInput,
} from "../../../src/pipeline/harness/core/compiler";
import { parseIpMeasurement } from "../../../src/pipeline/harness/core/ipMeasurement";
import type { Preset, PresetMenu } from "../../../src/pipeline/harness/core/presets";
import { IP_ADDRESS_PRESET } from "../../../src/pipeline/harness/core/presets/ipAddress";
import { LODASH_SET_PRESET } from "../../../src/pipeline/harness/core/presets/lodashSet";
import { IP_CERT, LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const TEMPLATE = readFileSync("src/pipeline/harness/sandbox/returnsExpected.cjs", "utf8");
const MODULES_DIR = resolve(tmpdir(), "graveyard-test-class-modules");
const SOURCE = { url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", fetchedAt: "2026-11-15T10:00:00Z" };
const IP_SOURCE = { url: "https://github.com/advisories/GHSA-2p57-rm9w-gvfp", fetchedAt: "2026-11-15T10:00:00Z" };

const measured = parseIpMeasurement(readFileSync("docs/measurements/ip-2.0.1.json", "utf8"));
if (!measured.ok) throw new Error(`measurement: ${measured.error.issues.join("; ")}`);
const MEASUREMENT = measured.value;

// A fake class: a call is in the class when its first argument is a negative number.
const isNegativeFirst = (args: readonly unknown[]): boolean => typeof args[0] === "number" && args[0] < 0;

const TEST_LODASH: Preset = {
  ...LODASH_SET_PRESET,
  name: "test-lodash",
  functions: ["default", "other"],
  deltaFunctions: ["default"],
  inputClasses: { "negative-first": isNegativeFirst },
};
const LODASH_MENU: PresetMenu = { [TEST_LODASH.name]: TEST_LODASH };

// A fake ip preset with a class that selects only the string "8.8.8.8" (so the menu is not empty).
const TEST_IP: Preset = {
  ...IP_ADDRESS_PRESET,
  name: "ip-address",
  inputClasses: { "only-google": (args) => args[0] === "8.8.8.8" },
};
const IP_MENU: PresetMenu = { [TEST_IP.name]: TEST_IP };

const classDelta = (over: Record<string, unknown> = {}) => ({
  kind: "returns-expected-class",
  id: "neg-class",
  function: "default",
  advisory: "GHSA-p6mc-m468-83gw",
  class: "negative-first",
  expected: { ok: false },
  cases: [{ input: [-1, "a"], source: SOURCE }, { input: [-5], source: SOURCE }],
  ...over,
});

function lodashInput(deltas: unknown[], extra: Partial<CompileInput> = {}): CompileInput {
  return {
    deltas: { schemaVersion: 1, package: "lodash.set", deltas },
    harness: {
      schemaVersion: 1,
      package: "lodash.set",
      functions: { default: { preset: "test-lodash" }, other: { preset: "test-lodash" } },
    },
    certificate: LODASH_SET_CERT,
    returnsExpected: { template: TEMPLATE, modulesDir: MODULES_DIR },
    presets: LODASH_MENU,
    ...extra,
  } as CompileInput;
}

function ipInput(deltas: unknown[], extra: Partial<CompileInput> = {}): CompileInput {
  return {
    deltas: { schemaVersion: 1, package: "ip", deltas },
    harness: { schemaVersion: 1, package: "ip", functions: { isPublic: { preset: "ip-address" }, isPrivate: { preset: "ip-address" } } },
    certificate: IP_CERT,
    measurement: MEASUREMENT,
    returnsExpected: { template: TEMPLATE, modulesDir: MODULES_DIR },
    presets: IP_MENU,
    ...extra,
  } as CompileInput;
}

const ipClassDelta = (inputs: string[], over: Record<string, unknown> = {}) => ({
  kind: "returns-expected-class",
  id: "ip-class",
  function: "isPublic",
  advisory: "GHSA-2p57-rm9w-gvfp",
  class: "only-google",
  expected: false,
  cases: inputs.map((i) => ({ input: [i], source: IP_SOURCE })),
  ...over,
});

function errorsOf(i: CompileInput): CompileError[] {
  const r = compileHarness(i);
  if (r.ok) throw new Error("expected a compile failure");
  return r.error;
}

function load(text: string): { check: (ctx: unknown) => { ok: boolean } } {
  const dir = mkdtempSync(join(tmpdir(), "re-class-module-"));
  try {
    const file = join(dir, "m.cjs");
    writeFileSync(file, text, "utf8");
    return createRequire(import.meta.url)(file) as ReturnType<typeof load>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("returns-expected-class lowering", () => {
  it("uses the class predicate, the listed cases and one generated module with the expected value", () => {
    const r = compileHarness(lodashInput([classDelta()]));
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const { config, modules } = r.value;
    const modulePath = join(MODULES_DIR, "returns-expected-neg-class.cjs");
    expect(modules.map((m) => m.name)).toEqual(["returns-expected-neg-class.cjs"]);
    const d = config.deltas[0]!;
    expect(d.id).toBe("neg-class");
    expect(d.propertyModule).toBe(modulePath);
    expect(d.explicitCases).toEqual([[-1, "a"], [-5]]);
    expect(d.generator).toBeUndefined();
    expect(config.readPaths).toEqual([modulePath]);
    // The predicate selects class members only, including inputs that are not listed cases.
    expect(d.predicate([-1, "a"])).toBe(true);
    expect(d.predicate([-99])).toBe(true);
    expect(d.predicate([1])).toBe(false);
    expect(d.predicate([])).toBe(false);
    // The module embeds the single expected value.
    const m = load(modules[0]!.text);
    const ctx = (result: unknown) => ({ functionName: "default", kind: "returned", prototypeDelta: [], result });
    expect(m.check(ctx({ ok: false })).ok).toBe(true);
    expect(m.check(ctx({ ok: true })).ok).toBe(false);
    expect(m.check(ctx(undefined)).ok).toBe(false);
  });

  it("is idempotent: two compilations give equal modules and delta data", () => {
    const i = lodashInput([classDelta({ id: "b" }), classDelta({ id: "a", expected: 1 })]);
    const a = compileHarness(i);
    const b = compileHarness(i);
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(b.value.modules).toEqual(a.value.modules);
    expect(a.value.modules.map((m) => m.name)).toEqual(["returns-expected-a.cjs", "returns-expected-b.cjs"]);
    const data = (c: typeof a.value) =>
      c.config.deltas.map((d) => [d.id, d.function, d.propertyModule, d.explicitCases]);
    expect(data(b.value)).toEqual(data(a.value));
  });

  it("needs the module template and directory", () => {
    const { returnsExpected: _r, ...rest } = lodashInput([classDelta()]);
    expect(errorsOf(rest as CompileInput).map((e) => e.code)).toEqual(["module-output-required"]);
  });

  it("rejects a case without a source", () => {
    const errors = errorsOf(lodashInput([classDelta({ cases: [{ input: [-1] }] })]));
    expect(errors.map((e) => e.code)).toEqual(["missing-source"]);
  });
});

describe("class menu (R4.16)", () => {
  it("rejects a class that is not in the preset menu, naming the delta and the class", () => {
    const errors = errorsOf(lodashInput([classDelta({ class: "no-such-class" })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "unknown-class", deltaId: "neg-class", key: "no-such-class" });
    expect(errors[0]?.message).toContain('"neg-class"');
    expect(errors[0]?.message).toContain('"no-such-class"');
    expect(errors[0]?.message).toContain("negative-first");
  });

  it("the real menu is looked up by default: the ip-address class menu is exactly non-public-address", () => {
    expect(Object.keys(IP_ADDRESS_PRESET.inputClasses)).toEqual(["non-public-address"]);

    const { presets: _p, ...ok } = ipInput([ipClassDelta(["127.1"], { class: "non-public-address" })]);
    const r = compileHarness(ok as CompileInput);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.config.deltas[0]?.id).toBe("ip-class");

    const { presets: _q, ...bad } = ipInput([ipClassDelta(["127.1"], { class: "no-such-class" })]);
    const errors = errorsOf(bad as CompileInput);
    expect(errors.map((e) => e.code)).toEqual(["unknown-class"]);
    expect(errors[0]?.message).toContain('"ip-class"');
    expect(errors[0]?.message).toContain('"no-such-class"');
  });

  it("rejects a predicate or code field in the file text with a key error", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      package: "lodash.set",
      deltas: [classDelta({ predicate: "(a) => true" })],
    });
    const r = compileHarnessFiles({
      deltasJson: text,
      harnessJson: JSON.stringify({ schemaVersion: 1, package: "lodash.set", functions: { default: { preset: "test-lodash" } } }),
      certificate: LODASH_SET_CERT,
      returnsExpected: { template: TEMPLATE, modulesDir: MODULES_DIR },
      presets: LODASH_MENU,
    });
    if (r.ok) throw new Error("expected a failure");
    expect(r.error.some((e) => e.code === "forbidden-key" && e.key === "predicate")).toBe(true);
  });
});

describe("preset delta allowlist (R4.13, R4.20)", () => {
  const onOther: Record<string, unknown> = {
    "prototype-unchanged": { kind: "prototype-unchanged", id: "d", function: "other", advisory: "GHSA-p6mc-m468-83gw" },
    "returns-expected": {
      kind: "returns-expected",
      id: "d",
      function: "other",
      advisory: "GHSA-p6mc-m468-83gw",
      cases: [{ input: ["a"], expected: 1, source: SOURCE }],
    },
    "returns-expected-class": classDelta({ id: "d", function: "other" }),
  };

  for (const kind of Object.keys(onOther)) {
    it(`rejects a ${kind} delta on a function outside the allowlist, naming the delta and the function`, () => {
      const errors = errorsOf(lodashInput([onOther[kind]]));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "delta-function-not-allowed", deltaId: "d", key: "other" });
      expect(errors[0]?.message).toContain('"d"');
      expect(errors[0]?.message).toContain('"other"');
    });
  }

  it("the registered presets carry the allowlists of the design", () => {
    expect(LODASH_SET_PRESET.deltaFunctions).toEqual(["default"]);
    expect(IP_ADDRESS_PRESET.deltaFunctions).toEqual(["isPublic"]);
  });

  it("rejects any ip delta on isPrivate", () => {
    const errors = errorsOf(ipInput([ipClassDelta(["127.1"], { function: "isPrivate" })]));
    expect(errors.map((e) => e.code)).toEqual(["delta-function-not-allowed"]);
    expect(errors[0]?.message).toContain('"isPrivate"');
  });
});

describe("ip explicit cases of a class delta (A10, compile half of Property 5)", () => {
  const ADVISORY = ["127.1", "01200034567", "012.1.2.3", "000:0:0000::01", "::fFFf:127.0.0.1"];

  it("compiles with the measured-true addresses as cases", () => {
    const r = compileHarness(ipInput([ipClassDelta(ADVISORY)]));
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.config.deltas[0]?.explicitCases).toEqual(ADVISORY.map((a) => [a]));
  });

  it("rejects 0 and 017700000001 as explicit cases", () => {
    for (const address of ["0", "017700000001"]) {
      const errors = errorsOf(ipInput([ipClassDelta([address])]));
      expect(errors.map((e) => e.code)).toEqual(["input-not-measured"]);
    }
  });

  it("rejects a case measured false, and needs the measurement", () => {
    const changed = {
      ...MEASUREMENT,
      results: MEASUREMENT.results.map((m) =>
        m.input === "127.1" ? { ...m, outcome: { kind: "returned" as const, value: false } } : m,
      ),
    };
    expect(errorsOf(ipInput([ipClassDelta(["127.1"])], { measurement: changed })).map((e) => e.code)).toEqual([
      "input-not-measured",
    ]);
    const { measurement: _m, ...rest } = ipInput([ipClassDelta(["127.1"])]);
    expect(errorsOf(rest as CompileInput).map((e) => e.code)).toEqual(["measurement-required"]);
  });

  it("Property 5 (class cases): compiles exactly when every case is a measured-true address", () => {
    const pool = [...ADVISORY, "0", "017700000001", "8.8.8.8", "10.0.0.1"];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...pool), { minLength: 1, maxLength: 6 }), (inputs) => {
        const r = compileHarness(ipInput([ipClassDelta(inputs)]));
        expect(r.ok).toBe(inputs.every((i) => ADVISORY.includes(i)));
      }),
      { numRuns: 60 },
    );
  });
});
