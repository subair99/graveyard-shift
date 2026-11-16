// Requirements: 23.24, 5.12, 4.12
// The compiled ip harness (ip preset, deltas.json + harness.json of tests/pipeline/fixtures/ip, the
// recorded measurement docs/measurements/ip-2.0.1.json) run through the real Proof_Engine and the real
// Sandbox_Executor, with the CI case counts of the compiled config (no override) and the full radius.
// Case 1: the Original (recorded ip@2.0.1 tarball) against ip-alive is alive. Case 2 (negative
// control): the Original against itself is not alive and the delta is not demonstrated.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileHarnessFiles } from "../../../src/pipeline/harness/core/compiler";
import { parseIpMeasurement } from "../../../src/pipeline/harness/core/ipMeasurement";
import { IP_EXPORTS } from "../../../src/pipeline/harness/core/presets/ipAddress";
import { runProofOfLife } from "../../../src/proof/index";
import type { HarnessConfig, ProofRun } from "../../../src/proof/types";
import { IP_CERT } from "../helpers/gravediggerCerts";

const ROOT = resolve(__dirname, "../../..");
const FIXTURE = resolve(ROOT, "tests/pipeline/fixtures/ip");
const IP_FIXTURES = resolve(ROOT, "tests/proof/fixtures");
const ORIGINAL_TARBALL = join(IP_FIXTURES, "ip", "ip-2.0.1.tgz");
const ORIGINAL_META = join(IP_FIXTURES, "ip", "ip-2.0.1.meta.json");
const ALIVE_DIR = join(IP_FIXTURES, "ip-alive");

let workDir = "";
let config: HarnessConfig;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "graveyard-ip-alive-"));
  const measurement = parseIpMeasurement(readFileSync(join(ROOT, "docs/measurements/ip-2.0.1.json"), "utf8"));
  if (!measurement.ok) throw new Error(measurement.error.issues.join("; "));
  const compiled = compileHarnessFiles({
    deltasJson: readFileSync(join(FIXTURE, "deltas.json"), "utf8"),
    harnessJson: readFileSync(join(FIXTURE, "harness.json"), "utf8"),
    certificate: IP_CERT,
    measurement: measurement.value,
    returnsExpected: {
      template: readFileSync(join(ROOT, "src/pipeline/harness/sandbox/returnsExpected.cjs"), "utf8"),
      modulesDir: workDir,
    },
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  for (const m of compiled.value.modules) writeFileSync(join(workDir, m.name), m.text, "utf8");
  config = compiled.value.config;
});

afterAll(() => {
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

async function prove(resurrection: { kind: "directory"; path: string } | { kind: "tarball"; path: string }) {
  const meta = JSON.parse(readFileSync(ORIGINAL_META, "utf8")) as { integrity: string };
  return runProofOfLife({
    original: { name: "ip", version: "2.0.1", tarballPath: ORIGINAL_TARBALL, integrity: meta.integrity },
    resurrection,
    harness: config,
  });
}

function summary(run: ProofRun): string {
  const r = run.report;
  return JSON.stringify({
    verdict: r.verdict,
    harnessErrors: r.harnessErrors,
    divergences: r.divergences.map((d) => ({ ...d })),
    deltas: r.deltas,
    nonDeterministicFunctions: r.nonDeterministicFunctions,
  });
}

describe("ip harness (real engine, real sandbox)", () => {
  it("Original vs ip-alive is alive, the isPublic delta is demonstrated, every export is covered", { timeout: 120_000 }, async () => {
    const run = await prove({ kind: "directory", path: ALIVE_DIR });
    const r = run.report;
    expect(r.harnessErrors, summary(run)).toEqual([]);
    expect(r.harnessErrors.some((e) => e.kind === "missing-generator")).toBe(false);
    expect(r.verdict, summary(run)).toBe("alive");
    expect(r.divergences).toEqual([]);
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]).toMatchObject({ function: "isPublic", status: "demonstrated" });
    expect([...r.functionsTested].sort()).toEqual([...IP_EXPORTS].sort());
    expect(r.functionsTested).toHaveLength(20);
  });

  it("negative control: the Original against itself is not alive and the delta is not demonstrated", { timeout: 120_000 }, async () => {
    const run = await prove({ kind: "tarball", path: ORIGINAL_TARBALL });
    const r = run.report;
    expect(r.verdict).not.toBe("alive");
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]).toMatchObject({ function: "isPublic", status: "not-demonstrated" });
  });
});
