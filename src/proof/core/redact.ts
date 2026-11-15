// Path_Redactor (Requirements 13.10 to 13.15). Pure: every machine-dependent input is in the
// PathContext. It processes ERROR TEXT only, after the Root_Normalizer, and before comparison.
//
// The Identity_Redactor over encoded nodes (redactIdentityDeep, redactionMaskedDifference,
// Requirements 13.25 and 13.30) is at the end of this module. It uses the shared matcher of
// identity.ts, so the Path_Redactor, the scanner and the redactor agree on what an Identity_Value is.
//
// One left-to-right pass over the text, with alternatives tried in this order at each position:
//   1. `<package>` and the rest of its path, remainder rewritten with forward slashes
//   2. the Proof_Engine work root, os.tmpdir() and the Node directory, with the rest of the path
//   3. any other absolute path (file:// URL, `\\?\`, UNC, drive letter, POSIX)
//   4. the name of a Proof_Engine temporary directory without its parent path
// A path found by 3 that begins with an Identity_Value path is left unchanged (Requirement 13.12).

import { canonicalizeNode } from "../child/codec/canonical";
import { compareCodePoints } from "../child/codec/order";
import { scanIdentity, redactIdentity, type IdentityValues, type Platform } from "./identity";
import {
  alternationSource,
  rootForms,
  type CollisionWhere,
  type NormalizationCollision,
  type RootForm,
} from "./normalize";
import type {
  DeltaEntry,
  EncodedDescriptor,
  EncodedNode,
  ExportSummary,
  Outcome,
  Result,
} from "../types";

export const REDACTED_PATH = "<redacted-path>";

export interface PathContext {
  /** True when the parent platform is win32. */
  caseInsensitive: boolean;
  knownPaths: {
    work: string;
    nodeDir: string;
    tmpDir: string;
    /** Names of directories created by the Proof_Engine, matched without a parent path. */
    tempNames: readonly string[];
  };
  /**
   * Path-valued Identity_Values (USERPROFILE, HOMEPATH, HOME), taken by the caller from the
   * environment snapshot. Only used to recognize a path that begins with one of them.
   */
  identityPaths: readonly string[];
}

const BODY = "[^\\s\"'`<>|*?]*";
const REST = `(?:[\\\\/]${BODY})?`;
const CONTINUES = "A-Za-z0-9._~-";

const PACKAGE_SOURCE = `<package>${REST}`;
const FILE_URL_SOURCE = "file:\\/\\/[^\\s\"'`<>|*?]+";
const EXTENDED_SOURCE = "(?:\\\\{4}\\?\\\\{2}|\\\\{2}\\?\\\\)[^\\s\"'`<>|*?]+";
const UNC_SOURCE = `(?<![\\\\/\\w:])\\\\{2,4}[^\\s"'\`<>|*?\\\\/]+\\\\{1,2}[^\\s"'\`<>|*?\\\\/]+${REST}`;
const DRIVE_SOURCE = `(?<![A-Za-z0-9_])[A-Za-z]:[\\\\/]${BODY}`;
const POSIX_SOURCE = `(?<![A-Za-z0-9_.~)\\]}>:/\\\\-])\\/[^\\s"'\`<>|*?/]${BODY}`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Trailing `:line:column` and sentence punctuation stay outside the replaced path.
function splitTail(match: string): [string, string] {
  let core = match;
  for (;;) {
    const m = /(?::\d+)+$|[)\]},;.:!]+$/.exec(core);
    if (m === null || m.index === 0) break;
    core = core.slice(0, m.index);
  }
  return [core, match.slice(core.length)];
}

/**
 * True when the path begins with an Identity_Value path, decided by the shared matcher of
 * identity.ts (all its forms, longest first, case-insensitive on Windows, name boundary so a
 * sibling directory is not matched). A path-valued Identity_Value without a drive letter, such
 * as `\Users\x`, is also recognized after the drive letter of the path.
 */
function beginsWithIdentityPath(path: string, identity: IdentityValues, platform: Platform): boolean {
  if (identity.pathValues.length === 0) return false;
  const afterDrive = /^[A-Za-z]:/.test(path) ? 2 : 0;
  return scanIdentity(path, identity, platform).matches.some(
    (m) => m.kind === "home" && (m.index === 0 || m.index === afterDrive),
  );
}

