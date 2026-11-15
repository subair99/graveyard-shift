// Tarball wrapper for synthetic packages (task 11.3). The ustar and gzip writer is the one in
// `treeFiles.ts` (no `tar` dependency in tests); this file only adds the package file list and
// the sha512 integrity string.
import { computeSri } from "../../../src/proof/shell/integrity";
import { packageFiles } from "./syntheticPackage";
import type { SyntheticPackageSpec } from "./syntheticPackage";
import { buildTarball } from "./treeFiles";
import type { TreeFile } from "../../../src/proof/shell/treeHash";

export interface BuiltTarball {
  /** npm-style `.tgz`: every file under `package/`, gzip-compressed ustar. */
  bytes: Uint8Array;
  /** `sha512-<base64>` SRI string of `bytes`, from `computeSri`. */
  integrity: string;
}

/** Builds a tarball from arbitrary files (reuses the ustar builder of `treeFiles.ts`). */
export function tarballOf(files: readonly TreeFile[]): BuiltTarball {
  const bytes = buildTarball(files);
  return { bytes, integrity: computeSri(bytes) };
}

/** Builds the `.tgz` of a synthetic package, byte-identical for equal specs. */
export function buildSyntheticTarball(spec: SyntheticPackageSpec): BuiltTarball {
  return tarballOf(packageFiles(spec));
}
