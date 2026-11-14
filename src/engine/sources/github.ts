import { NO_GITHUB_REPOSITORY_REASON } from "../reasons";
import type { GitHubSignal, GitHubSkipped } from "../core/certificate";
import { GitHubRepoSchema } from "../types";
import type { SourceResult } from "../types";
import { formatTimestamp } from "./http";
import type { HttpClient } from "./http";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubFetchResult {
  /** The value for `Signals.github`. */
  result: SourceResult<GitHubSignal> | GitHubSkipped;
  /**
   * Whether the request carried a token. `false` when no token was configured
   * or when no request was made. Feeds `Signals.githubTokenUsed` and
   * `notes.githubTokenUsed` (R2.6, R2.7).
   */
  tokenUsed: boolean;
}

export interface GitHubClient {
  /** Fetches repository facts for a repository URL. Never throws. */
  fetchRepo(repositoryUrl: string | undefined): Promise<GitHubFetchResult>;
}

export interface GitHubClientOptions {
  /**
   * GitHub token from `EngineConfig.githubToken`. The caller reads
   * `GITHUB_TOKEN` from the environment; this module never touches process.env.
   * An empty or blank token counts as no token.
   */
  token?: string | undefined;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*)$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const URL_PROTOCOLS = new Set(["https:", "http:", "git:", "ssh:"]);

function toRef(ownerRaw: string | undefined, repoRaw: string | undefined): GitHubRepoRef | null {
  if (ownerRaw === undefined || repoRaw === undefined) return null;
  const repo = repoRaw.replace(/\.git$/i, "");
  if (!OWNER_PATTERN.test(ownerRaw)) return null;
  if (repo === "" || repo === "." || repo === ".." || !REPO_PATTERN.test(repo)) return null;
  return { owner: ownerRaw, repo };
}

/**
 * Extracts `{ owner, repo }` from a github.com repository URL, or null.
 * Accepts https, http, git+https, git://, ssh://, scp-style `git@github.com:o/r.git`
 * and `github:o/r`, with or without `.git`, `www.` and a trailing path, query or
 * `#hash`. Other hosts (`notgithub.com`, `github.com.evil.com`, gist.github.com)
 * give null. Pure: no I/O.
 */
export function parseGitHubRepo(url: string): GitHubRepoRef | null {
  const text = url.trim();
  if (text === "") return null;

  const shorthand = /^github:([^/#?\s]+)\/([^/#?\s]+)/i.exec(text);
  if (shorthand) return toRef(shorthand[1], shorthand[2]);

  const scp = /^(?:[A-Za-z0-9_.-]+@)?github\.com:([^/#?\s]+)\/([^/#?\s]+)/i.exec(text);
  if (scp && !text.includes("://")) return toRef(scp[1], scp[2]);

  let parsed: URL;
  try {
    parsed = new URL(text.replace(/^git\+/i, ""));
  } catch {
    return null;
  }
  if (!URL_PROTOCOLS.has(parsed.protocol)) return null;
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  return toRef(segments[0], segments[1]);
}

/** Second-precision UTC `YYYY-MM-DDTHH:mm:ssZ`, or null when `value` is not a date. */
function normalizePushedAt(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return formatTimestamp(new Date(ms));
}

/**
 * Creates the GitHub Source_Client.
 *
 * Token handling (R2.8): the orchestrator MUST create the shared `http` client
 * with `secrets: [token]` so any error message or log line containing the token
 * is redacted. The token is sent only in the `Authorization` header. It is
 * never part of the URL, Cache key, result or error.
 */
export function createGitHubClient(http: HttpClient, options: GitHubClientOptions = {}): GitHubClient {
  const token = options.token !== undefined && options.token.trim() !== "" ? options.token.trim() : undefined;

  async function fetchRepo(repositoryUrl: string | undefined): Promise<GitHubFetchResult> {
    const ref = repositoryUrl === undefined ? null : parseGitHubRepo(repositoryUrl);
    if (ref === null) {
      return { result: { status: "skipped", reason: NO_GITHUB_REPOSITORY_REASON }, tokenUsed: false };
    }

    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;

    const response = await http.get("github", apiUrl, { headers });
    const tokenUsed = token !== undefined;
    if (response.status !== "ok") return { result: response, tokenUsed };

    const fetchedAt = response.provenance[0]?.fetchedAt ?? "";
    const failParse = (reason: string): GitHubFetchResult => ({
      result: { status: "unavailable", source: "github", attemptedUrl: apiUrl, attemptedAt: fetchedAt, reason },
      tokenUsed,
    });

    let json: unknown;
    try {
      json = JSON.parse(response.value.body);
    } catch {
      return failParse("response was not valid JSON");
    }
    const repo = GitHubRepoSchema.safeParse(json);
    if (!repo.success) return failParse("response did not match the expected repository shape");

    const value: GitHubSignal = {
      archived: repo.data.archived,
      pushedAt: normalizePushedAt(repo.data.pushed_at),
    };
    const result: SourceResult<GitHubSignal> = {
      status: "ok",
      value,
      provenance: response.provenance,
    };
    if (response.stale === true) result.stale = true;
    return { result, tokenUsed };
  }

  return { fetchRepo };
}
