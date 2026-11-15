// Requirements: 2.8, 2.9, 2.11, 3.2, 3.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.9
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { createHttpClient, requestCacheKey } from "../../../src/engine/sources/http";
import type { Cache, CacheEntry, Clock } from "../../../src/engine/types";

const URL_A = "https://registry.npmjs.org/ip";
const TTL = 1000 * 60 * 60;

function clockAt(iso: string): Clock & { set(iso: string): void } {
  let t = new Date(iso);
  return {
    now: () => t,
    set(next: string) {
      t = new Date(next);
    },
  };
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(
  handler: (call: Call) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

function recordingCache(): Cache & { puts: string[]; store: Map<string, CacheEntry> } {
  const store = new Map<string, CacheEntry>();
  const puts: string[] = [];
  return {
    store,
    puts,
    get: (k) => Promise.resolve(store.get(k)),
    put: (k, e) => {
      puts.push(k);
      store.set(k, { ...e });
      return Promise.resolve();
    },
  };
}

const key = (url = URL_A): string => requestCacheKey({ source: "npm", url });

describe("http wrapper", () => {
  it("returns a fresh cache hit (age <= TTL) with zero upstream requests and the original fetchedAt", async () => {
    const cache = recordingCache();
    cache.store.set(key(), { body: "{}", status: 200, fetchedAt: "2026-01-01T00:00:00Z" });
    const { fetch, calls } = fakeFetch(() => new Response("never"));
    const clock = clockAt("2026-01-01T01:00:00Z"); // age exactly TTL
    const http = createHttpClient({ fetch, clock, cache, ttlMs: TTL });
    const r = await http.get("npm", URL_A);
    expect(calls).toHaveLength(0);
    expect(r).toEqual({
      status: "ok",
      value: { body: "{}", status: 200 },
      provenance: [{ sourceUrl: URL_A, fetchedAt: "2026-01-01T00:00:00Z" }],
    });
  });

  it("refetches an expired entry and replaces it with the new fetchedAt", async () => {
    const cache = recordingCache();
    cache.store.set(key(), { body: "old", status: 200, fetchedAt: "2026-01-01T00:00:00Z" });
    const { fetch, calls } = fakeFetch(() => new Response("new", { status: 200 }));
    const clock = clockAt("2026-01-01T02:00:00.789Z");
    const http = createHttpClient({ fetch, clock, cache, ttlMs: TTL });
    const r = await http.get("npm", URL_A);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({
      status: "ok",
      value: { body: "new", status: 200 },
      provenance: [{ sourceUrl: URL_A, fetchedAt: "2026-01-01T02:00:00Z" }],
    });
    expect(cache.store.get(key())).toEqual({
      body: "new",
      status: 200,
      fetchedAt: "2026-01-01T02:00:00Z",
    });
  });

  it("on failure with an expired entry uses it, marks stale and leaves the entry unchanged", async () => {
    const cache = recordingCache();
    const old: CacheEntry = { body: "old", status: 200, fetchedAt: "2026-01-01T00:00:00Z" };
    cache.store.set(key(), { ...old });
    const { fetch } = fakeFetch(() => new Response("boom", { status: 500 }));
    const clock = clockAt("2026-01-02T00:00:00Z");
    const http = createHttpClient({ fetch, clock, cache, ttlMs: TTL });
    const r = await http.get("npm", URL_A);
    expect(r).toEqual({
      status: "ok",
      value: { body: "old", status: 200 },
      provenance: [{ sourceUrl: URL_A, fetchedAt: old.fetchedAt }],
      stale: true,
    });
    expect(cache.store.get(key())).toEqual(old);
    expect(cache.puts).toHaveLength(0);
  });

  it("on failure with no entry reports unavailable and stores nothing", async () => {
    const cache = recordingCache();
    const { fetch } = fakeFetch(() => {
      throw new Error("ECONNRESET");
    });
    const clock = clockAt("2026-01-02T00:00:00.500Z");
    const http = createHttpClient({ fetch, clock, cache, ttlMs: TTL });
    const r = await http.get("npm", URL_A);
    expect(r).toEqual({
      status: "unavailable",
      source: "npm",
      attemptedUrl: URL_A,
      attemptedAt: "2026-01-02T00:00:00Z",
      reason: "request failed: ECONNRESET",
    });
    expect(cache.puts).toHaveLength(0);
    expect(cache.store.size).toBe(0);
  });

  it("maps a timeout to unavailable (signal passed to fetch)", async () => {
    const cache = createMemoryCache();
    let sawSignal = false;
    const { fetch } = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = call.init?.signal;
          sawSignal = signal instanceof AbortSignal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache,
      ttlMs: TTL,
      timeoutMs: 20,
    });
    const r = await http.get("osv", URL_A);
    expect(sawSignal).toBe(true);
    expect(r).toMatchObject({ status: "unavailable", source: "osv", reason: "timed out after 20 ms" });
  });

  it("maps a 429 to unavailable with rateLimitResetAt from x-ratelimit-reset (epoch seconds)", async () => {
    const reset = Date.UTC(2026, 0, 1, 1, 0, 0) / 1000;
    const { fetch } = fakeFetch(
      () => new Response("slow down", { status: 429, headers: { "x-ratelimit-reset": String(reset) } }),
    );
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache: createMemoryCache(),
      ttlMs: TTL,
    });
    const r = await http.get("github", "https://api.github.com/repos/a/b");
    expect(r).toMatchObject({
      status: "unavailable",
      source: "github",
      attemptedUrl: "https://api.github.com/repos/a/b",
      rateLimitResetAt: "2026-01-01T01:00:00Z",
    });
  });

  it("derives rateLimitResetAt from retry-after on a 403, and omits it without a usable header", async () => {
    const cache = createMemoryCache();
    const clock = clockAt("2026-01-01T00:00:00Z");
    const a = fakeFetch(() => new Response("", { status: 403, headers: { "retry-after": "90" } }));
    const r1 = await createHttpClient({ fetch: a.fetch, clock, cache, ttlMs: TTL }).get("github", URL_A);
    expect(r1).toMatchObject({ status: "unavailable", rateLimitResetAt: "2026-01-01T00:01:30Z" });
    const b = fakeFetch(() => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    const r2 = await createHttpClient({ fetch: b.fetch, clock, cache, ttlMs: TTL }).get("github", URL_A);
    expect(r2).toMatchObject({ status: "unavailable" });
    expect(r2).not.toHaveProperty("rateLimitResetAt");
  });

  it("keeps the requested URL as sourceUrl when the response was redirected", async () => {
    const redirected = "https://example.org/moved";
    const { fetch } = fakeFetch(() => {
      const res = new Response("{}", { status: 200 });
      Object.defineProperty(res, "url", { value: redirected });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    });
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache: createMemoryCache(),
      ttlMs: TTL,
    });
    const r = await http.get("npm", URL_A);
    expect(r).toMatchObject({ status: "ok", provenance: [{ sourceUrl: URL_A }] });
  });

  it("returns not-found with fetchedAt from the Clock for 404 and does not cache it", async () => {
    const cache = recordingCache();
    const { fetch } = fakeFetch(() => new Response("nope", { status: 404 }));
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00.789Z"),
      cache,
      ttlMs: TTL,
    });
    expect(await http.get("npm", URL_A)).toEqual({
      status: "not-found",
      source: "npm",
      url: URL_A,
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    expect(cache.puts).toHaveLength(0);
    expect(cache.store.size).toBe(0);
  });

  it("removes the token and Authorization values from error messages and log lines", async () => {
    const token = "ghp_SECRETTOKEN123";
    const logs: string[] = [];
    const { fetch } = fakeFetch(() => {
      throw new Error(`bad credentials for Bearer ${token} and ${token}`);
    });
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache: createMemoryCache(),
      ttlMs: TTL,
      secrets: [token],
      log: (l) => logs.push(l),
    });
    const r = await http.get("github", `https://api.github.com/repos/a/b?access_token=${token}`, {
      headers: { Authorization: "Bearer other-header-secret" },
    });
    const text = JSON.stringify(r) + logs.join("\n");
    expect(r.status).toBe("unavailable");
    expect(text).not.toContain(token);
    expect(text).toContain("[REDACTED]");

    const { fetch: f2 } = fakeFetch(() => {
      throw new Error("denied: other-header-secret");
    });
    const r2 = await createHttpClient({
      fetch: f2,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache: createMemoryCache(),
      ttlMs: TTL,
    }).get("github", URL_A, { headers: { authorization: "Bearer other-header-secret" } });
    expect(JSON.stringify(r2)).not.toContain("other-header-secret");
  });

  it("de-duplicates concurrent requests with the same Cache key", async () => {
    const releases: ((r: Response) => void)[] = [];
    const { fetch, calls } = fakeFetch(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve);
        }),
    );
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache: createMemoryCache(),
      ttlMs: TTL,
    });
    const p1 = http.get("npm", URL_A);
    const p2 = http.get("npm", URL_A);
    const p3 = http.get("npm", "https://registry.npmjs.org/other");
    await new Promise((r) => setTimeout(r, 10));
    expect(releases).toHaveLength(2);
    for (const release of releases) release(new Response("{}", { status: 200 }));
    await Promise.all([p1, p2, p3]);
    expect(calls.map((c) => c.url).sort()).toEqual(
      [URL_A, "https://registry.npmjs.org/other"].sort(),
    );
  });

  it("never puts headers in the Cache key or entry, and keys POST bodies by hash", async () => {
    const cache = recordingCache();
    const { fetch, calls } = fakeFetch(() => new Response('{"vulns":[]}', { status: 200 }));
    const http = createHttpClient({
      fetch,
      clock: clockAt("2026-01-01T00:00:00Z"),
      cache,
      ttlMs: TTL,
    });
    const osv = "https://api.osv.dev/v1/query";
    const body1 = JSON.stringify({ package: { name: "a", ecosystem: "npm" }, version: "1.0.0" });
    const body2 = JSON.stringify({ package: { name: "b", ecosystem: "npm" }, version: "1.0.0" });
    const headers = { Authorization: "Bearer topsecret", "content-type": "application/json" };
    await http.post("osv", osv, body1, { headers });
    await http.post("osv", osv, body2, { headers });
    await http.post("osv", osv, body1, { headers: { "content-type": "application/json" } });
    expect(calls).toHaveLength(2); // third call is a cache hit despite different headers
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(body1);
    expect(cache.puts).toHaveLength(2);
    expect(new Set(cache.puts).size).toBe(2);
    const dump = JSON.stringify([...cache.store.entries()]);
    expect(dump).not.toContain("topsecret");
    expect(dump).not.toContain("Authorization");
    for (const entry of cache.store.values()) {
      expect(Object.keys(entry).sort()).toEqual(["body", "fetchedAt", "status"]);
    }
  });
});
