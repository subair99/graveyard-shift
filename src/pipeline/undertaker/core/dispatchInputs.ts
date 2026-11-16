// Dispatch input validation (R9.1, R9.2, R23.7). Pure: no I/O, no clock.

import * as semver from "semver";

import type { Result } from "../../../engine/types";
import { resurrectBranchName } from "../../common/branchNames";
import { supportedPackageNameProblem } from "../../common/packageNames";

export const DISPATCH_REF = "refs/heads/main";
export const MEDIUM_MODES = ["local", "stub"] as const;
export type MediumMode = (typeof MEDIUM_MODES)[number];

export interface DispatchInputs {
  readonly ref: string;
  readonly package: string;
  readonly version: string;
  /** Empty string when the dispatch names no branch. */
  readonly branch: string;
  readonly mediumMode: string;
}

export interface ValidDispatchInputs {
  readonly package: string;
  readonly version: string;
  /** Null when the branch input is empty. */
  readonly branch: string | null;
  readonly mediumMode: MediumMode;
}

/** Accepts only the main ref, a supported package, an exact semver, an empty or own branch, and a known mode. Every problem is listed. */
export function validateDispatchInputs(input: DispatchInputs): Result<ValidDispatchInputs, string[]> {
  const problems: string[] = [];

  if (input.ref !== DISPATCH_REF) problems.push(`ref must be ${DISPATCH_REF}`);

  const nameProblem = supportedPackageNameProblem(input.package);
  if (nameProblem !== null) problems.push(`package: ${nameProblem}`);

  if (semver.valid(input.version) !== input.version) {
    problems.push("version must be an exact semver version");
  }

  if (input.branch !== "") {
    if (nameProblem !== null || input.branch !== resurrectBranchName(input.package)) {
      problems.push(`branch must be empty or ${resurrectBranchName(input.package)}`);
    }
  }

  const mode = MEDIUM_MODES.find((m) => m === input.mediumMode);
  if (mode === undefined) problems.push("medium mode must be local or stub");

  if (problems.length > 0 || mode === undefined) return { ok: false, error: problems };
  return {
    ok: true,
    value: {
      package: input.package,
      version: input.version,
      branch: input.branch === "" ? null : input.branch,
      mediumMode: mode,
    },
  };
}
