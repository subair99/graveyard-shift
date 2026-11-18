// Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 12.10, 12.11
// Feature: crypt-ui, Property 10: The nightly view follows the run record, the report state and the conclusion
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nightlyLabel } from "../../../src/ui/core/nightlyLabels";
import { runUrl } from "../../../src/ui/core/site";
import { nightlyNoReport, nightlyReportRejected } from "../../../src/ui/core/texts";
import { buildSiteView, type NightlyInput, type SiteInput } from "../../../src/ui/core/viewModel";
import { runRecordArb, siteInputArb } from "../helpers/arbitraries";

const NUM_RUNS = 100;

/** Same site with the Nightly_Input replaced (keeps entries and ledger). */
function withNightly(input: SiteInput, nightly: NightlyInput | null): SiteInput {
  return { ...input, nightly };
}

describe("Property 10: The nightly view follows the run record, the report state and the conclusion", () => {
  it("with no nightly input, every entry is none-in-build and nightlyRun is null", () => {
    fc.assert(
      fc.property(siteInputArb({ nightly: "none" }), (input) => {
        const view = buildSiteView(input);
        expect(view.nightlyRun).toBeNull();
        for (const e of view.entries) expect(e.nightly).toEqual({ kind: "none-in-build" });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the run view copies the record, builds the link and flags differing commits", () => {
    fc.assert(
      fc.property(siteInputArb(), (input) => {
        const view = buildSiteView(input);
        if (input.nightly === null) {
          expect(view.nightlyRun).toBeNull();
          return;
        }
        const { run } = input.nightly;
        const nr = view.nightlyRun!;
        expect(nr.runUrl).toBe(runUrl(run.runId));
        expect(nr.runId).toBe(run.runId);
        expect(nr.runStartedAt).toBe(run.runStartedAt);
        expect(nr.conclusion).toBe(run.conclusion);
        expect(nr.headSha).toBe(run.headSha);
        expect(nr.buildSha).toBe(run.buildSha);
        expect(nr.commitsDiffer).toBe(run.headSha !== run.buildSha);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepted report: no-line without a line, otherwise the results in report order with labels, reason and facts", () => {
    fc.assert(
      fc.property(siteInputArb({ nightly: "accepted" }), (input) => {
        const nightly = input.nightly!;
        if (nightly.reportState !== "accepted") throw new Error("generator contract");
        const view = buildSiteView(input);
        expect(view.nightlyRun!.state).toBe("results");
        expect(view.nightlyRun!.sentence).toBeNull();
        input.entries.forEach((entry, i) => {
          const got = view.entries[i]!.nightly;
          const line = nightly.report.entries.find((l) => l.package === entry.name);
          if (line === undefined) {
            expect(got).toEqual({ kind: "no-line" });
            return;
          }
          const verdict = entry.kind === "resurrection" && entry.report !== null ? entry.report.verdict : null;
          expect(got).toEqual({
            kind: "results",
            results: line.results.map((code) => ({ code, label: nightlyLabel(code, verdict) })),
            reason: line.reason,
            facts: line.facts,
            firstDiffPath: line.firstDiffPath,
          });
          if (got.kind === "results" && verdict !== "alive") {
            for (const r of got.results.filter((x) => x.code === "verified")) {
              expect(r.label).not.toMatch(/verified|attested/i);
            }
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("missing report: ended-without-report unless the conclusion is success, then none-in-build", () => {
    fc.assert(
      fc.property(siteInputArb({ nightly: "none" }), runRecordArb, (input, run) => {
        const view = buildSiteView(withNightly(input, { run, report: null, reportState: "missing" }));
        const link = runUrl(run.runId);
        if (run.conclusion === "success") {
          expect(view.nightlyRun!.state).toBe("none-in-build");
          expect(view.nightlyRun!.sentence).toBeNull();
          for (const e of view.entries) expect(e.nightly).toEqual({ kind: "none-in-build" });
        } else {
          expect(view.nightlyRun!.state).toBe("ended-without-report");
          expect(view.nightlyRun!.sentence).toBe(nightlyNoReport(link, run.runStartedAt, run.conclusion));
          for (const e of view.entries) expect(e.nightly).toEqual({ kind: "ended-without-report" });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejected report: report-rejected whatever the conclusion, with the rejected sentence", () => {
    fc.assert(
      fc.property(siteInputArb({ nightly: "none" }), runRecordArb, (input, run) => {
        const view = buildSiteView(withNightly(input, { run, report: null, reportState: "rejected" }));
        expect(view.nightlyRun!.state).toBe("report-rejected");
        expect(view.nightlyRun!.sentence).toBe(
          nightlyReportRejected(runUrl(run.runId), run.runStartedAt, run.conclusion),
        );
        for (const e of view.entries) expect(e.nightly).toEqual({ kind: "report-rejected" });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