/** Builds the redaction function for a context; reuse it for many texts. */
export function buildPathRedactor(ctx: PathContext): (text: string) => string {
  const knownForms: RootForm[] = [];
  for (const root of [ctx.knownPaths.work, ctx.knownPaths.tmpDir, ctx.knownPaths.nodeDir]) {
    knownForms.push(...rootForms(root));
  }
  const knownSource = alternationSource(knownForms);
  const names = [...new Set(ctx.knownPaths.tempNames.filter((n) => n !== ""))].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
  );

  const alternatives: string[] = [`(?<pkg>${PACKAGE_SOURCE})`];
  if (knownSource !== null) alternatives.push(`(?<known>(?:${knownSource})${REST})`);
  alternatives.push(
    `(?<other>${[FILE_URL_SOURCE, EXTENDED_SOURCE, UNC_SOURCE, DRIVE_SOURCE, POSIX_SOURCE].join("|")})`,
  );
  if (names.length > 0) {
    alternatives.push(
      `(?<![${CONTINUES}])(?<name>${names.map(escapeRegExp).join("|")})(?![${CONTINUES}])`,
    );
  }
  const pattern = new RegExp(alternatives.join("|"), ctx.caseInsensitive ? "gi" : "g");
  const identity: IdentityValues = { pathValues: ctx.identityPaths, userName: undefined };
  const platform: Platform = ctx.caseInsensitive ? "win32" : "posix";

  return (text: string): string =>
    text.replace(pattern, (...args: unknown[]): string => {
      const match = args[0] as string;
      const groups = args[args.length - 1] as Record<string, string | undefined>;
      if (groups["name"] !== undefined) return REDACTED_PATH;
      const [core, tail] = splitTail(match);
      if (groups["pkg"] !== undefined) return core.replace(/\\+/g, "/") + tail;
      if (groups["known"] !== undefined) return REDACTED_PATH + tail;
      if (beginsWithIdentityPath(core, identity, platform)) return match;
      return REDACTED_PATH + tail;
    });
}

/** Redacts one error text. The text must already have been through the Root_Normalizer. */
export function redactErrorText(text: string, context: PathContext): string {
  return buildPathRedactor(context)(text);
}

// ---------------------------------------------------------------------------
// Encoded nodes: error text only
// ---------------------------------------------------------------------------

function redactNode(node: EncodedNode, redact: (t: string) => string): EncodedNode {
  const rec = (n: EncodedNode): EncodedNode => redactNode(n, redact);
  const props = (ps: readonly [string, EncodedNode][]): [string, EncodedNode][] =>
    ps.map(([k, v]): [string, EncodedNode] => [k, rec(v)]);
  switch (node.t) {
    case "error":
      return {
        t: "error",
        cls: node.cls,
        message: redact(node.message),
        // Every string-valued property of an error is error text; other values are walked
        // only to reach nested errors.
        props: node.props.map(([k, v]): [string, EncodedNode] => [
          k,
          v.t === "str" ? { t: "str", v: redact(v.v) } : rec(v),
        ]),
      };
    case "map":
      return {
        t: "map",
        entries: node.entries.map(([k, v]): [EncodedNode, EncodedNode] => [rec(k), rec(v)]),
      };
    case "set":
      return { t: "set", items: node.items.map(rec) };
    case "array":
      return {
        t: "array",
        length: node.length,
        items: node.items.map((e) => ({ i: e.i, n: rec(e.n) })),
        props: props(node.props),
      };
    case "object":
      return { t: "object", ctor: node.ctor, props: props(node.props) };
    default:
      return node;
  }
}

/** Redacts the error text inside one encoded node (for example a property result detail). */
export function redactErrorNodes(node: EncodedNode, context: PathContext): EncodedNode {
  return canonicalizeNode(redactNode(node, buildPathRedactor(context)));
}

/**
 * Redacts error text only: messages and string-valued properties of every encoded Error, and a
 * thrown or rejected string. Any other string, key and Prototype_Delta entry is unchanged.
 */
