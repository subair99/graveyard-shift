// Feature: proof-of-life-engine, Property 26: Injected behavior changes are detected
//
// Declared-delta variant: the declared-delta stand-in is `alive` with a matching Declared_Delta
// (status `demonstrated`) and `restless` without one.
// Split from p26-injected-changes.test.ts. numRuns restored from 30 to 100 (plain fcParams());
// packages kept small: maxFunctions 3 -> 1 (plus the injected absOfNegative0 function) and
// caseCount 5 -> 3. Both runs per case keep their explicit cases (the delta case [-3] and the
// mutation witness), so the assertions do not depend on generated cases.
//
// Requirements: 7.7, 7.8, 10.2, 15.4, 15.11
// Validates: Requirements 15.4, 15.11, 7.7, 7.8, 10.2
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DeclaredDelta } from "../../../src/proof/types";
import { fc, fcParams } from "../../engine/helpers/fc";
import { createPairRunner } from "../helpers/injectedPairRunner";
import { BEHAVIORS, DETERMINISTIC_BEHAVIORS, mutate, syntheticPackageArb } from "../helpers/syntheticPackage";
import type { SyntheticPackageSpec } from "../helpers/syntheticPackage";

const runner = createPairRunner("gs-p26b-", 3);

beforeAll(() => runner.setup());
afterAll(() => runner.teardown());

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

describe("Feature: proof-of-life-engine, Property 26: Injected behavior changes are detected", () => {
  it("declared-delta stand-in: alive with a demonstrated delta, restless without one", async () => {
    const started = Date.now();
    const packageArb = syntheticPackageArb({
      // Functions whose every result is unencodable would make the verdict inconclusive (no evidence).
      behaviors: DETERMINISTIC_BEHAVIORS.filter((id) => {
        const u = BEHAVIORS[id].unencodable;
        return u.cycle + u.getter + u.proxy === 0;
      }),
      maxFunctions: 1,
    });
    await fc.assert(
      fc.asyncProperty(packageArb, seedArb, async (others, seed) => {
        const base: SyntheticPackageSpec = {
          ...others,
          functions: [
            { exportName: "absOfNegative0", behavior: "absOfNegative", params: { ...others.functions[0]!.params } },
            ...others.functions.map((f, i) => ({ ...f, exportName: `${f.behavior}${i + 1}` })),
          ],
        };
        const { spec: changed, info } = mutate(base, { kind: "declared-delta", target: 0 });
        expect(info.declaredDelta).toBe(true);

        const delta: DeclaredDelta = {
          id: "abs-of-negative",
          function: "absOfNegative0",
          predicate: (args) => typeof args[0] === "number" && args[0] < 0,
          propertyModule: runner.propertyModule(),
          explicitCases: [[-3]],
        };
        const withDelta = await runner.runPair(base, changed, { seed, deltas: [delta] });
        expect(withDelta.harnessErrors).toEqual([]);
        expect(withDelta.divergences).toEqual([]);
        expect(withDelta.deltas.map((d) => d.status)).toEqual(["demonstrated"]);
        expect(withDelta.verdict).toBe("alive");

        const withoutDelta = await runner.runPair(base, changed, { seed, explicit: { absOfNegative0: [info.witness!()] } });
        expect(withoutDelta.verdict).toBe("restless");
        expect(withoutDelta.divergences.some((d) => d.function === "absOfNegative0")).toBe(true);
      }),
      fcParams(),
    );
    console.info(`[p26b] delta variant elapsed ${Date.now() - started} ms`);
    expect(runner.remainingTempEntries()).toEqual([]);
  }, 300_000);
});
