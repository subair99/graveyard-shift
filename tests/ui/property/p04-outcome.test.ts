// Requirements: 3.5, 3.8, 4.8, 5.5, 5.6, 6.2
// Feature: crypt-ui, Property 4: Outcome, Verdict and verification fields follow the entry kind and Verdict
import { fc, fcParams } from "../../engine/helpers/fc";
import { describe, expect, it } from "vitest";
import { ENTRY_FILES, bundleName } from "../../../src/pipeline/undertaker/core/layout";
import { verifyCommands } from "../../../src/pipeline/undertaker/core/verifyCommands";
import { GRAVEYARD_PATH } from "../../../src/ui/core/site";
import { buildSiteView } from "../../../src/ui/core/viewModel";
import { siteInputArb } from "../helpers/arbitraries";

const FORBIDDEN_WORDS = ["resurrected", "alive", "success", "verified", "attested"];

describe("Property 4: Outcome, Verdict and verification fields follow the entry kind and Verdict", () => {
  it("matches the model for every entry", () => {
    fc.assert(
      fc.property(siteInputArb({ nightly: "none" }), (input) => {
        const view = buildSiteView(input);
        expect(view.entries).toHaveLength(input.entries.length);
        input.entries.forEach((entry, i) => {
          const v = view.entries[i]!;
          const notResurrected = entry.kind === "not-resurrected";
          const verdict = notResurrected ? null : (entry.report?.verdict ?? null);
          const alive = verdict === "alive";

          expect(v.outcome === "not-resurrected").toBe(notResurrected);
          expect(v.verdict).toBe(verdict);
          if (notResurrected) expect(v.resurrectionVersion).toBeNull();

          // Model of the subjects: tarball (when the entry has one), proof report, certificate.
          const subjects = alive
            ? [
                ...(entry.tarballName === null ? [] : [entry.tarballName]),
                ENTRY_FILES.proofReport,
                ENTRY_FILES.certificate,
              ]
            : [];
          expect(v.verifyCommands).toEqual(
            alive
              ? verifyCommands({
                  subjects: subjects.map((name) => ({ name })),
                  prefix: `${GRAVEYARD_PATH}/${entry.name}/`,
                })
              : [],
          );
          if (alive && entry.tarballName !== null) expect(v.bundles).toHaveLength(3);
          expect(v.bundles).toEqual(
            subjects.map((subject) => ({
              subject,
              file: bundleName(subject),
              present: entry.files.includes(bundleName(subject)),
            })),
          );
          expect(v.unexpectedBundles).toEqual(
            alive ? [] : entry.files.filter((f) => f.endsWith(".sigstore.json")),
          );

          if (verdict !== "alive") {
            const label = v.outcomeLabel.toLowerCase();
            if (notResurrected) expect(v.outcomeLabel).toBe("not resurrected");
            else for (const word of FORBIDDEN_WORDS) expect(label).not.toContain(word);
          }
        });
      }),
      fcParams(),
    );
  });
});
