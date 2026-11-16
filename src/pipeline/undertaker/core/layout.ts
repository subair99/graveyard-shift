// Entry layout of graveyard/<package>/: file names, kinds, the single deriveEntryKind and the plan.
// Pure. Writer, nightly reader and tests all use this module (R14.12, R14.15).

import type { Verdict } from "../../../proof/types";
import { err, ok, type Result } from "../../common/result";

export const ENTRY_FILES = {
  certificate: "certificate.json",
  eligibility: "eligibility.json",
  deltas: "deltas.json",
  harness: "harness.json",
  proofReport: "proof-report.json",
  stubMarker: "stub-run.json",
} as const;

export const bundleName = (subject: string): string => `${subject}.sigstore.json`;

export type EntryKind = "resurrection" | "not-resurrected";

export type EntryKindError = { kind: "malformed-entry"; message: string };

export function deriveEntryKind(
  files: readonly string[],
  eligibility: { eligible: boolean } | null,
): Result<EntryKind, EntryKindError> {
  if (files.includes(ENTRY_FILES.proofReport)) return ok("resurrection");
  if (eligibility !== null && eligibility.eligible === false) return ok("not-resurrected");
  return err({
    kind: "malformed-entry",
    message: `entry has no ${ENTRY_FILES.proofReport} and no ${ENTRY_FILES.eligibility} with eligible: false`,
  });
}

const compareCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function planEntryFiles(i: {
  kind: EntryKind;
  verdict: Verdict | null;
  stub: boolean;
  tarballName: string | null;
}): string[] {
  const files: string[] = [ENTRY_FILES.certificate, ENTRY_FILES.eligibility];
  if (i.kind === "resurrection") {
    if (i.tarballName === null) {
      throw new Error("planEntryFiles: a resurrection entry needs a tarballName");
    }
    files.push(ENTRY_FILES.deltas, ENTRY_FILES.harness, i.tarballName, ENTRY_FILES.proofReport);
    if (i.verdict === "alive") {
      // The three subjects of R13.4: tarball, proof report, certificate.
      files.push(
        bundleName(i.tarballName),
        bundleName(ENTRY_FILES.proofReport),
        bundleName(ENTRY_FILES.certificate),
      );
    }
    if (i.stub) files.push(ENTRY_FILES.stubMarker);
  }
  return files.sort(compareCodePoint);
}

export interface StubMarker {
  schemaVersion: 1;
  mode: "stub";
  label: "stub run";
}

export function buildStubMarker(): StubMarker {
  return { schemaVersion: 1, mode: "stub", label: "stub run" };
}
