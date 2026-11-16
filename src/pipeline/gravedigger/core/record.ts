// Builds the Eligibility_Record from observed data (R2.2, R2.3, R2.5 to R2.8). Pure.

import type { DeathCertificate, Fact } from "../../../engine/types";
import type { EligibilityRecord } from "./eligibility";
import { evaluateRules } from "./rules";
import type { PackageJsonLike, RuleResult } from "./rules";

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

function buildFacts(i: BuildRecordInput, rules: readonly RuleResult[]): Fact[] {
  const at = i.fetchedAt;
  const packument = [{ sourceUrl: i.packumentUrl, fetchedAt: at }];
  const tarball = [{ sourceUrl: i.tarballUrl, fetchedAt: at }];
  const facts: Fact[] = [
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
  // The open-vulnerability observation comes from the certificate, not from the registry packument
  // or the tarball. Its Source_URL and Fetch_Date are the ones the Coroner recorded for the
  // `openVulnerabilities` fact (the OSV query, autopsy-engine R3.2, R3.3), never the Gravedigger's clock.
  const osvFact = i.cert.facts.find((f) => f.key === "openVulnerabilities");
  const open = rules.find((r) => r.rule === "open-vulnerability");
  if (osvFact !== undefined && osvFact.provenance.length > 0 && open !== undefined && open.reason !== "unverified") {
    facts.push({
      key: "rule.open-vulnerability",
      value: open.observed,
      provenance: osvFact.provenance.map((p) => ({ sourceUrl: p.sourceUrl, fetchedAt: p.fetchedAt })),
      ...(osvFact.stale === true ? { stale: true } : {}),
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
