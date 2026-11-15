// Harness_Config for lodash.set (design: "lodash.set harness"; Requirements 8, 10, 11, 14.6, 14.10).
//
// The only lodash-specific code of the Proof of Life Engine lives in this directory.
//
// Declared delta: lodash.set@4.3.2 (CVE-2020-8203) writes through the path segments `__proto__`,
// `constructor` and `prototype`, which pollutes Object.prototype. For a path with such a segment, the
// resurrection must not modify Object.prototype or the other tracked prototypes: it stops at the
// offending segment and returns the object, so assignments for earlier segments stay, as in
// lodash 4.17.20 `baseSet` (docs/demo-packages.md). The property is only that no tracked prototype
// is modified (Prototype_Delta empty); it does not constrain the rest of the result. The property
// module (sandbox/pollution.cjs) reports `ok: false` when a call changed a tracked prototype. A resurrection is expected to show
// `ok: true` on every in-predicate case while the original shows `ok: false`.
//
// Path resolution: the property module lives next to this file, so its absolute path is derived
// from `import.meta.url` (`fileURLToPath`), not from the working directory. The Sandbox_Executor
// grants read access only to `readPaths` and the setup module, so the module path is listed in
// `readPaths` as well, which grants exactly that one file.
//
// Requirement 8.14: no generator here uses `.filter`, a rejection chain or a retry loop. Every
// arbitrary is built by construction.

import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import type { DeclaredDelta, HarnessConfig } from "../../types";

export const DANGEROUS_SEGMENTS: readonly string[] = ["__proto__", "constructor", "prototype"];

/** Absolute path of the sandbox-side property module. */
export const POLLUTION_MODULE_PATH: string = fileURLToPath(
  new URL("./sandbox/pollution.cjs", import.meta.url),
);

// ---------------------------------------------------------------------------
// Path parsing (the way lodash.set@4.3.2 does it)
// ---------------------------------------------------------------------------

// Copied from lodash.set@4.3.2 (`rePropName`, `reLeadingDot`, `reEscapeChar`).
const RE_PROP_NAME =
  /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
const RE_LEADING_DOT = /^\./;
const RE_ESCAPE_CHAR = /\\(\\)?/g;

/**
 * The segments lodash.set@4.3.2 walks for `path`: an array path is used as is (each key
 * converted to a string); a string path is split on dots and brackets. Any other value is
 * converted to a string first. Pure; no state is shared between calls.
 */
export function parsePathSegments(path: unknown): string[] {
  if (Array.isArray(path)) return path.map((key: unknown) => String(key));
  const text = typeof path === "string" ? path : String(path);
  const result: string[] = [];
  if (RE_LEADING_DOT.test(text)) result.push("");
  text.replace(
    RE_PROP_NAME,
    (match: string, number: string | undefined, quote: string | undefined, inner: string | undefined) => {
      result.push(quote ? (inner ?? "").replace(RE_ESCAPE_CHAR, "$1") : (number ?? match));
      return match;
    },
  );
  return result;
}

/** The delta predicate: the path has `__proto__`, `constructor` or `prototype` as a segment. */
export function pathHasDangerousSegment(args: readonly unknown[]): boolean {
  return parsePathSegments(args[1]).some((segment) => DANGEROUS_SEGMENTS.includes(segment));
}

// ---------------------------------------------------------------------------
// Generators (by construction, no filters)
// ---------------------------------------------------------------------------

/** Ordinary keys: a safe alphabet that includes numeric segments. None is a dangerous segment. */
const safeSegment: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom("a", "b", "c", "d", "x", "y", "foo", "bar", "k1", "_z"),
  fc.nat(5).map(String),
);

