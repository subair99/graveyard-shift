// Requirements: 5.7
// The compiled Stub_Fixture harness (deltas.json + harness.json, lodash-set preset) run through the
// real Proof_Engine and the real Sandbox_Executor: alive for lodash.set-alive, restless for
// lodash.set-broken. The Original is the recorded lodash.set@4.3.2 tarball.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { compileHarnessFiles } from "../../../src/pipeline/harness/core/compiler";
import { runProofOfLife } from "../../../src/proof/index";
import type { HarnessConfig } from "../../../src/proof/types";
import {
  LODASH_ALIVE_DIR,
  LODASH_BROKEN_DIR,
  LODASH_ORIGINAL_TARBALL,
  readOriginalIntegrity,
  SMALL_CASE_COUNT,
  SMALL_DELTA_CASE_COUNT,
} from "../../proof/integration/helpers/lodashRun";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const FIXTURE = resolve(__dirname, "../fixtures/stub/lodash.set");

function compiledConfig(): HarnessConfig {
  const compiled = compileHarnessFiles({
    deltasJson: readFileSync(join(FIXTURE, "deltas.json"), "utf8"),
    harnessJson: readFileSync(join(FIXTURE, "harness.json"), "utf8"),
    certificate: LODASH_SET_CERT,
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const base = compiled.value.config;
  // Small counts keep the run short; the compiled config is otherwise passed unchanged.
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
  };
}

async function prove(resurrectionDir: string) {
  return runProofOfLife({
    original: {
      name: "lodash.set",
      version: "4.3.2",
      tarballPath: LODASH_ORIGINAL_TARBALL,
      integrity: readOriginalIntegrity(),
    },
    resurrection: { kind: "directory", path: resurrectionDir },
    harness: compiledConfig(),
  });
}

describe("compiled lodash-set harness (real engine, real sandbox)", () => {
  it("lodash.set-alive is alive", { timeout: 120_000 }, async () => {
    const run = await prove(LODASH_ALIVE_DIR);
    expect(run.report.harnessErrors).toEqual([]);
    expect(run.report.verdict).toBe("alive");
  });

  it("lodash.set-broken is restless", { timeout: 120_000 }, async () => {
    const run = await prove(LODASH_BROKEN_DIR);
    expect(run.report.harnessErrors).toEqual([]);
    expect(run.report.verdict).toBe("restless");
  });
});
