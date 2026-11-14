import semver from "semver";
import type { EngineInput, PackageRef, Result } from "../types";
import { packageNameProblem } from "./packageName";

export const MAX_PACKAGE_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_PACKAGE_LOCK_BYTES = 50 * 1024 * 1024;
export const NO_PACKAGES_NOTE = "no packages found";

export interface ParseError {
  /** "package name", "package.json", "package-lock.json", or the unsupported file name. */
  inputType: string;
  reason: string;
}

export interface ParsedInput {
  refs: PackageRef[];
  note?: string;
}

type Json = unknown;

function isRecord(v: Json): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(inputType: string, reason: string): Result<never, ParseError> {
  return { ok: false, error: { inputType, reason } };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Compares strings by Unicode code point (not UTF-16 unit, not locale). */
export function compareCodePoints(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const ra = ia.next();
    const rb = ib.next();
    if (ra.done === true && rb.done === true) return 0;
    if (ra.done === true) return -1;
    if (rb.done === true) return 1;
    const ca = ra.value.codePointAt(0) ?? 0;
    const cb = rb.value.codePointAt(0) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

/** null (latest) first, then exact versions by semver precedence, then other specs by code point. */
function compareSpecs(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const va = semver.valid(a);
  const vb = semver.valid(b);
  if (va !== null && vb !== null) {
    const c = semver.compare(va, vb);
    if (c !== 0) return c;
    return compareCodePoints(a, b);
  }
  if (va !== null) return -1;
  if (vb !== null) return 1;
  return compareCodePoints(a, b);
}

function finalize(refs: PackageRef[]): ParsedInput {
  const sorted = [...refs].sort(
    (x, y) => compareCodePoints(x.name, y.name) || compareSpecs(x.spec, y.spec),
  );
  const out: PackageRef[] = [];
  for (const ref of sorted) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.name === ref.name && prev.spec === ref.spec) continue;
    out.push(ref);
  }
  return out.length === 0 ? { refs: out, note: NO_PACKAGES_NOTE } : { refs: out };
}

function parseName(name: string, version: string | undefined): Result<ParsedInput, ParseError> {
  const type = "package name";
  const problem = packageNameProblem(name);
  if (problem !== null) return fail(type, problem);
  if (version === undefined || version === "") {
    return { ok: true, value: { refs: [{ name, spec: null }] } };
  }
  if (semver.valid(version) === null && semver.validRange(version) === null) {
    return fail(type, `version "${version}" is not an exact semver version or a semver range`);
  }
  return { ok: true, value: { refs: [{ name, spec: version }] } };
}

function parseJsonObject(
  type: string,
  text: string,
  limit: number,
): Result<Record<string, unknown>, ParseError> {
  if (byteLength(text) > limit) {
    return fail(type, `file is larger than ${limit / (1024 * 1024)} MB`);
  }
  let data: Json;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    return fail(type, `invalid JSON: ${detail}`);
  }
  if (!isRecord(data)) return fail(type, "top-level value must be a JSON object");
  return { ok: true, value: data };
}

const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

function parsePackageJson(text: string): Result<ParsedInput, ParseError> {
  const type = "package.json";
  const obj = parseJsonObject(type, text, MAX_PACKAGE_JSON_BYTES);
  if (!obj.ok) return obj;
  const refs: PackageRef[] = [];
  for (const field of DEP_FIELDS) {
    const section = obj.value[field];
    if (section === undefined) continue;
    if (!isRecord(section)) return fail(type, `"${field}" must be an object`);
    for (const [name, spec] of Object.entries(section)) {
      const problem = packageNameProblem(name);
      if (problem !== null) return fail(type, `"${field}" entry "${name}": ${problem}`);
      if (typeof spec !== "string") {
        return fail(type, `"${field}" entry "${name}": version specifier must be a string`);
      }
      refs.push({ name, spec });
    }
  }
  return { ok: true, value: finalize(refs) };
}

