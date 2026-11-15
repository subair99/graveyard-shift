// Feature: proof-of-life-engine, Property 26: Injected behavior changes are detected
//
// For any synthetic package and any injected change outside every Declared_Delta, the Verdict is
// `restless` with at least one Divergence for the changed function. The unmutated Resurrection of
// the same package is never `restless` (negative control). A delta variant checks that the
// declared-delta stand-in is `alive` with a matching Declared_Delta and `restless` without one.
//
// Validates: Requirements 15.4, 15.11, 7.7, 7.8, 10.2
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { DeclaredDelta, HarnessConfig, ProofReport } from "../../../src/proof/types";
import { fc, fcParams } from "../../engine/helpers/fc";
import { buildSyntheticTarball } from "../helpers/buildTarball";
import {
  BEHAVIORS,
  DETERMINISTIC_BEHAVIORS,
  mutate,
  mutatedPackageArb,
  syntheticPackageArb,
  writePackage,
} from "../helpers/syntheticPackage";
import type { MutationInfo, SyntheticPackageSpec } from "../helpers/syntheticPackage";

const CASE_COUNT = 5;

let root: string;
let tempRoot: string;
let counter = 0;
let propertyModule: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gs-p26-"));
  tempRoot = join(root, "tmp");
  mkdirSync(tempRoot);
  propertyModule = join(root, "nonNegativeResult.cjs");
  writeFileSync(
    propertyModule,
    "exports.check = (ctx) => ({ ok: ctx.kind === 'returned' && typeof ctx.result === 'number' && ctx.result >= 0 })\n",
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface RunOptions {
  seed: number;
  /** Export name -> explicit cases (witness of a witness-only mutation). */
  explicit?: Readonly<Record<string, readonly (readonly unknown[])[]>>;
  deltas?: readonly DeclaredDelta[];
}

async function runPair(
  original: SyntheticPackageSpec,
  resurrection: SyntheticPackageSpec,
  options: RunOptions,
): Promise<ProofReport> {
  const dir = join(root, `run${counter++}`);
  mkdirSync(dir);
  try {
    const built = buildSyntheticTarball(original);
    const tarball = join(dir, "original.tgz");
    writeFileSync(tarball, built.bytes);
    const resDir = join(dir, "res");
    writePackage(resurrection, resDir);
    const functions: HarnessConfig["functions"] = Object.fromEntries(
      original.functions.map((f) => {
        const explicit = options.explicit?.[f.exportName];
        return [
          f.exportName,
          { args: BEHAVIORS[f.behavior].args, ...(explicit === undefined ? {} : { explicitCases: explicit }) },
        ];
      }),
    );
    const run = await runProofOfLife(
      {
        original: { name: original.name, version: original.version, tarballPath: tarball, integrity: built.integrity },
        resurrection: { kind: "directory", path: resDir },
        harness: {
          package: original.name,
          seed: options.seed,
          caseCount: CASE_COUNT,
          perCallTimeoutMs: 1000,
          heapLimitMb: 64,
          outputLimitBytes: 100_000,
          maxRestarts: 5,
          shrinkBudget: 50,
          functions,
          deltas: options.deltas ?? [],
        },
        executorFactory: createInProcessExecutorFactory({ acknowledgeUnsandboxed: true }),
      },
      { tempRoot, env: {}, sink: () => undefined },
    );
    return run.report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function explicitFor(info: MutationInfo): RunOptions["explicit"] {
  if (info.observableOn !== "witness-only" || info.witness === null) return undefined;
  return { [info.exportName]: [info.witness()] };
}

const seedArb = fc.integer({ min: 0, max: 2 ** 31 - 1 });

describe("Property 26: Injected behavior changes are detected", () => {
  it("any injected change is restless with a Divergence for the changed function; the unmutated package is never restless", async () => {
    const started = Date.now();
    await fc.assert(
      fc.asyncProperty(mutatedPackageArb(), seedArb, async ({ original, mutated }, seed) => {
        const info = mutated.info;
        const report = await runPair(original, mutated.spec, { seed, explicit: explicitFor(info) });

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
        const control = await runPair(original, original, { seed });
        expect(control.divergences).toEqual([]);
        expect(["alive", "inconclusive"]).toContain(control.verdict);
      }),
      fcParams(),
    );
    console.info(`[p26] injected-change property elapsed ${Date.now() - started} ms`);
    expect(readdirSync(tempRoot)).toEqual([]);
  }, 300_000);

  it("declared-delta stand-in: alive with a demonstrated delta, restless without one", async () => {
    const started = Date.now();
    const packageArb = syntheticPackageArb({
      // Functions whose every result is unencodable would make the verdict inconclusive (no evidence).
      behaviors: DETERMINISTIC_BEHAVIORS.filter((id) => {
        const u = BEHAVIORS[id].unencodable;
        return u.cycle + u.getter + u.proxy === 0;
      }),
      maxFunctions: 3,
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
          propertyModule,
          explicitCases: [[-3]],
        };
        const withDelta = await runPair(base, changed, { seed, deltas: [delta] });
        expect(withDelta.harnessErrors).toEqual([]);
        expect(withDelta.divergences).toEqual([]);
        expect(withDelta.deltas.map((d) => d.status)).toEqual(["demonstrated"]);
        expect(withDelta.verdict).toBe("alive");

        const withoutDelta = await runPair(base, changed, { seed, explicit: { absOfNegative0: [info.witness!()] } });
        expect(withoutDelta.verdict).toBe("restless");
        expect(withoutDelta.divergences.some((d) => d.function === "absOfNegative0")).toBe(true);
      }),
      // Fewer runs than the main property: each run is two full engine runs and the delta logic is small.
      { ...fcParams(), numRuns: 30 },
    );
    console.info(`[p26] delta variant elapsed ${Date.now() - started} ms`);
    expect(readdirSync(tempRoot)).toEqual([]);
  }, 300_000);
});
