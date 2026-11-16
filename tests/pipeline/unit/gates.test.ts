// Requirements: 1.4, 11.2, 11.16, 11.17, 13.1, 13.2, 13.3, 13.10, 14.1, 15.1
import { describe, expect, it } from "vitest";
import type { Verdict } from "../../../src/proof/types";
import { attestDecision, publishGate, type JobResult } from "../../../src/pipeline/undertaker/core/gates";
import type { EntryKind } from "../../../src/pipeline/undertaker/core/layout";

const RESULTS: readonly JobResult[] = ["success", "failure", "cancelled", "skipped"];
const VERDICTS: readonly (Verdict | null)[] = ["alive", "restless", "inconclusive", null];
const KINDS: readonly (EntryKind | null)[] = ["resurrection", "not-resurrected", null];
const BOOLS = [true, false] as const;

describe("attestDecision (full table)", () => {
  it("attests exactly when checks and prove succeeded, verdict is alive, report parsed, hashes equal", () => {
    let attests = 0;
    for (const checks of RESULTS)
      for (const prove of RESULTS)
        for (const verdict of VERDICTS)
          for (const reportParsed of BOOLS)
            for (const treeHashEqual of BOOLS)
              for (const integrityEqual of BOOLS) {
                const expected =
                  checks === "success" && prove === "success" && verdict === "alive" && reportParsed && treeHashEqual && integrityEqual;
                const got = attestDecision({ checks, prove, verdict, reportParsed, treeHashEqual, integrityEqual });
                expect(got, JSON.stringify({ checks, prove, verdict, reportParsed, treeHashEqual, integrityEqual })).toBe(
                  expected ? "attest" : "skip",
                );
                if (expected) attests += 1;
              }
    expect(attests).toBe(1);
  });
});

describe("publishGate (full table)", () => {
  it("follows the design rule for every combination", () => {
    for (const intake of RESULTS)
      for (const checks of RESULTS)
        for (const prove of RESULTS)
          for (const attest of RESULTS)
            for (const kind of KINDS)
              for (const verdict of VERDICTS) {
                const base = intake === "success" && checks === "success";
                const expected =
                  base &&
                  (kind === "not-resurrected" ||
                    (kind === "resurrection" &&
                      prove === "success" &&
                      verdict !== null &&
                      (verdict !== "alive" || attest === "success")));
                expect(publishGate({ intake, checks, prove, attest, kind, verdict }), JSON.stringify({ intake, checks, prove, attest, kind, verdict })).toBe(
                  expected ? "publish" : "skip",
                );
              }
  });

  it("never publishes when checks did not succeed", () => {
    for (const checks of RESULTS.filter((r) => r !== "success"))
      for (const kind of KINDS)
        for (const verdict of VERDICTS)
          expect(publishGate({ intake: "success", checks, prove: "success", attest: "success", kind, verdict })).toBe("skip");
  });

  it("never publishes an alive resurrection without a successful attest (J10)", () => {
    for (const attest of RESULTS.filter((r) => r !== "success"))
      expect(
        publishGate({ intake: "success", checks: "success", prove: "success", attest, kind: "resurrection", verdict: "alive" }),
      ).toBe("skip");
  });

  it("publishes restless and inconclusive resurrections with the attest skipped", () => {
    for (const verdict of ["restless", "inconclusive"] as const)
      expect(
        publishGate({ intake: "success", checks: "success", prove: "success", attest: "skipped", kind: "resurrection", verdict }),
      ).toBe("publish");
  });
});
