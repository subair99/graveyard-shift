import { NO_SCORECARD_REASON } from "../reasons";
import { DepsDevDependentsSchema, DepsDevProjectSchema } from "../types";
import type { Clock, SourceResult } from "../types";
import type { HttpClient } from "./http";
import { formatTimestamp } from "./http";

/** deps.dev v3 base (stable API): GetProject. */
export const DEPSDEV_V3_BASE = "https://api.deps.dev/v3";

/**
 * deps.dev v3alpha base: GetDependents. This is an alpha API and may change or
 * disappear. Any change in its response shape surfaces as "unavailable" (R7.10).
 */
export const DEPSDEV_V3ALPHA_BASE = "https://api.deps.dev/v3alpha";

export interface DepsDevClient {
  /**
   * OpenSSF Scorecard overall score (0 to 10) for a repository URL.
   * `ok` with `null` means deps.dev answered but holds no Scorecard.
   * A 404 for the project and non-github.com repositories are `unavailable`
   * (the 404 case with the reason "no scorecard").
   */
  scorecard(repositoryUrl: string): Promise<SourceResult<number | null>>;
  /** Dependent count of `name@version` from the v3alpha `:dependents` endpoint. */
  dependents(name: string, version: string): Promise<SourceResult<number>>;
}

/**
 * Extracts `github.com/owner/repo` from the repository URL forms npm uses
 * (https, http, git+https, git, ssh, scp-like, `github:owner/repo`).
 * Returns undefined for anything that is not a github.com repository.
 */
export function githubProjectId(repositoryUrl: string): string | undefined {
  const text = repositoryUrl.trim();
  const match =
    /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/]+@)?(?:www\.)?github\.com(?::\d+)?\/([^/\s?#]+)\/([^/\s?#]+)/i.exec(
      text,
    ) ??
    /^git@github\.com:([^/\s?#]+)\/([^/\s?#]+)/i.exec(text) ??
    /^github:([^/\s?#]+)\/([^/\s?#]+)/i.exec(text);
  if (match === null) return undefined;
  const owner = match[1];
  const repo = (match[2] ?? "").replace(/\.git$/i, "");
  if (owner === undefined || owner === "" || repo === "") return undefined;
  return `github.com/${owner}/${repo}`;
}

export function scorecardUrl(projectId: string): string {
  return `${DEPSDEV_V3_BASE}/projects/${encodeURIComponent(projectId)}`;
}

export function dependentsUrl(name: string, version: string): string {
  return `${DEPSDEV_V3ALPHA_BASE}/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}:dependents`;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The clock is only used to stamp `attemptedAt` on results that never reached the HTTP layer or had no response time. */
export function createDepsDevClient(http: HttpClient, clock: Clock): DepsDevClient {
  const unavailable = (attemptedUrl: string, reason: string): SourceResult<never> => ({
    status: "unavailable",
    source: "deps.dev",
    attemptedUrl,
    attemptedAt: formatTimestamp(clock.now()),
    reason,
  });

  async function scorecard(repositoryUrl: string): Promise<SourceResult<number | null>> {
    const projectId = githubProjectId(repositoryUrl);
    if (projectId === undefined) {
      return unavailable(repositoryUrl, "not a github.com repository, scorecard lookup skipped");
    }
    const url = scorecardUrl(projectId);
    const result = await http.get("deps.dev", url);
    if (result.status === "unavailable") return result;
    if (result.status === "not-found") return unavailable(url, NO_SCORECARD_REASON);

    const parsed = DepsDevProjectSchema.safeParse(parseJson(result.value.body));
    if (!parsed.success) return unavailable(url, "unparseable deps.dev project response");
    const score = parsed.data.scorecard?.overallScore ?? null;
    const ok: SourceResult<number | null> = {
      status: "ok",
      value: score,
      provenance: result.provenance,
    };
    if (result.stale === true) ok.stale = true;
    return ok;
  }

  async function dependents(name: string, version: string): Promise<SourceResult<number>> {
    const url = dependentsUrl(name, version);
    const result = await http.get("deps.dev", url);
    if (result.status === "unavailable") return result;
    if (result.status === "not-found") return unavailable(url, "HTTP 404 (not found)");

    const parsed = DepsDevDependentsSchema.safeParse(parseJson(result.value.body));
    if (!parsed.success) {
      return unavailable(url, "deps.dev dependents response has no valid dependentCount");
    }
    const ok: SourceResult<number> = {
      status: "ok",
      value: parsed.data.dependentCount,
      provenance: result.provenance,
    };
    if (result.stale === true) ok.stale = true;
    return ok;
  }

  return { scorecard, dependents };
}
