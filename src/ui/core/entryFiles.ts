// File-name check of one Graveyard_Entry (crypt-ui Requirement 2.5). Pure.
// Whether a file is missing for the entry kind is checked by the reader after deriveEntryKind.

import { bundleName, ENTRY_FILES } from "../../pipeline/undertaker/core/layout";
import { err, ok, type Result } from "../../pipeline/common/result";

const TARBALL_NAME = /^[a-z0-9][a-z0-9._-]*\.tgz$/;

export function checkEntryFileNames(
  files: readonly string[],
): Result<{ tarballName: string | null }, string> {
  const fixed = new Set<string>(Object.values(ENTRY_FILES));
  const tarballs = files.filter((f) => !fixed.has(f) && TARBALL_NAME.test(f));
  if (tarballs.length > 1) {
    return err(`more than one tarball in the entry: ${tarballs.join(", ")}`);
  }
  const tarballName = tarballs[0] ?? null;
  const accepted = new Set<string>(fixed);
  if (tarballName !== null) accepted.add(tarballName);
  for (const subject of [tarballName, ENTRY_FILES.proofReport, ENTRY_FILES.certificate]) {
    if (subject !== null) accepted.add(bundleName(subject));
  }
  for (const f of files) {
    if (!accepted.has(f)) return err(`unexpected file name in the entry: ${f}`);
  }
  return ok({ tarballName });
}
