/**
 * Downloads a package tarball and records its metadata (default lodash.set@4.3.2). Run MANUALLY by a human:
 *
 *   npm run fixtures:record-tarball [-- --package <name> --version <v>] [--force] [--dry-run]
 *
 * Needs the registry packument recorded under tests/engine/fixtures/<name>/ (npm run fixtures:record).
 * Output: tests/proof/fixtures/<name>/<name>-<v>.tgz and .meta.json.
 *
 * Needs network (npm registry only, no credentials). Reads no environment variable and no `.env`.
 * Verifies the bytes against the recorded packument's dist.integrity before writing anything.
 */
import { resolve } from "node:path";
import { systemClock } from "../src/engine/clock";
import { findPackumentPath, parseRecordTarballArgs, recordTarball } from "./lib/recordTarball";

async function main(): Promise<void> {
  const parsed = parseRecordTarballArgs(process.argv.slice(2));
  const fixturesDir = resolve(process.cwd(), "tests", "engine", "fixtures");
  await recordTarball({
    fetch: globalThis.fetch,
    clock: systemClock,
    packumentPath: findPackumentPath(fixturesDir, parsed.packageName),
    outDir: resolve(process.cwd(), "tests", "proof", "fixtures", parsed.packageName),
    packageName: parsed.packageName,
    packageVersion: parsed.packageVersion,
    force: parsed.force,
    dryRun: parsed.dryRun,
    log: (line) => console.log(line),
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