const leaf: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: -100, max: 100 }),
  fc.string({ maxLength: 5 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);

const entriesOf = (keys: fc.Arbitrary<string>, values: fc.Arbitrary<unknown>) =>
  fc.array(fc.tuple(keys, values), { maxLength: 3 }).map((entries) => Object.fromEntries(entries));

const plainObject: fc.Arbitrary<unknown> = entriesOf(safeSegment, leaf);
const smallArray: fc.Arbitrary<unknown> = fc.array(leaf, { maxLength: 3 });

/** Small plain objects and arrays, one level of nesting. */
const target: fc.Arbitrary<unknown> = fc.oneof(
  plainObject,
  smallArray,
  entriesOf(safeSegment, fc.oneof(leaf, plainObject, smallArray)),
);

/** Values to set. */
const value: fc.Arbitrary<unknown> = fc.oneof(
  leaf,
  plainObject,
  smallArray,
  fc.constant({ polluted: true }),
);

type PathForm = "dotted" | "bracket" | "array";

/** Renders safe segments in one of the three forms. A numeric segment becomes `[n]` in bracket form. */
function renderPath(segments: readonly string[], form: PathForm): string | string[] {
  if (form === "array") return [...segments];
  if (form === "dotted") return segments.join(".");
  let text = "";
  segments.forEach((segment, index) => {
    if (/^\d+$/.test(segment)) text += `[${segment}]`;
    else text += index === 0 ? segment : `.${segment}`;
  });
  return text;
}

const pathForm: fc.Arbitrary<PathForm> = fc.constantFrom<PathForm>("dotted", "bracket", "array");

/** Ordinary paths: one to four safe segments, string (dotted or bracket) or array form. */
const ordinaryPath: fc.Arbitrary<string | string[]> = fc
  .tuple(fc.array(safeSegment, { minLength: 1, maxLength: 4 }), pathForm)
  .map(([segments, form]) => renderPath(segments, form));

/** Arguments (object, path, value) whose path never has a dangerous segment. */
export const ordinaryArgs: fc.Arbitrary<readonly unknown[]> = fc
  .tuple(target, ordinaryPath, value)
  .map(([object, path, newValue]) => [object, path, newValue] as const);

/**
 * Paths with a dangerous segment at a random position, built by construction: ordinary segments
 * before and after, one dangerous segment between them, then rendered in one of the forms. In
 * bracket form the dangerous segment is written as `["name"]` or `['name']`.
 */
const dangerousPath: fc.Arbitrary<string | string[]> = fc
  .tuple(
    fc.array(safeSegment, { maxLength: 3 }),
    fc.constantFrom(...DANGEROUS_SEGMENTS),
    fc.array(safeSegment, { maxLength: 3 }),
    pathForm,
    fc.constantFrom('"', "'"),
  )
  .map(([before, dangerous, after, form, quote]) => {
    if (form === "array") return [...before, dangerous, ...after];
    if (form === "dotted") return [...before, dangerous, ...after].join(".");
    const head = renderPath(before, "bracket") as string;
    const tail = renderPath(after, "bracket") as string;
    const middle = `[${quote}${dangerous}${quote}]`;
    // `tail` starts with a bare key when its first segment is not numeric: add the separating dot.
    const sep = tail === "" || tail.startsWith("[") ? "" : ".";
    return `${head}${middle}${sep}${tail}`;
  });

const pollutingValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant({ polluted: true }),
  fc.constant("yes"),
  fc.constant(1),
  plainObject,
);

/** Arguments (object, path, value) whose path always has a dangerous segment. */
export const dangerousArgs: fc.Arbitrary<readonly unknown[]> = fc
  .tuple(target, dangerousPath, pollutingValue)
  .map(([object, path, newValue]) => [object, path, newValue] as const);

// ---------------------------------------------------------------------------
// Explicit cases
// ---------------------------------------------------------------------------

/** Ordinary representative cases, run before the generated ones. */
export const ordinaryExplicitCases: readonly (readonly unknown[])[] = [
  [{}, "a", 1],
  [{}, "a.b.c", 1],
  [{}, "a[0].b", 2],
  [{ a: [] }, ["a", "0", "x"], "v"],
  [{ a: { b: 1 } }, "a.b", { c: 3 }],
  [[], "[0]", "z"],
  [[], "0.a", null],
  [{ a: 1 }, ["a"], undefined],
];

/** In-predicate demonstration cases (CVE-2020-8203 forms). */
export const deltaExplicitCases: readonly (readonly unknown[])[] = [
  [{}, "__proto__.polluted", "yes"],
  [{}, "constructor.prototype.polluted", "yes"],
  [{}, ["__proto__", "polluted"], "yes"],
];

export const prototypePollutionDelta: DeclaredDelta = {
  id: "lodash.set-prototype-pollution",
  // lodash.set's `module.exports` IS the function; the engine lists that export as `default`.
  function: "default",
  predicate: pathHasDangerousSegment,
  propertyModule: POLLUTION_MODULE_PATH,
  explicitCases: deltaExplicitCases,
  generator: dangerousArgs,
  caseCount: 100,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const lodashSetHarness: HarnessConfig = {
  package: "lodash.set",
  seed: 20260101,
  caseCount: 100,
  perCallTimeoutMs: 1000,
  heapLimitMb: 256,
  outputLimitBytes: 1_048_576,
  maxRestarts: 20,
  shrinkBudget: 500,
  functions: {
    // lodash.set's `module.exports` IS the function; the engine lists that export as `default`.
    default: {
      args: ordinaryArgs,
      explicitCases: ordinaryExplicitCases,
      caseCount: 100,
    },
  },
  deltas: [prototypePollutionDelta],
  readPaths: [POLLUTION_MODULE_PATH],
};
