// Tree_Hash (Requirement 4.3, 4.4).
//
// Algorithm:
//   1. Take the regular files of a tree as {path, bytes}, with `path` the POSIX-style
//      relative path (forward slashes, no leading "./").
//   2. Sort them by path, comparing Unicode code points (not UTF-16 units, not locale).
//   3. Feed a sha512 hash, for each file in that order, with:
//        utf8(path) 0x00 decimal(byteLength) 0x00 bytes 0x00
//      The decimal length makes every record self-delimiting, so moving bytes between a
//      path and a content, or between two files, always changes the stream.
//   4. Render the digest as `sha512-<base64>`.
//
// Included: regular files only. Not included: directories (an empty directory leaves no
// trace in the hash), `node_modules` and `.git` directories (directory source only),
// timestamps, permissions, ownership. File bytes are hashed as they are; line endings
// are never converted.
//
// Known-answer vector: see tests/proof/unit/treeHash.test.ts.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { HarnessError, Result } from "../types";

export interface TreeFile {
  /** POSIX-style relative path, for example `lib/a.js`. */
  path: string;
  bytes: Uint8Array;
}

/** Directory names skipped at any depth when hashing a source directory (R4.2). */
export const EXCLUDED_DIRECTORIES: readonly string[] = ["node_modules", ".git"];

const SEPARATOR = Uint8Array.of(0);

/** Compares strings by Unicode code point, never by locale or UTF-16 unit. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const cx = x[i]?.codePointAt(0) ?? 0;
    const cy = y[i]?.codePointAt(0) ?? 0;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * Computes the Tree_Hash of a file list. The input order is irrelevant.
 * Throws a RangeError when two entries have the same path, because such a list
 * does not describe a tree.
 */
export function computeTreeHash(files: readonly TreeFile[]): string {
  const sorted = [...files].sort((a, b) => compareCodePoints(a.path, b.path));
  const hash = createHash("sha512");
  let previous: string | undefined;
  for (const file of sorted) {
    if (file.path === previous) {
      throw new RangeError(`Duplicate path in tree: ${file.path}`);
    }
    previous = file.path;
    hash.update(file.path, "utf8");
    hash.update(SEPARATOR);
    hash.update(String(file.bytes.byteLength), "utf8");
    hash.update(SEPARATOR);
    hash.update(file.bytes);
    hash.update(SEPARATOR);
  }
  return `sha512-${hash.digest("base64")}`;
}

/**
 * Lists the regular files under `root`, skipping `node_modules` and `.git` directories.
 * A symbolic link or any other non-regular, non-directory entry gives `unsafe-archive`.
 */
export async function readTreeFiles(root: string): Promise<Result<TreeFile[], HarnessError>> {
  const files: TreeFile[] = [];

  async function walk(dir: string, prefix: string): Promise<HarnessError | null> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.includes(entry.name)) continue;
        const failure = await walk(join(dir, entry.name), relative);
        if (failure !== null) return failure;
      } else if (entry.isFile()) {
        files.push({ path: relative, bytes: await readFile(join(dir, entry.name)) });
      } else {
        const what = entry.isSymbolicLink() ? "symbolic link" : "non-regular file";
        return { kind: "unsafe-archive", message: `Resurrection directory contains a ${what}: ${relative}` };
      }
    }
    return null;
  }

  const failure = await walk(root, "");
  return failure === null ? { ok: true, value: files } : { ok: false, error: failure };
}

/** Tree_Hash of a directory: `readTreeFiles` followed by `computeTreeHash`. */
export async function computeDirectoryTreeHash(root: string): Promise<Result<string, HarnessError>> {
  const listed = await readTreeFiles(root);
  if (!listed.ok) return listed;
  return { ok: true, value: computeTreeHash(listed.value) };
}
