import * as fs from "node:fs";
import * as path from "node:path";
import type { Result } from "../types";

/**
 * CommonJS entry resolution (Requirements 3.4, 3.5).
 *
 * Order: `exports` (subset below), then `main` (as given, with `.js`, with `/index.js`), then
 * `index.js`. Only CommonJS is supported. `"type": "module"` is rejected here, before any child
 * starts. A package without a `type` field that uses ES module syntax is not detected
 * (limitation L12); this module does not support ES modules.
 *
 * Supported `exports` subset: a string, an array of such forms (first usable element), a
 * conditions object, or an object with a `"."` key whose value is one of those. Conditions are
 * matched in key order against `require`, `node` and `default`. Subpath keys other than `"."`,
 * patterns, `null` targets and unmatched conditions are rejected, never ignored.
 */

export interface UnloadableModuleError {
  kind: "unloadable-module";
  message: string;
}

export interface ResolvedEntry {
  /** Absolute path of the entry file, in `fs.realpathSync.native` form. */
  entryFile: string;
  /** `name` from package.json, or null when absent or not a string. */
  name: string | null;
  /** `version` from package.json, or null when absent or not a string. */
  version: string | null;
}

const CONDITIONS: ReadonlySet<string> = new Set(["require", "node", "default"]);

type Fail = (message: string) => Result<never, UnloadableModuleError>;
const fail: Fail = (message) => ({ ok: false, error: { kind: "unloadable-module", message } });

export function resolveEntry(packageDir: string): Result<ResolvedEntry, UnloadableModuleError> {
  let root: string;
  try {
    root = fs.realpathSync.native(packageDir);
  } catch {
    return fail("package directory does not exist");
  }

  const manifest = readManifest(root);
  if (!manifest.ok) return manifest;
  const pkg = manifest.value;

  if (pkg["type"] === "module") {
    return fail('package.json declares "type": "module"; only CommonJS packages are supported');
  }

  let candidate: string | undefined;
  const exportsField = pkg["exports"];
  if (exportsField !== undefined && exportsField !== null) {
    const target = resolveExports(exportsField);
    if (!target.ok) return target;
    const contained = lexicalInside(root, target.value);
    if (contained === undefined) return fail("exports target is outside the package directory");
    if (!isRegularFile(contained)) return fail("exports target file does not exist");
    candidate = contained;
  } else {
    const main = pkg["main"];
    if (typeof main === "string" && main !== "") {
      const base = lexicalInside(root, main);
      if (base === undefined) return fail("main points outside the package directory");
      candidate = firstFile([base, `${base}.js`, path.join(base, "index.js")]);
    }
    if (candidate === undefined) {
      candidate = firstFile([path.join(root, "index.js")]);
    }
    if (candidate === undefined) return fail("no entry file found (main, index.js)");
  }

  if (/\.mjs$/i.test(candidate)) {
    return fail("entry file is an ES module (.mjs); only CommonJS packages are supported");
  }

  // The real path of the file must still be inside the real package root (symlink escape).
  let realEntry: string;
  try {
    realEntry = fs.realpathSync.native(candidate);
  } catch {
    return fail("entry file does not exist");
  }
  if (!isInside(root, realEntry)) {
    return fail("entry file is outside the package directory");
  }

  return {
    ok: true,
    value: {
      entryFile: realEntry,
      name: typeof pkg["name"] === "string" ? pkg["name"] : null,
      version: typeof pkg["version"] === "string" ? pkg["version"] : null,
    },
  };
}

function readManifest(root: string): Result<Record<string, unknown>, UnloadableModuleError> {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "package.json"), "utf8");
  } catch {
    return fail("package.json is missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fail("package.json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("package.json is not a JSON object");
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** Resolves the `"."` target of an `exports` value to a relative string such as `./lib/a.js`. */
function resolveExports(value: unknown): Result<string, UnloadableModuleError> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const subpathKeys = keys.filter((key) => key.startsWith("."));
    if (subpathKeys.length > 0) {
      if (subpathKeys.length !== keys.length) {
        return fail("exports mixes subpath keys and condition keys");
      }
      if (!keys.includes(".")) return fail('exports has no "." entry');
      return resolveTarget((value as Record<string, unknown>)["."]);
    }
  }
  return resolveTarget(value);
}

function resolveTarget(target: unknown): Result<string, UnloadableModuleError> {
  if (typeof target === "string") {
    if (!target.startsWith("./")) return fail('exports target must start with "./"');
    if (target.includes("*")) return fail("exports patterns are not supported");
    return { ok: true, value: target };
  }
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTarget(item);
      if (resolved.ok) return resolved;
    }
    return fail("exports array has no usable CommonJS target");
  }
  if (typeof target === "object" && target !== null) {
    const record = target as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key.startsWith(".")) return fail("exports nests subpath keys inside conditions");
      if (!CONDITIONS.has(key)) continue;
      const resolved = resolveTarget(record[key]);
      if (resolved.ok) return resolved;
    }
    return fail("exports has no target for the require, node or default conditions");
  }
  return fail("exports target is not supported");
}

/** Joins `relative` onto `root`; returns undefined when the result leaves `root` lexically. */
function lexicalInside(root: string, relative: string): string | undefined {
  const joined = path.resolve(root, relative);
  return isInside(root, joined) ? joined : undefined;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function isRegularFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function firstFile(candidates: readonly string[]): string | undefined {
  return candidates.find(isRegularFile);
}
