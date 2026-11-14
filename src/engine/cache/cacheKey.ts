import type { SourceName } from "../types";

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Cache key: canonical JSON of `[source, url, sortedQueryPairs]`.
 * Query pairs are sorted by name (then value) using code-unit order, so the
 * key does not depend on property insertion order. The function takes no
 * credential argument: headers and tokens can never reach the key.
 */
export function cacheKey(
  source: SourceName,
  url: string,
  query: Record<string, string>,
): string {
  const pairs: [string, string][] = Object.entries(query).sort(
    ([ak, av], [bk, bv]) => compareCodeUnits(ak, bk) || compareCodeUnits(av, bv),
  );
  return JSON.stringify([source, url, pairs]);
}
