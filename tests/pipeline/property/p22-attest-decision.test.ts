// Requirements: 1.4, 11.16, 11.17, 13.1, 13.2, 13.3
// Feature: resurrection-pipeline, Property 22: Attest decision

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { attestDecision, type AttestDecisionInput, type JobResult } from "../../../src/pipeline/undertaker/core/gates";

const jobResult = fc.constantFrom<JobResult>("success", "failure", "cancelled", "skipped");
const verdict = fc.constantFrom<AttestDecisionInput["verdict"]>("alive", "restless", "inconclusive", null);

const input = fc.record({
  checks: jobResult,
  prove: jobResult,
  verdict,
  reportParsed: fc.boolean(),
  treeHashEqual: fc.boolean(),
  integrityEqual: fc.boolean(),
});

describe("Property 22: Attest decision", () => {
  /**
   * **Validates: Requirements 1.4, 11.16, 11.17, 13.1, 13.2, 13.3**
   */
  it("attests if and only if checks and prove succeeded, verdict is alive, report parsed and both hashes match", () => {
    fc.assert(
      fc.property(input, (i) => {
        const shouldAttest =
          i.checks === "success" &&
          i.prove === "success" &&
          i.verdict === "alive" &&
          i.reportParsed === true &&
          i.treeHashEqual === true &&
          i.integrityEqual === true;
        expect(attestDecision(i)).toBe(shouldAttest ? "attest" : "skip");
      }),
      { numRuns: 200 },
    );
  });

  it("attests for the all-good input", () => {
    expect(
      attestDecision({
        checks: "success",
        prove: "success",
        verdict: "alive",
        reportParsed: true,
        treeHashEqual: true,
        integrityEqual: true,
      }),
    ).toBe("attest");
  });
});
