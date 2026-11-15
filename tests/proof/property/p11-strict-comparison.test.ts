// Feature: proof-of-life-engine, Property 11: Comparison is strict structural equality
// Requirements: 6.4, 7.1, 7.2, 7.3, 7.4
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 6.4**
import { types } from "node:util";
import { describe, expect, it } from "vitest";
import type { EncodedNode } from "../../../src/proof/child/codec/nodes";
import { UNENCODABLE_REASONS } from "../../../src/proof/child/codec/nodes";
import { compareOutcomes as compareStrict, deepEqualNodes, firstDifference } from "../../../src/proof/core/equal";
import type { DeltaEntry, Outcome } from "../../../src/proof/types";
import { fc, fcParams } from "../../engine/helpers/fc";
import { encodeOrThrow, mutateNode, mutationArb } from "../helpers/mutationArb";
import { valueArb } from "../helpers/valueArb";

// ---------------------------------------------------------------------------
// Reordering helpers
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function enumerableKeys(o: object): string[] {
  return Reflect.ownKeys(o).filter(
    (k): k is string => typeof k === "string" && Reflect.getOwnPropertyDescriptor(o, k)?.enumerable === true,
  );
}

/** Rebuilds objects, arrays, Maps and Sets with a different insertion order. */
function reorderValue(v: unknown, rnd: () => number): unknown {
  if (typeof v !== "object" || v === null) return v;
  if (types.isNativeError(v) || types.isDate(v) || types.isRegExp(v)) return v;
  if (types.isAnyArrayBuffer(v) || ArrayBuffer.isView(v)) return v;
  if (types.isMap(v)) {
    const entries = shuffled([...v.entries()], rnd);
    return new Map(entries.map(([k, x]) => [reorderValue(k, rnd), reorderValue(x, rnd)]));
  }
  if (types.isSet(v)) return new Set(shuffled([...v.values()], rnd).map((x) => reorderValue(x, rnd)));
  const out: object = Array.isArray(v)
    ? new Array<unknown>(v.length)
    : Object.create(Object.getPrototypeOf(v) as object | null);
  for (const k of shuffled(enumerableKeys(v), rnd)) {
    const value = reorderValue((v as Record<string, unknown>)[k], rnd);
    Object.defineProperty(out, k, { value, writable: true, enumerable: true, configurable: true });
  }
  return out;
}

/** Permutes every props, Set items, Map entries and array items list of an encoded tree. */
function shuffleNode(node: EncodedNode, rnd: () => number): EncodedNode {
  const props = (p: [string, EncodedNode][]): [string, EncodedNode][] =>
    shuffled(p, rnd).map(([k, n]) => [k, shuffleNode(n, rnd)]);
  switch (node.t) {
    case "set":
      return { t: "set", items: shuffled(node.items, rnd).map((n) => shuffleNode(n, rnd)) };
    case "map":
      return {
        t: "map",
        entries: shuffled(node.entries, rnd).map(([k, x]) => [shuffleNode(k, rnd), shuffleNode(x, rnd)]),
      };
    case "error":
      return { t: "error", cls: node.cls, message: node.message, props: props(node.props) };
    case "object":
      return { t: "object", ctor: node.ctor, props: props(node.props) };
    case "array":
      return {
        t: "array",
        length: node.length,
        items: shuffled(node.items, rnd).map((e) => ({ i: e.i, n: shuffleNode(e.n, rnd) })),
        props: props(node.props),
      };
    default:
      return node;
  }
}

const params = fcParams();

// ---------------------------------------------------------------------------
// Node-level properties
// ---------------------------------------------------------------------------

