/**
 * Local_Runner entry: `npm run resurrect -- <package> [--stub <fixture-dir>]`.
 * Run in the WSL clone (see spikes/kiro-agent/README.md). All logic is in src/pipeline/local/shell/resurrect.ts.
 */
import { createResurrectDeps, runResurrect } from "../src/pipeline/local/shell/resurrect";

async function main(): Promise<void> {
  const { deps, close } = createResurrectDeps(process.cwd(), process.env);
  try {
    const result = await runResurrect(process.argv.slice(2), deps);
    process.exitCode = result.exitCode;
  } finally {
    close();
  }
}

main().catch(() => {
  process.stderr.write("The run stopped on an unexpected error.\n");
  process.exitCode = 1;
});
