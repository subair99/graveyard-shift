// Feature: proof-of-life-engine, Property 20: Delta classification
// **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.9, 11.10**
import { describe, expect, it } from "vitest";
import {
  accumulateCase,
  classifyCase,
  finalizeDelta,
  newDeltaAccumulator,
  pickDemonstration,
  type ApplicableDelta,
  type CaseObservation,
  type DeltaAccumulator,
  type PropertyResult,
} from "../../../src/proof/core/delta";
import { compareOutcomes } from "../../../src/proof/core/equal";
import type { EncodedNode, Outcome } from "../../../src/proof/types";
import { fc, fcParams } from "../../engine/helpers/fc";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const leafArb: fc.Arbitrary<EncodedNode> = fc.oneof(
  fc.constant<EncodedNode>({ t: "undefined" }),
  fc.constant<EncodedNode>({ t: "null" }),
  fc.boolean().map((v): EncodedNode => ({ t: "bool", v })),
  fc.string({ maxLength: 8 }).map((v): EncodedNode => ({ t: "str", v })),
  fc.integer({ min: -1000, max: 1000 }).map((v): EncodedNode => ({ t: "num", v })),
);

const nodeArb: fc.Arbitrary<EncodedNode> = fc.oneof(
  leafArb,
  fc.array(fc.tuple(fc.string({ maxLength: 4 }), leafArb), { maxLength: 3 }).map(
    (props): EncodedNode => {
      const seen = new Set<string>();
      const unique = props.filter(([k]) => (seen.has(k) ? false : (seen.add(k), true)));
      return { t: "object", ctor: "Object", props: unique };
    },
  ),
);

/** An array node always differs from every non-array node (kind of node differs). */
function differing(n: EncodedNode): EncodedNode {
  return { t: "array", length: 1, items: [{ i: 0, n }], props: [] };
}

function returned(value: EncodedNode, args: EncodedNode[]): Outcome {
  return { kind: "returned", async: false, value, args, prototypeDelta: [] };
}

type PropState = "pass" | "fail" | "missing";
const propStateArb = fc.constantFrom<PropState>("pass", "fail", "missing");

function toResult(s: PropState): PropertyResult | undefined {
  return s === "missing" ? undefined : { passed: s === "pass" };
}

interface Spec {
  args: EncodedNode[];
  equal: boolean;
  /** One entry per applicable delta; empty means outside every predicate. */
  deltas: { original: PropState; resurrection: PropState }[];
  observation: CaseObservation;
}

const specArb: fc.Arbitrary<Spec> = fc
  .record({
    base: nodeArb,
    args: fc.array(nodeArb, { maxLength: 2 }),
    equal: fc.boolean(),
    deltas: fc.array(fc.record({ original: propStateArb, resurrection: propStateArb }), { maxLength: 3 }),
  })
  .map(({ base, args, equal, deltas }) => {
    const applicable: ApplicableDelta[] = deltas.map((d, i) => ({
      id: `d${i}`,
      original: toResult(d.original),
      resurrection: toResult(d.resurrection),
    }));
    return {
      args,
      equal,
      deltas,
      observation: {
        args,
        original: returned(base, args),
        resurrection: returned(equal ? base : differing(base), args),
        applicable,
      },
    };
  });

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("Property 20: Delta classification", () => {
  it("labels every case with exactly one label following the rules", () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const c = classifyCase(spec.observation);
        const differs = compareOutcomes(spec.observation.original, spec.observation.resurrection).length > 0;
        expect(differs).toBe(!spec.equal);

        const inside = spec.deltas.length > 0;
        const resFailing = spec.deltas.filter((d) => d.resurrection !== "pass").length;

        const labels = ["equal", "explained-by-delta", "delta-violation", "unexplained-divergence"];
        expect(labels.filter((l) => l === c.label)).toHaveLength(1);

        if (inside && resFailing > 0) {
          // R11.3: failing or missing Resurrection property, whether or not outcomes are equal.
          expect(c.label).toBe("delta-violation");
        } else if (!inside && spec.equal) {
          expect(c.label).toBe("equal");
        } else if (!inside) {
          expect(c.label).toBe("unexplained-divergence");
        } else if (spec.equal) {
          expect(c.label).toBe("equal");
        } else {
          expect(c.label).toBe("explained-by-delta");
        }

        // Divergences: R11.4 `unexplained` only outside every predicate; one violation per failing delta.
        const violations = c.divergences.filter((d) => d.kind === "delta-violation");
        const unexplained = c.divergences.filter((d) => d.kind === "unexplained");
        expect(violations.map((d) => d.deltaId)).toEqual(
          spec.deltas.flatMap((d, i) => (d.resurrection !== "pass" ? [`d${i}`] : [])),
        );
        expect(unexplained).toHaveLength(!inside && !spec.equal ? 1 : 0);
        if (inside) expect(unexplained).toHaveLength(0);

        // checked / demonstrated bookkeeping (R11.3, R11.5).
        expect(c.checked).toEqual(spec.deltas.flatMap((d, i) => (d.resurrection !== "missing" ? [`d${i}`] : [])));
        expect(c.demonstrated).toEqual(
          spec.deltas.flatMap((d, i) => (d.original === "fail" && d.resurrection === "pass" ? [`d${i}`] : [])),
        );
      }),
      fcParams(),
    );
  });

  it("outside every predicate: equal -> equal, differing -> unexplained-divergence", () => {
    fc.assert(
      fc.property(nodeArb, fc.boolean(), (base, equal) => {
        const c = classifyCase({
          args: [],
          original: returned(base, []),
          resurrection: returned(equal ? base : differing(base), []),
          applicable: [],
        });
        expect(c.label).toBe(equal ? "equal" : "unexplained-divergence");
        expect(c.divergences.map((d) => d.kind)).toEqual(equal ? [] : ["unexplained"]);
      }),
      fcParams(),
    );
  });

  it("inside a predicate with a missing Resurrection result is a delta-violation", () => {
    fc.assert(
      fc.property(nodeArb, fc.boolean(), fc.constantFrom<PropState>("pass", "fail", "missing"), (base, equal, orig) => {
        const c = classifyCase({
          args: [],
          original: returned(base, []),
          resurrection: returned(equal ? base : differing(base), []),
          applicable: [{ id: "x", original: toResult(orig), resurrection: undefined }],
        });
        expect(c.label).toBe("delta-violation");
        expect(c.divergences.map((d) => d.kind)).toEqual(["delta-violation"]);
        expect(c.demonstrated).toEqual([]);
        expect(c.checked).toEqual([]);
      }),
      fcParams(),
    );
  });
});

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

