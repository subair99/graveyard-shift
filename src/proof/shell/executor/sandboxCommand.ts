// Pure builders for the Sandbox_Executor command line and environment (design: "Sandbox_Executor",
// "Command line"; Requirements 5.2, 5.3, 5.16 to 5.19, 16.3). No fs access, no process access:
// every path is an input, so the functions are tested without a child process.
//
// Command line: `--permission`, one `--allow-fs-read=<path>` flag per path (repeated flags, never a
// comma-joined flag), `--max-old-space-size=<n>`, then the runner entry. Each flag is one argv
// element, so spaces and commas in a path need no quoting (the shell is never used). The flags
// `--allow-net`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-fs-write`,
// `--allow-inspector`, `--allow-wasi`, `--allow-ffi` and `--allow-openssl-store` are never built.
// Node v26 runs the `.ts` runner with native type stripping and printed no experimental warning in
// the spike (journal task 1.2), so no `--experimental-*` flag is passed.
//
// Paths: the caller passes the `fs.realpathSync.native` form of the package directory, and the
// `cwd` returned here is that same string, so grant and `cwd` are in the same path form
// (Requirement 5.17). The optional `realpath` input is applied to the runner directory, the package
// directory and every extra grant before validation, so a short 8.3 form cannot reach a flag.
//
// Environment: only `TZ=UTC` (Requirement 5.3). On Windows the process launcher adds OS-supplied
// variables to the child's environment (11 names observed in the spike, journal task 1.4). The
// engine does not rely on them, does not report them, and does not try to remove them.

import type { Result } from "../../types";
import type { ExecutorError } from "./types";

export interface SandboxCommandInput {
  /** `process.execPath` of the parent. Absolute. */
  execPath: string;
  /** Absolute path of the runner DIRECTORY (`src/proof/child`), granted whole. */
  runnerDir: string;
  /** Absolute path of the runner entry file (`runner.ts`), passed as the script. */
  runnerEntry: string;
  /** Absolute `fs.realpathSync.native` path of the package directory: grant and `cwd`. */
  packageDir: string;
  /** Further grants: the created package path when it differs, harness modules or directories. */
  extraReadPaths: readonly string[];
  /** Heap limit in MB, a positive integer. */
  maxOldSpaceMb: number;
  /**
   * Resolves a grant path (production passes `fs.realpathSync.native`, which expands 8.3 short
   * names and links). Applied to `runnerDir`, `packageDir` and every `extraReadPaths` entry before
   * validation. A path for which it throws is used unchanged. Default: identity (the builder
   * stays pure).
   */
  realpath?: (p: string) => string;
}

export interface SandboxCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface SandboxEnv {
  TZ: "UTC";
}

// `*` widened a grant in the spike (journal task 1.12). The others were not tested and are rejected
// conservatively. `,` is allowed because repeated flags grant a comma path correctly.
const UNSAFE_GLOB_CHARS = /[*?[\]{}]/;
// C0 controls (including NUL) and DEL.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// POSIX root, Windows drive (either separator) or UNC / extended-length prefix.
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

function unavailable(message: string): Result<never, ExecutorError> {
  return { ok: false, error: { kind: "sandbox-unavailable", message } };
}

/** Returns a message that does not contain the path (Requirement 5.16), or undefined when valid. */
function pathProblem(label: string, value: string): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return `the ${label} path is empty`;
  }
  if (CONTROL_CHARS.test(value)) {
    return `the ${label} path contains a control character`;
  }
  if (UNSAFE_GLOB_CHARS.test(value)) {
    return `the ${label} path contains a character that is not allowed in a sandbox grant (one of * ? [ ] { })`;
  }
  if (!ABSOLUTE_PATH.test(value)) {
    return `the ${label} path is not absolute`;
  }
  return undefined;
}

/**
 * Builds the command, arguments and `cwd` of one sandboxed child. Returns `sandbox-unavailable`
 * (message without any path) for an unsafe or relative path or an invalid heap limit, so that the
 * Sandbox_Executor starts no child. Does not read or modify its input.
 */
export function buildSandboxArgv(
  input: SandboxCommandInput,
): Result<SandboxCommand, ExecutorError> {
  const resolveGrant = (p: string): string => {
    if (input.realpath === undefined || typeof p !== "string" || p.length === 0) return p;
    try {
      return input.realpath(p);
    } catch {
      return p; // for example ENOENT: the input path stays as it is
    }
  };
  const runnerDir = resolveGrant(input.runnerDir);
  const packageDir = resolveGrant(input.packageDir);
  const extraReadPaths = input.extraReadPaths.map(resolveGrant);

  const labeled: Array<[string, string]> = [
    ["node executable", input.execPath],
    ["runner directory", runnerDir],
    ["runner entry", input.runnerEntry],
    ["package directory", packageDir],
  ];
  extraReadPaths.forEach((p, i) => labeled.push([`extra read #${i + 1}`, p]));
  for (const [label, value] of labeled) {
    const problem = pathProblem(label, value);
    if (problem !== undefined) return unavailable(problem);
  }
  if (!Number.isSafeInteger(input.maxOldSpaceMb) || input.maxOldSpaceMb < 1) {
    return unavailable("the heap limit must be a positive integer number of megabytes");
  }

  // Runner directory, package directory, then extra paths; exact duplicates are granted once.
  const grants: string[] = [];
  for (const p of [runnerDir, packageDir, ...extraReadPaths]) {
    if (!grants.includes(p)) grants.push(p);
  }

  return {
    ok: true,
    value: {
      command: input.execPath,
      args: [
        "--permission",
        ...grants.map((p) => `--allow-fs-read=${p}`),
        `--max-old-space-size=${input.maxOldSpaceMb}`,
        input.runnerEntry,
      ],
      cwd: packageDir,
    },
  };
}

/**
 * The child's environment: `TZ=UTC` only. The optional arguments (the task's `platform` and
 * `parentEnv`) are accepted and ignored on purpose: nothing is copied from the parent.
 */
export function buildSandboxEnv(
  ...ignored: [platform?: string, parentEnv?: Readonly<Record<string, string | undefined>>]
): SandboxEnv {
  void ignored;
  return { TZ: "UTC" };
}
