// Requirements: 5.4, 5.12, 5.13, 5.14, 12.12
// A Harness_File that omits one function never gives `alive`. The compiler does not check coverage of
// the package's exports (it only knows the preset's list), so an omitted function without a delta
// compiles; the engine then ends the run `inconclusive` with the harness error `missing-generator`
// (it fails before any function is called). An omitted function that a delta names is a compile error.
// The `--radius` half of 12.12 is the example test in tests/pipeline/unit/proveEntry.test.ts
// ("never contains --radius and has the fixed shape"); it is not repeated here.
//
// The engine run uses the real Sandbox_Executor with the recorded ip@2.0.1 tarball; it only opens
// both sides and lists exports, so it is fast.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileHarnessFiles } from "../../../src/pipeline/harness/core/compiler";
import { parseIpMeasurement } from "../../../src/pipeline/harness/core/ipMeasurement";
import { runProofOfLife } from "../../../src/proof/index";
import { IP_CERT } from "../helpers/gravediggerCerts";

const ROOT = resolve(__dirname, "../../..");
const FIXTURE = resolve(ROOT, "tests/pipeline/fixtures/ip");
const ORIGINAL_TARBALL = join(ROOT, "tests/proof/fixtures/ip/ip-2.0.1.tgz");
const ORIGINAL_META = join(ROOT, "tests/proof/fixtures/ip/ip-2.0.1.meta.json");

const DELTAS_JSON = readFileSync(join(FIXTURE, "deltas.json"), "utf8");
const TEMPLATE = readFileSync(join(ROOT, "src/pipeline/harness/sandbox/returnsExpected.cjs"), "utf8");
const parsedMeasurement = parseIpMeasurement(readFileSync(join(ROOT, "docs/measurements/ip-2.0.1.json"), "utf8"));
if (!parsedMeasurement.ok) throw new Error(parsedMeasurement.error.issues.join("; "));
const MEASUREMENT = parsedMeasurement.value;

let workDir = "";
beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "graveyard-missing-gen-"));
});
afterAll(() => {
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

/** The ip harness.json without one function entry. */
function harnessWithout(fn: string): string {
  const h = JSON.parse(readFileSync(join(FIXTURE, "harness.json"), "utf8")) as { functions: Record<string, unknown> };
  expect(Object.keys(h.functions)).toContain(fn);
  delete h.functions[fn];
  return JSON.stringify(h);
}

function compile(harnessJson: string) {
  return compileHarnessFiles({
    deltasJson: DELTAS_JSON,
    harnessJson,
    certificate: IP_CERT,
    measurement: MEASUREMENT,
    returnsExpected: { template: TEMPLATE, modulesDir: workDir },
  });
}

describe("a Harness_File that omits one function", () => {
  it("compiles when no delta names it, and the compiled config has no entry for it", () => {
    const r = compile(harnessWithout("toLong"));
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(Object.keys(r.value.config.functions)).toHaveLength(19);
    expect(Object.keys(r.value.config.functions)).not.toContain("toLong");
  });

  it("is a compile error when a delta names the omitted function", () => {
    const r = compile(harnessWithout("isPublic"));
    if (r.ok) throw new Error("expected a compile failure");
    expect(r.error.map((e) => e.code)).toEqual(["delta-function-not-selected"]);
  });

  it(
    "ends the engine run inconclusive with missing-generator, never alive (real sandbox)",
    { timeout: 30_000 },
    async () => {
      const r = compile(harnessWithout("toLong"));
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      const meta = JSON.parse(readFileSync(ORIGINAL_META, "utf8")) as { integrity: string };
      const lines: string[] = [];
      const run = await runProofOfLife(
        {
          original: { name: "ip", version: "2.0.1", tarballPath: ORIGINAL_TARBALL, integrity: meta.integrity },
          resurrection: { kind: "tarball", path: ORIGINAL_TARBALL },
          harness: r.value.config,
        },
        { sink: (line) => lines.push(line) },
      );
      expect(lines.join("\n")).toContain('no generator is defined for "toLong"');
      expect(run.report.harnessErrors.map((e) => [e.kind, e.function])).toEqual([["missing-generator", "toLong"]]);
      expect(run.report.verdict).toBe("inconclusive");
      expect(run.report.verdict).not.toBe("alive");
      expect(run.report.functionsTested).toEqual([]);
    },
  );
});