describe("Property 11: Comparison is strict structural equality", () => {
  it("is reflexive: a value encoded twice is equal to itself", () => {
    fc.assert(
      fc.property(valueArb, (v) => {
        const a = encodeOrThrow(v);
        const b = encodeOrThrow(v);
        expect(deepEqualNodes(a, a)).toBe(true);
        expect(deepEqualNodes(a, b)).toBe(true);
        expect(firstDifference(a, b)).toBeNull();
      }),
      params,
    );
  });

  it("is symmetric, on unrelated values and on mutated pairs", () => {
    fc.assert(
      fc.property(valueArb, valueArb, mutationArb, (x, y, m) => {
        const a = encodeOrThrow(x);
        const b = encodeOrThrow(y);
        for (const [p, q] of [
          [a, b],
          [m.base, m.mutated],
          [a, a],
        ] as const) {
          expect(deepEqualNodes(p, q)).toBe(deepEqualNodes(q, p));
          expect(firstDifference(p, q) === null).toBe(firstDifference(q, p) === null);
        }
      }),
      params,
    );
  });

  it("ignores the insertion order of object keys, Map entries and Set items", () => {
    fc.assert(
      fc.property(valueArb, fc.nat(), (v, seed) => {
        const original = encodeOrThrow(v);
        // Value level: rebuild the value with another insertion order.
        const rebuilt = encodeOrThrow(reorderValue(v, makeRng(seed)));
        expect(firstDifference(original, rebuilt)).toBeNull();
        // Node level: permute every list in the encoded tree.
        const permuted = shuffleNode(original, makeRng(seed));
        expect(firstDifference(original, permuted)).toBeNull();
        expect(firstDifference(permuted, original)).toBeNull();
      }),
      params,
    );
  });

  it("reports every single atomic mutation, with the injected kind and path", () => {
    fc.assert(
      fc.property(mutationArb, ({ base, mutated, site }) => {
        const where = `${site.label} at "${site.path}"`;
        expect(deepEqualNodes(base, mutated), where).toBe(false);
        expect(deepEqualNodes(mutated, base), where).toBe(false);
        const d = firstDifference(base, mutated);
        expect(d, where).not.toBeNull();
        expect(firstDifference(mutated, base), where).not.toBeNull();
        if (d !== null && site.ordered) {
          expect({ kind: d.kind, path: d.path }, where).toEqual({ kind: site.kind, path: site.path });
        }
        if (d !== null) expect(d.path, where).not.toBe("");
      }),
      params,
    );
  });

  it("treats two unencodable nodes as equal exactly when their reasons are equal", () => {
    const reason = fc.constantFrom(...UNENCODABLE_REASONS);
    fc.assert(
      fc.property(reason, reason, (r1, r2) => {
        const a: EncodedNode = { t: "unencodable", reason: r1 };
        const b: EncodedNode = { t: "unencodable", reason: r2 };
        expect(deepEqualNodes(a, b)).toBe(r1 === r2);
        expect(firstDifference(a, b) === null).toBe(r1 === r2);
      }),
      params,
    );
  });

  it("keeps NaN equal to NaN but separates the confusable twins", () => {
    const num = (v: number | "NaN" | "-0"): EncodedNode => ({ t: "num", v });
    expect(deepEqualNodes(num("NaN"), num("NaN"))).toBe(true);
    expect(deepEqualNodes(num("-0"), num(0))).toBe(false);
    expect(deepEqualNodes(encodeOrThrow([undefined]), encodeOrThrow(new Array(1)))).toBe(false);
    expect(deepEqualNodes(encodeOrThrow({ a: undefined }), encodeOrThrow({}))).toBe(false);
    expect(deepEqualNodes(encodeOrThrow(new Date(NaN)), encodeOrThrow(new Date(0)))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Outcome comparison
// ---------------------------------------------------------------------------

const nodeArb = valueArb.map(encodeOrThrow);

const descriptorArb = fc
  .tuple(fc.boolean(), fc.boolean(), fc.constantFrom(1, 2, 3))
  .map(([enumerable, configurable, n]) => ({
    value: { t: "num", v: n } as EncodedNode,
    writable: true,
    enumerable,
    configurable,
  }));

const deltaEntryArb: fc.Arbitrary<DeltaEntry> = fc
  .tuple(
    fc.constantFrom("Object.prototype", "Array.prototype", "Function.prototype", "String.prototype"),
    fc.oneof(
      fc.string({ maxLength: 4 }).map((s) => ({ s })),
      fc.option(fc.string({ maxLength: 4 }), { nil: null }).map((sym) => ({ sym })),
    ),
    fc.constantFrom("added", "changed", "removed"),
    fc.option(descriptorArb, { nil: undefined }),
    fc.option(descriptorArb, { nil: undefined }),
  )
  .map(([prototype, key, change, before, after]) => ({
    prototype,
    key,
    change,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  }));

const outcomeArb: fc.Arbitrary<Completed> = fc
  .tuple(
    fc.constantFrom("returned", "threw", "rejected"),
    fc.boolean(),
    nodeArb,
    fc.array(nodeArb, { maxLength: 3 }),
    fc.array(deltaEntryArb, { maxLength: 3 }),
  )
  .map(
    ([kind, async, value, args, prototypeDelta]) =>
      ({
        kind,
        async: kind === "returned" ? async : kind === "rejected",
        value,
        args,
        prototypeDelta,
      }) as Completed,
  );

type Completed = Omit<Extract<Outcome, { value: EncodedNode }>, "kind" | "async"> & {
  kind: "returned" | "threw" | "rejected";
  async: boolean;
};

/** The schema ties `async` to `kind`; the comparison itself does not. */
function compareOutcomes(a: Completed | Outcome, b: Completed | Outcome): ReturnType<typeof compareStrict> {
  return compareStrict(a as Outcome, b as Outcome);
}

function copy(o: Completed): Completed {
  return structuredClone(o);
}

describe("Property 11: compareOutcomes reports exactly the changed part", () => {
  it("reports no difference for equal outcomes, including a key-reordered copy", () => {
    fc.assert(
      fc.property(outcomeArb, fc.nat(), (o, seed) => {
        expect(compareOutcomes(o, copy(o))).toEqual([]);
        const rnd = makeRng(seed);
        const reordered: Completed = {
          ...copy(o),
          value: shuffleNode(o.value, rnd),
          args: o.args.map((a) => shuffleNode(a, rnd)),
        };
        expect(compareOutcomes(o, reordered)).toEqual([]);
      }),
      params,
    );
  });

  it("reports only `value` when the value is mutated", () => {
    fc.assert(
      fc.property(outcomeArb, fc.nat(), (o, pick) => {
        const m = mutateNode(o.value, pick);
        const a: Completed = { ...copy(o), value: m.base };
        const b: Completed = { ...copy(o), value: m.mutated };
        const diffs = compareOutcomes(a, b);
        expect(diffs.map((d) => d.part)).toEqual(["value"]);
        if (m.site.ordered) expect(diffs[0]?.path).toBe(`value/${m.site.path}`);
      }),
      params,
    );
  });

  it("reports only `args` when one argument or the argument count changes", () => {
    fc.assert(
      fc.property(outcomeArb, fc.nat(), fc.nat(), (o, which, pick) => {
        const a = copy(o);
        const b = copy(o);
        if (a.args.length === 0) {
          b.args = [{ t: "undefined" }];
          expect(compareOutcomes(a, b)).toEqual([{ part: "args", path: "args" }]);
          return;
        }
        const idx = which % a.args.length;
        const m = mutateNode(a.args[idx] as EncodedNode, pick);
        a.args[idx] = m.base;
        b.args[idx] = m.mutated;
        const diffs = compareOutcomes(a, b);
        expect(diffs.map((d) => d.part)).toEqual(["args"]);
        if (m.site.ordered) expect(diffs[0]?.path).toBe(`args/${idx}/${m.site.path}`);
      }),
      params,
    );
  });

  it("reports only `async` when only the async flag changes", () => {
    fc.assert(
      fc.property(outcomeArb, (o) => {
        const a: Completed = { ...copy(o), kind: "returned", async: false };
        const b: Completed = { ...a, async: true };
        expect(compareOutcomes(a, b)).toEqual([{ part: "async", path: "async" }]);
        expect(compareOutcomes(b, a)).toEqual([{ part: "async", path: "async" }]);
      }),
      params,
    );
  });

  it("reports only `kind` when only the kind changes", () => {
    fc.assert(
      fc.property(outcomeArb, (o) => {
        const a: Completed = { ...copy(o), kind: "returned", async: false };
        const b: Completed = { ...a, kind: "threw" };
        expect(compareOutcomes(a, b)).toEqual([{ part: "kind", path: "kind" }]);
        expect(compareOutcomes(b, a)).toEqual([{ part: "kind", path: "kind" }]);
        const t: Outcome = { kind: "timeout" };
        expect(compareOutcomes(a, t)).toEqual([{ part: "kind", path: "kind" }]);
        expect(compareOutcomes(t, a)).toEqual([{ part: "kind", path: "kind" }]);
        for (const same of [{ kind: "timeout" }, { kind: "crash" }, { kind: "output-too-large" }] as Outcome[]) {
          expect(compareOutcomes(same, structuredClone(same))).toEqual([]);
        }
      }),
      params,
    );
  });

  it("reports only `prototypeDelta` when an entry is added, removed or changed", () => {
    fc.assert(
      fc.property(outcomeArb, deltaEntryArb, fc.nat(), (o, extra, pick) => {
        const a = copy(o);
        const variants: DeltaEntry[][] = [[...a.prototypeDelta, extra]];
        if (a.prototypeDelta.length > 0) {
          const dropped = structuredClone(a.prototypeDelta);
          dropped.pop();
          variants.push(dropped);
          const changed = structuredClone(a.prototypeDelta);
          const first = changed[0] as DeltaEntry;
          first.change = first.change === "added" ? "changed" : first.change === "changed" ? "removed" : "added";
          variants.push(changed);
          const flipped = structuredClone(a.prototypeDelta);
          const target = flipped[0] as DeltaEntry;
          target.after = { enumerable: !(target.after?.enumerable ?? false), configurable: true };
          variants.push(flipped);
        }
        const delta = variants[pick % variants.length] as DeltaEntry[];
        const b: Completed = { ...copy(o), prototypeDelta: delta };
        const diffs = compareOutcomes(a, b);
        expect(diffs.map((d) => d.part)).toEqual(["prototypeDelta"]);
        expect(compareOutcomes(b, a).map((d) => d.part)).toEqual(["prototypeDelta"]);
      }),
      params,
    );
  });
});