export function redactOutcome(outcome: Outcome, context: PathContext): Outcome {
  if (outcome.kind === "crash" || outcome.kind === "output-too-large" || outcome.kind === "timeout") {
    return outcome;
  }
  const redact = buildPathRedactor(context);
  const args = outcome.args.map((a) => canonicalizeNode(redactNode(a, redact)));
  const base =
    outcome.kind !== "returned" && outcome.value.t === "str"
      ? ({ t: "str", v: redact(outcome.value.v) } satisfies EncodedNode)
      : canonicalizeNode(redactNode(outcome.value, redact));
  switch (outcome.kind) {
    case "returned":
      return { ...outcome, value: base, args };
    case "threw":
      return { ...outcome, value: base, args };
    case "rejected":
      return { ...outcome, value: base, args };
  }
}

// ---------------------------------------------------------------------------
// Identity_Redactor over encoded nodes (Requirements 13.25, 13.30)
// ---------------------------------------------------------------------------
//
// Runs only on what is written to the report, never before the comparison. Every string that
// can carry text is redacted with `redactIdentity`: string values, object and error property
// keys, error class and message, constructor names, regular expression sources, symbol
// descriptions and function names, at any depth (including Map keys and values, Set items,
// arguments and Prototype_Delta strings). Numbers, flags, byte payloads (base64) and other
// non-text fields are left alone; an Identity_Value hidden in a base64 copy is not matched (L14).

interface IdentityCtx {
  readonly identity: IdentityValues;
  readonly platform: Platform;
  collision: boolean;
}

function idText(s: string, ctx: IdentityCtx): string {
  return redactIdentity(s, ctx.identity, ctx.platform);
}

function idProps(props: readonly [string, EncodedNode][], ctx: IdentityCtx): [string, EncodedNode][] {
  const seen = new Set<string>();
  const out: [string, EncodedNode][] = [];
  for (const [key, value] of props) {
    const k = idText(key, ctx);
    if (seen.has(k)) ctx.collision = true;
    seen.add(k);
    out.push([k, idWalk(value, ctx)]);
  }
  return out;
}

function idWalk(node: EncodedNode, ctx: IdentityCtx): EncodedNode {
  switch (node.t) {
    case "str":
      return { t: "str", v: idText(node.v, ctx) };
    case "symbol":
      return node.v === null ? node : { t: "symbol", v: idText(node.v, ctx) };
    case "regexp":
      return { t: "regexp", source: idText(node.source, ctx), flags: node.flags };
    case "function":
      return { t: "function", name: idText(node.name, ctx), arity: node.arity };
    case "map":
      return {
        t: "map",
        entries: node.entries.map(([k, v]): [EncodedNode, EncodedNode] => [idWalk(k, ctx), idWalk(v, ctx)]),
      };
    case "set":
      return { t: "set", items: node.items.map((n) => idWalk(n, ctx)) };
    case "error":
      return {
        t: "error",
        cls: idText(node.cls, ctx),
        message: idText(node.message, ctx),
        props: idProps(node.props, ctx),
      };
    case "array":
      return {
        t: "array",
        length: node.length,
        items: node.items.map((e) => ({ i: e.i, n: idWalk(e.n, ctx) })),
        props: idProps(node.props, ctx),
      };
    case "object":
      return {
        t: "object",
        ctor: node.ctor === null ? null : idText(node.ctor, ctx),
        props: idProps(node.props, ctx),
      };
    default:
      return node;
  }
}

function collisionResult<T>(where: CollisionWhere): Result<T, NormalizationCollision> {
  return { ok: false, error: { kind: "normalization-collision", where } };
}

/**
 * Identity_Redactor on one encoded node, then re-canonicalization. Two keys of one object that
 * become identical give `normalization-collision` (no path, no Identity_Value in the result).
 * Pure and idempotent. Not used before the comparison (Requirement 13.30).
 */
export function redactIdentityDeep(
  node: EncodedNode,
  identity: IdentityValues,
  platform: Platform,
  where: CollisionWhere = "property",
): Result<EncodedNode, NormalizationCollision> {
  const ctx: IdentityCtx = { identity, platform, collision: false };
  const value = canonicalizeNode(idWalk(node, ctx));
  return ctx.collision ? collisionResult(where) : { ok: true, value };
}

const PROTOTYPE_ORDER: readonly string[] = [
  "Object.prototype",
  "Array.prototype",
  "Function.prototype",
  "String.prototype",
  "Number.prototype",
  "Boolean.prototype",
];

function deltaKeyRank(entry: DeltaEntry): number {
  return "s" in entry.key ? 0 : 1;
}

function deltaKeyText(entry: DeltaEntry): string | null {
  return "s" in entry.key ? entry.key.s : entry.key.sym;
}

