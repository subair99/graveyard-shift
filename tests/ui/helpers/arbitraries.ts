// Shared generators of the crypt-ui property tests (tasks 3.2 to 3.6). No I/O, no clock.
// `siteInputArb` makes a SiteInput with entries of every kind and Verdict, any ledger and, optionally, a Nightly_Input.
// The parsed files that the view model copies unread (certificate, eligibility, report, deltas, harness) are
// partial objects with only the fields that `buildSiteView` reads; the cast is local to this module.

import fc from "fast-check";
import type { DeathCertificate } from "../../../src/engine/types";
import type { EligibilityRecord } from "../../../src/pipeline/gravedigger/core/eligibility";
import type { DeltasFile } from "../../../src/pipeline/harness/core/deltas";
import type { HarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import type { Ledger, LedgerEntry } from "../../../src/pipeline/local/core/ledger";
import { NIGHTLY_RESULT_ORDER } from "../../../src/pipeline/undertaker/core/nightlyClassify";
import { ENTRY_FILES, bundleName, type EntryKind } from "../../../src/pipeline/undertaker/core/layout";
import type { NightlyFact } from "../../../src/pipeline/undertaker/core/nightlyReport";
import type { ProofReport, Verdict } from "../../../src/proof/types";
import { DOCUMENTED_CONCLUSIONS, type NightlyRunRecord } from "../../../src/ui/core/nightlyRun";
import type {
  AcceptedNightlyReport,
  EntryInput,
  NightlyInput,
  SiteInput,
} from "../../../src/ui/core/viewModel";

/** Free text: binary and grapheme strings, so hostile characters appear; no lone surrogates (names are URL-encoded). */
export const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: "binary", maxLength: 12 }),
  fc.string({ unit: "grapheme", maxLength: 12 }),
  fc.constantFrom("", " ", "javascript:alert(1)", "<script>x</script>", "https://example.com/a", "not provided", "../x"),
);

const nameArb = fc.oneof(
  fc.string({ unit: "binary", minLength: 1, maxLength: 10 }),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 10 }),
  fc.constantFrom("lodash.set", "ip", "@scope/pkg"),
);

const hex40 = fc.stringMatching(/^[0-9a-f]{40}$/);

const CAUSE_CODES = ["maintainer-gone", "repo-archived", "unpatched-cve", "runtime-rot"];
const causeArb = fc.oneof(fc.constantFrom(...CAUSE_CODES), textArb);

const certificateArb = fc
  .record({
    version: textArb,
    analysisDate: textArb,
    causes: fc.array(causeArb, { maxLength: 4 }),
  })
  .map(
    (c) =>
      ({
        package: { name: "x", version: c.version },
        analysisDate: c.analysisDate,
        causes: c.causes,
      }) as unknown as DeathCertificate,
  );

const verdictArb: fc.Arbitrary<Verdict> = fc.constantFrom("alive", "restless", "inconclusive");

interface EntryParts {
  name: string;
  kind: EntryKind;
  verdict: Verdict;
  tarballName: string | null;
  extraFiles: string[];
  baseFiles: string[];
  bundles: string[];
  stub: boolean;
  version: string | null;
  certificate: DeathCertificate;
}

const entryPartsArb: fc.Arbitrary<EntryParts> = fc.record({
  name: nameArb,
  kind: fc.constantFrom<EntryKind>("resurrection", "not-resurrected"),
  verdict: verdictArb,
  tarballName: fc.option(
    textArb.map((t) => `${t}.tgz`),
    { nil: null },
  ),
  extraFiles: fc.array(textArb, { maxLength: 2 }),
  baseFiles: fc.subarray(Object.values(ENTRY_FILES)),
  bundles: fc.subarray([
    bundleName(ENTRY_FILES.proofReport),
    bundleName(ENTRY_FILES.certificate),
    bundleName("resurrection.tgz"),
  ]),
  stub: fc.boolean(),
  version: fc.option(textArb, { nil: null }),
  certificate: certificateArb,
});

function toEntry(p: EntryParts): EntryInput {
  const resurrection = p.kind === "resurrection";
  const tarballName = resurrection ? p.tarballName : null;
  const files = [
    ...p.baseFiles,
    ...(tarballName === null ? [] : [tarballName, bundleName(tarballName)]),
    ...p.bundles,
    ...p.extraFiles,
  ];
  return {
    name: p.name,
    files: [...new Set(files)],
    kind: p.kind,
    certificate: p.certificate,
    eligibility: { eligible: !resurrection } as unknown as EligibilityRecord,
    report: resurrection ? ({ verdict: p.verdict } as unknown as ProofReport) : null,
    deltas: resurrection ? ({} as unknown as DeltasFile) : null,
    harness: resurrection ? ({} as unknown as HarnessFile) : null,
    stubMarker: p.stub ? { schemaVersion: 1, mode: "stub", label: "stub run" } : null,
    tarballName,
    resurrectionVersion: resurrection ? p.version : null,
  };
}

