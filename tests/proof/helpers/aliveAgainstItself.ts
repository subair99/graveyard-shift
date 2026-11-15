// Shared setup for the Property 25 files (p25a to p25d): the same synthetic package is the Original
// (tarball with SRI) and the Resurrection (directory copy or tarball). Runs use the InProcess_Executor.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { HarnessConfig, ProofReport, ProofRequest } from "../../../src/proof/types";
import { fc } from "../../engine/helpers/fc";
import { buildSyntheticTarball, tarballOf } from "./buildTarball";
import { BEHAVIORS, DETERMINISTIC_BEHAVIORS, packageFiles, writePackage } from "./syntheticPackage";
import type { BehaviorId, SyntheticPackageSpec } from "./syntheticPackage";

export const hasUnencodable = (id: BehaviorId): boolean => {
  const u = BEHAVIORS[id].unencodable;
  return u.cycle + u.getter + u.proxy > 0;
};

/** Deterministic behaviors whose Outcomes are always encodable (async, mutating, throwing, Date/Map/Set/RegExp/typed arrays included). */
export const EVIDENCE: readonly BehaviorId[] = [
  ...DETERMINISTIC_BEHAVIORS.filter((id) => !hasUnencodable(id)),
  // The engine seeds Math.random per call (child/stubs.ts), so `random` is repeatable and alive against itself.
  "random",
];
export const UNENCODABLE: readonly BehaviorId[] = DETERMINISTIC_BEHAVIORS.filter(hasUnencodable);
/** Module-level state that changes the result between calls with equal inputs (not stubbed by the engine). */
export const FLAKY: readonly BehaviorId[] = ["counter"];

/** Smallest packages that still exercise every property: at most 2 functions, 3 to 5 Cases each. */
export const MAX_FUNCTIONS = 2;
export const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });
export const caseCountArb = fc.integer({ min: 3, max: 5 });

export const TIMEOUT_MS = 120_000;

export type Form = "directory" | "tarball";

export interface AgainstItself {
  setup(): void;
  teardown(): void;
  run(spec: SyntheticPackageSpec, seed: number, caseCount: number, form: Form): Promise<ProofReport>;
}

/** One work root per test file; call `setup` in beforeAll and `teardown` in afterAll. */
export function createAgainstItself(prefix: string): AgainstItself {
  let root = "";
  let counter = 0;
  return {
    setup() {
      root = mkdtempSync(join(tmpdir(), prefix));
    },
    teardown() {
      rmSync(root, { recursive: true, force: true });
    },
    async run(spec, seed, caseCount, form) {
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
    },
  };
}

export function expectBaseline(report: ProofReport, spec: SyntheticPackageSpec): void {
  expect(report.harnessErrors).toEqual([]);
  expect(report.divergences).toEqual([]);
  expect(report.deltas).toEqual([]);
  expect(report.functionsTested).toEqual(spec.functions.map((f) => f.exportName).sort());
  for (const c of report.casesPerFunction) expect(c.cases).toBeGreaterThan(0);
}

/** casesWithUnencodable must equal what the behavior's oracle predicts. */
export function expectUnencodableOracle(report: ProofReport, spec: SyntheticPackageSpec): void {
  for (const f of spec.functions) {
    const u = report.unencodableValues.find((x) => x.function === f.exportName);
    expect(u, f.exportName).toBeDefined();
    if (u === undefined) continue;
    expect(u.cases).toBeGreaterThan(0);
    expect(u.casesWithUnencodable).toBe(hasUnencodable(f.behavior) ? u.cases : 0);
  }
}
