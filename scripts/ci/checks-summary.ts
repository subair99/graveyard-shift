/**
 * CI entry of the `checks` job summary step: `tsx scripts/ci/checks-summary.ts`. Reads the outcomes of the three
 * check steps from GS_CHECK_TYPECHECK, GS_CHECK_LINT, GS_CHECK_TEST and the run URL from GS_RUN_URL.
 */
import { runChecksSummary } from "./lib/checksSteps";
import { createProductionIo, guarded, nodeFileOps } from "./lib/stepSupport";

const env = { ...process.env };
const io = createProductionIo(env);
guarded("checks-summary", io, () => runChecksSummary({ env, io, files: nodeFileOps })).then((code) => {
  process.exitCode = code;
});
