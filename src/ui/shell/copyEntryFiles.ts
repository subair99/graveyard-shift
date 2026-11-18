// Entry_File_Copy (crypt-ui Requirement 5.10): copies every file of every Graveyard_Entry, byte for byte,
// from <root>/graveyard/<package>/<file> to <outDir>/graveyard/<package>/<file>. Only the files listed in
// the view (which the reader listed from the entry directory) are copied. An existing target is an error.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "../../pipeline/common/result";
import type { SiteView } from "../core/viewModel";

export interface CopyFs {
  readFile(path: string): Promise<Uint8Array>;
  mkdir(path: string): Promise<void>;
  /** Writes with the flag `wx`: rejects when the target exists. */
  writeNew(path: string, bytes: Uint8Array): Promise<void>;
}

export interface CopyDeps {
  /** Repository root. */
  readonly root: string;
  /** Site_Output directory. */
  readonly outDir: string;
  readonly fs: CopyFs;
}

export const nodeCopyFs: CopyFs = {
  readFile: (path) => readFile(path),
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  writeNew: (path, bytes) => writeFile(path, bytes, { flag: "wx" }),
};

/** Returns the number of files copied, or an error naming the file that failed. */
export async function copyEntryFiles(view: SiteView, deps: CopyDeps): Promise<Result<number, string>> {
  let count = 0;
  for (const entry of view.entries) {
    for (const { file } of entry.downloads) {
      const source = join(deps.root, "graveyard", entry.name, file);
      const target = join(deps.outDir, "graveyard", entry.name, file);
      const label = `graveyard/${entry.name}/${file}`;
      let bytes: Uint8Array;
      try {
        bytes = await deps.fs.readFile(source);
      } catch (e) {
        return err(`${label}: cannot be read: ${reason(e)}`);
      }
      try {
        await deps.fs.mkdir(dirname(target));
        await deps.fs.writeNew(target, bytes);
      } catch (e) {
        return err(`${label}: cannot be copied: ${reason(e)}`);
      }
      count += 1;
    }
  }
  return ok(count);
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
