// Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9
import { describe, expect, it } from "vitest";
import { compareOutcomes, deepEqualNodes, firstDifference } from "../../../src/proof/core/equal";
import type { EncodedNode, Outcome } from "../../../src/proof/types";

const num = (v: number | "NaN" | "Infinity" | "-Infinity" | "-0"): EncodedNode => ({ t: "num", v });
const str = (v: string): EncodedNode => ({ t: "str", v });
const undef: EncodedNode = { t: "undefined" };
const obj = (props: [string, EncodedNode][], ctor: string | null = "Object"): EncodedNode => ({
  t: "object",
  ctor,
  props,
});
const arr = (length: number, items: { i: number; n: EncodedNode }[]): EncodedNode => ({
  t: "array",
  length,
  items,
  props: [],
});

describe("deepEqualNodes", () => {
  it("equates NaN with NaN and distinguishes 0 from -0", () => {
    expect(deepEqualNodes(num("NaN"), num("NaN"))).toBe(true);
    expect(deepEqualNodes(num(0), num("-0"))).toBe(false);
    expect(deepEqualNodes(num(0), num(0))).toBe(true);
  });

  it("distinguishes undefined from a missing property", () => {
    const a = obj([["k", undef]]);
    const b = obj([]);
    expect(deepEqualNodes(a, b)).toBe(false);
    expect(firstDifference(a, b)).toMatchObject({ kind: "missing-key", path: "props/0" });
    expect(firstDifference(b, a)).toMatchObject({ kind: "extra-key", path: "props/0" });
  });

  it("distinguishes a hole from undefined", () => {
    const hole = arr(1, []);
    const undefItem = arr(1, [{ i: 0, n: undef }]);
    expect(deepEqualNodes(hole, undefItem)).toBe(false);
    expect(firstDifference(hole, undefItem)).toMatchObject({ kind: "extra-key" });
  });

  it("reports a length mismatch and a type mismatch", () => {
    expect(firstDifference(arr(2, []), arr(3, []))).toMatchObject({
      kind: "length-mismatch",
      path: "length",
      original: "2",
      resurrection: "3",
    });
    expect(firstDifference(num(1), str("1"))).toMatchObject({ kind: "type-mismatch", path: "" });
  });

  it("ignores property insertion order, Map entry order and Set order", () => {
    expect(
      deepEqualNodes(
        obj([
          ["a", num(1)],
          ["b", num(2)],
        ]),
        obj([
          ["b", num(2)],
          ["a", num(1)],
        ]),
      ),
    ).toBe(true);
    const e1: [EncodedNode, EncodedNode] = [str("x"), num(1)];
    const e2: [EncodedNode, EncodedNode] = [str("y"), num(2)];
    expect(
      deepEqualNodes({ t: "map", entries: [e1, e2] }, { t: "map", entries: [e2, e1] }),
    ).toBe(true);
    expect(
      deepEqualNodes(
        { t: "set", items: [num(1), num(2)] },
        { t: "set", items: [num(2), num(1)] },
      ),
    ).toBe(true);
  });

  it("compares constructor names and nested values with a path", () => {
    expect(deepEqualNodes(obj([], "A"), obj([], "B"))).toBe(false);
    expect(deepEqualNodes(obj([], null), obj([], "Object"))).toBe(false);
    const d = firstDifference(obj([["k", obj([["z", num(1)]])]]), obj([["k", obj([["z", num(2)]])]]));
    expect(d).toEqual({
      path: "props/0/1/props/0/1",
      kind: "value-mismatch",
      original: '{"t":"num","v":1}',
      resurrection: '{"t":"num","v":2}',
    });
  });

  it("compares Date, RegExp, bigint, typed arrays and ArrayBuffer", () => {
    expect(deepEqualNodes({ t: "date", v: 1 }, { t: "date", v: 2 })).toBe(false);
    expect(deepEqualNodes({ t: "date", v: "invalid" }, { t: "date", v: "invalid" })).toBe(true);
    expect(
      deepEqualNodes(
        { t: "regexp", source: "a", flags: "g" },
        { t: "regexp", source: "a", flags: "i" },
      ),
    ).toBe(false);
    expect(deepEqualNodes({ t: "bigint", v: "1" }, { t: "bigint", v: "2" })).toBe(false);
    expect(
      deepEqualNodes(
        { t: "typed", kind: "Uint8Array", b64: "AA==" },
        { t: "typed", kind: "Int8Array", b64: "AA==" },
      ),
    ).toBe(false);
    expect(
      deepEqualNodes(
        { t: "typed", kind: "Uint8Array", b64: "AA==" },
        { t: "typed", kind: "Uint8Array", b64: "AQ==" },
      ),
    ).toBe(false);
    expect(deepEqualNodes({ t: "arraybuffer", b64: "AA==" }, { t: "arraybuffer", b64: "AQ==" })).toBe(
      false,
    );
  });

  it("compares functions by name and arity, unencodable by reason", () => {
    const f = (name: string, arity: number): EncodedNode => ({ t: "function", name, arity });
    expect(deepEqualNodes(f("a", 1), f("a", 1))).toBe(true);
    expect(deepEqualNodes(f("a", 1), f("b", 1))).toBe(false);
    expect(deepEqualNodes(f("a", 1), f("a", 2))).toBe(false);
    expect(
      deepEqualNodes({ t: "unencodable", reason: "cycle" }, { t: "unencodable", reason: "cycle" }),
    ).toBe(true);
    expect(
      deepEqualNodes({ t: "unencodable", reason: "cycle" }, { t: "unencodable", reason: "depth" }),
    ).toBe(false);
  });

  it("compares errors by class, message and own properties", () => {
    const e = (cls: string, message: string, props: [string, EncodedNode][] = []): EncodedNode => ({
      t: "error",
      cls,
      message,
      props,
    });
    expect(deepEqualNodes(e("TypeError", "m"), e("TypeError", "m"))).toBe(true);
    expect(deepEqualNodes(e("TypeError", "m"), e("RangeError", "m"))).toBe(false);
    expect(deepEqualNodes(e("TypeError", "m"), e("TypeError", "n"))).toBe(false);
    expect(deepEqualNodes(e("Error", "m", [["code", str("A")]]), e("Error", "m"))).toBe(false);
    expect(deepEqualNodes(e("Error", "m", [["code", str("A")]]), e("Error", "m", [["code", str("B")]]))).toBe(
      false,
    );
  });
});

