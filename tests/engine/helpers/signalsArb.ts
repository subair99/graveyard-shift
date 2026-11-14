import type { LookupRecord } from "../../../src/engine/core/successor";
import type { GitHubSignal, NpmSignal, OsvVulnerability, Signals } from "../../../src/engine/core/certificate";
import type { Provenance, SourceName, SourceResult } from "../../../src/engine/types";
import { fc } from "./fc";

/**
 * Generators for `Signals` (the input of `buildCertificate`).
 *
 * Every generated Fetch_Date and attempt time is `YYYY-MM-DDTHH:mm:ssZ` and at or before the
 * Analysis_Date, except the deliberately malformed provenance entries (bad calendar date,
 * millisecond precision). Ordering "Fetch_Date <= Analysis_Date" is guaranteed by the
 * orchestrator in live runs (design.md, notes on the model), not by `buildCertificate`,
 * so the generators never produce a later date.
 */

const MIN_SECONDS = Date.UTC(2015, 0, 1) / 1000;
const MAX_SECONDS = Date.UTC(2035, 11, 31) / 1000;

export function toSecondIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

/** An Analysis_Date (with a random millisecond part) and the whole seconds it truncates to. */
export interface AnalysisContext {
  analysisDate: Date;
  analysisSeconds: number;
}

export const analysisContextArb: fc.Arbitrary<AnalysisContext> = fc
  .record({
    seconds: fc.integer({ min: MIN_SECONDS + 86_400, max: MAX_SECONDS }),
    ms: fc.integer({ min: 0, max: 999 }),
  })
  .map(({ seconds, ms }) => ({
    analysisDate: new Date(seconds * 1000 + ms),
    analysisSeconds: seconds,
  }));

/** Valid Fetch_Date at or before the Analysis_Date. */
function validDateArb(a: AnalysisContext): fc.Arbitrary<string> {
  return fc.integer({ min: MIN_SECONDS, max: a.analysisSeconds }).map(toSecondIso);
}

const validUrlArb: fc.Arbitrary<string> = fc
  .record({
    scheme: fc.constantFrom("https", "http"),
    host: fc.constantFrom("registry.npmjs.org", "api.osv.dev", "api.deps.dev", "api.github.com"),
    path: fc.array(fc.stringMatching(/^[a-z0-9._-]{1,12}$/), { maxLength: 4 }),
  })
  .map(({ scheme, host, path }) => `${scheme}://${host}/${path.join("/")}`);

const malformedUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.constantFrom(" ", "   ", "\t\n"),
  fc.constantFrom("/v1/query", "registry.npmjs.org/left-pad", "../relative"),
  fc.integer({ min: 2049, max: 2200 }).map((n) => `https://example.com/${"a".repeat(n - 20)}`),
);

function malformedDateArb(a: AnalysisContext): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom("2024-13-45T00:00:00Z", "2023-02-30T10:00:00Z", "not a date", "", "2024-01-01"),
    // millisecond precision
    validDateArb(a).map((d) => d.replace("Z", ".123Z")),
  );
}

function validEntryArb(a: AnalysisContext): fc.Arbitrary<Provenance> {
  return fc.record({ sourceUrl: validUrlArb, fetchedAt: validDateArb(a) });
}

function entryArb(a: AnalysisContext): fc.Arbitrary<Provenance> {
  return fc.oneof(
    { weight: 5, arbitrary: validEntryArb(a) },
    { weight: 1, arbitrary: fc.record({ sourceUrl: malformedUrlArb, fetchedAt: validDateArb(a) }) },
    { weight: 1, arbitrary: fc.record({ sourceUrl: validUrlArb, fetchedAt: malformedDateArb(a) }) },
  );
}

/** Provenance lists: none, mixed valid and malformed, only malformed, or more than 20 entries. */
function provenanceListArb(a: AnalysisContext): fc.Arbitrary<Provenance[]> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant<Provenance[]>([]) },
    { weight: 4, arbitrary: fc.array(validEntryArb(a), { minLength: 1, maxLength: 4 }) },
    { weight: 4, arbitrary: fc.array(entryArb(a), { minLength: 1, maxLength: 6 }) },
    {
      weight: 1,
      arbitrary: fc.array(
        fc.oneof(
          fc.record({ sourceUrl: malformedUrlArb, fetchedAt: validDateArb(a) }),
          fc.record({ sourceUrl: validUrlArb, fetchedAt: malformedDateArb(a) }),
        ),
        { minLength: 1, maxLength: 3 },
      ),
    },
    {
      weight: 1,
      arbitrary: fc.uniqueArray(validEntryArb(a), {
        minLength: 21,
        maxLength: 25,
        selector: (e) => JSON.stringify([e.sourceUrl, e.fetchedAt]),
      }),
    },
  );
}

/** Any URL string, used for attempted/not-found URLs (not provenance for the top-level Maybe). */
const anyUrlArb: fc.Arbitrary<string> = fc.oneof(validUrlArb, malformedUrlArb);

