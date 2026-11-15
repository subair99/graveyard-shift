// Shared runner for the lodash.set integration tests (18.8 alive, 18.9 broken, 18.14 identity).
//
// Runs the REAL engine (`runProofOfLife`) with the REAL default Sandbox_Executor against the
// committed, integrity-pinned Original tarball (tests/proof/fixtures/lodash.set) and the real
// `lodashSetHarness`, with a SMALL case count so a run stays well under 30 s.
//
// The production defaults in the harness are higher (100 generated cases for `set`, 100 for the
// delta phase). `SMALL_CASE_COUNT` and `SMALL_DELTA_CASE_COUNT` only shorten the tests. Callers can
// override any HarnessConfig field, and replace any part of the deps (for example `env`).
// Nothing here touches the network.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProofOfLife } from "../../../../src/proof/index";
import { lodashSetHarness } from "../../../../src/proof/harnesses/lodash.set/config";
import type { HarnessConfig, ProofDeps, ProofRun } from "../../../../src/proof/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "fixtures");

export const LODASH_ORIGINAL_TARBALL = join(FIXTURES, "lodash.set", "lodash.set-4.3.2.tgz");
export const LODASH_ORIGINAL_META = join(FIXTURES, "lodash.set", "lodash.set-4.3.2.meta.json");
export const LODASH_ALIVE_DIR = join(FIXTURES, "lodash.set-alive");
export const LODASH_BROKEN_DIR = join(FIXTURES, "lodash.set-broken");

/** Generated cases per function in these tests (production default: 100). */
export const SMALL_CASE_COUNT = 20;
/** Generated delta cases in these tests (production default: 100). */
export const SMALL_DELTA_CASE_COUNT = 10;

export interface LodashRunOptions {
  /** Directory of the Resurrection (kind "directory"). */
  resurrectionDir: string;
  /** Overrides merged over the small-count harness (top level HarnessConfig fields). */
  overrides?: Partial<HarnessConfig>;
  /** Overrides merged over `defaultProofDeps()`. A `sink` given here is still captured too. */
  deps?: Partial<ProofDeps>;
}

export interface LodashRun {
  run: ProofRun;
  json: string;
  /** Every line the engine wrote to its sink. */
  sinkLines: string[];
}

/** Reads the integrity string from the committed meta file. */
export function readOriginalIntegrity(): string {
  const meta = JSON.parse(readFileSync(LODASH_ORIGINAL_META, "utf8")) as { integrity: string };
  return meta.integrity;
}

/** The lodash harness with the small case counts; `overrides` win. */
export function smallLodashHarness(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  const base = lodashSetHarness;
  return {
    ...base,
    caseCount: SMALL_CASE_COUNT,
    functions: Object.fromEntries(
      Object.entries(base.functions).map(([name, h]) => [
        name,
        "excluded" in h ? h : { ...h, caseCount: SMALL_CASE_COUNT },
      ]),
    ),
    deltas: base.deltas.map((d) => ({ ...d, caseCount: SMALL_DELTA_CASE_COUNT })),
    ...overrides,
  };
}

/** Runs Original (committed tarball) against `resurrectionDir` with the real Sandbox_Executor. */
export async function runLodash(options: LodashRunOptions): Promise<LodashRun> {
  const sinkLines: string[] = [];
  const extraSink = options.deps?.sink;
  const run = await runProofOfLife(
    {
      original: {
        name: "lodash.set",
        version: "4.3.2",
        tarballPath: LODASH_ORIGINAL_TARBALL,
        integrity: readOriginalIntegrity(),
      },
      resurrection: { kind: "directory", path: options.resurrectionDir },
      harness: smallLodashHarness(options.overrides),
      // No executorFactory: the engine uses the real Sandbox_Executor.
    },
    {
      ...options.deps,
      sink: (line: string) => {
        sinkLines.push(line);
        extraSink?.(line);
      },
    },
  );
  return { run, json: run.json, sinkLines };
}
