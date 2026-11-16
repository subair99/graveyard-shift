// Builds the Eligibility_Record from observed data (R2.2, R2.3, R2.5 to R2.8). Pure.

import type { DeathCertificate, Fact, Provenance } from "../../../engine/types";
import { compareCodePoints } from "../../common/canonical";
import type { EligibilityRecord, RecordFact } from "./eligibility";
import { CAUSE_INPUTS, evaluateRules } from "./rules";
import type { PackageJsonLike, RuleId, RuleResult } from "./rules";

export interface BuildRecordInput {
  name: string;
  version: string;
  cert: DeathCertificate;
  /** `dist.integrity` of the packument. */
  expectedIntegrity: string;
  /** sha512 SRI of the tarball bytes; null when no tarball was fetched. */
  computedIntegrity: string | null;
  /** `package.json` of the tarball; null on an integrity mismatch or when unreadable. */
  pkg: PackageJsonLike | null;
  /** Lines of the text files of the tarball; null on an integrity mismatch. */
  lineCount: number | null;
  packumentUrl: string;
  tarballUrl: string;
  /** The single clock read, `YYYY-MM-DDTHH:mm:ssZ`, used for every Fetch_Date. */
  fetchedAt: string;
}

// Certificate facts read by the engine when it derives each certificate field that a rule reads
// (src/engine/core/certificate.ts, buildCertificate):
// - `causes` comes from detectCauses over maintainers, the GitHub archived flag and last push
//   (`githubRepo`), the open vulnerabilities and the Time_Of_Death.
// - the risk score comes from computeRisk over the causes and the five Vital_Signs.
// - `status` comes from assignStatus over the Successor (`successor` and every
//   `successorLookup:<name>`), the deprecation message (`deprecation`), the causes and the risk score.
// - `openVulnerabilityIds` is the `openVulnerabilities` fact.
const CAUSE_FACT_KEYS: readonly string[] = CAUSE_INPUTS;
const RISK_FACT_KEYS = ["maintainers", "openVulnerabilities", "scorecard", "dependents", "weeklyDownloads"];
const STATUS_FACT_KEYS = new Set(["successor", "deprecation", ...CAUSE_FACT_KEYS, ...RISK_FACT_KEYS]);
const SUCCESSOR_LOOKUP_PREFIX = "successorLookup:";

/** Certificate fact keys that contributed to the certificate field read by each certificate rule. */
export function contributesTo(rule: RuleId, factKey: string): boolean {
  switch (rule) {
    case "status":
      return STATUS_FACT_KEYS.has(factKey) || factKey.startsWith(SUCCESSOR_LOOKUP_PREFIX);
    case "causes":
      return CAUSE_FACT_KEYS.includes(factKey);
    case "open-vulnerability":
      return factKey === "openVulnerabilities";
    default:
      return false;
  }
}

/** autopsy-engine R3.4 and the Fact schema: at most 20 provenance entries per Fact. */
export const MAX_PROVENANCE = 20;

/**
 * Union of the provenance of the given facts: each `{sourceUrl, fetchedAt}` pair once, ordered by
 * sourceUrl then fetchedAt (code point), as the engine orders provenance entries. Above 20 entries
 * the first 20 in that order are kept, as the engine does (R3.4 sets 20 as the maximum); the rule
 * fact then records the full count in `provenanceTotal`.
 */
export function unionProvenance(facts: readonly Fact[]): Provenance[] {
  return fullUnion(facts).slice(0, MAX_PROVENANCE);
}

/** The whole union, before the cap; its length is the count of contributing sources. */
function fullUnion(facts: readonly Fact[]): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const f of facts) {
    for (const p of f.provenance) {
      const id = JSON.stringify([p.sourceUrl, p.fetchedAt]);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ sourceUrl: p.sourceUrl, fetchedAt: p.fetchedAt });
    }
  }
  out.sort((a, b) => compareCodePoints(a.sourceUrl, b.sourceUrl) || compareCodePoints(a.fetchedAt, b.fetchedAt));
  return out;
}

const FROM_CERTIFICATE: readonly RuleId[] = ["status", "causes", "open-vulnerability"];

function buildFacts(i: BuildRecordInput, rules: readonly RuleResult[]): RecordFact[] {
  const at = i.fetchedAt;
  const packument = [{ sourceUrl: i.packumentUrl, fetchedAt: at }];
  const tarball = [{ sourceUrl: i.tarballUrl, fetchedAt: at }];
  const facts: RecordFact[] = [
    { key: "integrity.expected", value: i.expectedIntegrity, provenance: packument },
  ];
  if (i.computedIntegrity !== null) {
    facts.push({ key: "integrity.computed", value: i.computedIntegrity, provenance: tarball });
  }
  // Rule observations that come from the tarball. Unverified rules have no observed value.
  const fromTarball = new Set(["license", "dependencies", "module-type", "line-count"]);
  for (const r of rules) {
    if (r.reason === "unverified" || !fromTarball.has(r.rule)) continue;
    facts.push({ key: `rule.${r.rule}`, value: r.observed, provenance: tarball });
  }
  // The status, causes and open-vulnerability observations come from the certificate, not from the
  // registry packument or the tarball. Their provenance is the union of the provenance the Coroner
  // recorded for the contributing certificate facts (autopsy-engine R3.2 to R3.4), never the
  // Gravedigger's clock. No contributing fact (all omitted for missing provenance) means no fact.
  for (const r of rules) {
    if (r.reason === "unverified" || !FROM_CERTIFICATE.includes(r.rule)) continue;
    const contributing = i.cert.facts.filter((f) => contributesTo(r.rule, f.key));
    const all = fullUnion(contributing);
    if (all.length === 0) continue;
    facts.push({
      key: `rule.${r.rule}`,
      value: r.observed,
      provenance: all.slice(0, MAX_PROVENANCE),
      // Written only when entries were dropped, so the record says how many sources contributed.
      ...(all.length > MAX_PROVENANCE ? { provenanceTotal: all.length } : {}),
      ...(contributing.some((f) => f.stale === true) ? { stale: true } : {}),
    });
  }
  return facts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function buildEligibilityRecord(i: BuildRecordInput): EligibilityRecord {
  const matches = i.computedIntegrity !== null && i.computedIntegrity === i.expectedIntegrity;
  const mismatch = i.computedIntegrity !== null && !matches;
  // After a mismatch the tarball content is not trusted, so no rule reads it (R2.2).
  const pkg = matches ? i.pkg : null;
  const lineCount = matches ? i.lineCount : null;
  const rules = evaluateRules({ pkg, lineCount, cert: i.cert });
  const failedRules = rules.filter((r) => !r.holds).map((r) => r.rule);
  const record: EligibilityRecord = {
    schemaVersion: 1,
    package: { name: i.name, version: i.version },
    eligible: matches && failedRules.length === 0,
    integrity: { expected: i.expectedIntegrity, computed: i.computedIntegrity, matches },
    rules,
    failedRules,
    facts: buildFacts({ ...i, pkg, lineCount }, rules),
  };
  if (mismatch) record.reason = "integrity-mismatch";
  if (i.cert.status === "retired-with-successor" && i.cert.successor !== undefined) {
    record.successor = i.cert.successor;
  }
  return record;
}
