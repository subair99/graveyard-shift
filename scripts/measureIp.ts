/**
 * Measures what the Original ip@2.0.1 returns for the five Advisory_Addresses. Run MANUALLY by a human:
 *
 *   npx tsx scripts/measureIp.ts      (or: npm run measure:ip)
 *
 * Needs the recorded tarball (npm run fixtures:record-tarball -- --package ip --version 2.0.1).
 * Runs offline: the package code runs in the proof engine's sandbox. Writes docs/measurements/ip-2.0.1.json
 * and prints a plain table to stderr.
 */
import { systemClock } from "../src/engine/clock";
import { MeasureIpError, runMeasureIp } from "./lib/measureIp";

async function main(): Promise<void> {
  await runMeasureIp({
    repoRoot: process.cwd(),
    clock: systemClock,
    env: process.env,
    platform: process.platform === "win32" ? "win32" : "posix",
    node: process.version,
    log: (line) => process.stderr.write(`${line}\n`),
  });
}

main().catch((error: unknown) => {
  const text = error instanceof MeasureIpError ? error.message : "The measurement failed.";
  process.stderr.write(`${text}\n`);
  process.exitCode = 1;
});
