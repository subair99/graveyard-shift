// Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.10
import { describe, expect, it } from "vitest";
import {
  accumulateCase,
  classifyCase,
  finalizeDelta,
  newDeltaAccumulator,
  pickDemonstration,
  type ApplicableDelta,
  type PropertyResult,
} from "../../../src/proof/core/delta";
import type { EncodedNode, Outcome } from "../../../src/proof/types";

const str = (v: string): EncodedNode => ({ t: "str", v });
const obj = (props: [string, EncodedNode][]): EncodedNode => ({ t: "object", ctor: "Object", props });

function returned(value: EncodedNode): Outcome {
  return { kind: "returned", async: false, value, args: [], prototypeDelta: [] };
}

const ok: PropertyResult = { passed: true };
const bad: PropertyResult = { passed: false, detail: str("polluted") };
const delta = (
  original: PropertyResult | undefined,
  resurrection: PropertyResult | undefined,
): ApplicableDelta => ({ id: "proto-keys", original, resurrection });

const a = returned(obj([["x", str("1")]]));
const b = returned(obj([["x", str("2")]]));
const args = [str("__proto__")];

describe("classifyCase", () => {
  it("outside the predicate, equal Outcomes are equal", () => {
    const c = classifyCase({ args, original: a, resurrection: a, applicable: [] });
    expect(c.label).toBe("equal");
    expect(c.divergences).toEqual([]);
  });

  it("outside the predicate, differing Outcomes are an unexplained divergence", () => {
    const c = classifyCase({ args, original: a, resurrection: b, applicable: [] });
    expect(c.label).toBe("unexplained-divergence");
    expect(c.divergences).toHaveLength(1);
    expect(c.divergences[0]?.kind).toBe("unexplained");
    expect(c.divergences[0]?.differences.length).toBeGreaterThan(0);
  });

  it("inside the predicate, a difference is explained when the Resurrection satisfies the property", () => {
    const c = classifyCase({ args, original: a, resurrection: b, applicable: [delta(bad, ok)] });
    expect(c.label).toBe("explained-by-delta");
    expect(c.divergences).toEqual([]);
    expect(c.demonstrated).toEqual(["proto-keys"]);
    expect(c.checked).toEqual(["proto-keys"]);
  });

  it("inside the predicate, a property failure on the Resurrection is a delta-violation", () => {
    const c = classifyCase({ args, original: a, resurrection: b, applicable: [delta(bad, bad)] });
    expect(c.label).toBe("delta-violation");
    expect(c.divergences).toHaveLength(1);
    expect(c.divergences[0]).toMatchObject({ kind: "delta-violation", deltaId: "proto-keys" });
    expect(c.demonstrated).toEqual([]);
  });

  it("a property failure on the Resurrection is a violation even when the Outcomes are equal", () => {
    const c = classifyCase({ args, original: a, resurrection: a, applicable: [delta(ok, bad)] });
    expect(c.label).toBe("delta-violation");
    expect(c.divergences[0]?.differences).toEqual([]);
  });

  it("equal Outcomes with a passing property are equal and not demonstrated when both pass", () => {
    const c = classifyCase({ args, original: a, resurrection: a, applicable: [delta(ok, ok)] });
    expect(c.label).toBe("equal");
    expect(c.demonstrated).toEqual([]);
    expect(c.checked).toEqual(["proto-keys"]);
  });

  it("a missing Resurrection property result is a violation and is not counted as checked", () => {
    const c = classifyCase({ args, original: a, resurrection: b, applicable: [delta(bad, undefined)] });
    expect(c.label).toBe("delta-violation");
    expect(c.checked).toEqual([]);
  });

  it("a missing Original property result never demonstrates", () => {
    const c = classifyCase({ args, original: a, resurrection: b, applicable: [delta(undefined, ok)] });
    expect(c.label).toBe("explained-by-delta");
    expect(c.demonstrated).toEqual([]);
  });

  it("a Prototype_Delta difference is covered like any other difference", () => {
    const withProto: Outcome = {
      kind: "returned",
      async: false,
      value: str("v"),
      args: [],
      prototypeDelta: [
        { prototype: "Object.prototype", key: { s: "polluted" }, change: "added" },
      ],
    };
    const plain = returned(str("v"));
    expect(
      classifyCase({ args, original: withProto, resurrection: plain, applicable: [] }).label,
    ).toBe("unexplained-divergence");
    expect(
      classifyCase({ args, original: withProto, resurrection: plain, applicable: [delta(bad, ok)] }).label,
    ).toBe("explained-by-delta");
  });
});

