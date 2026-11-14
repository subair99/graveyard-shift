import type { Cache, CacheEntry } from "../types";

export type { Cache, CacheEntry } from "../types";

/** Default Cache_TTL: 24 hours. */
export const DEFAULT_CACHE_TTL_MS = 86_400_000;

export interface CacheTtlResolution {
  ttlMs: number;
  /** Set when the configured TTL was rejected; `ttlMs` is then the default. */
  error?: string;
}

/**
 * Resolves the Cache_TTL. An unset value gives the default. A value that is
 * not a positive finite number is rejected with an error naming the TTL, and
 * the default is used (R9.7, R9.8).
 */
export function resolveCacheTtl(configured: number | undefined): CacheTtlResolution {
  if (configured === undefined) return { ttlMs: DEFAULT_CACHE_TTL_MS };
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return { ttlMs: configured };
  }
  return {
    ttlMs: DEFAULT_CACHE_TTL_MS,
    error: `Invalid Cache_TTL: ${String(configured)} is not a positive finite number of milliseconds; using the default of ${DEFAULT_CACHE_TTL_MS} ms (24 hours).`,
  };
}

/**
 * Default in-memory store. Entries hold only `{ body, status, fetchedAt }`,
 * copied on the way in and out so callers cannot mutate stored state.
 * `put` replaces any existing entry for the same key. No clock is read here;
 * callers compute age from `fetchedAt` with an injected Clock.
 */
export function createMemoryCache(): Cache {
  const store = new Map<string, CacheEntry>();
  return {
    get(key: string): Promise<CacheEntry | undefined> {
      const entry = store.get(key);
      return Promise.resolve(entry === undefined ? undefined : { ...entry });
    },
    put(key: string, entry: CacheEntry): Promise<void> {
      store.set(key, {
        body: entry.body,
        status: entry.status,
        fetchedAt: entry.fetchedAt,
      });
      return Promise.resolve();
    },
  };
}
