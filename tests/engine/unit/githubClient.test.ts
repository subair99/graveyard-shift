// Requirements: 2.4, 2.6, 2.7, 2.8, 2.11, 2.12
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { createGitHubClient, parseGitHubRepo } from "../../../src/engine/sources/github";
import { createHttpClient } from "../../../src/engine/sources/http";
import type { CacheEntry, Clock } from "../../../src/engine/types";

const TOKEN = "ghp_SuperSecretToken123";
const API = "https://api.github.com/repos/o/r";
const clock: Clock = { now: () => new Date("2026-03-01T10:00:00.789Z") };

interface Call {
  url: string;
  headers: Record<string, string>;
}

function setup(respond: (call: Call) => Response, token?: string) {
  const calls: Call[] = [];
  const store = new Map<string, CacheEntry>();
  const cache = {
    get: async (k: string) => store.get(k),
    put: async (k: string, e: CacheEntry) => {
      store.set(k, e);
    },
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    };
    calls.push(call);
    return respond(call);
  };
  const http = createHttpClient({
    fetch: fetchFn,
    clock,
    cache: cache ?? createMemoryCache(),
    ttlMs: 3_600_000,
    secrets: token === undefined ? [] : [token],
  });
  return { client: createGitHubClient(http, { token }), calls, store };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe("parseGitHubRepo", () => {
  const ok: [string, string, string][] = [
    ["https://github.com/o/r", "o", "r"],
    ["https://github.com/o/r.git", "o", "r"],
    ["git+https://github.com/o/r.git", "o", "r"],
    ["git://github.com/o/r.git", "o", "r"],
    ["ssh://git@github.com/o/r.git", "o", "r"],
    ["git@github.com:o/r.git", "o", "r"],
    ["git@github.com:o/r", "o", "r"],
    ["github:o/r", "o", "r"],
    ["https://www.github.com/o/r", "o", "r"],
    ["https://GitHub.com/o/r/tree/main/src", "o", "r"],
    ["https://github.com/o/r.git#readme", "o", "r"],
    ["https://github.com/o/r/issues?x=1", "o", "r"],
    ["https://github.com/o/my.repo-js", "o", "my.repo-js"],
  ];
  it.each(ok)("accepts %s", (url, owner, repo) => {
    expect(parseGitHubRepo(url)).toEqual({ owner, repo });
  });

  const bad = [
    "",
    "https://notgithub.com/o/r",
    "https://github.com.evil.com/o/r",
    "https://evil.com/github.com/o/r",
    "https://github.com@evil.com/o/r",
    "https://gist.github.com/o/r",
    "https://gitlab.com/o/r",
    "https://bitbucket.org/o/r",
    "git@gitlab.com:o/r.git",
    "git@notgithub.com:o/r.git",
    "https://github.com/o",
    "https://github.com/",
    "https://github.com/o/..",
    "ftp://github.com/o/r",
    "not a url",
    "o/r",
  ];
  it.each(bad)("rejects %j", (url) => {
    expect(parseGitHubRepo(url)).toBeNull();
  });
});

describe("GitHub client", () => {
  it("skips without any request when there is no github.com URL", async () => {
    const { client, calls } = setup(() => json({}));
    const reason = "no github.com repository URL was available";
    expect(await client.fetchRepo(undefined)).toEqual({ result: { status: "skipped", reason }, tokenUsed: false });
    expect(await client.fetchRepo("https://gitlab.com/o/r")).toEqual({
      result: { status: "skipped", reason },
      tokenUsed: false,
    });
    expect(calls).toHaveLength(0);
  });

  it("sends the bearer header only with a token", async () => {
    const withToken = setup(() => json({ archived: false, pushed_at: null }), TOKEN);
    const a = await withToken.client.fetchRepo("https://github.com/o/r");
    expect(a.tokenUsed).toBe(true);
    expect(withToken.calls[0]?.url).toBe(API);
    expect(withToken.calls[0]?.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(withToken.calls[0]?.headers["Accept"]).toBe("application/vnd.github+json");
    expect(withToken.calls[0]?.headers["X-GitHub-Api-Version"]).toBeDefined();

    const without = setup(() => json({ archived: false }));
    const b = await without.client.fetchRepo("https://github.com/o/r");
    expect(b.tokenUsed).toBe(false);
    expect(Object.keys(without.calls[0]?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("authorization");

    const blank = setup(() => json({ archived: false }), "  ");
    expect((await blank.client.fetchRepo("github:o/r")).tokenUsed).toBe(false);
  });

  it.each([true, false])("returns archived=%s with provenance", async (archived) => {
    const { client } = setup(() => json({ archived, pushed_at: "2024-05-06T07:08:09Z" }));
    const { result } = await client.fetchRepo("git@github.com:o/r.git");
    expect(result).toEqual({
      status: "ok",
      value: { archived, pushedAt: "2024-05-06T07:08:09Z" },
      provenance: [{ sourceUrl: API, fetchedAt: "2026-03-01T10:00:00Z" }],
    });
  });

  it("normalizes pushed_at to second-precision UTC and handles null/missing", async () => {
    const a = setup(() => json({ archived: false, pushed_at: "2024-05-06T09:08:09.987+02:00" }));
    expect((await a.client.fetchRepo("github:o/r")).result).toMatchObject({
      value: { pushedAt: "2024-05-06T07:08:09Z" },
    });
    const b = setup(() => json({ archived: false }));
    expect((await b.client.fetchRepo("github:o/r")).result).toMatchObject({ value: { pushedAt: null } });
  });

  it("maps a rate limit to unavailable with rateLimitResetAt", async () => {
    const reset = Date.parse("2026-03-01T11:00:00Z") / 1000;
    const { client } = setup(
      () => new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }),
      TOKEN,
    );
    const { result } = await client.fetchRepo("github:o/r");
    expect(result).toMatchObject({ status: "unavailable", source: "github", rateLimitResetAt: "2026-03-01T11:00:00Z" });
  });

  it("returns not-found for 404 and follows moved repos via redirect handling without throwing", async () => {
    const nf = setup(() => json({ message: "Not Found" }, 404));
    expect((await nf.client.fetchRepo("github:o/r")).result).toEqual({
      status: "not-found",
      source: "github",
      url: API,
      fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });
    const moved = setup(() => json({ message: "Moved Permanently" }, 301));
    expect((await moved.client.fetchRepo("github:o/r")).result).toMatchObject({ status: "unavailable" });
  });

  it("reports unparseable bodies as unavailable", async () => {
    const bad = setup(() => new Response("<html>", { status: 200 }));
    expect((await bad.client.fetchRepo("github:o/r")).result).toMatchObject({
      status: "unavailable",
      reason: "response was not valid JSON",
    });
    const shape = setup(() => json({ archived: "yes" }));
    expect((await shape.client.fetchRepo("github:o/r")).result).toMatchObject({ status: "unavailable" });
  });

  it("keeps the token out of errors, results and the cache", async () => {
    const failing = setup(() => {
      throw new Error(`connect failed with Bearer ${TOKEN}`);
    }, TOKEN);
    const failed = await failing.client.fetchRepo("github:o/r");
    expect(JSON.stringify(failed)).not.toContain(TOKEN);

    const good = setup(() => json({ archived: false, pushed_at: "2024-01-01T00:00:00Z" }), TOKEN);
    const ok = await good.client.fetchRepo("github:o/r");
    expect(JSON.stringify(ok)).not.toContain(TOKEN);
    expect(JSON.stringify([...good.store.entries()])).not.toContain(TOKEN);
    expect(good.calls[0]?.url).not.toContain(TOKEN);
  });
});
