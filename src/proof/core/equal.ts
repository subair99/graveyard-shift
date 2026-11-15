// Strict structural comparison of encoded nodes and Outcomes (Requirement 7).
// Pure: reads neither the clock, the environment nor the file system.

import { canonicalizeNode, renderNode } from "../child/codec/canonical";
import { compareCodePoints } from "../child/codec/order";
import type { DeltaEntry, EncodedDescriptor, EncodedNode, Outcome } from "../types";

export type OutcomePart = "kind" | "async" | "value" | "args" | "prototypeDelta";

/** The shape of `Difference` in types.ts (`part` and `path`). Extra detail lives in `NodeDifference`. */
export interface PartDifference {
  part: OutcomePart;
  path: string;
}

export type DifferenceKind =
  | "type-mismatch"
  | "value-mismatch"
  | "missing-key"
  | "extra-key"
  | "length-mismatch";

/**
 * First difference between two encoded nodes. `path` is '/'-separated inside the encoded tree
 * (for example `props/2/1`, `items/0/n`, `entries/1/0`). `original` and `resurrection` are short
 * renderings of the two sides; `<absent>` marks a side that has no node at that position.
 */
export interface NodeDifference {
  path: string;
  kind: DifferenceKind;
  original: string;
  resurrection: string;
}

const ABSENT = "<absent>";
const RENDER_LIMIT = 200;

function render(node: EncodedNode): string {
  const s = renderNode(node);
  return s.length > RENDER_LIMIT ? `${s.slice(0, RENDER_LIMIT)}...` : s;
}

function join(path: string, ...parts: (string | number)[]): string {
  return path === "" ? parts.join("/") : [path, ...parts].join("/");
}

function fieldDiff(
  path: string,
  field: string,
  a: string | number,
  b: string | number,
): NodeDifference {
  return {
    path: join(path, field),
    kind: "value-mismatch",
    original: JSON.stringify(a),
    resurrection: JSON.stringify(b),
  };
}

function lengthDiff(path: string, a: number, b: number): NodeDifference {
  return { path, kind: "length-mismatch", original: String(a), resurrection: String(b) };
}

function onlyOriginal(path: string, a: EncodedNode): NodeDifference {
  return { path, kind: "missing-key", original: render(a), resurrection: ABSENT };
}

function onlyResurrection(path: string, b: EncodedNode): NodeDifference {
  return { path, kind: "extra-key", original: ABSENT, resurrection: render(b) };
}

function diffProps(
  a: readonly [string, EncodedNode][],
  b: readonly [string, EncodedNode][],
  path: string,
): NodeDifference | null {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const pa = a[i];
    const pb = b[j];
    if (pa !== undefined && pb !== undefined) {
      const order = compareCodePoints(pa[0], pb[0]);
      if (order === 0) {
        const d = diffNodes(pa[1], pb[1], join(path, i, 1));
        if (d !== null) return d;
        i++;
        j++;
      } else if (order < 0) {
        return onlyOriginal(join(path, i), pa[1]);
      } else {
        return onlyResurrection(join(path, j), pb[1]);
      }
    } else if (pa !== undefined) {
      return onlyOriginal(join(path, i), pa[1]);
    } else if (pb !== undefined) {
      return onlyResurrection(join(path, j), pb[1]);
    }
  }
  return null;
}

function diffList(
  a: readonly EncodedNode[],
  b: readonly EncodedNode[],
  path: string,
): NodeDifference | null {
  if (a.length !== b.length) return lengthDiff(path, a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) continue;
    const d = diffNodes(x, y, join(path, i));
    if (d !== null) return d;
  }
  return null;
}

function diffItems(
  a: readonly { i: number; n: EncodedNode }[],
  b: readonly { i: number; n: EncodedNode }[],
  path: string,
): NodeDifference | null {
  let p = 0;
  let q = 0;
  while (p < a.length || q < b.length) {
    const x = a[p];
    const y = b[q];
    if (x !== undefined && y !== undefined) {
      if (x.i === y.i) {
        const d = diffNodes(x.n, y.n, join(path, p, "n"));
        if (d !== null) return d;
        p++;
        q++;
      } else if (x.i < y.i) {
        return onlyOriginal(join(path, p), x.n);
      } else {
        return onlyResurrection(join(path, q), y.n);
      }
    } else if (x !== undefined) {
      return onlyOriginal(join(path, p), x.n);
    } else if (y !== undefined) {
      return onlyResurrection(join(path, q), y.n);
    }
  }
  return null;
}

