// Reads entries from the file system with `lstat` for the Local_Runner and the Push_Script (R9.12).
// Links are reported as such and never followed. Bytes are read for allowlisted regular files within the size limit.

import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ALLOWED_MEDIUM_PATHS, INTAKE_LIMITS } from "../../common/constants";
import type { EntryType, IntakeEntry } from "../core/types";

function isAllowlisted(path: string): boolean {
  return path.startsWith(ALLOWED_MEDIUM_PATHS[0]) || path === ALLOWED_MEDIUM_PATHS[1] || path === ALLOWED_MEDIUM_PATHS[2];
}

function typeOf(s: { isFile(): boolean; isSymbolicLink(): boolean; isBlockDevice(): boolean; isCharacterDevice(): boolean; nlink: number }): EntryType {
  if (s.isSymbolicLink()) return "symlink";
  if (s.isBlockDevice() || s.isCharacterDevice()) return "device";
  if (s.isFile()) return s.nlink > 1 ? "hardlink" : "file";
  return "other";
}

/** Lists every non-directory entry under `root`, with `/` separated paths relative to it. */
export async function readFsEntries(root: string, relPaths: readonly string[]): Promise<IntakeEntry[]> {
  const entries: IntakeEntry[] = [];
  async function visit(rel: string): Promise<void> {
    const full = join(root, rel);
    let s;
    try {
      s = await lstat(full);
    } catch {
      return; // absent: the validator reports missing required entries
    }
    if (s.isDirectory()) {
      const names = (await readdir(full)).sort();
      for (const name of names) await visit(rel === "" ? name : `${rel}/${name}`);
      return;
    }
    const type = typeOf(s);
    if (type === "file" && isAllowlisted(rel) && s.size <= INTAKE_LIMITS.maxFileBytes) {
      entries.push({ path: rel, type, size: s.size, bytes: new Uint8Array(await readFile(full)) });
    } else {
      entries.push({ path: rel, type, size: s.size });
    }
  }
  for (const rel of relPaths) await visit(rel.replace(/\/$/, ""));
  return entries;
}
