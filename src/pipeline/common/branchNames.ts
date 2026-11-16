// Branch names (design D2). Pure.

import type { Result } from "../../engine/types";
import { supportedPackageNameProblem } from "./packageNames";

/** The user's Resurrection_Branch for a package: `resurrect/<package>`. */
export function resurrectBranchName(pkg: string): string {
  return `resurrect/${pkg}`;
}

/** Package name with every character outside `[a-z0-9-]` replaced by `-`. */
export function branchSlug(pkg: string): string {
  return pkg.replace(/[^a-z0-9-]/g, "-");
}

export interface PublishBranchInput {
  readonly package: string;
  readonly runId: number;
  readonly runAttempt: number;
}

export const PUBLISH_BRANCH_PATTERN = /^publish\/[a-z0-9-]+-run[0-9]+-a[0-9]+$/;

function isPositiveInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

/**
 * `publish/<slug>-run<run_id>-a<run_attempt>` (D2). It never starts with `resurrect/`.
 * Not injective in the package name; the run id makes the name unique.
 */
export function publishBranchName(input: PublishBranchInput): Result<string, string> {
  const problem = supportedPackageNameProblem(input.package);
  if (problem !== null) return { ok: false, error: problem };
  if (!isPositiveInteger(input.runId)) {
    return { ok: false, error: "runId must be a positive integer" };
  }
  if (!isPositiveInteger(input.runAttempt)) {
    return { ok: false, error: "runAttempt must be a positive integer" };
  }
  return {
    ok: true,
    value: `publish/${branchSlug(input.package)}-run${input.runId}-a${input.runAttempt}`,
  };
}
