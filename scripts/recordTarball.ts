/**
 * Downloads the lodash.set@4.3.2 tarball and records its metadata. Run MANUALLY by a human:
 *
 *   npm run fixtures:record-tarball [-- --force] [-- --dry-run]
 *
 * Needs network (npm registry only, no credentials). Reads no environment variable and no `.env`.
 * Verifies the bytes against the recorded packument's dist.integrity before writing anything.
 */
import { resolve } from "node:path";
import { systemClock } from "../src/engine/clock";
import { recordTarball } from "./lib/recordTarball";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = new Set(["--force", "--dry-run"]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}. Supported: --force, --dry-run.`);
  }
  await recordTarball({
    fetch: globalThis.fetch,
    clock: systemClock,
    packumentPath: resolve(process.cwd(), "tests", "engine", "fixtures", "lodash.set", "npm-449996e32bd2.json"),
    outDir: resolve(process.cwd(), "tests", "proof", "fixtures", "lodash.set"),
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
    log: (line) => console.log(line),
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
