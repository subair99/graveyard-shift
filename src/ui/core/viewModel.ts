// View model of the Crypt_Site (crypt-ui Requirements 2.4, 3, 4, 5, 6, 12, 13). Pure: no clock, no I/O.
// Every string of the view comes from an input file, a fixed text of texts.ts or a link builder of site.ts.

import type { z } from "zod";
import type { DeathCertificate } from "../../engine/types";
import type { EligibilityRecord } from "../../pipeline/gravedigger/core/eligibility";
import type { DeltasFile } from "../../pipeline/harness/core/deltas";
import type { HarnessFile } from "../../pipeline/harness/core/harnessFile";
import type { Ledger } from "../../pipeline/local/core/ledger";
import type { NightlyResult } from "../../pipeline/undertaker/core/nightlyClassify";
import { ENTRY_FILES, bundleName, type EntryKind, type StubMarker } from "../../pipeline/undertaker/core/layout";
import type { NightlyFact, NightlyReportSchema } from "../../pipeline/undertaker/core/nightlyReport";
import { verifyCommands } from "../../pipeline/undertaker/core/verifyCommands";
import type { ProofReport, Verdict } from "../../proof/types";
import { causeView } from "./causes";
import { nightlyLabel } from "./nightlyLabels";
import type { NightlyRunRecord } from "./nightlyRun";
import { GRAVEYARD_PATH, downloadPath, entryRoute, historyUrl, runUrl } from "./site";
import { NOT_RECORDED, nightlyNoReport, nightlyReportRejected } from "./texts";

/** The accepted Nightly_Report, as the schema infers it (results are the Nightly_Result enum). */
export type AcceptedNightlyReport = z.infer<typeof NightlyReportSchema>;

export interface EntryInput {
  name: string;
  files: string[];
  kind: EntryKind;
  certificate: DeathCertificate;
  eligibility: EligibilityRecord;
  report: ProofReport | null;
  deltas: DeltasFile | null;
  harness: HarnessFile | null;
  stubMarker: StubMarker | null;
  tarballName: string | null;
  resurrectionVersion: string | null;
}

export type NightlyInput =
  | { run: NightlyRunRecord; report: AcceptedNightlyReport; reportState: "accepted" }
  | { run: NightlyRunRecord; report: null; reportState: "missing" | "rejected" };

export interface SiteInput {
  entries: EntryInput[];
  ledger: Ledger;
  nightly: NightlyInput | null;
}

export type Outcome = "alive" | "restless" | "inconclusive" | "not-resurrected";

export interface AttemptRow {
  date: string;
  mode: "local" | "stub";
  version: string;
  exitCode: string;
  creditBefore: string;
  creditAfter: string;
}

export type NightlyEntryView =
  | { kind: "none-in-build" }
  | { kind: "ended-without-report" }
  | { kind: "report-rejected" }
  | { kind: "no-line" }
  | {
      kind: "results";
      results: { code: NightlyResult; label: string }[];
      reason: string;
      facts: NightlyFact[];
      firstDiffPath: string | null;
    };

export interface NightlyRunView {
  runId: number;
  runUrl: string;
  runStartedAt: string;
  conclusion: string;
  headSha: string;
  buildSha: string;
  commitsDiffer: boolean;
  state: "results" | "ended-without-report" | "report-rejected" | "none-in-build";
  sentence: string | null;
}

export interface EntryView {
  name: string;
  route: string;
  kind: EntryKind;
  outcome: Outcome;
  outcomeLabel: string;
  verdict: Verdict | null;
  stub: boolean;
  originalVersion: string;
  analysed: string;
  causes: { code: string; label: string | null }[];
  resurrectionVersion: string | null;
  certificate: DeathCertificate;
  eligibility: EligibilityRecord;
  report: ProofReport | null;
  deltas: DeltasFile | null;
  bundles: { subject: string; file: string; present: boolean }[];
  unexpectedBundles: string[];
  verifyCommands: string[];
  downloads: { file: string; href: string }[];
  historyUrl: string;
  attempts: AttemptRow[];
  nightly: NightlyEntryView;
}

export interface SiteView {
  entries: EntryView[];
  nightlyRun: NightlyRunView | null;
}

const BUNDLE_SUFFIX = ".sigstore.json";

function outcomeLabelOf(outcome: Outcome): string {
  return outcome === "not-resurrected" ? "not resurrected" : outcome;
}

