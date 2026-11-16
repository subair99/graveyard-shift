// Necromancy gate: pure function of the two package.json objects and the two license files
// (requirements R10.1 to R10.6, R10.9). All checks run; every failure is listed.

import * as semver from "semver";
import { creditKey, missingAuthorCredits } from "./authors";

export type PackageJson = Readonly<Record<string, unknown>>;

export interface LicenseFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface NecromancyInput {
  readonly original: PackageJson;
  readonly resurrection: PackageJson;
  readonly originalLicense: LicenseFile | null;
  readonly resurrectionLicense: LicenseFile | null;
}

export const NECROMANCY_CHECK_IDS = [
  "license",
  "license-file",
  "author-credits",
  "version",
  "name",
  "forbidden-fields",
] as const;

export type NecromancyCheckId = (typeof NECROMANCY_CHECK_IDS)[number];

export interface NecromancyCheck {
  readonly id: NecromancyCheckId;
  readonly ok: boolean;
  readonly message: string;
}

export interface NecromancyResult {
  readonly ok: boolean;
  readonly checks: readonly NecromancyCheck[];
}

export const NAME_SCOPE = "@graveyard-shift/";
export const FORBIDDEN_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"] as const;

/** True for a root file named LICENSE or LICENCE, with or without an extension, any case. */
export function isLicenseFileName(name: string): boolean {
  return /^licen[cs]e(\.[^/\\]*)?$/i.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function show(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

function check(id: NecromancyCheckId, problem: string | null, okMessage: string): NecromancyCheck {
  return problem === null ? { id, ok: true, message: okMessage } : { id, ok: false, message: problem };
}

function checkLicense(i: NecromancyInput): NecromancyCheck {
  const o = i.original.license;
  const r = i.resurrection.license;
  const same = JSON.stringify(o) === JSON.stringify(r);
  return check(
    "license",
    same ? null : `license ${show(r)} differs from the original's ${show(o)}`,
    `license ${show(o)} matches the original`,
  );
}

function checkLicenseFile(i: NecromancyInput): NecromancyCheck {
  if (i.originalLicense === null) {
    return check("license-file", null, "the original has no license file");
  }
  if (i.resurrectionLicense === null) {
    return check("license-file", `license file ${i.originalLicense.path} is missing`, "");
  }
  const same = bytesEqual(i.originalLicense.bytes, i.resurrectionLicense.bytes);
  return check(
    "license-file",
    same ? null : `license file ${i.resurrectionLicense.path} differs from the original's ${i.originalLicense.path}`,
    "license file is identical to the original's",
  );
}

function checkAuthors(i: NecromancyInput): NecromancyCheck {
  const missing = missingAuthorCredits(i.original, i.resurrection);
  return check(
    "author-credits",
    missing.length === 0 ? null : `author credits missing: ${missing.map(creditKey).join(", ")}`,
    "every author credit of the original is present",
  );
}

function checkVersion(i: NecromancyInput): NecromancyCheck {
  const o = typeof i.original.version === "string" ? semver.valid(i.original.version) : null;
  const r = typeof i.resurrection.version === "string" ? semver.valid(i.resurrection.version) : null;
  let problem: string | null = null;
  if (o === null) problem = `original version ${show(i.original.version)} is not valid semver`;
  else if (r === null) problem = `version ${show(i.resurrection.version)} is not valid semver`;
  else if (semver.prerelease(r) !== null) problem = `version ${r} is a prerelease`;
  else if (semver.major(r) !== semver.major(o)) problem = `version ${r} changes the major of ${o}`;
  else if (!semver.gt(r, o)) problem = `version ${r} is not greater than ${o}`;
  return check("version", problem, `version ${r ?? ""} is a patch or minor increase over ${o ?? ""}`);
}

function checkName(i: NecromancyInput): NecromancyCheck {
  const o = i.original.name;
  const r = i.resurrection.name;
  const expected = typeof o === "string" ? `${NAME_SCOPE}${o}` : null;
  const problem =
    expected === null
      ? `original name ${show(o)} is not a string`
      : r === expected
        ? null
        : `name ${show(r)} is not ${show(expected)}`;
  return check("name", problem, `name is ${show(r)}`);
}

function checkForbidden(i: NecromancyInput): NecromancyCheck {
  const problems: string[] = [];
  const r = i.resurrection;
  if (isRecord(r.dependencies)) {
    const before = isRecord(i.original.dependencies) ? i.original.dependencies : {};
    const added = Object.keys(r.dependencies).filter((k) => !Object.prototype.hasOwnProperty.call(before, k));
    if (added.length > 0) problems.push(`adds dependencies: ${added.join(", ")}`);
  } else if (r.dependencies !== undefined && i.original.dependencies === undefined) {
    problems.push("adds a dependencies field");
  }
  if (isRecord(r.scripts)) {
    const scripts = r.scripts;
    const found = FORBIDDEN_SCRIPTS.filter((k) => Object.prototype.hasOwnProperty.call(scripts, k));
    if (found.length > 0) problems.push(`has install-time scripts: ${found.join(", ")}`);
  }
  if (r.bin !== undefined) problems.push("has a bin field");
  if (r.type === "module") problems.push('sets type to "module"');
  return check(
    "forbidden-fields",
    problems.length === 0 ? null : problems.join("; "),
    "no forbidden fields",
  );
}

export function checkNecromancy(input: NecromancyInput): NecromancyResult {
  const checks = [
    checkLicense(input),
    checkLicenseFile(input),
    checkAuthors(input),
    checkVersion(input),
    checkName(input),
    checkForbidden(input),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
