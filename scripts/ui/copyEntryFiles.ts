// Entry_File_Copy step of `npm run build` (crypt-ui Requirement 5.10): validates the graveyard with the same
// reader as the pages, then copies every entry file byte for byte into out/graveyard/. Exit 1 on any error.
// Reads no environment variable.

import { join } from "node:path";
import { copyEntryFiles, nodeCopyFs } from "../../src/ui/shell/copyEntryFiles";
import { loadSite } from "../../src/ui/shell/loadSite";

async function main(): Promise<number> {
  try {
    const root = process.cwd();
    const view = await loadSite();
    const result = await copyEntryFiles(view, { root, outDir: join(root, "out"), fs: nodeCopyFs });
    if (!result.ok) {
      process.stderr.write(`${result.error}\n`);
      return 1;
    }
    process.stdout.write(`Copied ${result.value} entry files to out/graveyard/.\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
