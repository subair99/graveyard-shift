// Requirements: 3.9, 6.1, 6.3, 6.7, 6.8
// Feature: crypt-ui, Property 3: Every string in the view comes from an input, a fixed text or a link builder
import { fc, fcParams } from "../../engine/helpers/fc";
import { describe, expect, it } from "vitest";
import { CAUSE_LABELS } from "../../../src/ui/core/causes";
import { NIGHTLY_RESULT_ORDER } from "../../../src/pipeline/undertaker/core/nightlyClassify";
import { ENTRY_FILES, bundleName } from "../../../src/pipeline/undertaker/core/layout";
import { verifyCommands } from "../../../src/pipeline/undertaker/core/verifyCommands";
import { nightlyLabel } from "../../../src/ui/core/nightlyLabels";
import { GRAVEYARD_PATH, downloadPath, entryRoute, historyUrl, runUrl } from "../../../src/ui/core/site";
import * as texts from "../../../src/ui/core/texts";
import { buildSiteView, type SiteInput } from "../../../src/ui/core/viewModel";
import { siteInputArb } from "../helpers/arbitraries";

/** Structural tags of the view (discriminators, Outcome values and labels), not texts shown as facts. */
const TAGS = [
  "alive", "restless", "inconclusive", "not-resurrected", "not resurrected", "resurrection",
  "local", "stub", "results", "ended-without-report", "report-rejected", "none-in-build", "no-line",
];

/** Keys of the parsed input files that the view copies unread; not checked (Property 3 wording). */
const COPIED_KEYS = new Set(["certificate", "eligibility", "report", "deltas"]);
/** Keys that must never appear in a derived field: nightly counts, stub flag of the report, gh version. */
const FORBIDDEN_KEYS = new Set(["counts", "ghVersion", "ghMinVersion", "committedTools", "runningTools"]);

function collect(value: unknown, strings: Set<string>, numbers: Set<number>): void {
  if (typeof value === "string") strings.add(value);
  else if (typeof value === "number") {
    numbers.add(value);
    strings.add(String(value));
  } else if (Array.isArray(value)) value.forEach((v) => collect(v, strings, numbers));
  else if (value !== null && typeof value === "object")
    Object.values(value as Record<string, unknown>).forEach((v) => collect(v, strings, numbers));
}

function allowedOf(input: SiteInput): { strings: Set<string>; numbers: Set<number> } {
  const strings = new Set<string>(TAGS);
  const numbers = new Set<number>();
  collect(input, strings, numbers);
  for (const v of Object.values(texts)) if (typeof v === "string") strings.add(v);
  strings.add(texts.ghVersionSentence(""));
  for (const label of Object.values(CAUSE_LABELS)) strings.add(label);
  for (const r of NIGHTLY_RESULT_ORDER)
    for (const v of ["alive", "restless", "inconclusive", null] as const) strings.add(nightlyLabel(r, v));
  for (const e of input.entries) {
    strings.add(entryRoute(e.name));
    strings.add(historyUrl(e.name));
    for (const f of e.files) strings.add(downloadPath(e.name, f));
    const subjects = [...(e.tarballName === null ? [] : [e.tarballName]), ENTRY_FILES.proofReport, ENTRY_FILES.certificate];
    for (const s of subjects) strings.add(bundleName(s));
    for (const s of subjects) strings.add(s);
    for (const c of verifyCommands({ subjects: subjects.map((name) => ({ name })), prefix: `${GRAVEYARD_PATH}/${e.name}/` }))
      strings.add(c);
  }
  if (input.nightly !== null) {
    const { run } = input.nightly;
    const link = runUrl(run.runId);
    strings.add(link);
    strings.add(texts.nightlyNoReport(link, run.runStartedAt, run.conclusion));
    strings.add(texts.nightlyReportRejected(link, run.runStartedAt, run.conclusion));
  }
  return { strings, numbers };
}

function checkLeaves(value: unknown, allowed: { strings: Set<string>; numbers: Set<number> }, path: string, skipCopied: boolean): void {
  if (typeof value === "string") {
    expect(allowed.strings.has(value), `string at ${path}: ${JSON.stringify(value)}`).toBe(true);
  } else if (typeof value === "number") {
    expect(allowed.numbers.has(value), `number at ${path}: ${value}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => checkLeaves(v, allowed, `${path}[${i}]`, skipCopied));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      expect(FORBIDDEN_KEYS.has(k), `forbidden key ${k} at ${path}`).toBe(false);
      if (skipCopied && COPIED_KEYS.has(k)) continue;
      checkLeaves(v, allowed, `${path}.${k}`, skipCopied);
    }
  }
}

describe("Property 3: every string in the view comes from a known source", () => {
  it("every derived string leaf is an input string, a fixed text, a label or a builder output", () => {
    fc.assert(
      fc.property(siteInputArb(), (input) => {
        const view = buildSiteView(input);
        const allowed = allowedOf(input);
        view.entries.forEach((e, i) => checkLeaves(e, allowed, `entries[${i}]`, true));
        checkLeaves(view.nightlyRun, allowed, "nightlyRun", false);
      }),
      fcParams(),
    );
  });

  it("every date of the view equals the input string it came from", () => {
    fc.assert(
      fc.property(siteInputArb(), (input) => {
        const view = buildSiteView(input);
        view.entries.forEach((e, i) => {
          const source = input.entries[i]!;
          expect(e.analysed).toBe(source.certificate.analysisDate);
          const dates = input.ledger.entries.filter((l) => l.package === source.name).map((l) => l.date);
          expect(e.attempts.map((a) => a.date)).toEqual(dates);
          if (e.nightly.kind === "results") {
            const line = input.nightly?.report?.entries.find((l) => l.package === source.name);
            expect(e.nightly.facts.map((f) => f.fetchedAt)).toEqual(line?.facts.map((f) => f.fetchedAt));
          }
        });
        if (input.nightly !== null) expect(view.nightlyRun?.runStartedAt).toBe(input.nightly.run.runStartedAt);
        else expect(view.nightlyRun).toBeNull();
      }),
      fcParams(),
    );
  });
});
