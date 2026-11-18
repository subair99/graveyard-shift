// Requirements: 2.4, 6.5, 13.5
// Feature: crypt-ui, Property 5: The stub flag comes only from the Stub_Marker
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENTRY_FILES } from "../../../src/pipeline/undertaker/core/layout";
import { buildSiteView } from "../../../src/ui/core/viewModel";
import { siteInputArb } from "../helpers/arbitraries";

const NUM_RUNS = 100;

describe("Property 5: The stub flag comes only from the Stub_Marker", () => {
  it("is true if and only if the entry files contain stub-run.json, whatever the Ledger and nightly say", () => {
    fc.assert(
      fc.property(siteInputArb(), (generated) => {
        // The reader lists stub-run.json exactly when it parses the marker; keep the two consistent.
        const entries = generated.entries.map((entry) => {
          const others = entry.files.filter((f) => f !== ENTRY_FILES.stubMarker);
          return {
            ...entry,
            files: entry.stubMarker === null ? others : [...others, ENTRY_FILES.stubMarker],
          };
        });
        const view = buildSiteView({ ...generated, entries });
        expect(view.entries).toHaveLength(entries.length);
        entries.forEach((entry, i) => {
          expect(view.entries[i]!.stub).toBe(entry.files.includes(ENTRY_FILES.stubMarker));
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("does not change when every Ledger row and nightly stub value is flipped", () => {
    fc.assert(
      fc.property(siteInputArb(), (input) => {
        const flipped = {
          ...input,
          ledger: {
            ...input.ledger,
            entries: input.ledger.entries.map((e) =>
              e.mode === "local"
                ? ({
                    mode: "stub",
                    package: e.package,
                    version: e.version,
                    date: e.date,
                    fixture: "x",
                  } as const)
                : ({
                    mode: "local",
                    package: e.package,
                    version: e.version,
                    date: e.date,
                    creditBefore: "a",
                    creditAfter: "b",
                    exitCode: 0,
                    kiroCliVersion: "k",
                  } as const),
            ),
          },
          nightly:
            input.nightly === null || input.nightly.report === null
              ? input.nightly
              : {
                  ...input.nightly,
                  report: {
                    ...input.nightly.report,
                    entries: input.nightly.report.entries.map((e) => ({ ...e, stub: !e.stub })),
                  },
                },
        };
        const stubs = (i: typeof input) => buildSiteView(i).entries.map((e) => e.stub);
        expect(stubs(flipped)).toEqual(stubs(input));
        expect(stubs(input)).toEqual(input.entries.map((e) => e.stubMarker !== null));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
