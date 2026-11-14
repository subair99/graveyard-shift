import type { DeathCertificate } from "../types";

/**
 * Fixed key order per object kind (R10.5). The single source of truth for the
 * key order of every serialized object. Keys absent from an object are skipped.
 */
export const CERTIFICATE_KEY_ORDER = {
  certificate: [
    "schemaVersion",
    "package",
    "analysisDate",
    "status",
    "statusError",
    "causes",
    "openVulnerabilityIds",
    "timeOfDeath",
    "daysSinceDeath",
    "vitalSigns",
    "successor",
    "riskScore",
    "risk",
    "facts",
    "notes",
  ],
  package: ["name", "version"],
  maybe: [
    "available",
    "value",
    "source",
    "attemptedUrl",
    "attemptedAt",
    "reason",
    "rateLimitResetAt",
  ],
  vitalSigns: ["maintainers", "openVulnerabilities", "scorecard", "dependents", "weeklyDownloads"],
  vulnerability: ["id", "aliases", "summary", "severity"],
  risk: ["contributions", "rawScore", "formula", "unavailable", "note"],
  contribution: ["component", "points"],
  formula: ["weights", "thresholds"],
  fact: ["key", "value", "provenance", "stale"],
  provenance: ["sourceUrl", "fetchedAt"],
  notes: ["githubTokenUsed", "githubSkippedReason", "omittedFacts"],
  omittedFact: ["key", "reason"],
} as const;

/** Fixed cause order (R10.4). */
export const CAUSE_ORDER: readonly string[] = [
  "maintainer-gone",
  "repo-archived",
  "unpatched-cve",
  "runtime-rot",
];

/** Fixed risk component order: causes in cause order, then vital signs in key order. */
const COMPONENT_ORDER: readonly string[] = [
  ...CAUSE_ORDER.map((c) => `cause:${c}`),
  ...CERTIFICATE_KEY_ORDER.vitalSigns.map((v) => `vitalSign:${v}`),
];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json | undefined };
type Obj = { [k: string]: unknown };

/** Compares strings by Unicode code point, never by locale or UTF-16 unit. */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const cx = x[i]!.codePointAt(0)!;
    const cy = y[i]!.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  return x.length - y.length;
}

function asObj(v: unknown): Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {};
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Truncates fractional seconds from an ISO timestamp string; other values pass through. */
function ts(v: unknown): unknown {
  return typeof v === "string" ? v.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d+Z$/, "$1Z") : v;
}

function ordered(
  obj: Obj,
  keys: readonly string[],
  map: Readonly<Record<string, (v: unknown) => unknown>> = {},
): Obj {
  const out: Obj = {};
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    const f = map[k];
    out[k] = f ? f(v) : v;
  }
  return out;
}

/** Generic canonicalization for free-form values: object keys by code point, list order kept. */
function generic(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(generic);
  if (typeof v === "object" && v !== null) {
    const o = v as Obj;
    const out: Obj = {};
    for (const k of Object.keys(o).sort(compareCodePoints)) {
      if (o[k] !== undefined) out[k] = generic(o[k]);
    }
    return out;
  }
  return v;
}

function sortedRecord(v: unknown): Obj {
  return generic(asObj(v)) as Obj;
}

function str(v: unknown): string {
  return JSON.stringify(v) ?? "";
}

function sortBy<T>(items: T[], ...cmps: Array<(a: T, b: T) => number>): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      for (const c of cmps) {
        const r = c(a.item, b.item);
        if (r !== 0) return r;
      }
      return a.index - b.index;
    })
    .map((e) => e.item);
}

function firstString(list: unknown, key: string): string {
  const first = asArr(list)[0];
  const v = asObj(first)[key];
  return typeof v === "string" ? v : "";
}

function provenance(v: unknown): unknown[] {
  const entries = asArr(v).map((p) =>
    ordered(asObj(p), CERTIFICATE_KEY_ORDER.provenance, { fetchedAt: ts }),
  );
  return sortBy(
    entries,
    (a, b) => compareCodePoints(String(a.sourceUrl), String(b.sourceUrl)),
    (a, b) => compareCodePoints(String(a.fetchedAt), String(b.fetchedAt)),
  );
}

function fact(v: unknown): Obj {
  return ordered(asObj(v), CERTIFICATE_KEY_ORDER.fact, { value: generic, provenance });
}