interface AccCase {
  tag: number;
  original: PropState;
  resurrection: PropState;
}

const accCasesArb = fc
  .array(fc.record({ original: propStateArb, resurrection: propStateArb }), { maxLength: 12 })
  .map((cs): AccCase[] => cs.map((c, tag) => ({ tag, ...c })));

function run(cases: readonly AccCase[]): DeltaAccumulator {
  let acc = newDeltaAccumulator("d", "f");
  for (const c of cases) {
    acc = accumulateCase(acc, [{ t: "num", v: c.tag }], toResult(c.original), toResult(c.resurrection));
  }
  return acc;
}

describe("Property 20: Delta accumulation", () => {
  it("is demonstrated iff some case fails on the Original and passes on the Resurrection and no case violates", () => {
    fc.assert(
      fc.property(accCasesArb, (cases) => {
        const acc = run(cases);
        const violated = cases.some((c) => c.resurrection !== "pass");
        const hasDemo = cases.some((c) => c.original === "fail" && c.resurrection === "pass");
        const expected = violated ? "violated" : hasDemo ? "demonstrated" : "not-demonstrated";
        expect(acc.state).toBe(expected);
        expect(finalizeDelta(acc).state).toBe(expected);

        const report = finalizeDelta(acc).report;
        expect(report.status).toBe(hasDemo ? "demonstrated" : "not-demonstrated");
        expect(report.demonstration === null).toBe(!hasDemo);
        expect(acc.inPredicateCases).toBe(cases.length);
        expect(report.predicateCasesChecked).toBe(cases.filter((c) => c.resurrection !== "missing").length);
      }),
      fcParams(),
    );
  });

  it("the demonstration is the first demonstrating case in execution order", () => {
    fc.assert(
      fc.property(accCasesArb, (cases) => {
        const acc = run(cases);
        const first = cases.find((c) => c.original === "fail" && c.resurrection === "pass");
        if (first === undefined) {
          expect(acc.demonstration).toBeNull();
        } else {
          expect(acc.demonstration?.args).toEqual([{ t: "num", v: first.tag }]);
        }

        // pickDemonstration over classified cases agrees with the first demonstrating case.
        const classified = cases.map((c) => ({
          tag: c.tag,
          demonstrated: classifyCase({
            args: [],
            original: returned({ t: "null" }, []),
            resurrection: returned({ t: "null" }, []),
            applicable: [{ id: "d", original: toResult(c.original), resurrection: toResult(c.resurrection) }],
          }).demonstrated,
        }));
        expect(pickDemonstration(classified, "d")?.tag).toBe(first?.tag);
        expect(pickDemonstration(classified, "other")).toBeNull();
      }),
      fcParams(),
    );
  });

  it("final state and counts do not depend on case order", () => {
    fc.assert(
      fc.property(accCasesArb, fc.array(fc.nat(), { minLength: 12, maxLength: 12 }), (cases, keys) => {
        const shuffled = cases
          .map((c, i) => ({ c, k: keys[i] ?? 0, i }))
          .sort((a, b) => a.k - b.k || a.i - b.i)
          .map((x) => x.c);
        const a = run(cases);
        const b = run(shuffled);
        expect(b.state).toBe(a.state);
        expect(b.inPredicateCases).toBe(a.inPredicateCases);
        expect(b.original).toEqual(a.original);
        expect(b.resurrection).toEqual(a.resurrection);
        expect(b.demonstration === null).toBe(a.demonstration === null);
        expect(finalizeDelta(b).report.predicateCasesChecked).toBe(finalizeDelta(a).report.predicateCasesChecked);
      }),
      fcParams(),
    );
  });
});
