import { NO_GITHUB_REPOSITORY_REASON, NO_SCORECARD_REASON } from "../reasons";
import {
  ProvenanceSchema,
  type CauseOfDeath,
  type DeathCertificate,
  type Fact,
  type Maybe,
  type Provenance,
  type SourceName,
  type SourceResult,
  type Vulnerability,
  type VitalSigns,
} from "../types";
import { detectCauses, filterOpenVulnerabilities, type VulnerabilityRecord } from "./causes";
import { computeRisk } from "./risk";
import { assignStatus } from "./status";
import type { LookupRecord } from "./successor";
import { NO_PUBLISH_DATE_REASON, timeOfDeath } from "./timeOfDeath";

/**
 * Certificate assembly (Requirements 3, 4, 6, 7, 8). Pure: it reads no clock,
 * environment or random value. The Analysis_Date is an explicit argument.
 *
 * Every list in the returned certificate is already in its documented order
 * (design.md "Serializer" ordering table), so the serializer only emits keys in order:
 * - causes: fixed order (from detectCauses)
 * - open vulnerabilities and `openVulnerabilityIds`: id (code point), then first alias
 * - vulnerability aliases: code point, unique
 * - maintainers: registry order, untouched
 * - facts: key (code point), then first provenance sourceUrl
 * - provenance entries: sourceUrl, then fetchedAt, unique, at most 20
 * - risk contributions and unavailable signs: as ordered by computeRisk
 * - omitted facts: key (code point), unique
 */

// ---------------------------------------------------------------------------
// Signals: the normalized, per-source input of the pure core
// ---------------------------------------------------------------------------

/** npm packument data for the analyzed version. */
export interface NpmSignal {
  /** npm usernames in registry order. An empty list means the registry reported none. */
  maintainers: readonly string[];
  /** The registry `time` map (may include `created` and `modified`, which are ignored). */
  time: Readonly<Record<string, string>>;
  /** Full npm deprecation message of the analyzed version, when deprecated. */
  deprecation?: string;
}

/** One OSV vulnerability, normalized by the OSV client. */
export interface OsvVulnerability {
  id: string;
  aliases: readonly string[];
  summary: string;
  severity?: string;
  /** Every `fixed` version OSV lists across the affected ranges. */
  fixedVersions: readonly string[];
}

/** GitHub repository data. `pushedAt` is null or undefined when GitHub reports none. */
export interface GitHubSignal {
  archived: boolean;
  pushedAt?: string | null;
}

/** GitHub was not called, for example because the repository is not on github.com. */
export interface GitHubSkipped {
  status: "skipped";
  reason: string;
}

/**
 * Normalized signals for one package. Each `SourceResult` carries its provenance
 * (`ok`) or the attempted URL and time (`unavailable`), as produced by the source clients.
 *
 * - `npm`: `not-found` is treated as unavailable (the orchestrator normally stops earlier).
 * - `scorecard`: `null` means deps.dev holds no Scorecard; it is reported as unavailable
 *   with the reason "no scorecard".
 * - `github`: `skipped` records `notes.githubSkippedReason`.
 * - `successor`: the outcome of `findSuccessor` (the Successor and every lookup record).
 * - `publishedVersions`: versions published on npm, used to decide whether an OSV fix is installable.
 * - `githubTokenUsed`: whether the GitHub request was sent with a token.
 */
export interface Signals {
  name: string;
  version: string;
  publishedVersions: readonly string[];
  npm: SourceResult<NpmSignal>;
  osv: SourceResult<readonly OsvVulnerability[]>;
  scorecard: SourceResult<number | null>;
  dependents: SourceResult<number>;
  weeklyDownloads: SourceResult<number>;
  github: SourceResult<GitHubSignal> | GitHubSkipped;
  successor: { successor?: string; lookups: readonly LookupRecord[] };
  githubTokenUsed: boolean;
}

