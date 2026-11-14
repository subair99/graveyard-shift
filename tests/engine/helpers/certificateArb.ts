import type {
  CauseOfDeath,
  DeathCertificate,
  Maybe,
  SourceName,
  Status,
  Vulnerability,
} from "../../../src/engine/types";
import { fc } from "./fc";

/**
 * Generators for Death_Certificates. Every certificate satisfies
 * DeathCertificateSchema after second truncation. Timestamps are generated
 * with millisecond precision on purpose: the serializer truncates them, and
 * the schema only accepts second precision on the serialized form.
 */

const MIN_MS = Date.UTC(1971, 0, 1);
const MAX_MS = Date.UTC(2099, 11, 31);

/** ISO 8601 UTC timestamp with milliseconds, e.g. 2026-01-01T00:00:00.123Z. */
export const msTimestampArb: fc.Arbitrary<string> = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms).toISOString());

/** Strings with any code point, including astral characters and lone surrogates. */
export const unicodeArb: fc.Arbitrary<string> = fc.string({ unit: "binary", maxLength: 12 });

const nonEmptyUnicodeArb = fc.string({ unit: "binary", minLength: 1, maxLength: 12 });

const asciiWordArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);

/** Absolute URLs, some with a unicode fragment so code point ordering is exercised. */
export const sourceUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.webUrl(),
  fc.tuple(fc.webUrl(), fc.string({ unit: "binary", maxLength: 6 })).map(([u, f]) => `${u}#${f}`),
  asciiWordArb.map((w) => `https://example.test/${w}`),
);

const SOURCES: readonly SourceName[] = ["npm", "osv", "deps.dev", "github"];
const STATUSES: readonly Status[] = ["alive", "dying", "dead", "retired-with-successor"];
const CAUSES: readonly CauseOfDeath[] = [
  "maintainer-gone",
  "repo-archived",
  "unpatched-cve",
  "runtime-rot",
];
const VITAL_SIGN_KEYS = [
  "maintainers",
  "openVulnerabilities",
  "scorecard",
  "dependents",
  "weeklyDownloads",
] as const;

const nonNegIntArb = fc.integer({ min: 0, max: 1_000_000_000 });

function unavailableArb<T>(): fc.Arbitrary<Maybe<T>> {
  return fc
    .record(
      {
        source: fc.constantFrom(...SOURCES),
        attemptedUrl: fc.oneof(sourceUrlArb, unicodeArb),
        attemptedAt: msTimestampArb,
        reason: unicodeArb,
        rateLimitResetAt: fc.oneof(msTimestampArb, unicodeArb),
      },
      { requiredKeys: ["source", "attemptedUrl", "attemptedAt", "reason"] },
    )
    .map((r) => ({ available: false as const, ...r }));
}

/** An available or unavailable Maybe. */
export function maybeArb<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Maybe<T>> {
  return fc.oneof(
    value.map((v): Maybe<T> => ({ available: true, value: v })),
    unavailableArb<T>(),
  );
}

const vulnerabilityArb: fc.Arbitrary<Vulnerability> = fc.record(
  {
    id: nonEmptyUnicodeArb,
    aliases: fc.array(unicodeArb, { maxLength: 4 }),
    summary: unicodeArb,
    severity: unicodeArb,
  },
  { requiredKeys: ["id", "aliases", "summary"] },
);

const vitalSignsArb = fc.record({
  maintainers: maybeArb(fc.array(unicodeArb, { maxLength: 5 })),
  openVulnerabilities: maybeArb(fc.array(vulnerabilityArb, { maxLength: 5 })),
  scorecard: maybeArb(
    fc.oneof(fc.constant(null), fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true })),
  ),
  dependents: maybeArb(nonNegIntArb),
  weeklyDownloads: maybeArb(nonNegIntArb),
});

const provenanceArb = fc.record({ sourceUrl: sourceUrlArb, fetchedAt: msTimestampArb });

