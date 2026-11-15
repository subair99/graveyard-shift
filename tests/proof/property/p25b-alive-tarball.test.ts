// Feature: proof-of-life-engine, Property 25: A package is alive against itself
// Validates: Requirements 15.3 (and 12.1 to 12.7, 9.4 for the controls)
//
// Part b: the Resurrection is a tarball built from the same files as the Original.
// Split from the former p25-alive-against-itself.test.ts so the parts run in parallel.
// Reduced inner size (assertions unchanged, numRuns stays fcParams()): maxFunctions 3 -> 2 and
// caseCount 5..8 -> 3..5 per generated package, to keep the project under its 60 s target.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import {
  EVIDENCE,
  MAX_FUNCTIONS,
  TIMEOUT_MS,
  caseCountArb,
  createAgainstItself,
  expectBaseline,
  expectUnencodableOracle,
  seedArb,
} from "../helpers/aliveAgainstItself";
import { syntheticPackageArb } from "../helpers/syntheticPackage";

const h = createAgainstItself("gs-p25b-");
beforeAll(() => h.setup());
afterAll(() => h.teardown());

describe("Feature: proof-of-life-engine, Property 25: A package is alive against itself", () => {
  it("alive with zero divergences (Resurrection as tarball)", async () => {
    await fc.assert(
      fc.asyncProperty(syntheticPackageArb({ behaviors: EVIDENCE, maxFunctions: MAX_FUNCTIONS }), seedArb, caseCountArb, async (spec, seed, caseCount) => {
        const report = await h.run(spec, seed, caseCount, "tarball");
        expectBaseline(report, spec);
        expect(report.nonDeterministicFunctions).toEqual([]);
        expectUnencodableOracle(report, spec);
        expect(report.verdict).toBe("alive");
      }),
      fcParams(),
    );
  }, TIMEOUT_MS);
});
