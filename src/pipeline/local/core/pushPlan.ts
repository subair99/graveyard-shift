// Push plan (R8.2, R8.4, R8.7, R8.11, R23.6). Pure: no I/O, no clock.
import { ALLOWED_MEDIUM_PATHS, REPO } from "../../common/constants";
import { resurrectBranchName } from "../../common/branchNames";
import { supportedPackageNameProblem } from "../../common/packageNames";
import { err, ok, type Result } from "../../common/result";
import type { IntakeEntry } from "../../intake/core/types";

export type MediumMode = "local" | "stub";

export interface PushPlanInput {
  readonly package: string;
  readonly version: string;
  readonly mode: MediumMode;
  readonly files: readonly IntakeEntry[];
}

export interface PushPlan {
  readonly branch: string;
  /** Sorted, each path inside the allowlist. */
  readonly commitPaths: readonly string[];
  /** Arguments after `gh`. */
  readonly dispatchArgv: readonly string[];
  /** Printed when the branch already exists; never run. */
  readonly deleteCommand: string;
}

export const WORKFLOW_FILE = "resurrect.yml";
export const WORKFLOW_RUNS_URL = `https://github.com/${REPO}/actions/workflows/${WORKFLOW_FILE}`;

export function isAllowedCommitPath(path: string): boolean {
  return (
    path.startsWith(ALLOWED_MEDIUM_PATHS[0]) ||
    path === ALLOWED_MEDIUM_PATHS[1] ||
    path === ALLOWED_MEDIUM_PATHS[2]
  );
}

/** `gh workflow run ...` arguments. `branch` null gives the eligibility-only dispatch (no `-f branch=`). */
export function buildDispatchArgv(input: {
  package: string;
  version: string;
  branch: string | null;
  mode: MediumMode;
}): string[] {
  const argv = ["workflow", "run", WORKFLOW_FILE, "--repo", REPO, "--ref", "main", "-f", `package=${input.package}`, "-f", `version=${input.version}`];
  if (input.branch !== null) argv.push("-f", `branch=${input.branch}`);
  argv.push("-f", `medium_mode=${input.mode}`);
  return argv;
}

/** The dispatch of Requirement 6.4: no Resurrection_Branch, `medium_mode=local`. */
export function planEligibilityDispatch(input: { package: string; version: string }): Result<string[], string> {
  const problem = supportedPackageNameProblem(input.package);
  if (problem !== null) return err(problem);
  return ok(buildDispatchArgv({ ...input, branch: null, mode: "local" }));
}

export function planPush(input: PushPlanInput): Result<PushPlan, string> {
  const problem = supportedPackageNameProblem(input.package);
  if (problem !== null) return err(problem);
  const paths = input.files.map((f) => f.path);
  const outside = paths.filter((p) => !isAllowedCommitPath(p));
  if (outside.length > 0) return err(`path outside the allowlist: ${outside.join(", ")}`);
  const branch = resurrectBranchName(input.package);
  return ok({
    branch,
    commitPaths: [...new Set(paths)].sort(),
    dispatchArgv: buildDispatchArgv({ package: input.package, version: input.version, branch, mode: input.mode }),
    deleteCommand: `git push origin --delete ${branch}`,
  });
}
