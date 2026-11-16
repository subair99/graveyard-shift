// Requirements: 4.12, 4.13, 4.14, 4.20, 3.5, 3.6, 3.7
// The ip Deltas_File and Harness_File examples (test data, not Medium output) compile against the
// ip certificate and the recorded measurement; an input the Original did not measure as true is a
// compile error (the compile half of Property 5).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { compileHarnessFiles, type CompileError } from "../../../src/pipeline/harness/core/compiler";
import { canonicalDeltasJson, parseDeltasFile } from "../../../src/pipeline/harness/core/deltas";
import { canonicalHarnessJson, parseHarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import { parseIpMeasurement } from "../../../src/pipeline/harness/core/ipMeasurement";
import { IP_EXPORTS, IP_SETUP_MODULE_PATH } from "../../../src/pipeline/harness/core/presets/ipAddress";
import { IP_CERT } from "../helpers/gravediggerCerts";

const read = (p: string): string => readFileSync(p, "utf8");
const DELTAS_JSON = read("tests/pipeline/fixtures/ip/deltas.json");
const HARNESS_JSON = read("tests/pipeline/fixtures/ip/harness.json");
const TEMPLATE = read("src/pipeline/harness/sandbox/returnsExpected.cjs");
const MODULES_DIR = resolve(tmpdir(), "graveyard-test-ip-modules");

const parsed = parseIpMeasurement(read("docs/measurements/ip-2.0.1.json"));
if (!parsed.ok) throw new Error(`measurement: ${parsed.error.issues.join("; ")}`);
const MEASUREMENT = parsed.value;

const ADVISORY_ADDRESSES = ["127.1", "01200034567", "012.1.2.3", "000:0:0000::01", "::fFFf:127.0.0.1"];

function compile(deltasJson = DELTAS_JSON, harnessJson = HARNESS_JSON, measurement = MEASUREMENT) {
  return compileHarnessFiles({
    deltasJson,
    harnessJson,
    certificate: IP_CERT,
    measurement,
    returnsExpected: { template: TEMPLATE, modulesDir: MODULES_DIR },
  });
}

function errorsOf(r: ReturnType<typeof compile>): CompileError[] {
  if (r.ok) throw new Error("expected a compile failure");
  return r.error;
}

describe("ip example files", () => {
  it("are canonical bytes: no BOM, no trailing newline", () => {
    for (const text of [DELTAS_JSON, HARNESS_JSON]) {
      expect(text.charCodeAt(0)).not.toBe(0xfeff);
      expect(text.endsWith("\n")).toBe(false);
    }
    const d = parseDeltasFile(DELTAS_JSON);
    const h = parseHarnessFile(HARNESS_JSON);
    if (!d.ok || !h.ok) throw new Error("example files do not parse");
    expect(canonicalDeltasJson(d.value)).toBe(DELTAS_JSON);
    expect(canonicalHarnessJson(h.value)).toBe(HARNESS_JSON);
  });

  it("compile: 20 exports, setup module set, one class delta on isPublic with the measured-true addresses as cases", () => {
    const r = compile();
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const { config, modules, presetsUsed } = r.value;
    expect(presetsUsed).toEqual(["ip-address"]);
    expect(Object.keys(config.functions).sort()).toEqual([...IP_EXPORTS].sort());
    expect(config.setupModule).toBe(IP_SETUP_MODULE_PATH);
    expect(config.deltas.map((d) => [d.id, d.function])).toEqual([["is-public-advisory", "isPublic"]]);
    expect(config.deltas[0]?.explicitCases).toEqual(ADVISORY_ADDRESSES.map((a) => [a]));
    expect(modules.map((m) => m.name)).toEqual(["returns-expected-is-public-advisory.cjs"]);
  });

  it("hold one returns-expected-class delta: isPublic, class non-public-address, expected false, five cases", () => {
    const d = parseDeltasFile(DELTAS_JSON);
    if (!d.ok) throw new Error("does not parse");
    expect(d.value.deltas).toHaveLength(1);
    const only = d.value.deltas[0];
    expect(only).toMatchObject({
      kind: "returns-expected-class",
      id: "is-public-advisory",
      function: "isPublic",
      advisory: "GHSA-2p57-rm9w-gvfp",
      class: "non-public-address",
      expected: false,
    });
    if (only?.kind !== "returns-expected-class") throw new Error("wrong kind");
    expect(only.cases.map((c) => c.input[0])).toEqual(ADVISORY_ADDRESSES);
    expect(only.cases.every((c) => c.source.url === "https://github.com/advisories/GHSA-2p57-rm9w-gvfp" && c.source.fetchedAt === "2026-11-15T00:00:00Z")).toBe(true);
  });

  it("reject a delta on isPrivate, isLoopback or another function (allowlist)", () => {
    for (const name of ["isPrivate", "isLoopback", "isV4Format", "toLong"]) {
      const moved = DELTAS_JSON.replace('"function":"isPublic"', `"function":"${name}"`);
      expect(moved).not.toBe(DELTAS_JSON);
      const errors = errorsOf(compile(moved));
      expect(errors.map((e) => e.code)).toEqual(["delta-function-not-allowed"]);
      expect(errors[0]?.message).toContain(`"${name}"`);
    }
  });

  it("reject 0 and 017700000001 as explicit cases", () => {
    for (const address of ["0", "017700000001"]) {
      const changed = DELTAS_JSON.replace('"input":["127.1"]', `"input":["${address}"]`);
      expect(changed).not.toBe(DELTAS_JSON);
      const errors = errorsOf(compile(changed));
      expect(errors.map((e) => e.code)).toEqual(["input-not-measured"]);
      expect(errors[0]?.deltaId).toBe("is-public-advisory");
    }
  });

  it("reject an input the Original did not measure as true", () => {
    const withExtra = DELTAS_JSON.replace('"input":["127.1"]', '"input":["8.8.8.8"]');
    expect(withExtra).not.toBe(DELTAS_JSON);
    const errors = errorsOf(compile(withExtra));
    expect(errors.map((e) => e.code)).toEqual(["input-not-measured"]);
    expect(errors[0]?.deltaId).toBe("is-public-advisory");
  });

  it("reject an address whose measured result was not true", () => {
    const changed = {
      ...MEASUREMENT,
      results: MEASUREMENT.results.map((m) =>
        m.input === "127.1" ? { ...m, outcome: { kind: "returned" as const, value: false } } : m,
      ),
    };
    const errors = errorsOf(compile(DELTAS_JSON, HARNESS_JSON, changed));
    expect(errors.map((e) => e.code)).toEqual(["input-not-measured"]);
  });
  it("need the measurement", () => {
    const r = compileHarnessFiles({
      deltasJson: DELTAS_JSON,
      harnessJson: HARNESS_JSON,
      certificate: IP_CERT,
      returnsExpected: { template: TEMPLATE, modulesDir: MODULES_DIR },
    });
    expect(errorsOf(r).map((e) => e.code)).toEqual(["measurement-required"]);
  });
});
