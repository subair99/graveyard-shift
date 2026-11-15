// Feature: proof-of-life-engine, Property 8: Value codec round trip
// Requirements: 6.1, 6.2, 6.5, 6.6, 6.7
// **Validates: Requirements 6.1, 6.2, 6.5, 6.6, 6.7**
import { types } from "node:util";
import { describe, expect, it } from "vitest";
import { canonicalizeNode, nodeJson } from "../../../src/proof/child/codec/canonical";
import { decodeNode } from "../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import type { EncodedNode } from "../../../src/proof/child/codec/nodes";
import { fc, fcParams } from "../../engine/helpers/fc";
import { cyclicValueArb, sharedValueArb, valueArb } from "../helpers/valueArb";

const BUDGET = 50_000_000;

function encode(v: unknown): EncodedNode {
  const r = encodeValue(v, { budget: BUDGET });
  if (!r.ok) throw new Error(`encoding failed: ${r.reason}`);
  return r.node;
}

/** Reasons of every `unencodable` node anywhere in an encoded tree. */
function unencodableReasons(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) {
    for (const e of x) unencodableReasons(e, out);
  } else if (x !== null && typeof x === "object") {
    const rec = x as Record<string, unknown>;
    if (rec["t"] === "unencodable") out.push(String(rec["reason"]));
    for (const v of Object.values(rec)) unencodableReasons(v, out);
  }
  return out;
}

/** Paths of `error` nodes that carry a `stack` property. */
function errorStackProps(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) {
    for (const e of x) errorStackProps(e, out);
  } else if (x !== null && typeof x === "object") {
    const rec = x as Record<string, unknown>;
    if (rec["t"] === "error" && Array.isArray(rec["props"])) {
      for (const p of rec["props"] as [string, unknown][]) if (p[0] === "stack") out.push("stack");
    }
    for (const v of Object.values(rec)) errorStackProps(v, out);
  }
  return out;
}

// ---- Local strict structural comparator (independent of core/equal.ts) ----

function tagOf(x: unknown): string {
  if (x === null) return "null";
  if (typeof x !== "object") return typeof x;
  if (Array.isArray(x)) return "array";
  if (types.isDate(x)) return "date";
  if (types.isRegExp(x)) return "regexp";
  if (types.isMap(x)) return "map";
  if (types.isSet(x)) return "set";
  if (types.isArrayBuffer(x)) return "arraybuffer";
  if (types.isDataView(x)) return "dataview";
  if (types.isNativeError(x)) return "error";
  if (Buffer.isBuffer(x)) return "buffer";
  if (types.isTypedArray(x)) return Object.prototype.toString.call(x);
  return "object";
}

function ctorName(x: object): string | null {
  const proto = Reflect.getPrototypeOf(x);
  if (proto === null) return null;
  const d = Reflect.getOwnPropertyDescriptor(proto, "constructor");
  return typeof d?.value === "function" ? (d.value as { name: string }).name : "Object";
}

function bytesOf(x: ArrayBufferView | ArrayBuffer): Uint8Array {
  return x instanceof ArrayBuffer
    ? new Uint8Array(x)
    : new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
}