const factArb = fc.record(
  {
    key: nonEmptyUnicodeArb,
    value: fc.jsonValue({ maxDepth: 3 }),
    provenance: fc.array(provenanceArb, { minLength: 1, maxLength: 20 }),
    stale: fc.boolean(),
  },
  { requiredKeys: ["key", "value", "provenance"] },
);

const COMPONENTS: readonly string[] = [
  ...CAUSES.map((c) => `cause:${c}`),
  ...VITAL_SIGN_KEYS.map((v) => `vitalSign:${v}`),
];

/** Unique components (one entry per component, as assembly produces), mostly known, some unknown. */
const contributionsArb = fc
  .uniqueArray(fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...COMPONENTS) }, { weight: 1, arbitrary: unicodeArb }), {
    maxLength: 12,
  })
  .chain((components) =>
    fc.tuple(...components.map(() => nonNegIntArb)).map((points) =>
      components.map((component, i) => ({ component, points: points[i]! })),
    ),
  );

const finiteNumberArb = fc.double({ noNaN: true, noDefaultInfinity: true });
const numberRecordArb = fc.dictionary(
  unicodeArb.filter((k) => k !== "__proto__"),
  finiteNumberArb,
  { maxKeys: 5 },
);

const riskArb = fc.record(
  {
    contributions: contributionsArb,
    rawScore: nonNegIntArb,
    formula: fc.record({ weights: numberRecordArb, thresholds: numberRecordArb }),
    unavailable: fc.array(fc.oneof(fc.constantFrom(...COMPONENTS), unicodeArb), { maxLength: 9 }),
    note: unicodeArb,
  },
  { requiredKeys: ["contributions", "rawScore", "formula", "unavailable"] },
);

const notesArb = fc.record(
  {
    githubTokenUsed: fc.boolean(),
    githubSkippedReason: unicodeArb,
    omittedFacts: fc.array(
      fc.record({ key: unicodeArb, reason: fc.constant("missing-provenance" as const) }),
      { maxLength: 5 },
    ),
  },
  { requiredKeys: ["githubTokenUsed", "omittedFacts"] },
);

/** status present, or absent with a statusError (the only allowed absence). */
const statusPartArb: fc.Arbitrary<{ status?: Status; statusError?: string }> = fc.oneof(
  fc.constantFrom(...STATUSES).map((status) => ({ status })),
  unicodeArb.map((statusError) => ({ statusError })),
  fc
    .tuple(fc.constantFrom(...STATUSES), unicodeArb)
    .map(([status, statusError]) => ({ status, statusError })),
);

const timeOfDeathArb = maybeArb(msTimestampArb);

/**
 * Valid certificates. `timeOfDeath` unavailable never carries `daysSinceDeath`;
 * an available one may.
 */
export const deathCertificateArb: fc.Arbitrary<DeathCertificate> = fc
  .record({
    package: fc.record({ name: nonEmptyUnicodeArb, version: nonEmptyUnicodeArb }),
    analysisDate: msTimestampArb,
    statusPart: statusPartArb,
    causes: fc.array(fc.constantFrom(...CAUSES), { maxLength: 4 }),
    openVulnerabilityIds: fc.array(unicodeArb, { maxLength: 5 }),
    timeOfDeath: timeOfDeathArb,
    daysSinceDeath: fc.option(nonNegIntArb, { nil: undefined }),
    vitalSigns: vitalSignsArb,
    successor: fc.option(unicodeArb, { nil: undefined }),
    riskScore: fc.integer({ min: 0, max: 100 }),
    risk: riskArb,
    facts: fc.array(factArb, { maxLength: 6 }),
    notes: notesArb,
  })
  .map(({ statusPart, daysSinceDeath, successor, ...rest }) => {
    const cert: DeathCertificate = {
      schemaVersion: 1,
      ...rest,
      ...statusPart,
      ...(rest.timeOfDeath.available && daysSinceDeath !== undefined ? { daysSinceDeath } : {}),
      ...(successor !== undefined ? { successor } : {}),
    };
    return cert;
  });
