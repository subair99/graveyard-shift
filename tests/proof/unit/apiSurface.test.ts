// Requirements: 10.1, 10.2, 10.3
import { describe, expect, it } from "vitest";
import { compareApiSurface, type ExportEntry } from "../../../src/proof/core/apiSurface";

const fn = (name: string, arity: number, fnName = name): ExportEntry => ({
  name,
  type: "function",
  fnName,
  arity,
});
const num = (name: string, v: number): ExportEntry => ({
  name,
  type: "number",
  primitive: { t: "num", v },
});

describe("compareApiSurface", () => {
  it("returns nothing for identical tables", () => {
    const t = [fn("a", 1), num("b", 2), { name: "c", type: "object" }];
    expect(compareApiSurface(t, [...t])).toEqual([]);
  });

  it("reports a missing export with a null resurrection side", () => {
    const d = compareApiSurface([fn("a", 1), fn("b", 0)], [fn("a", 1)]);
    expect(d).toEqual([
      {
        function: "b",
        kind: "api-surface",
        apiSurface: {
          export: "b",
          original: { type: "function", fnName: "b", arity: 0 },
          resurrection: null,
        },
        redactionMaskedDifference: false,
      },
    ]);
  });

  it("reports an extra export with a null original side", () => {
    const d = compareApiSurface([fn("a", 1)], [fn("a", 1), num("z", 1)]);
    expect(d).toHaveLength(1);
    expect(d[0]?.apiSurface.original).toBeNull();
    expect(d[0]?.apiSurface.resurrection?.type).toBe("number");
  });

  it("reports kind, arity, function name and primitive changes", () => {
    expect(compareApiSurface([fn("a", 1)], [num("a", 1)])).toHaveLength(1);
    expect(compareApiSurface([fn("a", 1)], [fn("a", 2)])).toHaveLength(1);
    expect(compareApiSurface([fn("a", 1)], [fn("a", 1, "renamed")])).toHaveLength(1);
    expect(compareApiSurface([num("n", 1)], [num("n", 2)])).toHaveLength(1);
  });

  it("treats a primitive of the same type and value as equal", () => {
    expect(compareApiSurface([num("n", 1)], [num("n", 1)])).toEqual([]);
  });

  it("reports one divergence per export even when several fields differ", () => {
    const d = compareApiSurface([fn("a", 1)], [fn("a", 2, "other")]);
    expect(d).toHaveLength(1);
  });

  it("sorts by export name in code point order", () => {
    const d = compareApiSurface(
      [fn("b", 0), fn("\u{1F600}", 0), fn("\uFF5E", 0), fn("a", 0)],
      [],
    );
    expect(d.map((x) => x.function)).toEqual(["a", "b", "\uFF5E", "\u{1F600}"]);
  });

  it("reports a radius name that is absent from both sides", () => {
    const d = compareApiSurface([fn("a", 0)], [fn("a", 0)], ["a", "ghost"]);
    expect(d).toHaveLength(1);
    expect(d[0]?.function).toBe("ghost");
    expect(d[0]?.apiSurface.original).toBeNull();
    expect(d[0]?.apiSurface.resurrection).toBeNull();
  });

  it("does not duplicate a divergence for a radius name already reported", () => {
    const d = compareApiSurface([fn("a", 0)], [], ["a"]);
    expect(d).toHaveLength(1);
  });

  it("still checks exports outside an explicit radius", () => {
    const d = compareApiSurface([fn("a", 0), fn("b", 0)], [fn("a", 0), fn("b", 3)], ["a"]);
    expect(d.map((x) => x.function)).toEqual(["b"]);
  });
});
