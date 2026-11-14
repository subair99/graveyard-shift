import {
  NpmDownloadsSchema,
  NpmPackumentSchema,
  safeParseResult,
  type SourceResult,
} from "../types";
import type { HttpClient } from "./http";

// npm Source_Client: packument, weekly downloads and existence lookups.
// The HTTP wrapper owns the clock, so no time is read here.

export const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
export const NPM_DOWNLOADS_BASE = "https://api.npmjs.org/downloads/point/last-week";

/** Repository URL as published, plus its canonical github.com form when it has one. */
export interface NpmRepository {
  /** The string exactly as the packument gave it. */
  original: string;
  /** `https://github.com/{owner}/{repo}` when the repository is on github.com. */
  github?: string;
}

export interface NpmPackumentData {
  /** Maintainer usernames in registry order. Empty when the packument lists none. */
  maintainers: string[];
  /** The registry `time` map as published (includes `created` and `modified`). */
  time: Record<string, string>;
  /** Deprecation message of the requested version, when it has a non-empty one. */
  deprecation?: string;
  repository?: NpmRepository;
  /** `dist-tags.latest`. */
  latest?: string;
  /** Published versions, in registry order. */
  versions: string[];
}

export interface NpmClient {
  /** Packument for `name`. `version` selects the version whose deprecation is reported. */
  packument(name: string, version?: string): Promise<SourceResult<NpmPackumentData>>;
  /** Weekly downloads. A reported 0 is `ok` with value 0. */
  weeklyDownloads(name: string): Promise<SourceResult<number>>;
  /**
   * Existence lookup, usable as the `lookup` argument of `findSuccessor`:
   * ok = exists, not-found = 404, unavailable = any failure.
   */
  lookupPackage(name: string): Promise<SourceResult<{ exists: true }>>;
}

export function packumentUrl(name: string): string {
  return `${NPM_REGISTRY_BASE}/${name.replace("/", "%2F")}`;
}

/**
 * Downloads URL. Decision: keep the name UNENCODED, so a scoped name gives
 * `https://api.npmjs.org/downloads/point/last-week/@scope/name` (the `@` and `/` are left as is).
 * Verified live on 14 Nov 2026 with GET requests: `.../last-week/@babel/core` and
 * `.../last-week/@babel%2Fcore` return the same JSON.
 * The packument URL (registry.npmjs.org, see `packumentUrl`) is different on purpose:
 * it needs `@scope%2Fname`.
 */
export function downloadsUrl(name: string): string {
  return `${NPM_DOWNLOADS_BASE}/${name}`;
}

const GITHUB_PATTERNS: readonly RegExp[] = [
  // github:o/r
  /^github:([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:#.*)?$/i,
  // o/r shorthand (npm treats it as a GitHub repository)
  /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/,
  // git@github.com:o/r.git
  /^git@github\.com:([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:#.*)?$/i,
  // http(s)://, git://, git+https://, git+http://, ssh://, git+ssh://, with optional user@ and port
  /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/\s]+@)?(?:www\.)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i,
];

/** Canonical `https://github.com/o/r` for a github.com repository URL, otherwise undefined. */
export function normalizeGithubUrl(raw: string): string | undefined {
  const text = raw.trim();
  for (const pattern of GITHUB_PATTERNS) {
    const m = pattern.exec(text);
    const owner = m?.[1];
    const repo = m?.[2];
    if (owner !== undefined && repo !== undefined && owner.length > 0 && repo.length > 0) {
      return `https://github.com/${owner}/${repo}`;
    }
  }
  return undefined;
}

function toRepository(raw: string | { url: string } | undefined): NpmRepository | undefined {
  if (raw === undefined) return undefined;
  const original = typeof raw === "string" ? raw : raw.url;
  if (original.trim().length === 0) return undefined;
  const github = normalizeGithubUrl(original);
  return github === undefined ? { original } : { original, github };
}

export function createNpmClient(http: HttpClient): NpmClient {
  async function packument(
    name: string,
    version?: string,
  ): Promise<SourceResult<NpmPackumentData>> {
    const url = packumentUrl(name);
    const res = await http.get("npm", url);
    if (res.status !== "ok") return res;
    const provenance = res.provenance;
    const first = provenance[0];
    const parseFailure = (problem: string): SourceResult<never> => ({
      status: "unavailable",
      source: "npm",
      attemptedUrl: first?.sourceUrl ?? url,
      attemptedAt: first?.fetchedAt ?? "",
      reason: `npm packument could not be parsed: ${problem}`,
    });

    let json: unknown;
    try {
      json = JSON.parse(res.value.body);
    } catch (e) {
      return parseFailure(`invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    const parsed = safeParseResult(NpmPackumentSchema, json);
    if (!parsed.ok) return parseFailure(parsed.error.issues.join("; "));
    const p = parsed.value;

    const data: NpmPackumentData = {
      maintainers: (p.maintainers ?? []).map((m) => m.name),
      time: p.time ?? {},
      versions: Object.keys(p.versions ?? {}),
    };
    const message = version === undefined ? undefined : p.versions?.[version]?.deprecated;
    if (message !== undefined && message.length > 0) data.deprecation = message;
    const repository = toRepository(p.repository);
    if (repository !== undefined) data.repository = repository;
    const latest = p["dist-tags"]?.latest;
    if (latest !== undefined) data.latest = latest;

    const out: SourceResult<NpmPackumentData> = { status: "ok", value: data, provenance };
    if (res.stale === true) out.stale = true;
    return out;
  }

  async function weeklyDownloads(name: string): Promise<SourceResult<number>> {
    const url = downloadsUrl(name);
    const res = await http.get("npm", url);
    if (res.status !== "ok") return res;
    const first = res.provenance[0];
    const fail = (problem: string): SourceResult<never> => ({
      status: "unavailable",
      source: "npm",
      attemptedUrl: first?.sourceUrl ?? url,
      attemptedAt: first?.fetchedAt ?? "",
      reason: `npm downloads response could not be parsed: ${problem}`,
    });
    let json: unknown;
    try {
      json = JSON.parse(res.value.body);
    } catch (e) {
      return fail(`invalid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    const parsed = safeParseResult(NpmDownloadsSchema, json);
    if (!parsed.ok) return fail(parsed.error.issues.join("; "));
    const out: SourceResult<number> = {
      status: "ok",
      value: parsed.value.downloads,
      provenance: res.provenance,
    };
    if (res.stale === true) out.stale = true;
    return out;
  }

  async function lookupPackage(name: string): Promise<SourceResult<{ exists: true }>> {
    const res = await packument(name);
    if (res.status !== "ok") return res;
    const out: SourceResult<{ exists: true }> = {
      status: "ok",
      value: { exists: true },
      provenance: res.provenance,
    };
    if (res.stale === true) out.stale = true;
    return out;
  }

  return { packument, weeklyDownloads, lookupPackage };
}
