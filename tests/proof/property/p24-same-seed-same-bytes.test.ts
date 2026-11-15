// Feature: proof-of-life-engine, Property 24: Same seed, same bytes
// Validates: Requirements 15.2 (and 12/13/15 determinism: no timestamps, no temp paths in the report)
//
// Two runs of runProofOfLife with the same request, deps and a fresh InProcess_Executor produce
// byte-identical canonical JSON. Variants:
//   - Haunting_Radius listed in another order (same set): bytes identical.
//   - Resurrection as directory versus tarball with the same files: the reports differ ONLY in
//     `resurrection.source` (the request kind, which the report records). Everything else,
//     including treeHash, verdict, divergences and cases, is seed-determined and must be equal.
//   - A different seed is run too, only to check that it completes and its report is
//     self-consistent (the same seed again gives the same bytes). A difference is not asserted.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalReport } from "../../../src/proof/serialize/canonicalReport";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { HarnessConfig, ProofDeps, ProofRequest, ProofRun } from "../../../src/proof/types";
import { fc, fcParams } from "../../engine/helpers/fc";
import { buildSyntheticTarball, tarballOf } from "../helpers/buildTarball";
import { BEHAVIORS, listMutations, mutate, packageFiles, syntheticPackageArb, writePackage } from "../helpers/syntheticPackage";
import type { SyntheticPackageSpec } from "../helpers/syntheticPackage";

const BASE_PREFIX = "gs-p24-base-";
let base: string;
let counter = 0;
let elapsedMs = 0;
let runs = 0;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), BASE_PREFIX));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  console.log(`p24: ${runs} generated cases, ${elapsedMs} ms in the property`);
});

function harnessFor(spec: SyntheticPackageSpec, seed: number, caseCount: number): HarnessConfig {
  return {
    package: spec.name,
    seed,
    caseCount,
    perCallTimeoutMs: 1000,
    heapLimitMb: 64,
    outputLimitBytes: 100_000,
    maxRestarts: 5,
    shrinkBudget: 20,
    functions: Object.fromEntries(spec.functions.map((f) => [f.exportName, { args: BEHAVIORS[f.behavior].args }])),
    deltas: [],
  };
}

interface Scenario {
  original: SyntheticPackageSpec;
  resurrection: SyntheticPackageSpec;
  seed: number;
  caseCount: number;
  haunting: string[];
}

/** One run in its own directory with a fresh executor factory; the work directory must be gone after. */
async function run(
  s: Scenario,
  kind: "directory" | "tarball",
  options: { seed?: number; haunting?: string[] } = {},
): Promise<ProofRun> {
  const dir = join(base, `c${counter++}`);
  const tempRoot = join(dir, "tmp");
  mkdirSync(tempRoot, { recursive: true });
  const built = buildSyntheticTarball(s.original);
  const originalPath = join(dir, "original.tgz");
  writeFileSync(originalPath, built.bytes);
  let path: string;
  if (kind === "directory") {
    path = join(dir, "res");
    writePackage(s.resurrection, path);
  } else {
    path = join(dir, "res.tgz");
    writeFileSync(path, tarballOf(packageFiles(s.resurrection)).bytes);
  }
  const request: ProofRequest = {
    original: { name: s.original.name, version: s.original.version, tarballPath: originalPath, integrity: built.integrity },
    resurrection: { kind, path },
    ...(options.haunting === undefined ? {} : { haunting: options.haunting }),
    harness: harnessFor(s.original, options.seed ?? s.seed, s.caseCount),
    executorFactory: createInProcessExecutorFactory({ acknowledgeUnsandboxed: true }),
  };
  const deps: Partial<ProofDeps> = { tempRoot, env: {}, sink: () => undefined };
  const result = await runProofOfLife(request, deps);
  expect(readdirSync(tempRoot)).toEqual([]);
  // No temp path text in the report (the unique base directory name appears in every path used).
  expect(result.json).not.toContain(BASE_PREFIX.slice(0, -1));
  expect(result.json).not.toContain(tmpdir().replaceAll("\\", "\\\\"));
  expect(result.json).not.toContain(tmpdir());
  expect(result.json).toBe(canonicalReport(result.report));
  return result;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    original: syntheticPackageArb({ minFunctions: 1, maxFunctions: 3 }),
    pick: fc.nat(),
    mutateIt: fc.boolean(),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    caseCount: fc.integer({ min: 5, max: 8 }),
    order: fc.infiniteStream(fc.nat()),
  })
  .map(({ original, pick, mutateIt, seed, caseCount, order }) => {
    const mutations = listMutations(original);
    const chosen = mutateIt && mutations.length > 0 ? mutations[pick % mutations.length] : undefined;
    const resurrection = chosen === undefined ? original : mutate(original, chosen).spec;
    // The Original's function names in a pseudo-random order (same set as the default radius).
    const names = original.functions.map((f) => f.exportName);
    const iter = order[Symbol.iterator]();
    const keyed = names.map((n) => ({ n, k: iter.next().value as number }));
    keyed.sort((a, b) => a.k - b.k);
    return { original, resurrection, seed, caseCount, haunting: keyed.map((x) => x.n) };
  });

describe("Feature: proof-of-life-engine, Property 24: Same seed, same bytes", () => {
  it("two runs with the same request produce byte-identical canonical reports", async () => {
    const started = Date.now();
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        runs += 1;
        const a = await run(s, "directory");
        const b = await run(s, "directory");
        expect(b.json).toBe(a.json);
        expect(b.report.verdict).toBe(a.report.verdict);
        expect(a.report.harnessErrors).toEqual([]);

        // Directory versus tarball, with the same functions listed in another order: only the
        // recorded source kind differs.
        const t = await run(s, "tarball", { haunting: s.haunting });
        expect(t.report.resurrection.source).toBe("tarball");
        expect(a.report.resurrection.source).toBe("directory");
        expect(t.report.resurrection.treeHash).toBe(a.report.resurrection.treeHash);
        expect(t.report.verdict).toBe(a.report.verdict);
        expect(t.json.replace('"source":"tarball"', '"source":"directory"')).toBe(a.json);

        // A different seed: the report is self-consistent (`run` checks json === canonicalReport(report),
        // no temp path, work dir removed) and has no harness error. No difference is asserted.
        const d = await run(s, "directory", { seed: (s.seed + 1) % 2 ** 31 });
        expect(d.report.harnessErrors).toEqual([]);
      }),
      { ...fcParams(), numRuns: Math.max(100, fcParams().numRuns ?? 100) },
    );
    elapsedMs = Date.now() - started;
  }, 300_000);
});