function buildNightlyRunView(nightly: NightlyInput | null): NightlyRunView | null {
  if (nightly === null) return null;
  const { run } = nightly;
  const link = runUrl(run.runId);
  let state: NightlyRunView["state"];
  let sentence: string | null = null;
  if (nightly.reportState === "accepted") {
    state = "results";
  } else if (nightly.reportState === "rejected") {
    state = "report-rejected";
    sentence = nightlyReportRejected(link, run.runStartedAt, run.conclusion);
  } else if (run.conclusion !== "success") {
    state = "ended-without-report";
    sentence = nightlyNoReport(link, run.runStartedAt, run.conclusion);
  } else {
    state = "none-in-build";
  }
  return {
    runId: run.runId,
    runUrl: link,
    runStartedAt: run.runStartedAt,
    conclusion: run.conclusion,
    headSha: run.headSha,
    buildSha: run.buildSha,
    commitsDiffer: run.headSha !== run.buildSha,
    state,
    sentence,
  };
}

function buildNightlyEntryView(
  nightly: NightlyInput | null,
  run: NightlyRunView | null,
  name: string,
  verdict: Verdict | null,
): NightlyEntryView {
  if (nightly === null || run === null) return { kind: "none-in-build" };
  if (run.state === "none-in-build") return { kind: "none-in-build" };
  if (run.state === "ended-without-report") return { kind: "ended-without-report" };
  if (run.state === "report-rejected" || nightly.reportState !== "accepted") return { kind: "report-rejected" };
  const line = nightly.report.entries.find((e) => e.package === name);
  if (line === undefined) return { kind: "no-line" };
  return {
    kind: "results",
    results: line.results.map((code) => ({ code, label: nightlyLabel(code, verdict) })),
    reason: line.reason,
    facts: line.facts.map((f) => ({ text: f.text, sourceUrl: f.sourceUrl, fetchedAt: f.fetchedAt })),
    firstDiffPath: line.firstDiffPath,
  };
}

function buildAttempts(ledger: Ledger, name: string): AttemptRow[] {
  const rows: AttemptRow[] = [];
  for (const e of ledger.entries) {
    if (e.package !== name) continue;
    if (e.mode === "local") {
      rows.push({
        date: e.date,
        mode: "local",
        version: e.version,
        exitCode: String(e.exitCode),
        creditBefore: e.creditBefore,
        creditAfter: e.creditAfter,
      });
    } else {
      rows.push({
        date: e.date,
        mode: "stub",
        version: e.version,
        exitCode: NOT_RECORDED,
        creditBefore: NOT_RECORDED,
        creditAfter: NOT_RECORDED,
      });
    }
  }
  return rows;
}

function buildEntryView(entry: EntryInput, input: SiteInput, run: NightlyRunView | null): EntryView {
  const verdict: Verdict | null = entry.kind === "resurrection" && entry.report !== null ? entry.report.verdict : null;
  const outcome: Outcome = verdict ?? "not-resurrected";
  const alive = verdict === "alive";

  const subjects: string[] = [];
  if (alive) {
    if (entry.tarballName !== null) subjects.push(entry.tarballName);
    subjects.push(ENTRY_FILES.proofReport, ENTRY_FILES.certificate);
  }
  const bundles = subjects.map((subject) => ({
    subject,
    file: bundleName(subject),
    present: entry.files.includes(bundleName(subject)),
  }));

  return {
    name: entry.name,
    route: entryRoute(entry.name),
    kind: entry.kind,
    outcome,
    outcomeLabel: outcomeLabelOf(outcome),
    verdict,
    stub: entry.stubMarker !== null,
    originalVersion: entry.certificate.package.version,
    analysed: entry.certificate.analysisDate,
    causes: entry.certificate.causes.map((c) => causeView(c)),
    resurrectionVersion: entry.kind === "resurrection" ? entry.resurrectionVersion : null,
    certificate: entry.certificate,
    eligibility: entry.eligibility,
    report: entry.report,
    deltas: entry.deltas,
    bundles,
    unexpectedBundles: alive ? [] : entry.files.filter((f) => f.endsWith(BUNDLE_SUFFIX)),
    verifyCommands: alive
      ? verifyCommands({ subjects: subjects.map((name) => ({ name })), prefix: `${GRAVEYARD_PATH}/${entry.name}/` })
      : [],
    downloads: entry.files.map((file) => ({ file, href: downloadPath(entry.name, file) })),
    historyUrl: historyUrl(entry.name),
    attempts: buildAttempts(input.ledger, entry.name),
    nightly: buildNightlyEntryView(input.nightly, run, entry.name, verdict),
  };
}

/** Total over valid input: reads no clock, does no I/O, copies no computed figure. */
export function buildSiteView(input: SiteInput): SiteView {
  const nightlyRun = buildNightlyRunView(input.nightly);
  return {
    entries: input.entries.map((e) => buildEntryView(e, input, nightlyRun)),
    nightlyRun,
  };
}
