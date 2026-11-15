// Shared setup for the Property 24 files (p24 and p24b): one run of runProofOfLife in its own
// directory with a fresh executor factory, plus the scenario generator.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { canonicalReport } from "../../../src/proof/serialize/canonicalReport";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { HarnessConfig, ProofDeps, ProofRequest, ProofRun } from "../../../src/proof/types";
import { fc } from "../../engine/helpers/fc";
import { buildSyntheticTarball, tarballOf } from "./buildTarball";
import { BEHAVIORS, listMutations, mutate, packageFiles, syntheticPackageArb, writePackage } from "./syntheticPackage";
import type { SyntheticPackageSpec } from "./syntheticPackage";

export interface Scenario {
  original: SyntheticPackageSpec;
  resurrection: SyntheticPackageSpec;
  seed: number;
  caseCount: number;
  haunting: string[];
}

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

export interface SameSeedRunner {
  setup(): void;
  teardown(): void;
  run(s: Scenario, kind: "directory" | "tarball", options?: { seed?: number; haunting?: string[] }): Promise<ProofRun>;
}

export function createSameSeedRunner(basePrefix: string): SameSeedRunner {
  let base = "";
  let counter = 0;
  return {
    setup() {
      base = mkdtempSync(join(tmpdir(), basePrefix));
    },
    teardown() {
      rmSync(base, { recursive: true, force: true });
    },
    async run(s, kind, options = {}) {
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
      expect(result.json).not.toContain(basePrefix.slice(0, -1));
      expect(result.json).not.toContain(tmpdir().replaceAll("\\", "\\\\"));
      expect(result.json).not.toContain(tmpdir());
      expect(result.json).toBe(canonicalReport(result.report));
      return result;
    },
  };
}

export function scenarioArb(maxFunctions: number, caseCountRange: { min: number; max: number }): fc.Arbitrary<Scenario> {
  return fc
    .record({
      original: syntheticPackageArb({ minFunctions: 1, maxFunctions }),
      pick: fc.nat(),
      mutateIt: fc.boolean(),
      seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
      caseCount: fc.integer(caseCountRange),
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
}
