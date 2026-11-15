// Generator of single atomic mutations of an encoded value (Property 11).
// `mutationArb` encodes a generated value, wraps it in a one-property object, picks one mutation
// site in the canonical tree and applies it to a copy. Every mutation changes exactly one thing,
// so the first difference reported by `firstDifference` is the injected one.
import { canonicalizeNode } from "../../../src/proof/child/codec/canonical";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import type { EncodedNode, TypedKind } from "../../../src/proof/child/codec/nodes";
import { compareCodePoints } from "../../../src/proof/child/codec/order";
import type { DifferenceKind } from "../../../src/proof/core/equal";
import { fc } from "../../engine/helpers/fc";
import { valueArb } from "./valueArb";

const BUDGET = 50_000_000;

export function encodeOrThrow(v: unknown): EncodedNode {
  const r = encodeValue(v, { budget: BUDGET });
  if (!r.ok) throw new Error(`encoding failed: ${r.reason}`);
  return r.node;
}

type Prop = [string, EncodedNode];

export interface MutationSite {
  /** What was changed, for failure messages. */
  label: string;
  /** Path `firstDifference` reports (only reliable when `ordered`). */
  path: string;
  /** Kind `firstDifference` reports (only reliable when `ordered`). */
  kind: DifferenceKind;
  /** False under a Map or Set, where canonical sorting may move the mutated item. */
  ordered: boolean;
  apply: () => void;
}

export interface Mutation {
  /** Canonical, wrapped in `{ v: <value> }`. Never modified. */
  base: EncodedNode;
  /** Copy of `base` with one atomic mutation. */
  mutated: EncodedNode;
  site: Omit<MutationSite, "apply">;
}

function join(path: string, ...parts: (string | number)[]): string {
  return path === "" ? parts.join("/") : [path, ...parts].join("/");
}

function overwrite(target: EncodedNode, source: EncodedNode): void {
  const t = target as unknown as Record<string, unknown>;
  for (const k of Object.keys(t)) delete t[k];
  Object.assign(t, source);
}

function flipB64(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) return Buffer.from([0]).toString("base64");
  buf[0] = (buf[0] ?? 0) ^ 0xff;
  return buf.toString("base64");
}

function freshKey(props: readonly Prop[]): string {
  let key = "added";
  while (props.some((p) => p[0] === key)) key += "_";
  return key;
}

function collectProps(props: Prop[], base: string, ordered: boolean, out: MutationSite[]): void {
  props.forEach((p, i) => {
    collect(p[1], join(base, i, 1), ordered, out);
    out.push({
      label: "remove-key",
      path: join(base, i),
      kind: "missing-key",
      ordered,
      apply: () => void props.splice(i, 1),
    });
  });
  for (const [label, value] of [
    ["add-key-null", { t: "null" }],
    ["add-key-undefined", { t: "undefined" }],
  ] as const) {
    const key = freshKey(props);
    let at = props.findIndex((p) => compareCodePoints(p[0], key) > 0);
    if (at < 0) at = props.length;
    out.push({
      label,
      path: join(base, at),
      kind: "extra-key",
      ordered,
      apply: () => void props.splice(at, 0, [key, { ...value } as EncodedNode]),
    });
  }
}