describe("compareOutcomes", () => {
  const returned = (over: Partial<Extract<Outcome, { kind: "returned" }>> = {}): Outcome => ({
    kind: "returned",
    async: false,
    value: num(1),
    args: [str("a")],
    prototypeDelta: [],
    ...over,
  });

  it("returns no difference for equal outcomes", () => {
    expect(compareOutcomes(returned(), returned())).toEqual([]);
  });

  it("reports one kind difference for return versus throw", () => {
    const threw: Outcome = {
      kind: "threw",
      async: false,
      value: num(1),
      args: [str("a")],
      prototypeDelta: [],
    };
    expect(compareOutcomes(returned(), threw)).toEqual([{ part: "kind", path: "kind" }]);
  });

  it("treats equal timeout, crash and output-too-large as equal and mismatches as differences", () => {
    for (const kind of ["timeout", "crash", "output-too-large"] as const) {
      expect(compareOutcomes({ kind }, { kind })).toEqual([]);
    }
    expect(compareOutcomes({ kind: "timeout" }, { kind: "crash" })).toHaveLength(1);
    expect(compareOutcomes(returned(), { kind: "crash" })).toEqual([{ part: "kind", path: "kind" }]);
  });

  it("detects a difference in each of async, value, args and prototypeDelta", () => {
    expect(compareOutcomes(returned(), returned({ async: true }))).toEqual([
      { part: "async", path: "async" },
    ]);
    expect(compareOutcomes(returned(), returned({ value: num("-0") }))).toEqual([
      { part: "value", path: "value" },
    ]);
    expect(compareOutcomes(returned(), returned({ args: [str("b")] }))).toEqual([
      { part: "args", path: "args/0" },
    ]);
    expect(compareOutcomes(returned(), returned({ args: [] }))).toEqual([
      { part: "args", path: "args" },
    ]);
    const entry = {
      prototype: "Array.prototype" as const,
      key: { s: "x" },
      change: "added" as const,
      after: { value: num(1), writable: true, enumerable: true, configurable: true },
    };
    expect(compareOutcomes(returned(), returned({ prototypeDelta: [entry] }))).toEqual([
      { part: "prototypeDelta", path: "prototypeDelta" },
    ]);
    const changed = { ...entry, after: { ...entry.after, value: num(2) } };
    expect(
      compareOutcomes(returned({ prototypeDelta: [entry] }), returned({ prototypeDelta: [changed] })),
    ).toEqual([{ part: "prototypeDelta", path: "prototypeDelta/0" }]);
    expect(
      compareOutcomes(returned({ prototypeDelta: [entry] }), returned({ prototypeDelta: [entry] })),
    ).toEqual([]);
  });

  it("reports at most one difference per part", () => {
    const diffs = compareOutcomes(
      returned(),
      returned({ async: true, value: num(2), args: [str("b")] }),
    );
    expect(diffs.map((d) => d.part)).toEqual(["async", "value", "args"]);
  });

  it("compares thrown errors by class, message and properties", () => {
    const threw = (message: string): Outcome => ({
      kind: "threw",
      async: false,
      value: { t: "error", cls: "Error", message, props: [] },
      args: [],
      prototypeDelta: [],
    });
    expect(compareOutcomes(threw("a"), threw("a"))).toEqual([]);
    expect(compareOutcomes(threw("a"), threw("b"))).toEqual([
      { part: "value", path: "value/message" },
    ]);
  });
});
