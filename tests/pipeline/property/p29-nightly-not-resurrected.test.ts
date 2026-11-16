// Requirements: 16.22, 16.23
// Feature: resurrection-pipeline, Property 29: Not-resurrected entries are never proof failures
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  classifyEntry,
  type NightlyInput,
  type NightlyResult,
  type ToolVersions,
} from "../../../src/pipeline/undertaker/core/nightlyClassify";
import type { Verdict } from "../../../src/proof/types";

const toolsArb: fc.Arbitrary<ToolVersions> = fc.record({
  node: fc.constantFrom("20.11.0", "22.1.0"),
  fastCheck: fc.constantFrom("3.0.0", "4.0.0"),
  reportSchema: fc.integer({ min: 1, max: 3 }),
});

// Every field that does not apply to a not-resurrected entry is generated freely, so
// the classification must ignore it.
const inputArb: fc.Arbitrary<NightlyInput> = fc.record({
  kind: fc.constant("not-resurrected" as const),
  stub: fc.boolean(),
  verdict: fc.constantFrom<Verdict | null>("alive", "restless", "inconclusive", null),
  committedTools: fc.option(toolsArb, { nil: null }),
  runningTools: toolsArb,
  replay: fc.record({
    status: fc.constantFrom("identical", "different", "not-run", "fetch-failed" as const),
    reason: fc.option(fc.string(), { nil: undefined }),
  }) as fc.Arbitrary<NightlyInput["replay"]>,
  bundlesPresent: fc.boolean(),
  attestations: fc.oneof(
    fc.constant("not-applicable" as const),
    fc.array(fc.constantFrom("ok" as const, "failed" as const), { maxLength: 5 }),
  ),
  newAdvisoryIds: fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }),
});

const FORBIDDEN: readonly NightlyResult[] = [
  "attestation-failed",
  "replay-mismatch",
  "tool-versions-changed",
  "not-checked",
  "verified",
];

describe("Property 29: not-resurrected entries are never proof failures", () => {
  it("never yields a proof failure result; fails only with an unexpected attestation", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { results, fails } = classifyEntry(input);
        for (const r of FORBIDDEN) expect(results).not.toContain(r);
        // R16.12: the only failing result for this kind is unexpected-attestation (bundle present).
        expect(fails).toBe(input.bundlesPresent);
        expect(results.includes("unexpected-attestation")).toBe(input.bundlesPresent);
        // R16.22: not-resurrected is the result unless criterion 12 or 13 gives another one.
        expect(results.includes("not-resurrected")).toBe(!input.bundlesPresent && input.newAdvisoryIds.length === 0);
        expect(results.includes("new-advisory")).toBe(input.newAdvisoryIds.length > 0);
      }),
      { numRuns: 200 },
    );
  });

  it("an entry without a bundle and without new advisories is exactly not-resurrected and passes", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const c = classifyEntry({ ...input, bundlesPresent: false, newAdvisoryIds: [] });
        expect(c).toEqual({ results: ["not-resurrected"], fails: false });
      }),
      { numRuns: 100 },
    );
  });
});
