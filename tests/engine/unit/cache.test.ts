import { describe, expect, it } from "vitest";

import {
  DEFAULT_CACHE_TTL_MS,
  createMemoryCache,
  resolveCacheTtl,
} from "../../../src/engine/cache/cache";
import { cacheKey } from "../../../src/engine/cache/cacheKey";

describe("cacheKey", () => {
  const url = "https://registry.npmjs.org/ip";

  it("is canonical JSON of [source, url, sortedQueryPairs]", () => {
    expect(cacheKey("npm", url, { b: "2", a: "1" })).toBe(
      JSON.stringify(["npm", url, [["a", "1"], ["b", "2"]]]),
    );
  });

  it("ignores query insertion order", () => {
    expect(cacheKey("osv", url, { a: "1", b: "2" })).toBe(cacheKey("osv", url, { b: "2", a: "1" }));
  });

  it("changes when source, url or query changes", () => {
    const base = cacheKey("npm", url, { a: "1" });
    expect(cacheKey("osv", url, { a: "1" })).not.toBe(base);
    expect(cacheKey("npm", url + "x", { a: "1" })).not.toBe(base);
    expect(cacheKey("npm", url, { a: "2" })).not.toBe(base);
    expect(cacheKey("npm", url, {})).not.toBe(base);
  });

  it("takes no credential argument", () => {
    expect(cacheKey.length).toBe(3);
  });
});

describe("createMemoryCache", () => {
  const entry = { body: "{}", status: 200, fetchedAt: "2024-01-01T00:00:00Z" };

  it("returns undefined for a missing key", async () => {
    expect(await createMemoryCache().get("k")).toBeUndefined();
  });

  it("stores and returns body, status and fetchedAt", async () => {
    const cache = createMemoryCache();
    await cache.put("k", entry);
    expect(await cache.get("k")).toEqual(entry);
  });

  it("replaces an existing entry for the same key", async () => {
    const cache = createMemoryCache();
    await cache.put("k", entry);
    const newer = { body: "[]", status: 200, fetchedAt: "2024-01-02T00:00:00Z" };
    await cache.put("k", newer);
    expect(await cache.get("k")).toEqual(newer);
  });

  it("stores only the three entry fields", async () => {
    const cache = createMemoryCache();
    const withExtra = { ...entry, authorization: "Bearer secret" };
    await cache.put("k", withExtra);
    expect(Object.keys((await cache.get("k")) ?? {}).sort()).toEqual(["body", "fetchedAt", "status"]);
  });
});

describe("resolveCacheTtl", () => {
  it("defaults to 24 hours when unset", () => {
    expect(resolveCacheTtl(undefined)).toEqual({ ttlMs: 86_400_000 });
    expect(DEFAULT_CACHE_TTL_MS).toBe(86_400_000);
  });

  it("uses a positive finite configured value", () => {
    expect(resolveCacheTtl(5000)).toEqual({ ttlMs: 5000 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects %s with an error naming the TTL and uses the default",
    (bad) => {
      const r = resolveCacheTtl(bad);
      expect(r.ttlMs).toBe(DEFAULT_CACHE_TTL_MS);
      expect(r.error).toContain("Cache_TTL");
      expect(r.error).toContain(String(bad));
    },
  );
});
