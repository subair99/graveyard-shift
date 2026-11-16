/** CI entry of the `publish` job: `tsx scripts/ci/publish.ts <gate|build-entry|push-pr>`. Logic is in lib/publishSteps.ts. */
import { appendFileSync } from "node:fs";
import { nodeCommandRunner } from "../../src/pipeline/local/shell/gitPlumbing";
import { PUBLISH_STEPS, isPublishStep } from "./lib/publishSteps";
import { createProductionIo, extractInMemory, guarded, nodePublishFs, sha256Hex } from "./lib/stepSupport";

const step = process.argv[2];
if (!isPublishStep(step)) {
  process.stderr.write(`usage: publish.ts <${Object.keys(PUBLISH_STEPS).join("|")}>\n`);
  process.exitCode = 64;
} else {
  const env = { ...process.env };
  const io = createProductionIo(env);
  const summaryFile = env["GITHUB_STEP_SUMMARY"];
  guarded(`publish ${step}`, io, () =>
    PUBLISH_STEPS[step]({
      env,
      io,
      extract: extractInMemory,
      publish: {
        fs: nodePublishFs,
        sha256: sha256Hex,
        runner: nodeCommandRunner,
        summary: async (markdown) => {
          if (summaryFile !== undefined && summaryFile !== "") appendFileSync(summaryFile, `${markdown}\n`);
        },
      },
    }),
  ).then((code) => {
    process.exitCode = code;
  });
}
