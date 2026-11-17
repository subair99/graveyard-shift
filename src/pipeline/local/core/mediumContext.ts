/**
 * Medium_Context plan (pure): the files the Local_Runner writes for the Context_Server, and the
 * scan that must come back empty before anything is written.
 * Requirements: 5.1, 5.2, 5.5 (medium-agent).
 */

import { redactionScanFindsAnything } from "../../common/canonical";
import type { IdentityValues, Platform } from "../../common/canonical";
import { findIdentity } from "../../../proof/core/identity";
import type { ExtractedFile } from "../../../proof/shell/tarball/tarballExtractor";

export const MEDIUM_CONTEXT_DIR = ".graveyard-work/medium-context";
export const GUARD_LOG_FILE_REL = ".graveyard-work/guard.log";

/** Repository-relative path of the Measurement_File of a package version. */
export function measurementFilePath(name: string, version: string): string {
  return `docs/measurements/${name}-${version}.json`;
}

export interface ContextFile {
  rel: string;
  bytes: Uint8Array;
  kind: "generated" | "original";
}

const encoder = new TextEncoder();

/** The Medium_Context files in plan order, with exact bytes. */
export function planMediumContext(input: {
  certificateText: string;
  eligibilityText: string;
  menuText: string;
  measurementBytes: Uint8Array | null;
  original: readonly ExtractedFile[];
}): ContextFile[] {
  const files: ContextFile[] = [
    { rel: "certificate.json", bytes: encoder.encode(input.certificateText), kind: "generated" },
    { rel: "eligibility.json", bytes: encoder.encode(input.eligibilityText), kind: "generated" },
    { rel: "preset-menu.json", bytes: encoder.encode(input.menuText), kind: "generated" },
  ];
  if (input.measurementBytes !== null) {
    files.push({ rel: "measurement.json", bytes: input.measurementBytes, kind: "generated" });
  }
  for (const f of input.original) {
    files.push({ rel: `original/${f.path}`, bytes: f.bytes, kind: "original" });
  }
  return files;
}

/**
 * `rel` of every file that fails the scan, in plan order. Generated files get the full redaction
 * scan; Original files only the identity scan, so public package text is not rejected.
 */
export function contextScanFindings(
  files: readonly ContextFile[],
  identity: IdentityValues,
  platform: Platform,
): string[] {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const findings: string[] = [];
  for (const f of files) {
    const text = decoder.decode(f.bytes);
    const found =
      f.kind === "generated"
        ? redactionScanFindsAnything(text, identity, platform)
        : findIdentity(text, identity, platform).found;
    if (found) findings.push(f.rel);
  }
  return findings;
}
