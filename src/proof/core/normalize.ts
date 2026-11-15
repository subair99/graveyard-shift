// Root_Normalizer (Requirements 13.18 to 13.22). Pure: every machine-dependent input is an
// argument. No environment, file system, clock or random source.
//
// Replaces the temporary package root of one side, in every form it can take in text, with
// `<package>` in every encoded string of that side's Outcome (values, keys, Prototype_Delta
// strings), then re-canonicalizes. Two object keys that become identical give
// `normalization-collision`.

import { canonicalizeNode } from "../child/codec/canonical";
import { compareCodePoints } from "../child/codec/order";
import type { DeltaEntry, EncodedDescriptor, EncodedNode, Outcome, Result } from "../types";

export const PACKAGE_PLACEHOLDER = "<package>";

/** The created (user-supplied) path of a side's root and, only when different, its real path. */
export interface SideRoots {
  created: string;
  real?: string;
}

export type CollisionWhere = "value" | "args" | "prototypeDelta" | "property";

export interface NormalizationCollision {
  kind: "normalization-collision";
  where: CollisionWhere;
}

/** One candidate text form of a root. `url` forms carry percent-encoded hexadecimal digits. */
export interface RootForm {
  text: string;
  url: boolean;
}

export interface RootMatcher {
  /** Global expression, or `null` when there is no usable root. */
  readonly pattern: RegExp | null;
}

// Characters that can continue a directory name (Requirement 13.19). A root is matched only
// where the next character is not one of these. In the URL form `%` also continues a name.
const LOOKAHEAD_PLAIN = "(?![A-Za-z0-9._~-])";
const LOOKAHEAD_URL = "(?![A-Za-z0-9._~%-])";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pct(byte: number): string {
  return "%" + byte.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Percent-encodes a forward-slash path the way `pathToFileURL` does: space, `%`, `#`, `?`,
 * `"`, `<`, `>`, backtick, braces and control characters, and non-ASCII as UTF-8 bytes,
 * with uppercase hexadecimal (observed in the 1.6 spike: `%20`, `%23`, `%25`, `%C3%BC`).
 */
function encodeUrlPath(path: string): string {
  const utf8 = new TextEncoder();
  let out = "";
  for (const ch of path) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x7f) {
      for (const b of utf8.encode(ch)) out += pct(b);
    } else if (cp <= 0x20 || cp === 0x7f || ch === "%" || '"#<>?`{}'.includes(ch)) {
      out += pct(cp);
    } else {
      out += ch;
    }
  }
  return out;
}

