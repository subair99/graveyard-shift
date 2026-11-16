// Types of the Intake_Validator (pure). The same entries shape is filled by gitEntries (CI) and fsEntries (local).

export type EntryType = "file" | "symlink" | "hardlink" | "submodule" | "device" | "other";

/** Directories are not entries. `bytes` is present for regular files under the allowlist. */
export interface IntakeEntry {
  readonly path: string;
  readonly type: EntryType;
  readonly size: number;
  readonly bytes?: Uint8Array;
}

export const VIOLATION_CODES = [
  "bad-encoding",
  "bad-extension",
  "bad-path",
  "case-collision",
  "control-file-too-large",
  "file-too-large",
  "link",
  "missing-required",
  "outside-allowlist",
  "too-deep",
  "too-many-files",
  "total-too-large",
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface Violation {
  readonly path: string;
  readonly code: ViolationCode;
  readonly message: string;
}

export type IntakeResult =
  | { readonly ok: true; readonly files: readonly IntakeEntry[] }
  | { readonly ok: false; readonly violations: readonly Violation[] };