export const MISSING_PROVENANCE = "missing-provenance" as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareCodePoint(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** `YYYY-MM-DDTHH:mm:ssZ`, milliseconds truncated. */
function formatSecond(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** Valid, unique provenance entries ordered by sourceUrl then fetchedAt, at most 20. */
function cleanProvenance(entries: readonly Provenance[]): Provenance[] {
  const seen = new Set<string>();
  const valid: Provenance[] = [];
  for (const e of entries) {
    const parsed = ProvenanceSchema.safeParse(e);
    if (!parsed.success) continue;
    const id = JSON.stringify([parsed.data.sourceUrl, parsed.data.fetchedAt]);
    if (seen.has(id)) continue;
    seen.add(id);
    valid.push({ sourceUrl: parsed.data.sourceUrl, fetchedAt: parsed.data.fetchedAt });
  }
  valid.sort(
    (a, b) => compareCodePoint(a.sourceUrl, b.sourceUrl) || compareCodePoint(a.fetchedAt, b.fetchedAt),
  );
  return valid.slice(0, 20);
}

function okProvenance(r: SourceResult<unknown>): Provenance[] {
  return r.status === "ok" ? r.provenance : [];
}

function isStale(...results: SourceResult<unknown>[]): boolean {
  return results.some((r) => r.status === "ok" && r.stale === true);
}

/** Collects Facts and the keys of Facts omitted for missing provenance (R3.6). */
class FactBuilder {
  readonly facts: Fact[] = [];
  private readonly omitted = new Set<string>();

  add(key: string, value: unknown, provenance: readonly Provenance[], stale = false): void {
    const cleaned = cleanProvenance(provenance);
    if (cleaned.length === 0) {
      this.omitted.add(key);
      return;
    }
    this.facts.push({ key, value, provenance: cleaned, ...(stale ? { stale: true } : {}) });
  }

  sortedFacts(): Fact[] {
    return [...this.facts].sort(
      (a, b) =>
        compareCodePoint(a.key, b.key) ||
        compareCodePoint(a.provenance[0]?.sourceUrl ?? "", b.provenance[0]?.sourceUrl ?? ""),
    );
  }

  omittedFacts(): { key: string; reason: typeof MISSING_PROVENANCE }[] {
    return [...this.omitted]
      .sort(compareCodePoint)
      .map((key) => ({ key, reason: MISSING_PROVENANCE }));
  }
}

function unavailable(
  source: SourceName,
  attemptedUrl: string,
  attemptedAt: string,
  reason: string,
  rateLimitResetAt?: string,
): Maybe<never> {
  return {
    available: false,
    source,
    attemptedUrl,
    attemptedAt,
    reason,
    ...(rateLimitResetAt !== undefined ? { rateLimitResetAt } : {}),
  };
}

/** Maps a source result to a Maybe. `ok` values go through `pick`, which may return `undefined` to mark "no value". */
function toMaybe<T, U>(
  result: SourceResult<T>,
  source: SourceName,
  fallbackAt: string,
  pick: (value: T) => U | { noValue: string },
): Maybe<U> {
  if (result.status === "unavailable") {
    return unavailable(
      result.source,
      result.attemptedUrl,
      result.attemptedAt,
      result.reason,
      result.rateLimitResetAt,
    );
  }
  if (result.status === "not-found") {
    return unavailable(result.source, result.url, result.fetchedAt, "not found");
  }
  const picked = pick(result.value);
  if (typeof picked === "object" && picked !== null && "noValue" in picked) {
    const first = cleanProvenance(result.provenance)[0];
    return unavailable(
      source,
      first?.sourceUrl ?? "",
      first?.fetchedAt ?? fallbackAt,
      (picked as { noValue: string }).noValue,
    );
  }
  return { available: true, value: picked as U };
}

function dedupeSortedVulnerabilities(records: readonly OsvVulnerability[]): Vulnerability[] {
  const normalized = records.map((r) => {
    const aliases = [...new Set(r.aliases)].sort(compareCodePoint);
    const v: Vulnerability = {
      id: r.id,
      aliases,
      summary: r.summary,
      ...(r.severity !== undefined ? { severity: r.severity } : {}),
    };
    return v;
  });
  normalized.sort(
    (a, b) =>
      compareCodePoint(a.id, b.id) ||
      compareCodePoint(a.aliases[0] ?? "", b.aliases[0] ?? "") ||
      compareCodePoint(a.summary, b.summary),
  );
  const out: Vulnerability[] = [];
  for (const v of normalized) {
    if (out.length === 0 || (out[out.length - 1] as Vulnerability).id !== v.id) out.push(v);
  }
  return out;
}

/**
 * Fact for one successor lookup (R4.2, R3.1). Values: `{ result: "exists" }`,
 * `{ result: "not-found" }`, `{ result: "unavailable", reason }`. Each carries the
 * lookup's own provenance: the requested URL and response time (ok, not-found) or the
 * attempted URL and attempt time (unavailable).
 *
 * The injected lookup never throws (the orchestrator wraps errors into `unavailable`).
 * A `threw` record is only a defensive path: it has no URL or time, so its Fact is
 * omitted and reported in `notes.omittedFacts`.
 */
function lookupFact(record: LookupRecord): { value: unknown; provenance: Provenance[]; stale: boolean } {
  if (record.outcome === "threw") {
    return { value: { result: "unavailable", reason: record.error }, provenance: [], stale: false };
  }
  const r = record.result;
  if (r.status === "ok") {
    return { value: { result: "exists" }, provenance: r.provenance, stale: r.stale === true };
  }
  if (r.status === "unavailable") {
    return {
      value: { result: "unavailable", reason: r.reason },
      provenance: [{ sourceUrl: r.attemptedUrl, fetchedAt: r.attemptedAt }],
      stale: false,
    };
  }
  return {
    value: { result: "not-found" },
    provenance: [{ sourceUrl: r.url, fetchedAt: r.fetchedAt }],
    stale: false,
  };
}

// ---------------------------------------------------------------------------
// buildCertificate
// ---------------------------------------------------------------------------

export function buildCertificate(signals: Signals, analysisDate: Date): DeathCertificate {
  const fallbackAt = formatSecond(analysisDate);
  const facts = new FactBuilder();
  const { npm, osv, scorecard, dependents, weeklyDownloads, github } = signals;

  // --- Vital signs -------------------------------------------------------
  const maintainers = toMaybe(npm, "npm", fallbackAt, (v) => [...v.maintainers]);

  const osvRecords: VulnerabilityRecord[] | undefined =
    osv.status === "ok" ? osv.value.map((v) => ({ id: v.id, fixedVersions: v.fixedVersions })) : undefined;
  const openIds =
    osv.status === "ok" && osvRecords !== undefined
      ? filterOpenVulnerabilities(osvRecords, signals.version, signals.publishedVersions)
      : [];
  const openIdSet = new Set(openIds);
  const openVulnerabilities = toMaybe(osv, "osv", fallbackAt, (all) =>
    dedupeSortedVulnerabilities(all.filter((v) => openIdSet.has(v.id))),
  );

  const scorecardSign = toMaybe(scorecard, "deps.dev", fallbackAt, (v) =>
    v === null ? { noValue: NO_SCORECARD_REASON } : v,
  );
  const dependentsSign = toMaybe(dependents, "deps.dev", fallbackAt, (v) => v);
  const downloadsSign = toMaybe(weeklyDownloads, "npm", fallbackAt, (v) => v);

  const vitalSigns: VitalSigns = {
    maintainers,
    openVulnerabilities,
    scorecard: scorecardSign,
    dependents: dependentsSign,
    weeklyDownloads: downloadsSign,
  };

  // --- Time of death -----------------------------------------------------
  let timeOfDeathSign: Maybe<string>;
  let daysSinceDeath: number | undefined;
  if (npm.status === "ok") {
    const tod = timeOfDeath({ ...npm.value.time }, analysisDate);
    if ("timeOfDeath" in tod) {
      timeOfDeathSign = { available: true, value: tod.timeOfDeath };
      daysSinceDeath = tod.daysSince;
    } else {
      const first = cleanProvenance(npm.provenance)[0];
      timeOfDeathSign = unavailable("npm", first?.sourceUrl ?? "", first?.fetchedAt ?? fallbackAt, NO_PUBLISH_DATE_REASON);
    }
  } else {
    timeOfDeathSign = toMaybe(npm, "npm", fallbackAt, () => "");
  }

  // --- Causes, risk, status ----------------------------------------------
  const githubOk = github.status === "ok" ? github : undefined;
  const githubNoData = unavailable(
    "github",
    github.status === "unavailable" ? github.attemptedUrl : "",
    github.status === "unavailable" ? github.attemptedAt : fallbackAt,
    github.status === "skipped" ? github.reason : github.status === "unavailable" ? github.reason : "not found",
  );
  const causes: CauseOfDeath[] = detectCauses(
    {
      maintainers,
      archived: githubOk ? { available: true, value: githubOk.value.archived } : githubNoData,
      openVulnerabilityIds: openVulnerabilities.available
        ? { available: true, value: openIds }
        : openVulnerabilities,
      timeOfDeath: timeOfDeathSign,
      lastPush: githubOk ? { available: true, value: githubOk.value.pushedAt } : githubNoData,
    },
    analysisDate,
  );

  const { riskScore, risk } = computeRisk({ causes, vitalSigns });

  const successor = signals.successor.successor;
  const deprecation = npm.status === "ok" ? npm.value.deprecation : undefined;
  const statusResult = assignStatus({
    ...(successor !== undefined ? { successor } : {}),
    ...(deprecation !== undefined ? { deprecation } : {}),
    causes,
    risk: riskScore,
  });

  // --- Facts -------------------------------------------------------------
  if (maintainers.available) {
    facts.add("maintainers", maintainers.value, okProvenance(npm), isStale(npm));
  }
  if (openVulnerabilities.available) {
    const usesPublished = osv.status === "ok" && osv.value.some((v) => v.fixedVersions.length > 0);
    facts.add(
      "openVulnerabilities",
      openVulnerabilities.value,
      [...okProvenance(osv), ...(usesPublished ? okProvenance(npm) : [])],
      isStale(osv, ...(usesPublished ? [npm] : [])),
    );
  }
  if (scorecardSign.available) facts.add("scorecard", scorecardSign.value, okProvenance(scorecard), isStale(scorecard));
  if (dependentsSign.available) facts.add("dependents", dependentsSign.value, okProvenance(dependents), isStale(dependents));
  if (downloadsSign.available) {
    facts.add("weeklyDownloads", downloadsSign.value, okProvenance(weeklyDownloads), isStale(weeklyDownloads));
  }
  if (timeOfDeathSign.available) {
    facts.add("timeOfDeath", timeOfDeathSign.value, okProvenance(npm), isStale(npm));
  }
  if (githubOk) {
    facts.add(
      "githubRepo",
      { archived: githubOk.value.archived, pushedAt: githubOk.value.pushedAt ?? null },
      githubOk.provenance,
      githubOk.stale === true,
    );
  }
  for (const record of signals.successor.lookups) {
    const f = lookupFact(record);
    facts.add(`successorLookup:${record.name}`, f.value, f.provenance, f.stale);
  }
  if (successor !== undefined && successor.length > 0) {
    const confirming = signals.successor.lookups.find(
      (l) => l.name === successor && l.outcome === "result" && l.result.status === "ok",
    );
    const f = confirming ? lookupFact(confirming) : { provenance: [], stale: false };
    facts.add("successor", successor, f.provenance, f.stale);
  }
  if ("status" in statusResult && statusResult.deprecationMessage !== undefined) {
    facts.add("deprecation", statusResult.deprecationMessage, okProvenance(npm), isStale(npm));
  }

  const certificate: DeathCertificate = {
    schemaVersion: 1,
    package: { name: signals.name, version: signals.version },
    analysisDate: fallbackAt,
    ...("status" in statusResult ? { status: statusResult.status } : { statusError: statusResult.error }),
    causes,
    openVulnerabilityIds: openIds,
    timeOfDeath: timeOfDeathSign,
    ...(daysSinceDeath !== undefined ? { daysSinceDeath } : {}),
    vitalSigns,
    ...(successor !== undefined && successor.length > 0 ? { successor } : {}),
    riskScore,
    risk,
    facts: facts.sortedFacts(),
    notes: {
      githubTokenUsed: signals.githubTokenUsed,
      ...(github.status === "skipped"
        ? { githubSkippedReason: github.reason.length > 0 ? github.reason : NO_GITHUB_REPOSITORY_REASON }
        : {}),
      omittedFacts: facts.omittedFacts(),
    },
  };
  return certificate;
}
