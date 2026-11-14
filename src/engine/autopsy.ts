import semver from "semver";
import { resolveCacheTtl } from "./cache/cache";
import {
  buildCertificate,
  type GitHubSignal,
  type GitHubSkipped,
  type NpmSignal,
  type Signals,
} from "./core/certificate";
import { extractCandidates, findSuccessor, type LookupResult } from "./core/successor";
import { parseInput } from "./parse/inputParser";
import { NO_GITHUB_REPOSITORY_REASON } from "./reasons";
import { resolveVersion } from "./resolve/versionResolver";
import { compareCodePoints } from "./serialize/canonicalJson";
import { createDepsDevClient, dependentsUrl } from "./sources/depsdev";
import { createGitHubClient } from "./sources/github";
import { createHttpClient, formatTimestamp, redact } from "./sources/http";
import { createNpmClient, downloadsUrl, packumentUrl, type NpmPackumentData } from "./sources/npm";
import { createOsvClient, OSV_QUERY_URL } from "./sources/osv";
import type {
  AutopsyError,
  AutopsyRun,
  DeathCertificate,
  EngineConfig,
  EngineDeps,
  EngineInput,
  PackageRef,
  SourceName,
  SourceResult,
} from "./types";

/** Default bound on simultaneous upstream requests (design: "default 8"). */
export const DEFAULT_CONCURRENCY = 8;

/**
 * Order of certificates in a run (design.md "Serializer" table, docs/engine-ordering.md):
 * package name by code point, then version by semver precedence, then the version
 * string by code point. Versions that are not valid semver sort after valid ones.
 */
export function compareCertificates(a: DeathCertificate, b: DeathCertificate): number {
  const byName = compareCodePoints(a.package.name, b.package.name);
  if (byName !== 0) return byName;
  const va = semver.valid(a.package.version);
  const vb = semver.valid(b.package.version);
  if (va !== null && vb !== null) {
    const c = semver.compare(va, vb);
    if (c !== 0) return c;
  } else if (va !== null) {
    return -1;
  } else if (vb !== null) {
    return 1;
  }
  return compareCodePoints(a.package.version, b.package.version);
}

type Limit = <T>(fn: () => Promise<T>) => Promise<T>;