function compareDeltaEntries(a: DeltaEntry, b: DeltaEntry): number {
  const p = PROTOTYPE_ORDER.indexOf(a.prototype) - PROTOTYPE_ORDER.indexOf(b.prototype);
  if (p !== 0) return p;
  const r = deltaKeyRank(a) - deltaKeyRank(b);
  if (r !== 0) return r;
  const ka = deltaKeyText(a);
  const kb = deltaKeyText(b);
  if (ka === kb) return 0;
  if (ka === null) return -1;
  if (kb === null) return 1;
  return compareCodePoints(ka, kb);
}

function idDescriptor(d: EncodedDescriptor, ctx: IdentityCtx): EncodedDescriptor {
  const walk = (n: EncodedNode): EncodedNode => canonicalizeNode(idWalk(n, ctx));
  return {
    ...(d.value !== undefined ? { value: walk(d.value) } : {}),
    ...(d.get !== undefined ? { get: walk(d.get) } : {}),
    ...(d.set !== undefined ? { set: walk(d.set) } : {}),
    ...(d.writable !== undefined ? { writable: d.writable } : {}),
    enumerable: d.enumerable,
    configurable: d.configurable,
  };
}

function idDelta(entries: readonly DeltaEntry[], ctx: IdentityCtx): DeltaEntry[] {
  let keyChanged = false;
  const seen = new Set<string>();
  const out = entries.map((e): DeltaEntry => {
    let key = e.key;
    if ("s" in key) {
      const s = idText(key.s, ctx);
      if (s !== key.s) keyChanged = true;
      key = { s };
      const id = e.prototype + "\u0000" + s;
      if (seen.has(id)) ctx.collision = true;
      seen.add(id);
    } else if (key.sym !== null) {
      const sym = idText(key.sym, ctx);
      if (sym !== key.sym) keyChanged = true;
      key = { sym };
    }
    return {
      prototype: e.prototype,
      key,
      change: e.change,
      ...(e.before !== undefined ? { before: idDescriptor(e.before, ctx) } : {}),
      ...(e.after !== undefined ? { after: idDescriptor(e.after, ctx) } : {}),
    };
  });
  return keyChanged
    ? out
        .map((e, i) => ({ e, i }))
        .sort((a, b) => compareDeltaEntries(a.e, b.e) || a.i - b.i)
        .map((x) => x.e)
    : out;
}

/** Identity_Redactor on Prototype_Delta entries (keys, symbol descriptions and descriptor nodes). */
export function redactIdentityDelta(
  entries: readonly DeltaEntry[],
  identity: IdentityValues,
  platform: Platform,
): Result<DeltaEntry[], NormalizationCollision> {
  const ctx: IdentityCtx = { identity, platform, collision: false };
  const value = idDelta(entries, ctx);
  return ctx.collision ? collisionResult("prototypeDelta") : { ok: true, value };
}

/**
 * Identity_Redactor on a whole Outcome: value, arguments (post-states) and Prototype_Delta.
 * `crash` and `output-too-large` carry no text.
 */
export function redactIdentityOutcome(
  outcome: Outcome,
  identity: IdentityValues,
  platform: Platform,
): Result<Outcome, NormalizationCollision> {
  if (outcome.kind === "crash" || outcome.kind === "output-too-large") {
    return { ok: true, value: outcome };
  }
  if (outcome.kind === "timeout") {
    if (outcome.prototypeDelta === undefined) return { ok: true, value: outcome };
    const delta = redactIdentityDelta(outcome.prototypeDelta, identity, platform);
    if (!delta.ok) return delta;
    return { ok: true, value: { kind: "timeout", prototypeDelta: delta.value } };
  }
  const value = redactIdentityDeep(outcome.value, identity, platform, "value");
  if (!value.ok) return value;
  const args: EncodedNode[] = [];
  for (const a of outcome.args) {
    const r = redactIdentityDeep(a, identity, platform, "args");
    if (!r.ok) return r;
    args.push(r.value);
  }
  const prototypeDelta = redactIdentityDelta(outcome.prototypeDelta, identity, platform);
  if (!prototypeDelta.ok) return prototypeDelta;
  switch (outcome.kind) {
    case "returned":
      return {
        ok: true,
        value: { kind: "returned", async: outcome.async, value: value.value, args, prototypeDelta: prototypeDelta.value },
      };
    case "threw":
      return {
        ok: true,
        value: { kind: "threw", async: false, value: value.value, args, prototypeDelta: prototypeDelta.value },
      };
    case "rejected":
      return {
        ok: true,
        value: { kind: "rejected", async: true, value: value.value, args, prototypeDelta: prototypeDelta.value },
      };
  }
}

