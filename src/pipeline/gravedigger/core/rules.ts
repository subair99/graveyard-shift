// Gravedigger eligibility rules (R2.3 to R2.6, R2.8) and the line counter (R2.4). Pure.

import type { DeathCertificate } from "../../../engine/types";

/** Rule ids in the fixed evaluation order of R2.3 (a) to (g). */
export const RULE_IDS = [
  "license",
  "dependencies",
  "module-type",
  "line-count",
  "status",
  "causes",
  "open-vulnerability",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type Observed = string | number | boolean | null;

export interface RuleResult {
  rule: RuleId;
  holds: boolean;
  observed: Observed;
  /** Present only when the field needed by the rule could not be read (R2.6). */
  reason?: "unverified";
  missingField?: string;
}

export const ALLOWED_LICENSES: readonly string[] = [
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
];

/** Product limit of rule (d). */
export const MAX_LINES = 5000;

export interface PackageJsonLike {
  license?: unknown;
  dependencies?: unknown;
  type?: unknown;
}

export interface EvaluateInput {
  /** The `package.json` of the tarball, or null when it could not be read. */
  pkg: PackageJsonLike | null;
  /** Lines of the text files in the tarball, or null when the tarball was not read. */
  lineCount: number | null;
  cert: DeathCertificate;
}

function unverified(rule: RuleId, missingField: string): RuleResult {
  return { rule, holds: false, observed: null, reason: "unverified", missingField };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function licenseRule(pkg: PackageJsonLike | null): RuleResult {
  if (pkg === null) return unverified("license", "package.json");
  if (typeof pkg.license !== "string") return unverified("license", "license");
  return { rule: "license", holds: ALLOWED_LICENSES.includes(pkg.license), observed: pkg.license };
}

function dependenciesRule(pkg: PackageJsonLike | null): RuleResult {
  if (pkg === null) return unverified("dependencies", "package.json");
  if (pkg.dependencies === undefined) return { rule: "dependencies", holds: true, observed: 0 };
  if (!isPlainObject(pkg.dependencies)) return unverified("dependencies", "dependencies");
  const count = Object.keys(pkg.dependencies).length;
  return { rule: "dependencies", holds: count === 0, observed: count };
}

function moduleTypeRule(pkg: PackageJsonLike | null): RuleResult {
  if (pkg === null) return unverified("module-type", "package.json");
  if (pkg.type === undefined) return { rule: "module-type", holds: true, observed: null };
  if (typeof pkg.type !== "string") return unverified("module-type", "type");
  return { rule: "module-type", holds: pkg.type !== "module", observed: pkg.type };
}

function lineCountRule(lineCount: number | null): RuleResult {
  if (lineCount === null) return unverified("line-count", "lineCount");
  return { rule: "line-count", holds: lineCount <= MAX_LINES, observed: lineCount };
}

function statusRule(cert: DeathCertificate): RuleResult {
  if (cert.status === undefined) return unverified("status", "status");
  // retired-with-successor is neither dead nor dying, so it fails here; the record keeps the Successor.
  return {
    rule: "status",
    holds: cert.status === "dead" || cert.status === "dying",
    observed: cert.status,
  };
}

function openVulnerabilityRule(cert: DeathCertificate): RuleResult {
  // When OSV could not be queried, the certificate marks the vital sign unavailable and leaves
  // `openVulnerabilityIds` empty (engine/core/certificate.ts). An empty list then means "unknown",
  // not "none", so the rule is unverified (R2.6) rather than failed with an observed 0.
  if (!cert.vitalSigns.openVulnerabilities.available) {
    return unverified("open-vulnerability", "openVulnerabilities");
  }
  return {
    rule: "open-vulnerability",
    holds: cert.openVulnerabilityIds.length >= 1,
    observed: cert.openVulnerabilityIds.length,
  };
}

/**
 * Inputs of detectCauses (src/engine/core/causes.ts), in its order, with how the certificate shows
 * that each one could not be read (src/engine/core/certificate.ts, buildCertificate):
 * - maintainers: `vitalSigns.maintainers.available === false`.
 * - githubRepo (archived flag and last push): the certificate has no vital sign for GitHub; the
 *   `githubRepo` fact is written only when the GitHub call succeeded. So GitHub was unavailable or
 *   skipped when there is neither a `githubRepo` fact nor a `notes.omittedFacts` entry for it (an
 *   omitted entry means the data was read but had no provenance).
 * - openVulnerabilities: `vitalSigns.openVulnerabilities.available === false`.
 * - timeOfDeath: `timeOfDeath.available === false`.
 */
export const CAUSE_INPUTS = ["maintainers", "githubRepo", "openVulnerabilities", "timeOfDeath"] as const;

function unavailableCauseInputs(cert: DeathCertificate): string[] {
  const githubRead =
    cert.facts.some((f) => f.key === "githubRepo") ||
    cert.notes.omittedFacts.some((o) => o.key === "githubRepo");
  const unavailable: Record<(typeof CAUSE_INPUTS)[number], boolean> = {
    maintainers: !cert.vitalSigns.maintainers.available,
    githubRepo: !githubRead,
    openVulnerabilities: !cert.vitalSigns.openVulnerabilities.available,
    timeOfDeath: !cert.timeOfDeath.available,
  };
  return CAUSE_INPUTS.filter((k) => unavailable[k]);
}

/**
 * Inputs each cause depends on (src/engine/core/causes.ts, detectCauses):
 * - maintainer-gone: maintainers (lines 37-39).
 * - repo-archived: githubRepo, the archived flag (lines 40-42).
 * - unpatched-cve: openVulnerabilities (lines 43-45).
 * - runtime-rot: timeOfDeath (lines 46-47) and githubRepo, the last push (lines 49-50). An
 *   unavailable push date is treated as "no push date" and still yields the cause (line 53), and
 *   certificate.ts (lines 341-353) passes the unavailable GitHub signal as `lastPush`. So a found
 *   runtime-rot is reliable only when githubRepo was available.
 */
const CAUSE_DEPENDS_ON: Record<string, readonly (typeof CAUSE_INPUTS)[number][]> = {
  "maintainer-gone": ["maintainers"],
  "repo-archived": ["githubRepo"],
  "unpatched-cve": ["openVulnerabilities"],
  "runtime-rot": ["timeOfDeath", "githubRepo"],
};

function causesRule(cert: DeathCertificate): RuleResult {
  // The rule holds when at least one listed cause has every input it depends on available.
  // Otherwise it is unverified (R2.6). The missingField set, comma-separated without spaces in
  // CAUSE_INPUTS order, is:
  // - found causes exist but all are unreliable: the unavailable inputs of those causes only;
  // - no cause found: every unavailable input (unknown, not "none");
  // - a reliable cause coexists with an unreliable one: the rule holds, no missingField.
  const unavailable = new Set<string>(unavailableCauseInputs(cert));
  const observed = cert.causes.length;
  if (observed === 0) {
    if (unavailable.size > 0) return unverified("causes", [...unavailable].join(","));
    return { rule: "causes", holds: false, observed };
  }
  const missingOf = (c: string): string[] => (CAUSE_DEPENDS_ON[c] ?? []).filter((i) => unavailable.has(i));
  if (cert.causes.some((c) => missingOf(c).length === 0)) return { rule: "causes", holds: true, observed };
  const missing = new Set(cert.causes.flatMap(missingOf));
  return unverified("causes", CAUSE_INPUTS.filter((k) => missing.has(k)).join(","));
}

/** The seven rules in fixed order. Never throws; an unreadable field gives an `unverified` failure. */
export function evaluateRules(input: EvaluateInput): RuleResult[] {
  const { pkg, lineCount, cert } = input;
  return [
    licenseRule(pkg),
    dependenciesRule(pkg),
    moduleTypeRule(pkg),
    lineCountRule(lineCount),
    statusRule(cert),
    causesRule(cert),
    openVulnerabilityRule(cert),
  ];
}

const NEWLINE = 0x0a;

function isStrictUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lines of one file: the number of `\n`, plus one when the file is not empty and does not end
 * with `\n`. A text file has no NUL byte and is strict UTF-8.
 */
function countFileLines(bytes: Uint8Array): number | null {
  if (bytes.length === 0) return 0;
  if (bytes.includes(0)) return null;
  if (!isStrictUtf8(bytes)) return null;
  let n = 0;
  for (const b of bytes) if (b === NEWLINE) n++;
  return bytes[bytes.length - 1] === NEWLINE ? n : n + 1;
}

/** Total lines of the text files (R2.4). Reads only the bytes; never `dist.unpackedSize`. */
export function countLines(files: readonly { path: string; bytes: Uint8Array }[]): number {
  let total = 0;
  for (const f of files) total += countFileLines(f.bytes) ?? 0;
  return total;
}
