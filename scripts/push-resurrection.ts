/**
 * Push_Script entry. Run MANUALLY (needs network, git and gh):
 *
 *   npx tsx scripts/push-resurrection.ts <package> <version> [--stub]
 *
 * Run it from the repository root, where `resurrection/`, `deltas.json` and `harness.json` are.
 */
import { createInterface } from "node:readline/promises";
import { defaultPushDeps, runPush } from "../src/pipeline/local/shell/push";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const stub = args.includes("--stub");
  const positional = args.filter((a) => a !== "--stub");
  if (positional.length !== 2) {
    process.stderr.write("Usage: push-resurrection <package> <version> [--stub]\n");
    return 64;
  }
  const [pkg, version] = positional as [string, string];
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const deps = defaultPushDeps({
      confirmEmail: async (email) => {
        const answer = await rl.question(`Commit email is ${email}. Use it? (y/N) `);
        return /^y(es)?$/i.test(answer.trim());
      },
      out: (line) => process.stderr.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    });
    return await runPush({ package: pkg, version, mode: stub ? "stub" : "local", root: process.cwd() }, deps);
  } finally {
    rl.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write("The push failed.\n");
    process.exitCode = 1;
  },
);
