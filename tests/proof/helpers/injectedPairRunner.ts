// Shared setup for the Property 26 files (p26 and p26b): run the engine on an (Original, Resurrection)
// pair of synthetic packages and return the report.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { DeclaredDelta, HarnessConfig, ProofReport } from "../../../src/proof/types";
import { buildSyntheticTarball } from "./buildTarball";
import { BEHAVIORS, writePackage } from "./syntheticPackage";
import type { SyntheticPackageSpec } from "./syntheticPackage";

export interface RunOptions {
  seed: number;
  /** Export name -> explicit cases (witness of a witness-only mutation). */
  explicit?: Readonly<Record<string, readonly (readonly unknown[])[]>>;
  deltas?: readonly DeclaredDelta[];
}

export interface PairRunner {
  setup(): void;
  teardown(): void;
  /** Absolute path of a property module whose check requires a non-negative number result. */
  propertyModule(): string;
  /** The runner's temp root; it must be empty after every run. */
  remainingTempEntries(): string[];
  runPair(original: SyntheticPackageSpec, resurrection: SyntheticPackageSpec, options: RunOptions): Promise<ProofReport>;
}

export function createPairRunner(prefix: string, caseCount: number): PairRunner {
  let root = "";
  let tempRoot = "";
  let moduleFile = "";
  let counter = 0;
  return {
    setup() {
      root = mkdtempSync(join(tmpdir(), prefix));
      tempRoot = join(root, "tmp");
      mkdirSync(tempRoot);
      moduleFile = join(root, "nonNegativeResult.cjs");
      writeFileSync(
        moduleFile,
        "exports.check = (ctx) => ({ ok: ctx.kind === 'returned' && typeof ctx.result === 'number' && ctx.result >= 0 })\n",
      );
    },
    teardown() {
      rmSync(root, { recursive: true, force: true });
    },
    propertyModule: () => moduleFile,
    remainingTempEntries: () => readdirSync(tempRoot),
    async runPair(original, resurrection, options) {
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
              caseCount,
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
    },
  };
}
