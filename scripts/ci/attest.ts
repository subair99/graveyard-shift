/** CI entry of the `attest` job: `tsx scripts/ci/attest.ts <prepare|collect>`. Logic is in lib/attestSteps.ts. */
import { ATTEST_STEPS, isAttestStep } from "./lib/attestSteps";
import { createProductionIo, extractInMemory, guarded, nodeFileOps, sha256Hex } from "./lib/stepSupport";

const step = process.argv[2];
if (!isAttestStep(step)) {
  process.stderr.write(`usage: attest.ts <${Object.keys(ATTEST_STEPS).join("|")}>\n`);
  process.exitCode = 64;
} else {
  const env = { ...process.env };
  const io = createProductionIo(env);
  guarded(`attest ${step}`, io, () =>
    ATTEST_STEPS[step]({ env, io, files: nodeFileOps, sha256: sha256Hex, extract: extractInMemory }),
  ).then((code) => {
    process.exitCode = code;
  });
}