function diffNodes(a: EncodedNode, b: EncodedNode, path: string): NodeDifference | null {
  if (a.t !== b.t) {
    return { path, kind: "type-mismatch", original: render(a), resurrection: render(b) };
  }
  const leaf = (same: boolean): NodeDifference | null =>
    same ? null : { path, kind: "value-mismatch", original: render(a), resurrection: render(b) };
  switch (a.t) {
    case "undefined":
    case "null":
      return null;
    case "bool":
    case "str":
    case "bigint":
    case "symbol":
    case "date":
    case "num": {
      const y = b as typeof a;
      return leaf(Object.is(a.v, y.v));
    }
    case "regexp": {
      const y = b as typeof a;
      if (a.source !== y.source) return fieldDiff(path, "source", a.source, y.source);
      if (a.flags !== y.flags) return fieldDiff(path, "flags", a.flags, y.flags);
      return null;
    }
    case "arraybuffer": {
      const y = b as typeof a;
      return leaf(a.b64 === y.b64);
    }
    case "typed": {
      const y = b as typeof a;
      if (a.kind !== y.kind) return fieldDiff(path, "kind", a.kind, y.kind);
      return leaf(a.b64 === y.b64);
    }
    case "function": {
      const y = b as typeof a;
      if (a.name !== y.name) return fieldDiff(path, "name", a.name, y.name);
      if (a.arity !== y.arity) return fieldDiff(path, "arity", a.arity, y.arity);
      return null;
    }
    case "unencodable": {
      const y = b as typeof a;
      return leaf(a.reason === y.reason);
    }
    case "set": {
      const y = b as typeof a;
      return diffList(a.items, y.items, join(path, "items"));
    }
    case "map": {
      const y = b as typeof a;
      const base = join(path, "entries");
      if (a.entries.length !== y.entries.length) {
        return lengthDiff(base, a.entries.length, y.entries.length);
      }
      for (let i = 0; i < a.entries.length; i++) {
        const ea = a.entries[i];
        const eb = y.entries[i];
        if (ea === undefined || eb === undefined) continue;
        const dk = diffNodes(ea[0], eb[0], join(base, i, 0));
        if (dk !== null) return dk;
        const dv = diffNodes(ea[1], eb[1], join(base, i, 1));
        if (dv !== null) return dv;
      }
      return null;
    }
    case "error": {
      const y = b as typeof a;
      if (a.cls !== y.cls) return fieldDiff(path, "cls", a.cls, y.cls);
      if (a.message !== y.message) return fieldDiff(path, "message", a.message, y.message);
      return diffProps(a.props, y.props, join(path, "props"));
    }
    case "object": {
      const y = b as typeof a;
      if (a.ctor !== y.ctor) {
        return {
          path: join(path, "ctor"),
          kind: "value-mismatch",
          original: JSON.stringify(a.ctor),
          resurrection: JSON.stringify(y.ctor),
        };
      }
      return diffProps(a.props, y.props, join(path, "props"));
    }
    case "array": {
      const y = b as typeof a;
      if (a.length !== y.length) return lengthDiff(join(path, "length"), a.length, y.length);
      return (
        diffItems(a.items, y.items, join(path, "items")) ??
        diffProps(a.props, y.props, join(path, "props"))
      );
    }
  }
}

/** First difference in canonical traversal order, or `null` when the nodes are strictly equal. */
export function firstDifference(
  original: EncodedNode,
  resurrection: EncodedNode,
  path = "",
): NodeDifference | null {
  return diffNodes(canonicalizeNode(original), canonicalizeNode(resurrection), path);
}

export function deepEqualNodes(a: EncodedNode, b: EncodedNode): boolean {
  return firstDifference(a, b) === null;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function descriptorsDiffer(a: EncodedDescriptor | undefined, b: EncodedDescriptor | undefined): boolean {
  if (a === undefined || b === undefined) return a !== b;
  if (a.enumerable !== b.enumerable || a.configurable !== b.configurable) return true;
  if (a.writable !== b.writable) return true;
  for (const k of ["value", "get", "set"] as const) {
    const x = a[k];
    const y = b[k];
    if (x === undefined || y === undefined) {
      if (x !== y) return true;
    } else if (!deepEqualNodes(x, y)) {
      return true;
    }
  }
  return false;
}

function deltaEntriesDiffer(a: DeltaEntry, b: DeltaEntry): boolean {
  if (a.prototype !== b.prototype || a.change !== b.change) return true;
  if ("s" in a.key || "s" in b.key) {
    if (!("s" in a.key) || !("s" in b.key) || a.key.s !== b.key.s) return true;
  } else if (a.key.sym !== b.key.sym) {
    return true;
  }
  return descriptorsDiffer(a.before, b.before) || descriptorsDiffer(a.after, b.after);
}

function deltaDifference(
  a: readonly DeltaEntry[] | undefined,
  b: readonly DeltaEntry[] | undefined,
): string | null {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return "prototypeDelta";
  for (let i = 0; i < x.length; i++) {
    const ea = x[i];
    const eb = y[i];
    if (ea === undefined || eb === undefined || deltaEntriesDiffer(ea, eb)) {
      return `prototypeDelta/${i}`;
    }
  }
  return null;
}

/**
 * Differences between the Original's and the Resurrection's Outcome, at most one per part.
 * Differing kinds give a single `kind` difference. Equal `timeout`, `crash` and
 * `output-too-large` kinds give none (Requirement 7.9).
 */
export function compareOutcomes(original: Outcome, resurrection: Outcome): PartDifference[] {
  if (original.kind !== resurrection.kind) return [{ part: "kind", path: "kind" }];
  if (
    original.kind === "timeout" ||
    original.kind === "crash" ||
    original.kind === "output-too-large" ||
    resurrection.kind === "timeout" ||
    resurrection.kind === "crash" ||
    resurrection.kind === "output-too-large"
  ) {
    return [];
  }
  const out: PartDifference[] = [];
  if (original.async !== resurrection.async) out.push({ part: "async", path: "async" });
  const v = firstDifference(original.value, resurrection.value, "value");
  if (v !== null) out.push({ part: "value", path: v.path });
  if (original.args.length !== resurrection.args.length) {
    out.push({ part: "args", path: "args" });
  } else {
    for (let i = 0; i < original.args.length; i++) {
      const x = original.args[i];
      const y = resurrection.args[i];
      if (x === undefined || y === undefined) continue;
      const d = firstDifference(x, y, `args/${i}`);
      if (d !== null) {
        out.push({ part: "args", path: d.path });
        break;
      }
    }
  }
  const delta = deltaDifference(original.prototypeDelta, resurrection.prototypeDelta);
  if (delta !== null) out.push({ part: "prototypeDelta", path: delta });
  return out;
}
