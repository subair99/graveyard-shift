// Feature: proof-of-life-engine, Property 24: Same seed, same bytes
// Requirements: 15.2
// Validates: Requirements 15.2 (and 12/13/15 determinism: no timestamps, no temp paths in the report)
//
// Part b: a different seed is run only to check that it completes and its report is
// self-consistent (the shared runner checks json === canonicalReport(report), no temp path text,
// work directory removed) with no harness error. A difference from the original seed is not asserted.
// Split from p24-same-seed-same-bytes.test.ts so it runs in parallel.
//
// Smallest packages: maxFunctions 1, caseCount 3..5, one runProofOfLife call per generated case;
// numRuns stays max(100, fcParams()).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import { createSameSeedRunner, scenarioArb } from "../helpers/sameSeedRunner";

const runner = createSameSeedRunner("gs-p24b-base-");

beforeAll(() => runner.setup());
afterAll(() => runner.teardown());

describe("Feature: proof-of-life-engine, Property 24: Same seed, same bytes", () => {
  it("a run with a different seed completes and its report is self-consistent", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb(1, { min: 3, max: 5 }), async (s) => {
        const d = await runner.run(s, "directory", { seed: (s.seed + 1) % 2 ** 31 });
        expect(d.report.harnessErrors).toEqual([]);
      }),
      { ...fcParams(), numRuns: Math.max(100, fcParams().numRuns ?? 100) },
    );
  }, 300_000);
});
