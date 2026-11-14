/**
 * Records live upstream responses as test fixtures. Run MANUALLY by a human:
 *
 *   npm run fixtures:record [-- --force] [-- --dry-run]
 *
 * Needs network. Reads GITHUB_TOKEN from the environment (npm script loads `.env`
 * through `--env-file`). Never prints or writes the token.
 */
import { resolve } from "node:path";
import { systemClock } from "../src/engine/clock";
import { recordFixtures } from "./lib/recordFixtures";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = new Set(["--force", "--dry-run"]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}. Supported: --force, --dry-run.`);
  }
  const summary = await recordFixtures({
    fetch: globalThis.fetch,
    clock: systemClock,
    outDir: resolve(process.cwd(), "tests", "engine", "fixtures"),
    token: process.env["GITHUB_TOKEN"],
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
    log: (line) => console.log(line),
  });
  if (!summary.dryRun) {
    const total = Object.values(summary.written).reduce((a, b) => a + b, 0);
    console.log(`Done: ${total} file(s) written.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recording failed.");
  process.exitCode = 1;
});