function urlFormOf(forward: string): string | undefined {
  if (/^[A-Za-z]:\//.test(forward)) return "file:///" + encodeUrlPath(forward);
  if (forward.startsWith("//")) return "file:" + encodeUrlPath(forward);
  if (forward.startsWith("/")) return "file://" + encodeUrlPath(forward);
  return undefined;
}

/**
 * All candidate forms of one root: native, forward-slash, back-slash, JSON-escaped back-slash
 * (every back-slash doubled), the `\\?\` extended-length form (and its escaped form) for a
 * drive-letter root, and the percent-encoded `file://` URL form. Forms are built by encoding
 * the root, never by decoding text, so a root containing a literal `%20` (URL form `%2520`)
 * is not confused with a root containing a space.
 */
export function rootForms(root: string): RootForm[] {
  const trimmed = root.replace(/[\\/]+$/, "");
  if (trimmed === "") return [];
  const forward = trimmed.replace(/\\/g, "/");
  const back = trimmed.replace(/\//g, "\\");
  const forms: RootForm[] = [
    { text: trimmed, url: false },
    { text: forward, url: false },
    { text: back, url: false },
    { text: back.replace(/\\/g, "\\\\"), url: false },
  ];
  if (/^[A-Za-z]:\\/.test(back)) {
    const extended = "\\\\?\\" + back;
    forms.push({ text: extended, url: false });
    forms.push({ text: extended.replace(/\\/g, "\\\\"), url: false });
  }
  const url = urlFormOf(forward);
  if (url !== undefined) forms.push({ text: url, url: true });
  return forms;
}

/** Deduplicates by text, then orders longest first, ties by Unicode code point. */
export function orderForms(forms: readonly RootForm[]): RootForm[] {
  const byText = new Map<string, RootForm>();
  for (const f of forms) if (!byText.has(f.text)) byText.set(f.text, f);
  return [...byText.values()].sort(
    (a, b) => b.text.length - a.text.length || compareCodePoints(a.text, b.text),
  );
}

function hexClass(d: string): string {
  return /[A-Fa-f]/.test(d) ? `[${d.toUpperCase()}${d.toLowerCase()}]` : d;
}

function urlSource(text: string): string {
  return text
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((part, i) => {
      if (i % 2 === 1) return "%" + hexClass(part.charAt(1)) + hexClass(part.charAt(2));
      // `^` is encoded as %5E by newer URL parsers only, so accept both.
      return part.split("^").map(escapeRegExp).join("(?:\\^|%5[eE])");
    })
    .join("");
}

/** Regular expression source of one form, with the boundary rule appended. */
export function formSource(form: RootForm): string {
  return form.url
    ? urlSource(form.text) + LOOKAHEAD_URL
    : escapeRegExp(form.text) + LOOKAHEAD_PLAIN;
}

/** Expression source matching any of the forms, longest first; `null` when there are none. */
export function alternationSource(forms: readonly RootForm[]): string | null {
  const ordered = orderForms(forms);
  if (ordered.length === 0) return null;
  return ordered.map(formSource).join("|");
}

export function buildRootMatcher(roots: SideRoots, caseInsensitive: boolean): RootMatcher {
  const forms = rootForms(roots.created);
  if (roots.real !== undefined && roots.real !== roots.created) forms.push(...rootForms(roots.real));
  const source = alternationSource(forms);
  if (source === null) return { pattern: null };
  return { pattern: new RegExp(source, caseInsensitive ? "gi" : "g") };
}

/** Replaces every root occurrence in one pass; replaced text is never rescanned. */
export function normalizeText(text: string, matcher: RootMatcher): string {
  if (matcher.pattern === null) return text;
  return text.replace(matcher.pattern, PACKAGE_PLACEHOLDER);
}

// ---------------------------------------------------------------------------
// Encoded nodes
// ---------------------------------------------------------------------------

interface Ctx {
  matcher: RootMatcher;
  collision: boolean;
}

function walkProps(props: readonly [string, EncodedNode][], ctx: Ctx): [string, EncodedNode][] {
  const seen = new Set<string>();
  const out: [string, EncodedNode][] = [];
  for (const [key, value] of props) {
    const k = normalizeText(key, ctx.matcher);
    if (seen.has(k)) ctx.collision = true;
    seen.add(k);
    out.push([k, walk(value, ctx)]);
  }
  return out;
}

function walk(node: EncodedNode, ctx: Ctx): EncodedNode {
  const nt = (s: string): string => normalizeText(s, ctx.matcher);
  switch (node.t) {
    case "str":
      return { t: "str", v: nt(node.v) };
    case "symbol":
      return node.v === null ? node : { t: "symbol", v: nt(node.v) };
    case "regexp":
      return { t: "regexp", source: nt(node.source), flags: node.flags };
    case "function":
      return { t: "function", name: nt(node.name), arity: node.arity };
    case "map":
      return {
        t: "map",
        entries: node.entries.map(([k, v]): [EncodedNode, EncodedNode] => [walk(k, ctx), walk(v, ctx)]),
      };
    case "set":
      return { t: "set", items: node.items.map((n) => walk(n, ctx)) };
    case "error":
      return {
        t: "error",
        cls: nt(node.cls),
        message: nt(node.message),
        props: walkProps(node.props, ctx),
      };
    case "array":
      return {
        t: "array",
        length: node.length,
        items: node.items.map((e) => ({ i: e.i, n: walk(e.n, ctx) })),
        props: walkProps(node.props, ctx),
      };
    case "object":
      return {
        t: "object",
        ctor: node.ctor === null ? null : nt(node.ctor),
        props: walkProps(node.props, ctx),
      };
    default:
      return node;
  }
}

function normalizeWith(node: EncodedNode, ctx: Ctx): EncodedNode {
  return canonicalizeNode(walk(node, ctx));
}

/** Normalizes one encoded node (for example a property result detail). */
export function normalizeNode(
  node: EncodedNode,
  matcher: RootMatcher,
  where: CollisionWhere = "property",
): Result<EncodedNode, NormalizationCollision> {
  const ctx: Ctx = { matcher, collision: false };
  const value = normalizeWith(node, ctx);
  if (ctx.collision) return { ok: false, error: { kind: "normalization-collision", where } };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Prototype_Delta
// ---------------------------------------------------------------------------

const PROTOTYPE_ORDER: readonly string[] = [
  "Object.prototype",
  "Array.prototype",
  "Function.prototype",
  "String.prototype",
  "Number.prototype",
  "Boolean.prototype",
];

function walkDescriptor(d: EncodedDescriptor, ctx: Ctx): EncodedDescriptor {
  return {
    ...(d.value !== undefined ? { value: normalizeWith(d.value, ctx) } : {}),
    ...(d.get !== undefined ? { get: normalizeWith(d.get, ctx) } : {}),
    ...(d.set !== undefined ? { set: normalizeWith(d.set, ctx) } : {}),
    ...(d.writable !== undefined ? { writable: d.writable } : {}),
    enumerable: d.enumerable,
    configurable: d.configurable,
  };
}

function keyRank(entry: DeltaEntry): number {
  return "s" in entry.key ? 0 : 1;
}

function keyText(entry: DeltaEntry): string | null {
  return "s" in entry.key ? entry.key.s : entry.key.sym;
}

function compareDelta(a: DeltaEntry, b: DeltaEntry): number {
  const p = PROTOTYPE_ORDER.indexOf(a.prototype) - PROTOTYPE_ORDER.indexOf(b.prototype);
  if (p !== 0) return p;
  const r = keyRank(a) - keyRank(b);
  if (r !== 0) return r;
  const ka = keyText(a);
  const kb = keyText(b);
  if (ka === kb) return 0;
  if (ka === null) return -1;
  if (kb === null) return 1;
  return compareCodePoints(ka, kb);
}

function walkDelta(entries: readonly DeltaEntry[], ctx: Ctx): DeltaEntry[] {
  let keyChanged = false;
  const seen = new Set<string>();
  const out = entries.map((e): DeltaEntry => {
    let key = e.key;
    if ("s" in key) {
      const s = normalizeText(key.s, ctx.matcher);
      if (s !== key.s) keyChanged = true;
      key = { s };
      const id = e.prototype + "\u0000" + s;
      if (seen.has(id)) ctx.collision = true;
      seen.add(id);
    } else if (key.sym !== null) {
      const sym = normalizeText(key.sym, ctx.matcher);
      if (sym !== key.sym) keyChanged = true;
      key = { sym };
    }
    return {
      prototype: e.prototype,
      key,
      change: e.change,
      ...(e.before !== undefined ? { before: walkDescriptor(e.before, ctx) } : {}),
      ...(e.after !== undefined ? { after: walkDescriptor(e.after, ctx) } : {}),
    };
  });
  // The delta is sorted before encoding; re-sort only when a key text changed.
  return keyChanged ? out.map((e, i) => ({ e, i })).sort((a, b) => compareDelta(a.e, b.e) || a.i - b.i).map((x) => x.e) : out;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/** Normalizes an Outcome with a prepared matcher. Pure; the input is not modified. */
export function normalizeOutcomeWith(
  outcome: Outcome,
  matcher: RootMatcher,
): Result<Outcome, NormalizationCollision> {
  const fail = (where: CollisionWhere): Result<Outcome, NormalizationCollision> => ({
    ok: false,
    error: { kind: "normalization-collision", where },
  });

  if (outcome.kind === "crash" || outcome.kind === "output-too-large") {
    return { ok: true, value: outcome };
  }
  if (outcome.kind === "timeout") {
    if (outcome.prototypeDelta === undefined) return { ok: true, value: outcome };
    const ctx: Ctx = { matcher, collision: false };
    const prototypeDelta = walkDelta(outcome.prototypeDelta, ctx);
    if (ctx.collision) return fail("prototypeDelta");
    return { ok: true, value: { kind: "timeout", prototypeDelta } };
  }

  const valueCtx: Ctx = { matcher, collision: false };
  const value = normalizeWith(outcome.value, valueCtx);
  if (valueCtx.collision) return fail("value");

  const argsCtx: Ctx = { matcher, collision: false };
  const args = outcome.args.map((a) => normalizeWith(a, argsCtx));
  if (argsCtx.collision) return fail("args");

  const deltaCtx: Ctx = { matcher, collision: false };
  const prototypeDelta = walkDelta(outcome.prototypeDelta, deltaCtx);
  if (deltaCtx.collision) return fail("prototypeDelta");

  switch (outcome.kind) {
    case "returned":
      return { ok: true, value: { kind: "returned", async: outcome.async, value, args, prototypeDelta } };
    case "threw":
      return { ok: true, value: { kind: "threw", async: false, value, args, prototypeDelta } };
    case "rejected":
      return { ok: true, value: { kind: "rejected", async: true, value, args, prototypeDelta } };
  }
}

/**
 * Replaces the side's own roots in every encoded string of the Outcome with `<package>`,
 * re-canonicalizes, and reports `normalization-collision` when two keys of one object become
 * identical (Requirement 13.21). The same code runs for both sides.
 */
export function normalizeOutcome(
  outcome: Outcome,
  roots: SideRoots,
  caseInsensitive: boolean,
): Result<Outcome, NormalizationCollision> {
  return normalizeOutcomeWith(outcome, buildRootMatcher(roots, caseInsensitive));
}
