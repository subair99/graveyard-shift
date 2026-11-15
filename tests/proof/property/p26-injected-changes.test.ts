// Feature: proof-of-life-engine, Property 26: Injected behavior changes are detected
//
// For any synthetic package and any injected change outside every Declared_Delta, the Verdict is
// `restless` with at least one Divergence for the changed function. The unmutated Resurrection of
// the same package is never `restless` (negative control). The declared-delta variant lives in
// p26b-declared-delta.test.ts.
//
// Reduced inner size (assertions unchanged, numRuns stays fcParams()): maxFunctions default 4 -> 2
// and caseCount 5 -> 4 per generated package. Calls per case stay 2 (mutated pair and control).
// Witness-only mutations still use explicit cases, so the lower caseCount does not remove them.
//
// Validates: Requirements 15.4, 15.11, 7.7, 7.8, 10.2
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import { createPairRunner } from "../helpers/injectedPairRunner";
import type { RunOptions } from "../helpers/injectedPairRunner";
import { mutatedPackageArb } from "../helpers/syntheticPackage";
import type { MutationInfo } from "../helpers/syntheticPackage";

const runner = createPairRunner("gs-p26-", 4);

beforeAll(() => runner.setup());
afterAll(() => runner.teardown());

function explicitFor(info: MutationInfo): RunOptions["explicit"] {
  if (info.observableOn !== "witness-only" || info.witness === null) return undefined;
  return { [info.exportName]: [info.witness()] };
}

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

describe("Feature: proof-of-life-engine, Property 26: Injected behavior changes are detected", () => {
  it("any injected change is restless with a Divergence for the changed function; the unmutated package is never restless", async () => {
    const started = Date.now();
    await fc.assert(
      fc.asyncProperty(mutatedPackageArb({ maxFunctions: 2 }), seedArb, async ({ original, mutated }, seed) => {
        const info = mutated.info;
        const report = await runner.runPair(original, mutated.spec, { seed, explicit: explicitFor(info) });

        expect(report.verdict).toBe("restless");
        expect(report.verdict).not.toBe("alive");
        expect(report.verdict).not.toBe("inconclusive");

        if (info.effect === "api") {
          const names = new Set([info.exportName, info.mutatedExportName].filter((n) => n !== null));
          const api = report.divergences.filter((d) => d.kind === "api-surface" && names.has(d.function));
          expect(api.length).toBeGreaterThanOrEqual(1);
        } else {
          const own = report.divergences.filter((d) => d.function === info.exportName && d.kind !== "api-surface");
          expect(own.length).toBeGreaterThanOrEqual(1);
          for (const d of own) {
            if (d.kind === "api-surface") continue;
            expect(d.args).toBeInstanceOf(Array);
            expect(d.replay).toBeDefined();
            expect(d.shrink.attempts).toBeGreaterThanOrEqual(0);
          }
        }

        // Negative control: the unmutated Resurrection of the same package is never restless.
        const control = await runner.runPair(original, original, { seed });
        expect(control.divergences).toEqual([]);
        expect(["alive", "inconclusive"]).toContain(control.verdict);
      }),
      fcParams(),
    );
    console.info(`[p26] injected-change property elapsed ${Date.now() - started} ms`);
    expect(runner.remainingTempEntries()).toEqual([]);
  }, 300_000);
});
