// Intake_Validator: a pure function of the entry list (R9.5 to R9.9, R9.12). No I/O, no clock.

import {
  ALLOWED_EXTENSIONS,
  CONTROL_FILES,
  DELTAS_FILE,
  FORBIDDEN_SEGMENTS,
  HARNESS_FILE,
  INTAKE_LIMITS,
  LICENSE_FILE_NAME,
  RESURRECTION_DIR,
  TEXT_EXTENSIONS,
} from "./limits";
import { codePointLabel, firstControlCharacter } from "./safePath";
import type { IntakeEntry, IntakeResult, Violation, ViolationCode } from "./types";

function badPathReason(path: string): string | null {
  if (path.length === 0) return "empty path";
  const control = firstControlCharacter(path);
  if (control !== null) return `control character ${codePointLabel(control)} in path`;
  if (path.includes("\\")) return "backslash in path";
  if (/^[A-Za-z]:/.test(path)) return "drive prefix in path";
  if (path.startsWith("/")) return "absolute path";
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "") return "empty path segment";
    if (segment === "..") return "'..' path segment";
    if (FORBIDDEN_SEGMENTS.includes(segment.toLowerCase())) return `forbidden path segment '${segment}'`;
  }
  return null;
}

function isAllowlisted(path: string): boolean {
  return path.startsWith(RESURRECTION_DIR) || CONTROL_FILES.includes(path);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

function isStrictUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function compareViolations(a: Violation, b: Violation): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return 0;
}

export function validateIntake(entries: readonly IntakeEntry[]): IntakeResult {
  const violations: Violation[] = [];
  const add = (path: string, code: ViolationCode, message: string): void => {
    violations.push({ path, code, message });
  };

  // 1. bad-path. Such entries take part in no later check.
  const sane: IntakeEntry[] = [];
  for (const entry of entries) {
    const reason = badPathReason(entry.path);
    if (reason !== null) add(entry.path, "bad-path", reason);
    else sane.push(entry);
  }

  // 2. outside-allowlist.
  const allowed: IntakeEntry[] = [];
  for (const entry of sane) {
    if (isAllowlisted(entry.path)) allowed.push(entry);
    else add(entry.path, "outside-allowlist", "path is not under resurrection/ and is not deltas.json or harness.json");
  }

  // 3. link (any entry that is not a regular file; also reported outside the allowlist).
  for (const entry of sane) {
    if (entry.type !== "file") add(entry.path, "link", `entry type '${entry.type}' is not allowed`);
  }
  const files = allowed.filter((entry) => entry.type === "file");

  // 4. case-collision (every path that took part, so both sides of a pair are named).
  const byLower = new Map<string, IntakeEntry[]>();
  for (const entry of sane) {
    const key = entry.path.toLowerCase();
    byLower.set(key, [...(byLower.get(key) ?? []), entry]);
  }
  for (const group of byLower.values()) {
    if (group.length < 2) continue;
    for (const entry of group) add(entry.path, "case-collision", "path differs from another path only in letter case");
  }

  // 5. limits.
  const resurrectionFiles = files.filter((entry) => entry.path.startsWith(RESURRECTION_DIR));
  if (resurrectionFiles.length > INTAKE_LIMITS.maxFiles) {
    add(RESURRECTION_DIR, "too-many-files", `${resurrectionFiles.length} files, limit ${INTAKE_LIMITS.maxFiles}`);
  }
  let total = 0;
  for (const entry of files) {
    total += entry.size;
    if (entry.size > INTAKE_LIMITS.maxFileBytes) {
      add(entry.path, "file-too-large", `${entry.size} bytes, limit ${INTAKE_LIMITS.maxFileBytes}`);
    }
    if (entry.path.split("/").length > INTAKE_LIMITS.maxDepth) {
      add(entry.path, "too-deep", `more than ${INTAKE_LIMITS.maxDepth} path segments`);
    }
    if (CONTROL_FILES.includes(entry.path) && entry.size > INTAKE_LIMITS.maxControlFileBytes) {
      add(entry.path, "control-file-too-large", `${entry.size} bytes, limit ${INTAKE_LIMITS.maxControlFileBytes}`);
    }
  }
  if (total > INTAKE_LIMITS.maxTotalBytes) {
    add(RESURRECTION_DIR, "total-too-large", `${total} bytes in total, limit ${INTAKE_LIMITS.maxTotalBytes}`);
  }

  // 6. required paths (a directory counts as present when a regular file lies under it).
  const present = new Set(files.map((entry) => entry.path));
  if (resurrectionFiles.length === 0) add(RESURRECTION_DIR, "missing-required", "resurrection/ is missing or empty");
  if (!present.has(DELTAS_FILE)) add(DELTAS_FILE, "missing-required", "deltas.json is missing");
  if (!present.has(HARNESS_FILE)) add(HARNESS_FILE, "missing-required", "harness.json is missing");
  if (resurrectionFiles.length > 0 && !present.has(`${RESURRECTION_DIR}package.json`)) {
    add(`${RESURRECTION_DIR}package.json`, "missing-required", "resurrection/package.json is missing");
  }

  // 7. content.
  for (const entry of files) {
    const extension = extensionOf(entry.path);
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const isLicense = name === LICENSE_FILE_NAME && entry.path.startsWith(RESURRECTION_DIR);
    if (!ALLOWED_EXTENSIONS.includes(extension) && !isLicense) {
      add(entry.path, "bad-extension", `extension '${extension}' is not allowed`);
      continue;
    }
    const mustBeText = TEXT_EXTENSIONS.includes(extension) || isLicense;
    if (mustBeText && entry.bytes !== undefined && !isStrictUtf8(entry.bytes)) {
      add(entry.path, "bad-encoding", "file is not valid UTF-8");
    }
  }

  if (violations.length > 0) return { ok: false, violations: violations.sort(compareViolations) };
  return { ok: true, files };
}
