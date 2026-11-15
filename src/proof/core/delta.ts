// Declared_Delta classification and evidence accumulation (Requirement 11).
// Pure: it consumes the predicate result (evaluated by the driver in the parent) and the property
// results (evaluated in the sandbox, inside the call) and never runs either itself.

import type { DeltaReport, EncodedNode, Outcome } from "../types";
import { compareOutcomes, type PartDifference } from "./equal";

/** Result of a delta property run in the child. Absent when the property did not run (crash, timeout). */
export interface PropertyResult {
  passed: boolean;
  detail?: EncodedNode;
}

/**
 * One applicable delta (its predicate held on the decoded arguments) with the property results
 * of both sides for this case. An `undefined` result means the property produced no result on
 * that side (the call timed out, crashed or exceeded the output limit). A property module that
 * throws or returns a malformed result is a `property-error` harness error handled by the
 * driver, and never reaches this module.
 */
export interface ApplicableDelta {
  id: string;
  original: PropertyResult | undefined;
  resurrection: PropertyResult | undefined;
}

export interface CaseObservation {
  args: readonly EncodedNode[];
  original: Outcome;
  resurrection: Outcome;
  applicable: readonly ApplicableDelta[];
}

export type CaseLabel = "equal" | "explained-by-delta" | "delta-violation" | "unexplained-divergence";

export interface ClassifiedDivergence {
  kind: "unexplained" | "delta-violation";
  deltaId?: string;
  differences: PartDifference[];
}

export interface CaseClassification {
  label: CaseLabel;
  differences: PartDifference[];
  divergences: ClassifiedDivergence[];
  /** Delta ids whose property fails on the Original and passes on the Resurrection for this case. */
  demonstrated: string[];
  /** Delta ids whose property ran (and produced a result) on the Resurrection for this case. */
  checked: string[];
}

/**
 * Rules (design, "Delta classification"):
 * 1. differences = compareOutcomes(original, resurrection).
 * 2. For each applicable delta: a Resurrection property that did not pass (including no result)
 *    is a `delta-violation`, even when the Outcomes are equal (11.3). Fails on the Original and
 *    passes on the Resurrection: demonstrated (11.5).
 * 3. Differences with no applicable delta are `unexplained` (11.4). With applicable deltas the
 *    differences are accepted when at least one property passes on the Resurrection (11.2, 11.10);
 *    otherwise the `delta-violation` of rule 2 already reports the case.
 *
 * Label precedence: delta-violation, unexplained-divergence, explained-by-delta, equal.
 */
export function classifyCase(observation: CaseObservation): CaseClassification {
  const differences = compareOutcomes(observation.original, observation.resurrection);
  const divergences: ClassifiedDivergence[] = [];
  const demonstrated: string[] = [];
  const checked: string[] = [];
  let anyHolds = false;

  for (const d of observation.applicable) {
    if (d.resurrection !== undefined) checked.push(d.id);
    if (d.resurrection?.passed === true) {
      anyHolds = true;
      if (d.original !== undefined && !d.original.passed) demonstrated.push(d.id);
    } else {
      divergences.push({ kind: "delta-violation", deltaId: d.id, differences });
    }
  }

  const hasViolation = divergences.length > 0;
  if (differences.length > 0 && observation.applicable.length === 0) {
    divergences.push({ kind: "unexplained", differences });
  }

  let label: CaseLabel;
  if (hasViolation) label = "delta-violation";
  else if (differences.length === 0) label = "equal";
  else if (anyHolds) label = "explained-by-delta";
  else label = "unexplained-divergence";

  return { label, differences, divergences, demonstrated, checked };
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

export type DeltaState = "demonstrated" | "not-demonstrated" | "violated";

export interface SideTally {
  passes: number;
  failures: number;
  /** Cases where the property produced no result on this side. */
  missing: number;
}

export interface DeltaDemonstration {
  args: readonly EncodedNode[];
  original: PropertyResult;
  resurrection: PropertyResult;
}

export interface DeltaAccumulator {
  id: string;
  function: string;
  /** Cases that satisfied the predicate. */
  inPredicateCases: number;
  original: SideTally;
  resurrection: SideTally;
  /** First case, in the order added, that fails on the Original and passes on the Resurrection. */
  demonstration: DeltaDemonstration | null;
  state: DeltaState;
}

export function newDeltaAccumulator(id: string, fn: string): DeltaAccumulator {
  return {
    id,
    function: fn,
    inPredicateCases: 0,
    original: { passes: 0, failures: 0, missing: 0 },
    resurrection: { passes: 0, failures: 0, missing: 0 },
    demonstration: null,
    state: "not-demonstrated",
  };
}

function tally(t: SideTally, r: PropertyResult | undefined): SideTally {
  if (r === undefined) return { ...t, missing: t.missing + 1 };
  return r.passed ? { ...t, passes: t.passes + 1 } : { ...t, failures: t.failures + 1 };
}

function stateOf(
  resurrection: SideTally,
  demonstration: DeltaDemonstration | null,
): DeltaState {
  if (resurrection.failures > 0 || resurrection.missing > 0) return "violated";
  return demonstration === null ? "not-demonstrated" : "demonstrated";
}

/**
 * Adds one in-predicate case. Call it only for cases whose predicate held, in execution order.
 * Returns a new accumulator; the input is not changed.
 */
export function accumulateCase(
  acc: DeltaAccumulator,
  args: readonly EncodedNode[],
  original: PropertyResult | undefined,
  resurrection: PropertyResult | undefined,
): DeltaAccumulator {
  const resurrectionTally = tally(acc.resurrection, resurrection);
  const demonstration =
    acc.demonstration ??
    (original !== undefined && !original.passed && resurrection?.passed === true
      ? { args, original, resurrection }
      : null);
  return {
    ...acc,
    inPredicateCases: acc.inPredicateCases + 1,
    original: tally(acc.original, original),
    resurrection: resurrectionTally,
    demonstration,
    state: stateOf(resurrectionTally, demonstration),
  };
}

export interface FinalizedDelta {
  state: DeltaState;
  report: DeltaReport;
}

function toReport(r: PropertyResult): { ok: boolean; detail?: EncodedNode } {
  return r.detail === undefined ? { ok: r.passed } : { ok: r.passed, detail: r.detail };
}

/**
 * Final state and the report entry. `violated` means the property failed (or gave no result) on
 * the Resurrection for at least one in-predicate case; the matching `delta-violation` Divergences
 * come from `classifyCase`. The report status is `demonstrated` only when a Demonstration exists.
 */
export function finalizeDelta(acc: DeltaAccumulator): FinalizedDelta {
  const state = stateOf(acc.resurrection, acc.demonstration);
  const d = acc.demonstration;
  return {
    state,
    report: {
      id: acc.id,
      function: acc.function,
      status: d === null ? "not-demonstrated" : "demonstrated",
      predicateCasesChecked: acc.resurrection.passes + acc.resurrection.failures,
      demonstration:
        d === null
          ? null
          : {
              args: [...d.args],
              original: toReport(d.original),
              resurrection: toReport(d.resurrection),
            },
    },
  };
}

/** First case, in execution order, that demonstrates the delta `id`; `null` if none does. */
export function pickDemonstration<T extends { demonstrated: readonly string[] }>(
  cases: Iterable<T>,
  id: string,
): T | null {
  for (const c of cases) {
    if (c.demonstrated.includes(id)) return c;
  }
  return null;
}