function facts(v: unknown): unknown[] {
  return sortBy(
    asArr(v).map(fact),
    (a, b) => compareCodePoints(String(a.key), String(b.key)),
    (a, b) => compareCodePoints(firstString(a.provenance, "sourceUrl"), firstString(b.provenance, "sourceUrl")),
    (a, b) => compareCodePoints(str(a), str(b)),
  );
}

function vulnerability(v: unknown): Obj {
  return ordered(asObj(v), CERTIFICATE_KEY_ORDER.vulnerability, {
    aliases: (a) => asArr(a).map(String).sort(compareCodePoints),
  });
}

function vulnerabilities(v: unknown): unknown[] {
  return sortBy(
    asArr(v).map(vulnerability),
    (a, b) => compareCodePoints(String(a.id), String(b.id)),
    (a, b) =>
      compareCodePoints(
        String(asArr(a.aliases)[0] ?? ""),
        String(asArr(b.aliases)[0] ?? ""),
      ),
    (a, b) => compareCodePoints(str(a), str(b)),
  );
}

function maybe(inner?: (v: unknown) => unknown): (v: unknown) => unknown {
  return (v) =>
    ordered(asObj(v), CERTIFICATE_KEY_ORDER.maybe, {
      ...(inner ? { value: inner } : {}),
      attemptedAt: ts,
    });
}

function componentRank(c: unknown): number {
  const i = COMPONENT_ORDER.indexOf(String(c));
  return i === -1 ? COMPONENT_ORDER.length : i;
}

function contributions(v: unknown): unknown[] {
  return sortBy(
    asArr(v).map((c) => ordered(asObj(c), CERTIFICATE_KEY_ORDER.contribution)),
    (a, b) => componentRank(a.component) - componentRank(b.component),
    (a, b) => compareCodePoints(String(a.component), String(b.component)),
  );
}

function risk(v: unknown): Obj {
  return ordered(asObj(v), CERTIFICATE_KEY_ORDER.risk, {
    contributions,
    formula: (f) =>
      ordered(asObj(f), CERTIFICATE_KEY_ORDER.formula, {
        weights: sortedRecord,
        thresholds: sortedRecord,
      }),
    unavailable: (u) => asArr(u).map(String).sort(compareCodePoints),
  });
}

function causes(v: unknown): unknown[] {
  return sortBy(
    asArr(v),
    (a, b) => CAUSE_ORDER.indexOf(String(a)) - CAUSE_ORDER.indexOf(String(b)),
    (a, b) => compareCodePoints(String(a), String(b)),
  );
}

function notes(v: unknown): Obj {
  return ordered(asObj(v), CERTIFICATE_KEY_ORDER.notes, {
    omittedFacts: (o) =>
      sortBy(
        asArr(o).map((x) => ordered(asObj(x), CERTIFICATE_KEY_ORDER.omittedFact)),
        (a, b) => compareCodePoints(String(a.key), String(b.key)),
        (a, b) => compareCodePoints(String(a.reason), String(b.reason)),
      ),
  });
}

/** Returns the certificate as plain data with canonical key and list order. */
export function canonicalize(cert: DeathCertificate): Json {
  const root = ordered(cert as unknown as Obj, CERTIFICATE_KEY_ORDER.certificate, {
    package: (p) => ordered(asObj(p), CERTIFICATE_KEY_ORDER.package),
    analysisDate: ts,
    causes,
    // Not in the design table; sorted by code point so the order is defined.
    openVulnerabilityIds: (ids) => asArr(ids).map(String).sort(compareCodePoints),
    timeOfDeath: maybe(ts),
    vitalSigns: (vs) =>
      ordered(asObj(vs), CERTIFICATE_KEY_ORDER.vitalSigns, {
        maintainers: maybe(),
        openVulnerabilities: maybe(vulnerabilities),
        scorecard: maybe(),
        dependents: maybe(),
        weeklyDownloads: maybe(),
      }),
    risk,
    facts,
    notes,
  });
  return root as Json;
}

/** Serializes a Death_Certificate to canonical JSON: fixed key order, sorted lists, no whitespace. */
export function canonicalJson(cert: DeathCertificate): string {
  return JSON.stringify(canonicalize(cert));
}