function createLimiter(max: number): Limit {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (active < max) {
        active++;
        resolve();
      } else {
        waiting.push(() => {
          active++;
          resolve();
        });
      }
    });
  const release = (): void => {
    active--;
    waiting.shift()?.();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

function mapResult<T, U>(r: SourceResult<T>, f: (value: T) => U): SourceResult<U> {
  if (r.status !== "ok") return r;
  const out: SourceResult<U> = { status: "ok", value: f(r.value), provenance: r.provenance };
  if (r.stale === true) out.stale = true;
  return out;
}

function toNpmSignal(data: NpmPackumentData): NpmSignal {
  return {
    maintainers: data.maintainers,
    time: data.time,
    ...(data.deprecation !== undefined ? { deprecation: data.deprecation } : {}),
  };
}

type Outcome = { error: AutopsyError } | { signals: Signals };

/**
 * Runs an autopsy for every package reference in `input`.
 *
 * Analysis_Date: when `analysisDate` is supplied it is used unchanged and the clock is
 * not read for it. Otherwise `deps.clock.now()` is read exactly once, after every source
 * fetch and successor lookup of the run has finished (and only when at least one
 * certificate is built), and that value is used for every certificate. The pure core
 * never reads the clock.
 *
 * Never reads `process.env`: the caller passes `config.githubToken`.
 */
export async function runAutopsy(
  input: EngineInput,
  config: EngineConfig,
  deps: EngineDeps,
  analysisDate?: Date,
): Promise<AutopsyRun> {
  const notes: string[] = [];
  const ttl = resolveCacheTtl(config.cacheTtlMs);
  if (ttl.error !== undefined) notes.push(ttl.error);

  const parsed = parseInput(input);
  if (!parsed.ok) {
    return {
      certificates: [],
      errors: [
        {
          kind: "parse",
          message: `Invalid ${parsed.error.inputType}: ${parsed.error.reason}`,
        },
      ],
      notes,
    };
  }
  if (parsed.value.note !== undefined) notes.push(parsed.value.note);
  const refs = parsed.value.refs;

  const token =
    config.githubToken !== undefined && config.githubToken.trim() !== ""
      ? config.githubToken.trim()
      : undefined;
  const secrets = token === undefined ? [] : [token];

  // One http client per run, so in-flight requests with the same cache key are shared.
  const http = createHttpClient({
    fetch: deps.fetch,
    clock: deps.clock,
    cache: deps.cache,
    ttlMs: ttl.ttlMs,
    secrets,
  });
  const npm = createNpmClient(http);
  const osv = createOsvClient(http, deps.clock);
  const depsDev = createDepsDevClient(http, deps.clock);
  const github = createGitHubClient(http, { token });

  const concurrency =
    Number.isFinite(config.concurrency) && config.concurrency >= 1
      ? Math.floor(config.concurrency)
      : DEFAULT_CONCURRENCY;
  const limit = createLimiter(concurrency);

  const failure = (source: SourceName, url: string, error: unknown): SourceResult<never> => ({
    status: "unavailable",
    source,
    attemptedUrl: url,
    attemptedAt: formatTimestamp(deps.clock.now()),
    reason: redact(`request failed: ${error instanceof Error ? error.message : String(error)}`, secrets),
  });

  /** Runs one upstream call under the concurrency bound. A throw becomes `unavailable`. */
  async function call<T>(
    source: SourceName,
    url: string,
    fn: () => Promise<SourceResult<T>>,
  ): Promise<SourceResult<T>> {
    try {
      return await limit(fn);
    } catch (e) {
      return failure(source, url, e);
    }
  }

  async function analyze(ref: PackageRef): Promise<Outcome> {
    const { name } = ref;
    const pUrl = packumentUrl(name);

    const first = await call("npm", pUrl, () => npm.packument(name));
    if (first.status === "not-found") {
      return {
        error: {
          package: name,
          kind: "not-found",
          message: `Package "${name}" was not found on the npm registry (${first.url}).`,
        },
      };
    }

    const exact = ref.spec !== null && semver.valid(ref.spec) !== null;
    if (first.status === "unavailable" && !exact) {
      return {
        error: {
          package: name,
          ...(ref.spec !== null ? { range: ref.spec } : {}),
          kind: "no-version",
          message: `Could not read the npm packument for "${name}" (${first.attemptedUrl}): ${first.reason}.`,
        },
      };
    }

    const published = first.status === "ok" ? first.value.versions : [];
    const latest = first.status === "ok" ? (first.value.latest ?? null) : null;
    const resolved = resolveVersion(name, ref.spec, published, latest);
    if (!resolved.ok) return { error: resolved.error };
    const version = resolved.value;

    // Second read selects the deprecation message of the analyzed version. It is a
    // cache hit (same cache key as the first read), so no extra upstream request.
    let npmResult: SourceResult<NpmPackumentData> = first;
    if (first.status === "ok") {
      const withVersion = await call("npm", pUrl, () => npm.packument(name, version));
      if (withVersion.status === "ok") npmResult = withVersion;
    }

    const repositoryUrl =
      npmResult.status === "ok" ? npmResult.value.repository?.original : undefined;
    const npmAttemptedAt =
      npmResult.status === "ok"
        ? (npmResult.provenance[0]?.fetchedAt ?? formatTimestamp(deps.clock.now()))
        : npmResult.status === "unavailable"
          ? npmResult.attemptedAt
          : formatTimestamp(deps.clock.now());

    const scorecardPromise: Promise<SourceResult<number | null>> =
      repositoryUrl === undefined
        ? Promise.resolve({
            status: "unavailable",
            source: "deps.dev",
            attemptedUrl: pUrl,
            attemptedAt: npmAttemptedAt,
            reason: NO_GITHUB_REPOSITORY_REASON,
          })
        : call("deps.dev", repositoryUrl, () => depsDev.scorecard(repositoryUrl));

    const githubPromise = (async (): Promise<{
      result: SourceResult<GitHubSignal> | GitHubSkipped;
      tokenUsed: boolean;
    }> => {
      try {
        return await limit(() => github.fetchRepo(repositoryUrl));
      } catch (e) {
        return {
          result: failure("github", repositoryUrl ?? "https://api.github.com/", e),
          tokenUsed: token !== undefined,
        };
      }
    })();

    const [osvResult, scorecard, dependents, weeklyDownloads, githubOutcome] = await Promise.all([
      call("osv", OSV_QUERY_URL, () => osv.queryVulnerabilities(name, version)),
      scorecardPromise,
      call("deps.dev", dependentsUrl(name, version), () => depsDev.dependents(name, version)),
      call("npm", downloadsUrl(name), () => npm.weeklyDownloads(name)),
      githubPromise,
    ]);

    const deprecation = npmResult.status === "ok" ? npmResult.value.deprecation : undefined;
    const successor =
      deprecation === undefined
        ? { lookups: [] }
        : await findSuccessor(extractCandidates(deprecation), async (candidate): Promise<LookupResult> => {
            const url = packumentUrl(candidate);
            return call("npm", url, () => npm.lookupPackage(candidate));
          });

    return {
      signals: {
        name,
        version,
        publishedVersions: published,
        npm: mapResult(npmResult, toNpmSignal),
        osv: osvResult,
        scorecard,
        dependents,
        weeklyDownloads,
        github: githubOutcome.result,
        successor,
        githubTokenUsed: githubOutcome.tokenUsed,
      },
    };
  }

  const outcomes = await Promise.all(refs.map((ref) => analyze(ref)));

  // Errors and signals follow the sorted reference order, not completion order (R11.5).
  const errors: AutopsyError[] = [];
  const signalList: Signals[] = [];
  const seen = new Set<string>();
  for (const outcome of outcomes) {
    if ("error" in outcome) {
      errors.push(outcome.error);
      continue;
    }
    const key = JSON.stringify([outcome.signals.name, outcome.signals.version]);
    if (seen.has(key)) continue;
    seen.add(key);
    signalList.push(outcome.signals);
  }

  if (signalList.length === 0) return { certificates: [], errors, notes };

  // The single clock read for the Analysis_Date: after every fetch of the run.
  const date = analysisDate ?? deps.clock.now();
  const certificates = signalList
    .map((signals) => buildCertificate(signals, date))
    .sort(compareCertificates);

  return { certificates, errors, notes };
}