/** Entries with distinct names, in no particular order. */
export const entriesArb: fc.Arbitrary<EntryInput[]> = fc
  .uniqueArray(entryPartsArb, { maxLength: 4, selector: (p) => p.name })
  .map((parts) => parts.map(toEntry));

const ledgerEntryArb = (names: readonly string[]): fc.Arbitrary<LedgerEntry> => {
  const pkg = names.length === 0 ? nameArb : fc.oneof(fc.constantFrom(...names), nameArb);
  return fc.oneof(
    fc.record({
      mode: fc.constant("local" as const),
      package: pkg,
      version: textArb,
      date: textArb,
      creditBefore: textArb,
      creditAfter: textArb,
      exitCode: fc.integer({ min: -1000, max: 1000 }),
      kiroCliVersion: textArb,
    }),
    fc.record({
      mode: fc.constant("stub" as const),
      package: pkg,
      version: textArb,
      date: textArb,
      fixture: textArb,
    }),
  );
};

const factArb: fc.Arbitrary<NightlyFact> = fc.record({
  text: textArb,
  sourceUrl: textArb,
  fetchedAt: textArb,
});

export const runRecordArb: fc.Arbitrary<NightlyRunRecord> = fc.record({
  schemaVersion: fc.constant(1 as const),
  runId: fc.integer({ min: 1, max: 2_000_000_000 }),
  runStartedAt: textArb,
  conclusion: fc.oneof(fc.constantFrom(...DOCUMENTED_CONCLUSIONS), fc.stringMatching(/^[a-z_]{1,32}$/)),
  headSha: hex40,
  buildSha: hex40,
});

const nightlyReportArb = (names: readonly string[]): fc.Arbitrary<AcceptedNightlyReport> => {
  const pkg = names.length === 0 ? nameArb : fc.oneof(fc.constantFrom(...names), nameArb);
  const line = fc.record({
    package: pkg,
    results: fc.subarray([...NIGHTLY_RESULT_ORDER], { minLength: 1 }),
    reason: textArb,
    stub: fc.boolean(),
    committedTools: fc.constant(null),
    runningTools: fc.record({ node: textArb, fastCheck: textArb, reportSchema: fc.integer({ min: 0, max: 9 }) }),
    differingToolFields: fc.constant([] as ("node" | "fastCheck" | "reportSchema")[]),
    firstDiffPath: fc.option(textArb, { nil: null }),
    facts: fc.array(factArb, { maxLength: 2 }),
  });
  return fc.record({
    repo: textArb,
    ghVersion: fc.option(textArb, { nil: null }),
    ghMinVersion: textArb,
    counts: fc.record({
      total: fc.nat({ max: 50 }),
      checkable: fc.nat({ max: 50 }),
      notChecked: fc.nat({ max: 50 }),
    }),
    entries: fc.array(line, { maxLength: 4 }),
  });
};

const nightlyInputArb = (names: readonly string[]): fc.Arbitrary<NightlyInput> =>
  fc.oneof(
    fc.record({
      run: runRecordArb,
      report: nightlyReportArb(names),
      reportState: fc.constant("accepted" as const),
    }),
    fc.record({
      run: runRecordArb,
      report: fc.constant(null),
      reportState: fc.constantFrom("missing" as const, "rejected" as const),
    }),
  );

export interface SiteInputOptions {
  /** `true`: always an accepted Nightly_Input; `false`: never one; default: either, or none. */
  nightly?: "any" | "none" | "accepted";
}

/** SiteInput of any entries (every kind and Verdict), any ledger and, by default, any Nightly_Input or none. */
export function siteInputArb(options: SiteInputOptions = {}): fc.Arbitrary<SiteInput> {
  const mode = options.nightly ?? "any";
  return entriesArb.chain((entries) => {
    const names = entries.map((e) => e.name);
    const ledger: fc.Arbitrary<Ledger> = fc
      .array(ledgerEntryArb(names), { maxLength: 6 })
      .map((list) => ({ schemaVersion: 1 as const, entries: list }));
    const nightly: fc.Arbitrary<NightlyInput | null> =
      mode === "none"
        ? fc.constant(null)
        : mode === "accepted"
          ? nightlyInputArb(names).filter((n) => n.reportState === "accepted")
          : fc.option(nightlyInputArb(names), { nil: null });
    return fc.record({ entries: fc.constant(entries), ledger, nightly });
  });
}