const NODE_MODULES = "node_modules/";

function nameFromLockPath(path: string): string | null {
  const idx = path.lastIndexOf(NODE_MODULES);
  if (idx === -1) return null;
  if (idx !== 0 && path[idx - 1] !== "/") return null;
  const name = path.slice(idx + NODE_MODULES.length);
  return name.length === 0 ? null : name;
}

function collectV1(
  deps: Record<string, unknown>,
  refs: PackageRef[],
): string | null {
  for (const [name, entry] of Object.entries(deps)) {
    const problem = packageNameProblem(name);
    if (problem !== null) return `dependency "${name}": ${problem}`;
    if (!isRecord(entry)) return `dependency "${name}" must be an object`;
    const version = entry["version"];
    if (typeof version !== "string") return `dependency "${name}" has no version string`;
    refs.push({ name, spec: version });
    const nested = entry["dependencies"];
    if (nested !== undefined) {
      if (!isRecord(nested)) return `dependency "${name}": "dependencies" must be an object`;
      const err = collectV1(nested, refs);
      if (err !== null) return err;
    }
  }
  return null;
}

function parsePackageLock(text: string): Result<ParsedInput, ParseError> {
  const type = "package-lock.json";
  const obj = parseJsonObject(type, text, MAX_PACKAGE_LOCK_BYTES);
  if (!obj.ok) return obj;
  const lock = obj.value;
  const lv = lock["lockfileVersion"];
  if (lv !== undefined && (typeof lv !== "number" || !Number.isInteger(lv) || lv < 1 || lv > 3)) {
    return fail(type, `unsupported lockfileVersion ${JSON.stringify(lv)} (supported: 1, 2, 3)`);
  }
  const packages = lock["packages"];
  const dependencies = lock["dependencies"];
  const refs: PackageRef[] = [];

  if (packages !== undefined && lv !== 1) {
    if (!isRecord(packages)) return fail(type, `"packages" must be an object`);
    for (const [path, entry] of Object.entries(packages)) {
      if (path === "") continue; // root project entry
      const name = nameFromLockPath(path);
      if (name === null) continue; // workspace folder, not an installed package
      if (!isRecord(entry)) return fail(type, `"packages" entry "${path}" must be an object`);
      if (entry["link"] === true) continue;
      const problem = packageNameProblem(name);
      if (problem !== null) return fail(type, `"packages" entry "${path}": ${problem}`);
      const version = entry["version"];
      if (typeof version !== "string") continue;
      refs.push({ name, spec: version });
    }
  } else if (dependencies !== undefined) {
    if (!isRecord(dependencies)) return fail(type, `"dependencies" must be an object`);
    const err = collectV1(dependencies, refs);
    if (err !== null) return fail(type, err);
  } else if (packages === undefined) {
    return fail(type, `no "packages" or "dependencies" field found`);
  }
  return { ok: true, value: finalize(refs) };
}

const UNSUPPORTED_LOCKFILES: Record<string, string> = {
  "yarn.lock": "yarn.lock",
  "pnpm-lock.yaml": "pnpm-lock.yaml",
};

function parseOther(filename: string): Result<ParsedInput, ParseError> {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const known = Object.hasOwn(UNSUPPORTED_LOCKFILES, base) ? UNSUPPORTED_LOCKFILES[base] : undefined;
  if (known !== undefined) {
    return fail(known, `${known} is not supported; provide a package-lock.json, package.json, or package name`);
  }
  return fail(base || "unknown file", "unsupported input type; provide a package name, package.json, or package-lock.json");
}

/** Pure: no clock, network, or environment access. */
export function parseInput(input: EngineInput): Result<ParsedInput, ParseError> {
  switch (input.kind) {
    case "name":
      return parseName(input.name, input.version);
    case "package.json":
      return parsePackageJson(input.text);
    case "package-lock.json":
      return parsePackageLock(input.text);
    case "other":
      return parseOther(input.filename);
  }
}