// ---------------------------------------------------------------------------
// redactionMaskedDifference (Requirement 13.30)
// ---------------------------------------------------------------------------

/** The raw (not yet identity-redacted) pair recorded in a Divergence. */
export type RawPair =
  | { kind: "outcome"; original: Outcome; resurrection: Outcome }
  | { kind: "api-surface"; original: ExportSummary | null; resurrection: ExportSummary | null };

const nodeKey = (n: EncodedNode): string => JSON.stringify(canonicalizeNode(n));

function descriptorKey(d: EncodedDescriptor | undefined): unknown {
  if (d === undefined) return null;
  return [
    d.value === undefined ? null : nodeKey(d.value),
    d.get === undefined ? null : nodeKey(d.get),
    d.set === undefined ? null : nodeKey(d.set),
    d.writable ?? null,
    d.enumerable,
    d.configurable,
  ];
}

function deltaKey(entries: readonly DeltaEntry[]): unknown {
  return entries.map((e) => [
    e.prototype,
    "s" in e.key ? ["s", e.key.s] : ["sym", e.key.sym],
    e.change,
    descriptorKey(e.before),
    descriptorKey(e.after),
  ]);
}

/** Canonical JSON of an Outcome: fixed key order, every node in canonical form. */
function outcomeJson(o: Outcome): string {
  if (o.kind === "crash" || o.kind === "output-too-large") return JSON.stringify([o.kind]);
  if (o.kind === "timeout") {
    return JSON.stringify([o.kind, o.prototypeDelta === undefined ? null : deltaKey(o.prototypeDelta)]);
  }
  return JSON.stringify([o.kind, o.async, nodeKey(o.value), o.args.map(nodeKey), deltaKey(o.prototypeDelta)]);
}

function summaryJson(s: ExportSummary | null): string {
  if (s === null) return "null";
  return JSON.stringify([
    s.type,
    s.fnName ?? null,
    s.arity ?? null,
    s.primitive === undefined ? null : nodeKey(s.primitive),
  ]);
}

function redactedPairJson(
  pair: RawPair,
  identity: IdentityValues,
  platform: Platform,
): [string, string] | null {
  if (pair.kind === "outcome") {
    const a = redactIdentityOutcome(pair.original, identity, platform);
    const b = redactIdentityOutcome(pair.resurrection, identity, platform);
    if (!a.ok || !b.ok) return null;
    return [outcomeJson(a.value), outcomeJson(b.value)];
  }
  const side = (s: ExportSummary | null): string | null => {
    if (s === null) return "null";
    const text = (t: string): string => redactIdentity(t, identity, platform);
    const primitive = s.primitive === undefined ? undefined : redactIdentityDeep(s.primitive, identity, platform);
    if (primitive !== undefined && !primitive.ok) return null;
    return summaryJson({
      type: text(s.type),
      ...(s.fnName !== undefined ? { fnName: text(s.fnName) } : {}),
      ...(s.arity !== undefined ? { arity: s.arity } : {}),
      ...(primitive !== undefined && primitive.ok ? { primitive: primitive.value } : {}),
    });
  };
  const a = side(pair.original);
  const b = side(pair.resurrection);
  return a === null || b === null ? null : [a, b];
}

/**
 * True exactly when the two recorded sides differ BEFORE identity redaction (canonical JSON)
 * and have the same canonical JSON AFTER it. The comparison itself always happens before
 * redaction; this function only reports whether the redaction used for the report hid the
 * difference. When a side cannot be redacted (key collision), nothing is rendered and the
 * result is false.
 */
export function redactionMaskedDifference(
  pair: RawPair,
  identity: IdentityValues,
  platform: Platform,
): boolean {
  const before =
    pair.kind === "outcome"
      ? [outcomeJson(pair.original), outcomeJson(pair.resurrection)]
      : [summaryJson(pair.original), summaryJson(pair.resurrection)];
  if (before[0] === before[1]) return false;
  const after = redactedPairJson(pair, identity, platform);
  return after !== null && after[0] === after[1];
}
