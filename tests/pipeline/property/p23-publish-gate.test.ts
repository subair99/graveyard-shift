// Requirements: 11.2, 11.16, 11.17, 13.10, 14.1, 15.1
// Feature: resurrection-pipeline, Property 23: Publish gate
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { publishGate, type JobResult } from "../../../src/pipeline/undertaker/core/gates";
import type { EntryKind } from "../../../src/pipeline/undertaker/core/layout";
import type { Verdict } from "../../../src/proof/types";

const jobArb = fc.constantFrom<JobResult>("success", "failure", "cancelled", "skipped");
const kindArb = fc.constantFrom<EntryKind | null>("resurrection", "not-resurrected", null);
// verdict null (no verdict) is generated: nothing is proposed without a verdict.
const verdictArb = fc.constantFrom<Verdict | null>("alive", "restless", "inconclusive", null);

const inputArb = fc.record({
  intake: jobArb,
  checks: jobArb,
  prove: jobArb,
  attest: jobArb,
  kind: kindArb,
  verdict: verdictArb,
});

// Oracle from the requirements: nothing is published unless intake and checks succeeded.
// An alive resurrection is published only when attest succeeded; a restless or inconclusive one
// is published with attest skipped; a not-resurrected entry is published without prove or attest.
function expected(i: {
  intake: JobResult;
  checks: JobResult;
  prove: JobResult;
  attest: JobResult;
  kind: EntryKind | null;
  verdict: Verdict | null;
}): boolean {
  if (i.intake !== "success" || i.checks !== "success") return false;
  if (i.kind === "not-resurrected") return true;
  if (i.kind !== "resurrection") return false;
  if (i.prove !== "success") return false;
  if (i.verdict === null) return false;
  return i.verdict === "alive" ? i.attest === "success" : true;
}

describe("Property 23: Publish gate", () => {
  it("publishes exactly when the requirements allow it", () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        expect(publishGate(i)).toBe(expected(i) ? "publish" : "skip");
      }),
      { numRuns: 500 },
    );
  });

  it("never publishes when intake or checks did not succeed", () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        fc.pre(i.intake !== "success" || i.checks !== "success");
        expect(publishGate(i)).toBe("skip");
      }),
      { numRuns: 200 },
    );
  });

  it("never publishes an alive resurrection unless attest succeeded", () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        fc.pre(i.kind === "resurrection" && i.verdict === "alive" && i.attest !== "success");
        expect(publishGate(i)).toBe("skip");
      }),
      { numRuns: 100 },
    );
  });

  it("never publishes a resurrection without a verdict, whatever the job results", () => {
    fc.assert(
      fc.property(inputArb, (i) => {
        fc.pre(i.kind === "resurrection");
        expect(publishGate({ ...i, verdict: null })).toBe("skip");
      }),
      { numRuns: 100 },
    );
  });

  it("publishes a restless or inconclusive resurrection with attest skipped", () => {
    fc.assert(
      fc.property(fc.constantFrom<Verdict>("restless", "inconclusive"), (verdict) => {
        expect(
          publishGate({
            intake: "success",
            checks: "success",
            prove: "success",
            attest: "skipped",
            kind: "resurrection",
            verdict,
          }),
        ).toBe("publish");
      }),
      { numRuns: 100 },
    );
  });

  it("publishes not-resurrected without prove or attest", () => {
    fc.assert(
      fc.property(jobArb, jobArb, verdictArb, (prove, attest, verdict) => {
        expect(
          publishGate({ intake: "success", checks: "success", prove, attest, kind: "not-resurrected", verdict }),
        ).toBe("publish");
      }),
      { numRuns: 100 },
    );
  });
});