describe("delta accumulation (lodash.set-like)", () => {
  const A1 = [str("a.b")];
  const A2 = [str("__proto__.x")];
  const A3 = [str("constructor.prototype.y")];

  it("is not-demonstrated when both sides pass the property in every case", () => {
    let acc = newDeltaAccumulator("proto-keys", "set");
    acc = accumulateCase(acc, A1, ok, ok);
    acc = accumulateCase(acc, A2, ok, ok);
    const f = finalizeDelta(acc);
    expect(f.state).toBe("not-demonstrated");
    expect(f.report).toMatchObject({
      status: "not-demonstrated",
      predicateCasesChecked: 2,
      demonstration: null,
    });
    expect(acc.original).toEqual({ passes: 2, failures: 0, missing: 0 });
  });

  it("records the first case that fails on the Original and passes on the Resurrection", () => {
    let acc = newDeltaAccumulator("proto-keys", "set");
    acc = accumulateCase(acc, A1, ok, ok);
    acc = accumulateCase(acc, A2, bad, ok);
    acc = accumulateCase(acc, A3, { passed: false, detail: str("later") }, ok);
    const f = finalizeDelta(acc);
    expect(f.state).toBe("demonstrated");
    expect(f.report.status).toBe("demonstrated");
    expect(f.report.predicateCasesChecked).toBe(3);
    expect(f.report.demonstration).toEqual({
      args: A2,
      original: { ok: false, detail: str("polluted") },
      resurrection: { ok: true },
    });
    expect(acc.original).toEqual({ passes: 1, failures: 2, missing: 0 });
  });

  it("is violated when the Resurrection fails the property in any case", () => {
    let acc = newDeltaAccumulator("proto-keys", "set");
    acc = accumulateCase(acc, A1, bad, ok);
    acc = accumulateCase(acc, A2, bad, bad);
    const f = finalizeDelta(acc);
    expect(f.state).toBe("violated");
    expect(f.report.status).toBe("demonstrated");
    expect(f.report.predicateCasesChecked).toBe(2);
  });

  it("treats a missing Resurrection result as a violation and does not count it as checked", () => {
    let acc = newDeltaAccumulator("proto-keys", "set");
    acc = accumulateCase(acc, A1, ok, undefined);
    const f = finalizeDelta(acc);
    expect(f.state).toBe("violated");
    expect(f.report.predicateCasesChecked).toBe(0);
    expect(acc.inPredicateCases).toBe(1);
  });

  it("does not change the accumulator it is given", () => {
    const acc = newDeltaAccumulator("proto-keys", "set");
    accumulateCase(acc, A1, bad, ok);
    expect(acc.inPredicateCases).toBe(0);
    expect(acc.demonstration).toBeNull();
  });

  it("an accumulator with no cases is not-demonstrated", () => {
    expect(finalizeDelta(newDeltaAccumulator("d", "f")).state).toBe("not-demonstrated");
  });
});

describe("pickDemonstration", () => {
  it("returns the first case in order that demonstrates the delta", () => {
    const cases = [
      { n: 0, demonstrated: [] as string[] },
      { n: 1, demonstrated: ["other"] },
      { n: 2, demonstrated: ["proto-keys"] },
      { n: 3, demonstrated: ["proto-keys"] },
    ];
    expect(pickDemonstration(cases, "proto-keys")?.n).toBe(2);
    expect(pickDemonstration(cases, "missing")).toBeNull();
  });
});