/** Returns a description of the first difference, or null when equal. */
function diff(a: unknown, b: unknown, path: string): string | null {
  const ta = tagOf(a);
  const tb = tagOf(b);
  if (ta !== tb) return `${path}: type ${ta} vs ${tb}`;
  switch (ta) {
    case "number":
      return Object.is(a, b) ? null : `${path}: number ${String(a)} vs ${String(b)}`;
    case "undefined":
    case "null":
      return null;
    case "boolean":
    case "string":
    case "bigint":
      return a === b ? null : `${path}: ${ta} ${String(a)} vs ${String(b)}`;
    case "symbol":
      return (a as symbol).description === (b as symbol).description
        ? null
        : `${path}: symbol description`;
    case "function": {
      const fa = a as { name: string; length: number };
      const fb = b as { name: string; length: number };
      return fa.name === fb.name && fa.length === fb.length ? null : `${path}: function name/arity`;
    }
    case "date":
      return Object.is((a as Date).getTime(), (b as Date).getTime()) ? null : `${path}: date`;
    case "regexp": {
      const ra = a as RegExp;
      const rb = b as RegExp;
      return ra.source === rb.source && ra.flags === rb.flags ? null : `${path}: regexp`;
    }
    case "arraybuffer":
    case "dataview":
    case "buffer":
    default:
      break;
  }
  if (ta === "arraybuffer" || ta === "dataview" || ta === "buffer" || ta.startsWith("[object ")) {
    const ba = bytesOf(a as ArrayBuffer);
    const bb = bytesOf(b as ArrayBuffer);
    return Buffer.compare(ba, bb) === 0 ? null : `${path}: bytes`;
  }
  if (ta === "set") {
    const ia = [...(a as Set<unknown>)];
    const ib = [...(b as Set<unknown>)];
    if (ia.length !== ib.length) return `${path}: set size`;
    const used = new Set<number>();
    for (const x of ia) {
      const j = ib.findIndex((y, k) => !used.has(k) && diff(x, y, path) === null);
      if (j < 0) return `${path}: set item without a match`;
      used.add(j);
    }
    return null;
  }
  if (ta === "map") {
    const ea = [...(a as Map<unknown, unknown>)];
    const eb = [...(b as Map<unknown, unknown>)];
    if (ea.length !== eb.length) return `${path}: map size`;
    const used = new Set<number>();
    for (const [k, v] of ea) {
      const j = eb.findIndex(
        ([k2, v2], i) => !used.has(i) && diff(k, k2, path) === null && diff(v, v2, path) === null,
      );
      if (j < 0) return `${path}: map entry without a match`;
      used.add(j);
    }
    return null;
  }
  // array, error, object: own enumerable string keys, holes included.
  const oa = a as object;
  const ob = b as object;
  if (ta === "array" && (a as unknown[]).length !== (b as unknown[]).length) return `${path}: array length`;
  if (ta === "error") {
    if (ctorName(oa) !== ctorName(ob)) return `${path}: error class`;
    if ((a as Error).message !== (b as Error).message) return `${path}: error message`;
  }
  if (ta === "object" && ctorName(oa) !== ctorName(ob)) return `${path}: constructor ${String(ctorName(oa))} vs ${String(ctorName(ob))}`;
  const ka = Object.keys(oa).filter((k) => !(ta === "error" && k === "stack")).sort();
  const kb = Object.keys(ob).filter((k) => !(ta === "error" && k === "stack")).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return `${path}: own keys [${ka.join(",")}] vs [${kb.join(",")}]`;
  for (const k of ka) {
    const da = Reflect.getOwnPropertyDescriptor(oa, k)!;
    const db = Reflect.getOwnPropertyDescriptor(ob, k)!;
    const r = diff(da.value, db.value, `${path}[${JSON.stringify(k)}]`);
    if (r !== null) return r;
  }
  return null;
}

describe("Property 8: Value codec round trip", () => {
  it("comparator sanity: distinguishes -0, NaN, holes, types", () => {
    expect(diff(0, -0, "$")).not.toBeNull();
    expect(diff(NaN, NaN, "$")).toBeNull();
    expect(diff([, 1], [undefined, 1], "$")).not.toBeNull();
    expect(diff([], {}, "$")).not.toBeNull();
    expect(diff(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 2 }, { a: 1 }]), "$")).toBeNull();
  });

  it("Feature: proof-of-life-engine, Property 8: Value codec round trip (decode(encode(v)) equals v, re-encoding keeps the canonical JSON)", () => {
    fc.assert(
      fc.property(valueArb, (v) => {
        const node = encode(v);
        expect(unencodableReasons(node)).toEqual([]);
        expect(errorStackProps(node)).toEqual([]);
        const decoded = decodeNode(node);
        expect(diff(v, decoded, "$")).toBeNull();
        const again = encode(decoded);
        expect(nodeJson(again)).toBe(nodeJson(node));
        expect(canonicalizeNode(again)).toEqual(canonicalizeNode(node));
        expect(nodeJson(canonicalizeNode(node))).toBe(nodeJson(node));
        // The node crosses the process boundary as JSON.
        const wire = JSON.parse(JSON.stringify(node)) as EncodedNode;
        expect(diff(v, decodeNode(wire), "$")).toBeNull();
      }),
      fcParams(),
    );
  });

  it("Feature: proof-of-life-engine, Property 8: Value codec round trip (a value with a cycle encodes to an unencodable `cycle` node, never throws, terminates)", () => {
    fc.assert(
      fc.property(cyclicValueArb, (v) => {
        const result = encodeValue(v, { budget: BUDGET });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(unencodableReasons(result.node)).toContain("cycle");
        expect(unencodableReasons(result.node).every((r) => r === "cycle")).toBe(true);
        expect(() => decodeNode(result.node)).toThrow(/unencodable/);
      }),
      fcParams(),
    );
  });

  it("Feature: proof-of-life-engine, Property 8: Value codec round trip (shared non-cyclic references are never reported as cycles)", () => {
    fc.assert(
      fc.property(sharedValueArb, (v) => {
        const node = encode(v);
        expect(unencodableReasons(node)).toEqual([]);
        expect(diff(v, decodeNode(node), "$")).toBeNull();
      }),
      fcParams(),
    );
    fc.assert(
      fc.property(valueArb, (o) => {
        const node = encode([o, o]);
        if (node.t !== "array") throw new Error("expected an array node");
        expect(node.items).toHaveLength(2);
        expect(unencodableReasons(node)).toEqual([]);
        expect(nodeJson(node.items[0]!.n)).toBe(nodeJson(node.items[1]!.n));
      }),
      fcParams(),
    );
  });
});
