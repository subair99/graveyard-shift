// Package names the pipeline accepts: valid npm names, unscoped only. The resurrection is
// published as @graveyard-shift/<name>, so a scoped input name has no meaning here.

import { packageNameProblem } from "../../engine/parse/packageName";

/** Returns a reason when `name` is not a supported package name, otherwise null. */
export function supportedPackageNameProblem(name: string): string | null {
  if (name.startsWith("@")) {
    return "scoped package names are not supported (only unscoped packages can be resurrected)";
  }
  return packageNameProblem(name);
}

export function isSupportedPackageName(name: string): boolean {
  return supportedPackageNameProblem(name) === null;
}
