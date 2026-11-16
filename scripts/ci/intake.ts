/**
 * CI entry of the `intake` job: `tsx scripts/ci/intake.ts <step>` with one of validate-inputs, coroner, plan,
 * resolve-branch, fetch-and-validate, pack. Inputs arrive as environment variables only (see INPUT_ENV).
 * All logic is in scripts/ci/lib/intakeSteps.ts; this file only wires the real side effects.
 */
import { appendFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAutopsy } from "../../src/engine";
import { createMemoryCache } from "../../src/engine/cache/cache";
import { systemClock } from "../../src/engine/clock";
import { identityValuesFromEnv } from "../../src/proof/core/identity";
import { runGravedigger } from "../../src/pipeline/gravedigger/shell/gravedigger";
import { readGitEntries } from "../../src/pipeline/intake/shell/gitEntries";
import { nodeCommandRunner } from "../../src/pipeline/local/shell/gitPlumbing";
import { extractTarball, packTarball } from "../../src/proof/shell/tarball/tarballExtractor";
import { createRedactingIo, isStepName, runStep, STEPS } from "./lib/intakeSteps";
import type { IntakeDeps } from "./lib/intakeSteps";

async function extractOriginal(tarball: Uint8Array): ReturnType<IntakeDeps["extractOriginal"]> {
  const dir = await mkdtemp(path.join(tmpdir(), "gs-intake-"));
  try {
    const extracted = await extractTarball(tarball, dir);
    return extracted.ok ? { ok: true, value: extracted.value } : { ok: false, error: `${extracted.error.kind}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const step = process.argv[2];
  if (!isStepName(step)) {
    process.stderr.write(`usage: intake.ts <${Object.keys(STEPS).join("|")}>\n`);
    return 64;
  }
  const env = { ...process.env };
  const platform = process.platform === "win32" ? "win32" : "posix";
  const outputFile = env["GITHUB_OUTPUT"];
  const summaryFile = env["GITHUB_STEP_SUMMARY"];
  const io = createRedactingIo(
    {
      stdout: (text) => void process.stdout.write(text),
      stderr: (text) => void process.stderr.write(text),
      appendOutput: (text) => {
        if (outputFile !== undefined && outputFile !== "") appendFileSync(outputFile, text);
      },
      appendSummary: (text) => {
        if (summaryFile !== undefined && summaryFile !== "") appendFileSync(summaryFile, text);
      },
    },
    identityValuesFromEnv(env, platform),
    platform,
  );
  const deps: IntakeDeps = {
    cwd: process.cwd(),
    env,
    io,
    nodeVersion: process.version,
    coroner: (name, version, githubToken) =>
      runAutopsy(
        { kind: "name", name, version },
        { requestTimeoutMs: 10_000, concurrency: 8, ...(githubToken !== undefined ? { githubToken } : {}) },
        { fetch, clock: systemClock, cache: createMemoryCache() },
      ),
    gravedigger: (cert) => runGravedigger(cert, { fetch, clock: systemClock }),
    runGh: (argv, ghEnv) => nodeCommandRunner.run("gh", argv, { env: ghEnv }),
    readGitEntries,
    extractOriginal,
    packTarball,
  };
  return runStep(step, deps);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write("intake stopped on an unexpected error\n");
    process.exitCode = 1;
  },
);
