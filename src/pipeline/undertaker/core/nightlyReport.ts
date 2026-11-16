// Nightly report: nightly-report.json and the job summary (R16.10, R16.14, R16.15, R23.14). Pure.
// One line per package. Every text passes redactText. The module reads no clock and states no number
// that was not measured: dates and versions come from the caller.

import { REPO, GH_MIN_VERSION } from "../../common/constants";
import { canonicalJsonText, redactText } from "../../common/canonical";
import type { IdentityValues, Platform } from "../../common/canonical";
import { differingToolFields, nightlyOrder } from "./nightlyClassify";
import type { NightlyResult, ToolVersionField, ToolVersions } from "./nightlyClassify";

/** A fact about the registry or an advisory; it always carries its Source_URL and Fetch_Date. */
export interface NightlyFact {
  readonly text: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
}

export interface NightlyEntryInput {
  readonly package: string;
  readonly results: readonly NightlyResult[];
  /** Why the entry got these results; when absent a default text for the primary result is used. */
  readonly reason?: string;
  readonly stub: boolean;
  readonly committedTools: ToolVersions | null;
  readonly runningTools: ToolVersions;
  /** First differing path of a replay mismatch (R16.8). */
  readonly firstDiffPath?: string;
  readonly facts?: readonly NightlyFact[];
}

export interface NightlyReportInput {
  readonly entries: readonly NightlyEntryInput[];
  /** Output of `gh --version` (first line), or null when it could not be read. */
  readonly ghVersion: string | null;
  readonly identity: IdentityValues;
  readonly platform: Platform;
}

export interface NightlyReportEntry {
  readonly package: string;
  readonly results: string[];
  readonly reason: string;
  readonly stub: boolean;
  readonly committedTools: ToolVersions | null;
  readonly runningTools: ToolVersions;
  readonly differingToolFields: ToolVersionField[];
  readonly firstDiffPath: string | null;
  readonly facts: NightlyFact[];
}

/**
 * Counts over the entries. `checkable` is the number of entries that were supposed to be checked: every entry
 * except a not-resurrected one (nothing to replay or attest) that got no `not-checked`. `notChecked` is the number
 * of entries with the result `not-checked`.
 */
export interface NightlyCounts {
  readonly total: number;
  readonly checkable: number;
  readonly notChecked: number;
}

export interface NightlyReport {
  readonly repo: string;
  readonly ghVersion: string | null;
  readonly ghMinVersion: string;
  readonly counts: NightlyCounts;
  readonly entries: NightlyReportEntry[];
}

/** Counts of a list of entries (pure). */
export function countNightlyEntries(entries: readonly { readonly results: readonly string[] }[]): NightlyCounts {
  const notChecked = entries.filter((e) => e.results.includes("not-checked")).length;
  const checkable = entries.filter((e) => e.results.includes("not-checked") || !e.results.includes("not-resurrected")).length;
  return { total: entries.length, checkable, notChecked };
}

/** True when at least one entry was to be checked and every one of them got `not-checked`: nothing was verified. */
export function allNotChecked(counts: NightlyCounts): boolean {
  return counts.checkable > 0 && counts.notChecked === counts.checkable;
}

/** Escapes the data of a GitHub Actions workflow command (`::warning::data`): `%`, CR and LF (workflow-commands rules). */
export function escapeWorkflowCommandData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/**
 * The `::warning::` line for one entry whose check could not be completed: package, reason and entry path,
 * redacted first and escaped second.
 */
export function renderNotCheckedWarning(
  pkg: string,
  entryPath: string,
  reason: string,
  identity: IdentityValues,
  platform: Platform,
): string {
  const text = `${pkg} not-checked (${entryPath}): ${reason}`;
  return `::warning::${escapeWorkflowCommandData(redactText(text, identity, platform))}`;
}

/** The line for a missing or empty graveyard/ (R16.24): the normal state before the first entry is merged. */
export const NO_ENTRIES_TEXT = "No entries in the graveyard: nothing to verify.";

/** The `::notice::` line for an empty graveyard, redacted first and escaped second. */
export function renderNoEntriesNotice(identity: IdentityValues, platform: Platform): string {
  return `::notice::${escapeWorkflowCommandData(redactText(NO_ENTRIES_TEXT, identity, platform))}`;
}