function sourceResultArb<T>(
  a: AnalysisContext,
  source: SourceName,
  value: fc.Arbitrary<T>,
  options: { notFound?: boolean } = {},
): fc.Arbitrary<SourceResult<T>> {
  const ok = fc
    .record({ value, provenance: provenanceListArb(a), stale: fc.option(fc.boolean(), { nil: undefined }) })
    .map(
      ({ value: v, provenance, stale }): SourceResult<T> => ({
        status: "ok",
        value: v,
        provenance,
        ...(stale !== undefined ? { stale } : {}),
      }),
    );
  const unavailable = fc
    .record({ attemptedUrl: anyUrlArb, attemptedAt: validDateArb(a), reason: fc.string({ maxLength: 20 }) })
    .map((r): SourceResult<T> => ({ status: "unavailable", source, ...r }));
  const notFound = fc
    .record({ url: anyUrlArb, fetchedAt: validDateArb(a) })
    .map((r): SourceResult<T> => ({ status: "not-found", source, ...r }));
  return options.notFound === false
    ? fc.oneof({ weight: 4, arbitrary: ok }, { weight: 1, arbitrary: unavailable })
    : fc.oneof({ weight: 4, arbitrary: ok }, { weight: 1, arbitrary: unavailable }, { weight: 1, arbitrary: notFound });
}

const VERSIONS = ["0.9.0", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "3.1.4"];

const npmSignalArb = (a: AnalysisContext): fc.Arbitrary<NpmSignal> =>
  fc.record({
    maintainers: fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/), { maxLength: 3 }),
    time: fc
      .array(fc.tuple(fc.constantFrom(...VERSIONS, "created", "modified"), fc.integer({ min: MIN_SECONDS, max: a.analysisSeconds })), {
        maxLength: 5,
      })
      .map((pairs) => Object.fromEntries(pairs.map(([k, s]) => [k, new Date(s * 1000).toISOString()]))),
    deprecation: fc.option(fc.constantFrom("deprecated", "Use `some-pkg` instead", "no longer maintained"), {
      nil: undefined,
    }),
  }).map((n) => {
    const { deprecation, ...rest } = n;
    return deprecation !== undefined ? { ...rest, deprecation } : rest;
  });

const osvVulnArb: fc.Arbitrary<OsvVulnerability> = fc.record({
  id: fc.constantFrom("GHSA-aaaa-bbbb-cccc", "CVE-2020-0001", "OSV-1", "GHSA-dddd-eeee-ffff"),
  aliases: fc.array(fc.constantFrom("CVE-2020-0001", "GHSA-x", "CVE-2021-1234"), { maxLength: 3 }),
  summary: fc.string({ maxLength: 20 }),
  fixedVersions: fc.array(fc.constantFrom(...VERSIONS), { maxLength: 2 }),
});

const githubSignalArb = (a: AnalysisContext): fc.Arbitrary<GitHubSignal> =>
  fc.record({
    archived: fc.boolean(),
    pushedAt: fc.option(
      fc.integer({ min: MIN_SECONDS, max: a.analysisSeconds }).map((s) => new Date(s * 1000).toISOString()),
      { nil: null },
    ),
  });

/** Lookup records as `findSuccessor` produces them: stops at the first `ok` result, which is the Successor. */
function successorArb(a: AnalysisContext): fc.Arbitrary<Signals["successor"]> {
  const record = (name: string): fc.Arbitrary<LookupRecord> =>
    fc.oneof(
      { weight: 5, arbitrary: sourceResultArb<unknown>(a, "npm", fc.constant({})).map((result): LookupRecord => ({ name, outcome: "result", result })) },
      { weight: 1, arbitrary: fc.string({ maxLength: 10 }).map((error): LookupRecord => ({ name, outcome: "threw", error })) },
    );
  return fc
    .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{1,10}$/), { maxLength: 4 })
    .chain((names) => fc.tuple(...names.map(record)))
    .map((records) => {
      const lookups: LookupRecord[] = [];
      for (const r of records) {
        lookups.push(r);
        if (r.outcome === "result" && r.result.status === "ok") return { successor: r.name, lookups };
      }
      return { lookups };
    });
}

export function signalsArb(a: AnalysisContext): fc.Arbitrary<Signals> {
  return fc.record({
    name: fc.stringMatching(/^[a-z][a-z0-9-]{1,12}$/),
    version: fc.constantFrom(...VERSIONS),
    publishedVersions: fc.subarray(VERSIONS),
    npm: sourceResultArb(a, "npm", npmSignalArb(a), { notFound: true }),
    osv: sourceResultArb(a, "osv", fc.array(osvVulnArb, { maxLength: 3 })),
    scorecard: sourceResultArb(a, "deps.dev", fc.option(fc.integer({ min: 0, max: 10 }), { nil: null })),
    dependents: sourceResultArb(a, "deps.dev", fc.nat({ max: 100_000 })),
    weeklyDownloads: sourceResultArb(a, "npm", fc.nat({ max: 10_000_000 })),
    github: fc.oneof(
      { weight: 4, arbitrary: sourceResultArb(a, "github", githubSignalArb(a)) },
      {
        weight: 1,
        arbitrary: fc
          .constantFrom("", "repository is not on github.com", "no repository field")
          .map((reason) => ({ status: "skipped" as const, reason })),
      },
    ),
    successor: successorArb(a),
    githubTokenUsed: fc.boolean(),
  });
}

/** Signals together with the Analysis_Date they were generated against. */
export const signalsWithDateArb: fc.Arbitrary<{ signals: Signals; analysis: AnalysisContext }> =
  analysisContextArb.chain((analysis) => signalsArb(analysis).map((signals) => ({ signals, analysis })));