function collect(node: EncodedNode, path: string, ordered: boolean, out: MutationSite[]): void {
  const site = (
    label: string,
    kind: DifferenceKind,
    apply: () => void,
    at: string = path,
  ): void => void out.push({ label, path: at, kind, ordered, apply });

  // Replace by a node of another type.
  const other: EncodedNode = node.t === "unencodable" ? { t: "undefined" } : { t: "unencodable", reason: "proxy" };
  site("type-swap", "type-mismatch", () => overwrite(node, other));

  switch (node.t) {
    case "undefined":
    case "null":
      return;
    case "bool":
      site("bool-flip", "value-mismatch", () => void (node.v = !node.v));
      return;
    case "str":
      site("str-append", "value-mismatch", () => void (node.v += "x"));
      return;
    case "bigint":
      site("bigint-append", "value-mismatch", () => void (node.v += "1"));
      return;
    case "symbol":
      site("symbol-description", "value-mismatch", () => void (node.v = node.v === null ? "" : node.v + "x"));
      return;
    case "num": {
      const v = node.v;
      if (v === "NaN") site("nan-to-number", "value-mismatch", () => void (node.v = 1));
      else site("number-to-nan", "value-mismatch", () => void (node.v = "NaN"));
      if (v === "-0") site("negzero-to-zero", "value-mismatch", () => void (node.v = 0));
      else if (v === 0) site("zero-to-negzero", "value-mismatch", () => void (node.v = "-0"));
      else if (v === "Infinity") site("inf-sign", "value-mismatch", () => void (node.v = "-Infinity"));
      else if (v === "-Infinity") site("inf-sign", "value-mismatch", () => void (node.v = "Infinity"));
      else if (typeof v === "number") site("number-negate", "value-mismatch", () => void (node.v = -v));
      return;
    }
    case "date":
      site("date-time", "value-mismatch", () => void (node.v = node.v === "invalid" ? 0 : node.v + 1));
      return;
    case "regexp":
      site("regexp-source", "value-mismatch", () => void (node.source += "x"), join(path, "source"));
      site("regexp-flags", "value-mismatch", () => void (node.flags += "x"), join(path, "flags"));
      return;
    case "arraybuffer":
      site("arraybuffer-byte", "value-mismatch", () => void (node.b64 = flipB64(node.b64)));
      return;
    case "typed": {
      site("typed-byte", "value-mismatch", () => void (node.b64 = flipB64(node.b64)));
      const next: TypedKind = node.kind === "Uint8Array" ? "Int8Array" : "Uint8Array";
      site("typed-kind", "value-mismatch", () => void (node.kind = next), join(path, "kind"));
      return;
    }
    case "function":
      site("function-name", "value-mismatch", () => void (node.name += "x"), join(path, "name"));
      site("function-arity", "value-mismatch", () => void (node.arity += 1), join(path, "arity"));
      return;
    case "unencodable":
      site(
        "unencodable-reason",
        "value-mismatch",
        () => void (node.reason = node.reason === "cycle" ? "depth" : "cycle"),
      );
      return;
    case "set": {
      const items = node.items;
      items.forEach((n, i) => collect(n, join(path, "items", i), false, out));
      site("set-add", "length-mismatch", () => void items.push({ t: "null" }), join(path, "items"));
      if (items.length > 0) {
        site("set-remove", "length-mismatch", () => void items.pop(), join(path, "items"));
      }
      return;
    }
    case "map": {
      const entries = node.entries;
      entries.forEach((e, i) => {
        collect(e[0], join(path, "entries", i, 0), false, out);
        collect(e[1], join(path, "entries", i, 1), false, out);
      });
      site(
        "map-add",
        "length-mismatch",
        () => void entries.push([{ t: "null" }, { t: "null" }]),
        join(path, "entries"),
      );
      if (entries.length > 0) {
        site("map-remove", "length-mismatch", () => void entries.pop(), join(path, "entries"));
      }
      return;
    }
    case "error":
      site("error-class", "value-mismatch", () => void (node.cls += "X"), join(path, "cls"));
      site("error-message", "value-mismatch", () => void (node.message += "x"), join(path, "message"));
      collectProps(node.props, join(path, "props"), ordered, out);
      return;
    case "object":
      site(
        "object-ctor",
        "value-mismatch",
        () => void (node.ctor = node.ctor === null ? "Object" : node.ctor + "X"),
        join(path, "ctor"),
      );
      collectProps(node.props, join(path, "props"), ordered, out);
      return;
    case "array": {
      site("array-length", "length-mismatch", () => void (node.length += 1), join(path, "length"));
      const items = node.items;
      items.forEach((it, p) => {
        collect(it.n, join(path, "items", p, "n"), ordered, out);
        if (it.n.t === "undefined") {
          // undefined replaced by a hole
          site("undefined-to-hole", "missing-key", () => void items.splice(p, 1), join(path, "items", p));
        }
      });
      const used = new Set(items.map((it) => it.i));
      let hole = 0;
      while (used.has(hole)) hole++;
      if (hole < node.length) {
        let at = items.findIndex((it) => it.i > hole);
        if (at < 0) at = items.length;
        // a hole replaced by undefined
        site(
          "hole-to-undefined",
          "extra-key",
          () => void items.splice(at, 0, { i: hole, n: { t: "undefined" } }),
          join(path, "items", at),
        );
      }
      collectProps(node.props, join(path, "props"), ordered, out);
      return;
    }
  }
}

/** Mutation sites of `value` (canonical tree wrapped in `{ v }`), in a deterministic order. */
function sitesOf(wrapper: EncodedNode): MutationSite[] {
  const out: MutationSite[] = [];
  if (wrapper.t === "object") collectProps(wrapper.props, "props", true, out);
  return out;
}

/** Applies the mutation chosen by `pick` to a copy of `value`. */
export function mutateNode(value: EncodedNode, pick: number): Mutation {
  const wrap = (v: EncodedNode): EncodedNode => ({ t: "object", ctor: "Object", props: [["v", v]] });
  const base = canonicalizeNode(wrap(structuredClone(value)));
  const mutated = structuredClone(base);
  const sites = sitesOf(mutated);
  const chosen = sites[pick % sites.length] as MutationSite;
  chosen.apply();
  return {
    base,
    mutated,
    site: { label: chosen.label, path: chosen.path, kind: chosen.kind, ordered: chosen.ordered },
  };
}

/** Encodable values paired with one atomic mutation of their encoded form. */
export const mutationArb: fc.Arbitrary<Mutation> = fc
  .tuple(valueArb, fc.nat())
  .map(([v, pick]) => mutateNode(encodeOrThrow(v), pick));
