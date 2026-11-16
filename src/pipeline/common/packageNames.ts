// Package names the pipeline accepts: valid npm names, unscoped only. The resurrection is
// published as @graveyard-shift/<name>, so a scoped input name has no meaning here.

import { packageNameProblem } from "../../engine/parse/packageName";

/**
 * Packages that stay excluded from the Pipeline (R19.9): their advisories are code execution and a fix would change
 * what the package does (docs/kiro-journal.md, Spike 6 results, decision 3).
 */
export const EXCLUDED_PACKAGES: readonly string[] = ["safe-eval", "node-serialize"];

/** Returns a reason when `name` is not a supported package name, otherwise null. */
export function supportedPackageNameProblem(name: string): string | null {
  if (name.startsWith("@")) {
    return "scoped package names are not supported (only unscoped packages can be resurrected)";
  }
  if (EXCLUDED_PACKAGES.includes(name)) {
    return `${name} is excluded from the Pipeline (its advisory is code execution and a fix would change what it does)`;
  }
  return packageNameProblem(name);
}

export function isSupportedPackageName(name: string): boolean {
  return supportedPackageNameProblem(name) === null;
}
