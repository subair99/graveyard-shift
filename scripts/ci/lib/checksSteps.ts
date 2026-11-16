// Logic of the `checks` summary step (R11.14, R11.16). The three check steps run with continue-on-error, so
// this step always runs and turns their `outcome` values into the job result.

import { encodeText } from "./stepSupport";
import type { Env, FileOps, StepIo } from "./stepSupport";

export const CHECKS_ENV = {
  typecheck: "GS_CHECK_TYPECHECK",
  lint: "GS_CHECK_LINT",
  test: "GS_CHECK_TEST",
  runUrl: "GS_RUN_URL",
} as const;

export const CHECKS_RESULTS_FILE = "checks-results.json";

const CHECK_LABELS = [
  ["typecheck", CHECKS_ENV.typecheck],
  ["lint", CHECKS_ENV.lint],
  ["full test suite", CHECKS_ENV.test],
] as const;

export interface ChecksDeps {
  readonly env: Env;
  readonly io: StepIo;
  readonly files: Pick<FileOps, "writeFile">;
}

/** Writes each result and the run URL to the summary and `checks-results.json`; exit 1 unless all three succeeded. */
export async function runChecksSummary(deps: ChecksDeps): Promise<number> {
  const runUrl = deps.env[CHECKS_ENV.runUrl] ?? "";
  const checks = CHECK_LABELS.map(([name, variable]) => {
    const raw = deps.env[variable];
    return { name, outcome: raw === undefined || raw === "" ? "missing" : raw };
  });
  const allPassed = checks.every((c) => c.outcome === "success");

  const lines = ["## Check results", "", ...checks.map((c) => `- ${c.name}: ${c.outcome}`), "", `Workflow run: ${runUrl}`];
  deps.io.summary(lines.join("\n"));
  for (const c of checks) deps.io.log(`${c.name}: ${c.outcome}`);

  const results = { schemaVersion: 1, runUrl, checks: checks.map((c) => ({ name: c.name, outcome: c.outcome })) };
  await deps.files.writeFile(CHECKS_RESULTS_FILE, encodeText(`${JSON.stringify(results)}\n`));
  if (!allPassed) {
    deps.io.error("a check did not succeed");
    return 1;
  }
  return 0;
}
