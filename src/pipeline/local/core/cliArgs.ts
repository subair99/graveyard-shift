// Argument parsing of `npm run resurrect` (R6.1, R6.2, R23.3). Pure; a usage error maps to exit code 64.

import { supportedPackageNameProblem } from "../../common/packageNames";
import { err, ok, type Result } from "../../common/result";
import { USAGE_EXIT_CODE } from "./usage";

export interface UsageError {
  kind: "usage";
  message: string;
}

export interface ResurrectArgs {
  package: string;
  /** Normalised with `/` separators, relative to the repository root. */
  stubDir?: string;
}

/** The path functions the checks need; tests inject `path.win32` and `path.posix`. */
export interface PathFns {
  isAbsolute(p: string): boolean;
}

export const STUB_FIXTURE_ROOTS = ["tests/pipeline/fixtures", "tests/proof/fixtures"] as const;

export function usageExitCode(_error: UsageError): number {
  return USAGE_EXIT_CODE;
}

function usage(message: string): Result<never, UsageError> {
  return err({ kind: "usage", message });
}

/** Checks one `--stub` value. Returns the normalised relative path, or a reason. */
export function checkStubDir(value: string, pathFns: PathFns): Result<string, string> {
  if (value === "") return err("--stub needs a fixture directory");
  if (pathFns.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[\\/]/.test(value)) {
    return err("--stub must be a relative path, not an absolute path");
  }
  const segments = value.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return err("--stub must not contain a '..' segment");
  const normalised = segments.join("/");
  const root = STUB_FIXTURE_ROOTS.find((r) => normalised.startsWith(`${r}/`));
  if (root === undefined) {
    return err(`--stub must name a directory under ${STUB_FIXTURE_ROOTS.join(" or ")}`);
  }
  return ok(normalised);
}

export function parseResurrectArgs(
  argv: readonly string[],
  pathFns: PathFns,
): Result<ResurrectArgs, UsageError> {
  const names: string[] = [];
  let stubDir: string | undefined;
  let stubSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--stub") {
      if (stubSeen) return usage("--stub is given more than once");
      stubSeen = true;
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return usage("--stub needs a fixture directory");
      const checked = checkStubDir(value, pathFns);
      if (!checked.ok) return usage(checked.error);
      stubDir = checked.value;
      i++;
    } else if (arg.startsWith("--")) {
      return usage(`unknown option ${arg}`);
    } else {
      names.push(arg);
    }
  }
  if (names.length !== 1) {
    return usage(`expected exactly one package name, got ${names.length}`);
  }
  const name = names[0] as string;
  const problem = supportedPackageNameProblem(name);
  if (problem !== null) return usage(`invalid package name: ${problem}`);
  return ok(stubDir === undefined ? { package: name } : { package: name, stubDir });
}
