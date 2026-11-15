// Feature: proof-of-life-engine, Property 25: A package is alive against itself
// Validates: Requirements 15.3 (and 12.1 to 12.7, 9.4 for the controls)
//
// Part c: a function whose every Case is unencodable gives inconclusive (never alive).
// Split from the former p25-alive-against-itself.test.ts so the parts run in parallel.
// Reduced inner size (assertions unchanged, numRuns stays fcParams()): maxFunctions default 4 -> 2
// and caseCount 5..8 -> 3..5 per generated package, to keep the project under its 60 s target.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import {
  EVIDENCE,
  MAX_FUNCTIONS,
  TIMEOUT_MS,
  UNENCODABLE,
  caseCountArb,
  createAgainstItself,
  expectBaseline,
  expectUnencodableOracle,
  hasUnencodable,
  seedArb,
} from "../helpers/aliveAgainstItself";
import { syntheticPackageArb } from "../helpers/syntheticPackage";

const h = createAgainstItself("gs-p25c-");
beforeAll(() => h.setup());
afterAll(() => h.teardown());

describe("Feature: proof-of-life-engine, Property 25: A package is alive against itself", () => {
  it("a function whose every Case is unencodable gives inconclusive (never alive)", async () => {
    await fc.assert(
      fc.asyncProperty(
        syntheticPackageArb({ behaviors: [...EVIDENCE, ...UNENCODABLE], maxFunctions: MAX_FUNCTIONS }).filter((s) =>
          s.functions.some((f) => hasUnencodable(f.behavior)),
        ),
        seedArb,
        caseCountArb,
        async (spec, seed, caseCount) => {
          const report = await h.run(spec, seed, caseCount, "directory");
          expectBaseline(report, spec);
          expectUnencodableOracle(report, spec);
          expect(report.verdict).toBe("inconclusive");
        },
      ),
      fcParams(),
    );
  }, TIMEOUT_MS);
});
