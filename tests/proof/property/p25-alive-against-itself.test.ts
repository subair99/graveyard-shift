// Feature: proof-of-life-engine, Property 25: A package is alive against itself
// Validates: Requirements 15.3 (and 12.1 to 12.7, 9.4 for the controls)
//
// The same synthetic package is the Original (tarball with SRI) and the Resurrection (directory
// copy, and in a second property a tarball). Runs use the InProcess_Executor.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { HarnessConfig, ProofReport, ProofRequest } from "../../../src/proof/types";
import { fc, fcParams } from "../../engine/helpers/fc";
import { buildSyntheticTarball, tarballOf } from "../helpers/buildTarball";
import {
  BEHAVIORS,
  DETERMINISTIC_BEHAVIORS,
  packageFiles,
  syntheticPackageArb,
  writePackage,
} from "../helpers/syntheticPackage";
import type { BehaviorId, SyntheticPackageSpec } from "../helpers/syntheticPackage";

const hasUnencodable = (id: BehaviorId): boolean => {
  const u = BEHAVIORS[id].unencodable;
  return u.cycle + u.getter + u.proxy > 0;
};

/** Deterministic behaviors whose Outcomes are always encodable (async, mutating, throwing, Date/Map/Set/RegExp/typed arrays included). */
const EVIDENCE: readonly BehaviorId[] = [
  ...DETERMINISTIC_BEHAVIORS.filter((id) => !hasUnencodable(id)),
  // The engine seeds Math.random per call (child/stubs.ts), so `random` is repeatable and alive against itself.
  "random",
];
const UNENCODABLE: readonly BehaviorId[] = DETERMINISTIC_BEHAVIORS.filter(hasUnencodable);
/** Module-level state that changes the result between calls with equal inputs (not stubbed by the engine). */
const FLAKY: readonly BehaviorId[] = ["counter"];

const TIMEOUT_MS = 120_000;

let root: string;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gs-p25-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

type Form = "directory" | "tarball";

async function runAgainstItself(
  spec: SyntheticPackageSpec,
  seed: number,
  caseCount: number,
  form: Form,
): Promise<ProofReport> {
  const dir = join(root, `run${counter++}`);
  const tempRoot = join(dir, "tmp");
  mkdirSync(tempRoot, { recursive: true });
  try {
    const built = buildSyntheticTarball(spec);
    const originalPath = join(dir, "original.tgz");
    writeFileSync(originalPath, built.bytes);

    let resurrection: ProofRequest["resurrection"];
    if (form === "directory") {
      const copy = join(dir, "resurrection");
      writePackage(spec, copy);
      resurrection = { kind: "directory", path: copy };
    } else {
      const tgz = join(dir, "resurrection.tgz");
      writeFileSync(tgz, tarballOf(packageFiles(spec)).bytes);
      resurrection = { kind: "tarball", path: tgz };
    }

    const harness: HarnessConfig = {
      package: spec.name,
      seed,
      caseCount,
      perCallTimeoutMs: 1000,
      heapLimitMb: 64,
      outputLimitBytes: 100_000,
      maxRestarts: 5,
      shrinkBudget: 50,
      functions: Object.fromEntries(spec.functions.map((f) => [f.exportName, { args: BEHAVIORS[f.behavior].args }])),
      deltas: [],
    };
    const run = await runProofOfLife(
      {
        original: { name: spec.name, version: spec.version, tarballPath: originalPath, integrity: built.integrity },
        resurrection,
        harness,
        executorFactory: createInProcessExecutorFactory({ acknowledgeUnsandboxed: true }),
      },
      { tempRoot, env: {}, sink: () => undefined },
    );
    expect(readdirSync(tempRoot)).toEqual([]);
    return run.report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });
const caseCountArb = fc.integer({ min: 5, max: 8 });

function expectBaseline(report: ProofReport, spec: SyntheticPackageSpec): void {
  expect(report.harnessErrors).toEqual([]);
  expect(report.divergences).toEqual([]);
  expect(report.deltas).toEqual([]);
  expect(report.functionsTested).toEqual(spec.functions.map((f) => f.exportName).sort());
  for (const c of report.casesPerFunction) expect(c.cases).toBeGreaterThan(0);
}

/** casesWithUnencodable must equal what the behavior's oracle predicts. */
function expectUnencodableOracle(report: ProofReport, spec: SyntheticPackageSpec): void {
  for (const f of spec.functions) {
    const u = report.unencodableValues.find((x) => x.function === f.exportName);
    expect(u, f.exportName).toBeDefined();
    if (u === undefined) continue;
    expect(u.cases).toBeGreaterThan(0);
    expect(u.casesWithUnencodable).toBe(hasUnencodable(f.behavior) ? u.cases : 0);
  }
}

describe("Property 25: A package is alive against itself", () => {
  for (const form of ["directory", "tarball"] as const) {
    it(`alive with zero divergences (Resurrection as ${form})`, async () => {
      await fc.assert(
        fc.asyncProperty(syntheticPackageArb({ behaviors: EVIDENCE, maxFunctions: 3 }), seedArb, caseCountArb, async (spec, seed, caseCount) => {
          const report = await runAgainstItself(spec, seed, caseCount, form);
          expectBaseline(report, spec);
          expect(report.nonDeterministicFunctions).toEqual([]);
          expectUnencodableOracle(report, spec);
          expect(report.verdict).toBe("alive");
        }),
        fcParams(),
      );
    }, TIMEOUT_MS);
  }

  it("a function whose every Case is unencodable gives inconclusive (never alive)", async () => {
    await fc.assert(
      fc.asyncProperty(
        syntheticPackageArb({ behaviors: [...EVIDENCE, ...UNENCODABLE] }).filter((s) =>
          s.functions.some((f) => hasUnencodable(f.behavior)),
        ),
        seedArb,
        caseCountArb,
        async (spec, seed, caseCount) => {
          const report = await runAgainstItself(spec, seed, caseCount, "directory");
          expectBaseline(report, spec);
          expectUnencodableOracle(report, spec);
          expect(report.verdict).toBe("inconclusive");
        },
      ),
      fcParams(),
    );
  }, TIMEOUT_MS);

  it("negative control: flaky functions differ from themselves, so the verdict is inconclusive, never alive or restless", async () => {
    await fc.assert(
      fc.asyncProperty(
        syntheticPackageArb({ behaviors: [...EVIDENCE, ...FLAKY] }).filter((s) =>
          s.functions.some((f) => FLAKY.includes(f.behavior)),
        ),
        seedArb,
        caseCountArb,
        async (spec, seed, caseCount) => {
          const report = await runAgainstItself(spec, seed, caseCount, "directory");
          const flaky = spec.functions.filter((f) => FLAKY.includes(f.behavior)).map((f) => f.exportName).sort();
          expect(report.harnessErrors).toEqual([]);
          expect(report.divergences).toEqual([]);
          expect(report.nonDeterministicFunctions.map((n) => n.function).sort()).toEqual(flaky);
          expect(report.verdict).toBe("inconclusive");
        },
      ),
      fcParams(),
    );
  }, TIMEOUT_MS);
});