const DEFAULT_REASONS: Readonly<Record<NightlyResult, string>> = {
  verified: "Replay identical and attestations verified.",
  "replay-mismatch": "The Replay produced a report that differs from the committed one.",
  "tool-versions-changed": "The running Tool_Versions differ from the committed ones; the Replay was not run.",
  "attestation-failed": "An attestation did not verify or fewer than three results were found.",
  "unexpected-attestation": "Attestation bundles exist for an entry that is not alive.",
  "new-advisory": "The Coroner found an advisory that the committed certificate does not list.",
  "not-resurrected": "Not-resurrected entry; nothing to replay or attest.",
  "not-checked": "The Replay could not be completed.",
};

function redactDeep<T>(value: T, identity: IdentityValues, platform: Platform): T {
  if (typeof value === "string") return redactText(value, identity, platform) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, identity, platform)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[redactText(k, identity, platform)] = redactDeep(v, identity, platform);
    }
    return out as T;
  }
  return value;
}

/** Builds the report object (fixed key order, entries in code point order of the package name, redacted). */
export function buildNightlyReport(input: NightlyReportInput): NightlyReport {
  const byName = new Map(input.entries.map((e) => [e.package, e] as const));
  const entries: NightlyReportEntry[] = nightlyOrder([...byName.keys()]).map((name) => {
    const e = byName.get(name) as NightlyEntryInput;
    const primary = e.results[0];
    return {
      package: e.package,
      results: [...e.results],
      reason: e.reason ?? (primary === undefined ? "" : DEFAULT_REASONS[primary]),
      stub: e.stub,
      committedTools: e.committedTools,
      runningTools: e.runningTools,
      differingToolFields: differingToolFields(e.committedTools, e.runningTools),
      firstDiffPath: e.firstDiffPath ?? null,
      facts: (e.facts ?? []).map((f) => ({ text: f.text, sourceUrl: f.sourceUrl, fetchedAt: f.fetchedAt })),
    };
  });
  const report: NightlyReport = {
    repo: REPO,
    ghVersion: input.ghVersion,
    ghMinVersion: GH_MIN_VERSION,
    counts: countNightlyEntries(entries),
    entries,
  };
  return redactDeep(report, input.identity, input.platform);
}

/** `nightly-report.json`: canonical JSON of the report plus a final newline. */
export function renderNightlyReportJson(report: NightlyReport): string {
  return `${canonicalJsonText(report)}\n`;
}

function toolsText(t: ToolVersions | null): string {
  return t === null ? "none recorded" : `node ${t.node}, fast-check ${t.fastCheck}, report schema ${t.reportSchema}`;
}

/** One summary line for an entry of an already redacted report. */
export function renderNightlyLine(e: NightlyReportEntry): string {
  const parts = [
    `${e.package}: ${e.results.join(", ")}`,
    `reason: ${e.reason}`,
    `committed Tool_Versions: ${toolsText(e.committedTools)}`,
    `running Tool_Versions: ${toolsText(e.runningTools)}`,
  ];
  if (e.stub) parts.push("stub run");
  if (e.firstDiffPath !== null) parts.push(`first differing path: ${e.firstDiffPath}`);
  for (const f of e.facts) parts.push(`${f.text} (source: ${f.sourceUrl}, fetched ${f.fetchedAt})`);
  return `- ${parts.join("; ")}`;
}

/** The job summary (markdown): the `gh` version line, then one line per package. */
export function renderNightlySummary(report: NightlyReport): string {
  const gh = report.ghVersion === null ? "gh version: unknown" : `gh version: ${report.ghVersion}`;
  const lines = [
    "# Nightly re-verification",
    "",
    `${gh} (minimum ${report.ghMinVersion})`,
    "",
    `Entries: ${report.counts.total} total, ${report.counts.notChecked} not-checked.`,
    ...(allNotChecked(report.counts)
      ? [`All ${report.counts.checkable} entries not-checked: nothing was verified tonight.`]
      : []),
    "",
    ...(report.entries.length === 0 ? [NO_ENTRIES_TEXT] : report.entries.map(renderNightlyLine)),
  ];
  return `${lines.join("\n")}\n`;
}
