// Requirements: 16.4, 16.5, 16.7, 16.11, 16.12, 16.13, 16.16, 16.18
// Feature: resurrection-pipeline, Property 28: Nightly classification

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  classifyEntry,
  type NightlyInput,
  type NightlyResult,
  type ToolVersions,
} from "../../../src/pipeline/undertaker/core/nightlyClassify";

// Oracle, from R16 (not from the implementation):
// - R16.4/16.5: resurrection entry, Tool_Versions differ -> `tool-versions-changed`, no replay result
//   (replay-mismatch) and no byte-comparison verdict.
// - R16.6/16.7: Tool_Versions equal and reports differ -> `replay-mismatch`.
// - R16.8: failed fetch -> `not-checked`.
// - R16.11: alive entry with a failed or missing attestation -> `attestation-failed`, even when Tool_Versions differ.
// - R16.12: bundles on a restless/inconclusive entry or on a not-resurrected entry -> `unexpected-attestation`.
// - R16.13: new advisory ids -> `new-advisory`, never a failure.
// - R16.16: the run fails iff replay-mismatch, attestation-failed or unexpected-attestation is present.
// - R16.18/16.22/16.23: fixed order, no duplicates; a not-resurrected entry without a bundle is never
//   attestation-failed, replay-mismatch or tool-versions-changed.

const FIXED_ORDER: readonly NightlyResult[] = [
  "tool-versions-changed",
  "unexpected-attestation",
  "attestation-failed",
  "replay-mismatch",
  "not-checked",
  "new-advisory",
  "verified",
  "not-resurrected",
];
const FAILING: readonly NightlyResult[] = ["replay-mismatch", "attestation-failed", "unexpected-attestation"];

const tools: fc.Arbitrary<ToolVersions> = fc.record({
  node: fc.constantFrom("26.0.0", "26.1.0"),
  fastCheck: fc.constantFrom("4.1.0", "4.2.0"),
  reportSchema: fc.constantFrom(1, 2),
});

const attestations = fc.oneof(
  fc.constant("not-applicable" as const),
  fc.array(fc.constantFrom("ok" as const, "failed" as const), { minLength: 0, maxLength: 4 }),
  fc.constant(["ok", "ok", "ok"] as ("ok" | "failed")[]),
);

const input: fc.Arbitrary<NightlyInput> = fc.record({
  kind: fc.constantFrom("resurrection" as const, "not-resurrected" as const),
  stub: fc.boolean(),
  verdict: fc.constantFrom("alive" as const, "restless" as const, "inconclusive" as const),
  committedTools: fc.option(tools, { nil: null }),
  runningTools: tools,
  replay: fc.record({
    status: fc.constantFrom("identical" as const, "different" as const, "not-run" as const, "fetch-failed" as const),
  }),
  bundlesPresent: fc.boolean(),
  attestations,
  newAdvisoryIds: fc.array(fc.constantFrom("GHSA-1", "CVE-2"), { maxLength: 3 }),
}).map((r) => (r.kind === "not-resurrected" ? { ...r, verdict: null } : r));

// The tool-versions-equal inputs make up the interesting replay cases; bias towards them.
const biasedInput = fc
  .tuple(input, fc.boolean())
  .map(([i, same]) => (same && i.kind === "resurrection" ? { ...i, committedTools: i.runningTools } : i));

const attestationsAllOk = (a: NightlyInput["attestations"]): boolean =>
  a !== "not-applicable" && a.length === 3 && a.every((x) => x === "ok");

const toolsDiffer = (i: NightlyInput): boolean =>
  i.committedTools === null ||
  i.committedTools.node !== i.runningTools.node ||
  i.committedTools.fastCheck !== i.runningTools.fastCheck ||
  i.committedTools.reportSchema !== i.runningTools.reportSchema;

describe("Property 28: Nightly classification", () => {
  /**
   * **Validates: Requirements 16.4, 16.5, 16.7, 16.11, 16.12, 16.13, 16.16, 16.18**
   */
  it("classifies each entry as R16 requires", () => {
    fc.assert(
      fc.property(biasedInput, (i) => {
        const { results, fails } = classifyEntry(i);
        const has = (r: NightlyResult): boolean => results.includes(r);

        // fixed order, no duplicates, never empty
        expect(new Set(results).size).toBe(results.length);
        expect(results.length).toBeGreaterThan(0);
        const idx = results.map((r) => FIXED_ORDER.indexOf(r));
        expect(idx).toEqual([...idx].sort((a, b) => a - b));

        // R16.16: fails iff one of the three failing results is listed
        expect(fails).toBe(results.some((r) => FAILING.includes(r)));
        // R16.13: new advisories never set fails on their own
        if (i.newAdvisoryIds.length > 0) expect(has("new-advisory")).toBe(true);
        else expect(has("new-advisory")).toBe(false);

        if (i.kind === "not-resurrected") {
          // R16.22, R16.23
          expect(has("attestation-failed")).toBe(false);
          expect(has("replay-mismatch")).toBe(false);
          expect(has("tool-versions-changed")).toBe(false);
          expect(has("not-checked")).toBe(false);
          expect(has("verified")).toBe(false);
          expect(has("unexpected-attestation")).toBe(i.bundlesPresent); // R16.12
          expect(has("not-resurrected")).toBe(!i.bundlesPresent && i.newAdvisoryIds.length === 0);
          return;
        }

        const differ = toolsDiffer(i);
        // R16.4, R16.5, R16.18: tool-versions-changed whenever tools differ, and then no replay result
        expect(has("tool-versions-changed")).toBe(differ);
        if (differ) {
          expect(results[0]).toBe("tool-versions-changed");
          expect(has("replay-mismatch")).toBe(false);
          expect(has("not-checked")).toBe(false);
        } else {
          // R16.7, R16.8
          expect(has("replay-mismatch")).toBe(i.replay.status === "different");
          expect(has("not-checked")).toBe(i.replay.status === "fetch-failed");
        }

        // R16.12
        expect(has("unexpected-attestation")).toBe(i.verdict !== "alive" && i.bundlesPresent);
        // R16.11: independent of the tool versions
        expect(has("attestation-failed")).toBe(i.verdict === "alive" && !attestationsAllOk(i.attestations));

        // verified only when nothing else is listed; never alongside other results
        expect(has("verified")).toBe(results.length === 1 && results[0] === "verified");
        expect(has("not-resurrected")).toBe(false);
        const others = results.filter((r) => r !== "verified");
        if (others.length === 0) expect(results).toEqual(["verified"]);
      }),
      { numRuns: 300 },
    );
  });

  /** **Validates: Requirements 16.5, 16.18** */
  it("a changed Tool_Version is never a failed resurrection by itself", () => {
    fc.assert(
      fc.property(
        tools,
        tools,
        fc.constantFrom("identical" as const, "different" as const, "fetch-failed" as const),
        (committed, running, status) => {
          fc.pre(JSON.stringify(committed) !== JSON.stringify(running));
          const r = classifyEntry({
            kind: "resurrection",
            stub: false,
            verdict: "alive",
            committedTools: committed,
            runningTools: running,
            replay: { status },
            bundlesPresent: true,
            attestations: ["ok", "ok", "ok"],
            newAdvisoryIds: [],
          });
          expect(r.results).toEqual(["tool-versions-changed"]);
          expect(r.fails).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
