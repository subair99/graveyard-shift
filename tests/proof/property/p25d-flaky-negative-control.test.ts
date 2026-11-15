// Feature: proof-of-life-engine, Property 25: A package is alive against itself
// Requirements: 9.3, 9.4, 9.5, 15.3
// Validates: Requirements 15.3 (and 12.1 to 12.7, 9.4 for the controls)
//
// Part d, negative control: flaky functions differ from themselves, so the verdict is
// inconclusive, never alive or restless.
// Split from the former p25-alive-against-itself.test.ts so the parts run in parallel.
// Reduced inner size (assertions unchanged, numRuns stays fcParams()): maxFunctions default 4 -> 2
// and caseCount 5..8 -> 3..5 per generated package, to keep the project under its 60 s target.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import { EVIDENCE, FLAKY, MAX_FUNCTIONS, TIMEOUT_MS, caseCountArb, createAgainstItself, seedArb } from "../helpers/aliveAgainstItself";
import { syntheticPackageArb } from "../helpers/syntheticPackage";

const h = createAgainstItself("gs-p25d-");
beforeAll(() => h.setup());
afterAll(() => h.teardown());

describe("Feature: proof-of-life-engine, Property 25: A package is alive against itself", () => {
  it("negative control: flaky functions differ from themselves, so the verdict is inconclusive, never alive or restless", async () => {
    await fc.assert(
      fc.asyncProperty(
        syntheticPackageArb({ behaviors: [...EVIDENCE, ...FLAKY], maxFunctions: MAX_FUNCTIONS }).filter((s) =>
          s.functions.some((f) => FLAKY.includes(f.behavior)),
        ),
        seedArb,
        caseCountArb,
        async (spec, seed, caseCount) => {
          const report = await h.run(spec, seed, caseCount, "directory");
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
