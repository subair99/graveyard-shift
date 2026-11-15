import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Result } from "../types";

/**
 * Temporary work root of one proof run (Requirements 3.6, 4.2, 4.6).
 *
 * Layout: `<work>/<side>` holds a side's package (`o` for the Original, `r` for the Resurrection).
 * Every path handed to a child (cwd, grant) and to the Root_Normalizer must be the `real` form
 * (`fs.realpathSync.native`); the spike showed that a `cwd` and a grant of different forms (link
 * or 8.3 short name versus real path) deny relative reads. `created` is kept because it can differ
 * (a junction as temp root, a short name), and the design grants both forms in that case.
 */

export const WORK_ROOT_PREFIX = "gs-";
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".git"]);
const RETRYABLE_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY"]);
const SIDE_NAME = /^[A-Za-z0-9_-]+$/;

export interface Roots {
  /** Path as returned by `mkdtemp` (may be a link or short-name form). */
  created: string;
  /** `fs.realpathSync.native` of `created`. Use this for cwd, grants and normalization. */
  real: string;
}

export interface WorkDir {
  roots: Roots;
  /** Creates `<work>/<name>` and returns both path forms. */
  sideDir(name: string): Roots;
  /**
   * Removes the work root and everything below it. Retries on EPERM and EBUSY (Windows file
   * locks). Never throws; returns an error message when the directory could not be removed.
   */
  cleanup(): Promise<Result<void, string>>;
}

export interface CreateWorkDirOptions {
  /** Default `os.tmpdir()`. */
  tempRoot?: string;
  /** Default 6 retries after the first attempt. */
  maxRetries?: number;
  /** Default 100 ms, multiplied by the attempt number. */
  retryDelayMs?: number;
}

/** Creates `gs-<random>` under the temp root with `fs.mkdtemp`. Throws on I/O failure. */
export function createWorkDir(options: CreateWorkDirOptions = {}): WorkDir {
  const tempRoot = options.tempRoot ?? os.tmpdir();
  const maxRetries = options.maxRetries ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 100;

  const created = fs.mkdtempSync(path.join(tempRoot, WORK_ROOT_PREFIX));
  const real = fs.realpathSync.native(created);
  const roots: Roots = { created, real };
  let removed = false;

  return {
    roots,
    sideDir(name: string): Roots {
      if (!SIDE_NAME.test(name)) {
        throw new Error("invalid side directory name");
      }
      const side = path.join(created, name);
      fs.mkdirSync(side);
      return { created: side, real: fs.realpathSync.native(side) };
    },
    async cleanup(): Promise<Result<void, string>> {
      if (removed) return { ok: true, value: undefined };
      // Guard: only ever remove a directory this module created (name check, not a root).
      const base = path.basename(real);
      if (!base.startsWith(WORK_ROOT_PREFIX) || path.dirname(real) === real) {
        return { ok: false, error: "refusing to remove a directory that is not a work root" };
      }
      let lastMessage = "unknown error";
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          // `rm` removes links without following them, so nothing outside the root is touched.
          await fs.promises.rm(real, { recursive: true, force: true });
          removed = true;
          return { ok: true, value: undefined };
        } catch (error) {
          const code = errorCode(error);
          lastMessage = code ?? "unknown error";
          if (code === undefined || !RETRYABLE_CODES.has(code) || attempt === maxRetries) break;
          await delay(retryDelayMs * (attempt + 1));
        }
      }
      return { ok: false, error: `could not remove the work directory (${lastMessage})` };
    },
  };
}

export interface CopyResult {
  /** POSIX-style relative paths of the copied regular files, sorted by code point. */
  files: string[];
  /** POSIX-style relative paths of the excluded `node_modules` and `.git` entries. */
  skipped: string[];
}

export interface UnsafeDirectoryError {
  kind: "unsafe-archive";
  message: string;
}

interface PlannedFile {
  relative: string;
  source: string;
}

/**
 * Copies a Resurrection directory into `destDir` (Requirement 4.6). `node_modules` and `.git`
 * are excluded at any depth and listed in `skipped`. Any symbolic link (or junction), or any
 * entry that is neither a regular file nor a directory, is rejected with `unsafe-archive` before
 * anything is written. Messages carry relative paths only.
 */
export function copyResurrectionDirectory(
  sourceDir: string,
  destDir: string,
): Result<CopyResult, UnsafeDirectoryError> {
  const files: PlannedFile[] = [];
  const directories: string[] = [];
  const skipped: string[] = [];

  const walk = (absolute: string, relative: string): UnsafeDirectoryError | undefined => {
    const names = fs.readdirSync(absolute).sort(compareCodePoints);
    for (const name of names) {
      const childAbsolute = path.join(absolute, name);
      const childRelative = relative === "" ? name : `${relative}/${name}`;
      if (EXCLUDED_DIRECTORIES.has(name)) {
        skipped.push(childRelative);
        continue;
      }
      const stat = fs.lstatSync(childAbsolute);
      if (stat.isSymbolicLink()) {
        return { kind: "unsafe-archive", message: `symbolic link in directory: ${childRelative}` };
      }
      if (stat.isDirectory()) {
        directories.push(childRelative);
        const failure = walk(childAbsolute, childRelative);
        if (failure !== undefined) return failure;
      } else if (stat.isFile()) {
        files.push({ relative: childRelative, source: childAbsolute });
      } else {
        return {
          kind: "unsafe-archive",
          message: `entry is not a regular file or directory: ${childRelative}`,
        };
      }
    }
    return undefined;
  };

  const failure = walk(sourceDir, "");
  if (failure !== undefined) return { ok: false, error: failure };

  fs.mkdirSync(destDir, { recursive: true });
  for (const directory of directories) {
    fs.mkdirSync(path.join(destDir, ...directory.split("/")), { recursive: true });
  }
  for (const file of files) {
    fs.copyFileSync(file.source, path.join(destDir, ...file.relative.split("/")));
  }
  return {
    ok: true,
    value: { files: files.map((f) => f.relative).sort(compareCodePoints), skipped },
  };
}

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i]?.codePointAt(0) ?? 0;
    const y = right[i]?.codePointAt(0) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
