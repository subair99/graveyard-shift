import type {
  DeltaReport,
  Divergence,
  HarnessError,
  UnencodableCount,
  Verdict,
} from "../types";

/** The facts of a completed run that decide the Verdict. `unencodable` covers tested functions only. */
export interface RunFacts {
  harnessErrors: readonly HarnessError[];
  divergences: readonly Divergence[];
  deltas: readonly DeltaReport[];
  /** Flagged non-deterministic and not excluded. */
  nonDeterministic: readonly string[];
  functionsTested: readonly string[];
  unencodable: readonly UnencodableCount[];
}

export interface VerdictResult {
  verdict: Verdict;
  /**
   * Machine-readable, sorted (by UTF-16 code unit order), without duplicates. Only the reasons of the
   * deciding precedence step are listed. Formats:
   * `harness-error:<kind>`, `no-functions-tested`, `divergence:<kind>:<function>`,
   * `delta-not-demonstrated:<id>`, `non-deterministic:<function>`, `lacking-evidence:<function>`.
   * For `alive` the list is empty.
   */
  reasons: string[];
}

/**
 * A tested function lacks evidence when no Case ran (`cases === 0`) or every Case had an
 * `unencodable` node (`casesWithUnencodable === cases`). Result is sorted and unique.
 */
export function functionsLackingEvidence(unencodable: readonly UnencodableCount[]): string[] {
  const names = unencodable
    .filter((u) => u.cases === 0 || u.casesWithUnencodable === u.cases)
    .map((u) => u.function);
  return sortedUnique(names);
}

/**
 * Precedence table, total, first match wins (design "Verdict logic", R12.1 to R12.4, R12.7):
 *
 * | # | Condition                                                             | Verdict      |
 * |---|-----------------------------------------------------------------------|--------------|
 * | 1 | any harness error (any HarnessErrorKind), even with divergences (R12.4)| inconclusive |
 * | 2 | any Divergence (unexplained, delta-violation, api-surface) or any      | restless     |
 * |   | `not-demonstrated` delta (beats flakiness and no-evidence, R12.7)      |              |
 * | 3 | any non-excluded non-deterministic function (R9.4)                    | inconclusive |
 * | 4 | no function tested (reason `no-functions-tested`)                     | inconclusive |
 * | 5 | any tested function lacking evidence (R12.7)                          | inconclusive |
 * | 6 | otherwise                                                             | alive        |
 *
 * A run with no tested function normally carries the harness error `no-functions-tested`, so
 * step 1 applies. Step 4 keeps `alive` impossible when nothing was tested even if that error is
 * missing from the input.
 */
export function computeVerdict(facts: RunFacts): VerdictResult {
  if (facts.harnessErrors.length > 0) {
    const reasons = facts.harnessErrors.map((e) => `harness-error:${e.kind}`);
    return { verdict: "inconclusive", reasons: sortedUnique(reasons) };
  }

  const restless = [
    ...facts.divergences.map((d) => `divergence:${d.kind}:${d.function}`),
    ...facts.deltas
      .filter((d) => d.status === "not-demonstrated")
      .map((d) => `delta-not-demonstrated:${d.id}`),
  ];
  if (restless.length > 0) {
    return { verdict: "restless", reasons: sortedUnique(restless) };
  }

  if (facts.nonDeterministic.length > 0) {
    return {
      verdict: "inconclusive",
      reasons: sortedUnique(facts.nonDeterministic.map((f) => `non-deterministic:${f}`)),
    };
  }

  if (facts.functionsTested.length === 0) {
    return { verdict: "inconclusive", reasons: ["no-functions-tested"] };
  }

  const lacking = functionsLackingEvidence(facts.unencodable);
  if (lacking.length > 0) {
    return {
      verdict: "inconclusive",
      reasons: lacking.map((f) => `lacking-evidence:${f}`),
    };
  }

  return { verdict: "alive", reasons: [] };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
