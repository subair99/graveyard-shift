import { createHash } from "node:crypto";
import { cacheKey } from "../cache/cacheKey";
import type { Cache, CacheEntry, Clock, SourceName, SourceResult } from "../types";

/** Request timeout applied through `AbortSignal.timeout` (R2.9). */
export const HTTP_TIMEOUT_MS = 10_000;

/** Longest Source_URL the engine records (R3.2). */
export const MAX_SOURCE_URL_LENGTH = 2048;

/** Body and status of a successful (2xx) upstream response. */
export interface HttpResponse {
  body: string;
  status: number;
}

/**
 * Result of one request. Outcomes:
 * - `ok`: a 2xx response, from the Cache (age <= TTL), from upstream, or from an
 *   expired entry after an upstream failure (then `stale: true`). `provenance`
 *   holds one entry: the requested URL (before redirects) and the original
 *   `fetchedAt` of the stored or fetched response.
 * - `not-found`: upstream answered 404. Only successful 2xx bodies are cached,
 *   so a 404 is never stored. It is not a failure: it does not fall back to a
 *   stale entry and it leaves any existing entry unchanged. It carries `url` (the
 *   requested URL) and `fetchedAt` (the Clock reading when the response was
 *   received, second precision UTC), so it can be recorded as a Fact. Callers that need
 *   "does not exist" semantics (npm packument, successor lookup) use it directly.
 * - `unavailable`: network error, timeout, rate limit, or any other non-2xx
 *   status, with no usable stored entry.
 */
export type HttpResult = SourceResult<HttpResponse>;

export interface HttpDeps {
  fetch: typeof fetch;
  clock: Clock;
  cache: Cache;
  /** Cache_TTL in ms. A cache entry with age <= ttlMs is a hit. */
  ttlMs: number;
  /**
   * Secret values (for example the GitHub token) to remove from every error
   * message and log line. Authorization header values are always redacted too.
   */
  secrets?: readonly string[];
  /** Overrides the 10 s timeout. For tests only. */
  timeoutMs?: number;
  /** Receives redacted log lines. */
  log?: (line: string) => void;
}

export interface HttpRequestOptions {
  source: SourceName;
  /** Absolute URL. Recorded as `sourceUrl` exactly as given, before redirects. */
  url: string;
  /** Default `GET`. */
  method?: "GET" | "POST";
  /**
   * Extra Cache key query pairs, for parameters that are not already part of
   * `url`. Optional.
   */
  query?: Record<string, string>;
  /**
   * Request body (POST), for example `JSON.stringify(...)`. Its SHA-256 is added
   * to the Cache key, so different bodies never share an entry. The body is
   * sent as is and never stored in the Cache.
   */
  body?: string;
  /**
   * Request headers, such as `Authorization`. Passed to `fetch` only. They
   * never reach the Cache key or entry. Set `content-type` yourself for POST.
   */
  headers?: Record<string, string>;
}

export interface HttpClient {
  request(options: HttpRequestOptions): Promise<HttpResult>;
  /** GET shorthand. */
  get(
    source: SourceName,
    url: string,
    options?: Omit<HttpRequestOptions, "source" | "url" | "method" | "body">,
  ): Promise<HttpResult>;
  /** POST shorthand with a string body. */
  post(
    source: SourceName,
    url: string,
    body: string,
    options?: Omit<HttpRequestOptions, "source" | "url" | "method" | "body">,
  ): Promise<HttpResult>;
}

/** `YYYY-MM-DDTHH:mm:ssZ`, truncated to whole seconds. */
export function formatTimestamp(date: Date): string {
  const seconds = Math.floor(date.getTime() / 1000) * 1000;
  return new Date(seconds).toISOString().replace(".000Z", "Z");
}

/** Cache key for a request: body hash and method (when not GET) join the query pairs. */
export function requestCacheKey(options: HttpRequestOptions): string {
  const query: Record<string, string> = { ...(options.query ?? {}) };
  if (options.method === "POST") query["__method"] = "POST";
  if (options.body !== undefined) {
    query["__bodySha256"] = createHash("sha256").update(options.body).digest("hex");
  }
  return cacheKey(options.source, options.url, query);
}

/** Removes every occurrence of each secret from `text`. Longest secrets first. */
export function redact(text: string, secrets: readonly string[]): string {
  const ordered = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of ordered) out = out.split(secret).join("[REDACTED]");
  return out;
}

/** Authorization header values, plus the credential part after a scheme such as `Bearer`. */
function authorizationSecrets(headers: Record<string, string> | undefined): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== "authorization") continue;
    found.push(value);
    const space = value.indexOf(" ");
    if (space > 0) found.push(value.slice(space + 1).trim());
  }
  return found;
}

function parseRateLimitReset(
  headers: Headers,
  now: Date,
): { rateLimit: boolean; resetAt?: string } {
  const reset = headers.get("x-ratelimit-reset");
  const retryAfter = headers.get("retry-after");
  const rateLimit =
    reset !== null || retryAfter !== null || headers.get("x-ratelimit-remaining") !== null;
  if (reset !== null && /^\d+$/.test(reset.trim())) {
    const ms = Number(reset.trim()) * 1000;
    if (Number.isSafeInteger(ms) && !Number.isNaN(new Date(ms).getTime())) {
      return { rateLimit, resetAt: formatTimestamp(new Date(ms)) };
    }
  }
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim();
    if (/^\d+$/.test(trimmed)) {
      const at = new Date(now.getTime() + Number(trimmed) * 1000);
      if (!Number.isNaN(at.getTime())) return { rateLimit, resetAt: formatTimestamp(at) };
    } else {
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return { rateLimit, resetAt: formatTimestamp(new Date(parsed)) };
    }
  }
  return { rateLimit };
}

type Attempt =
  | { kind: "ok"; response: HttpResponse }
  | { kind: "not-found"; fetchedAt: string }
  | { kind: "failed"; reason: string; rateLimitResetAt?: string };

function raceAbort<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Creates the HTTP wrapper shared by the four source clients. It owns the
 * in-flight table, so concurrent requests with the same Cache key share one
 * upstream call (R9.9). Never throws: every failure becomes `unavailable`.
 */
export function createHttpClient(deps: HttpDeps): HttpClient {
  const inflight = new Map<string, Promise<HttpResult>>();
  const timeoutMs = deps.timeoutMs ?? HTTP_TIMEOUT_MS;

  async function attempt(options: HttpRequestOptions, secrets: readonly string[]): Promise<Attempt> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const init: RequestInit = { method: options.method ?? "GET", signal };
      if (options.headers !== undefined) init.headers = { ...options.headers };
      if (options.body !== undefined) init.body = options.body;
      const outcome = await raceAbort(
        signal,
        (async () => {
          const response = await deps.fetch(options.url, init);
          const text = await response.text();
          return { response, text };
        })(),
      );
      const { response, text } = outcome;
      if (response.status >= 200 && response.status < 300) {
        return { kind: "ok", response: { body: text, status: response.status } };
      }
      if (response.status === 404) {
        return { kind: "not-found", fetchedAt: formatTimestamp(deps.clock.now()) };
      }
      if (response.status === 403 || response.status === 429) {
        const limit = parseRateLimitReset(response.headers, deps.clock.now());
        if (limit.rateLimit) {
          const failed: Attempt = {
            kind: "failed",
            reason: `rate limited (HTTP ${response.status})`,
          };
          if (limit.resetAt !== undefined) failed.rateLimitResetAt = limit.resetAt;
          return failed;
        }
      }
      return { kind: "failed", reason: `HTTP ${response.status}` };
    } catch (error) {
      if (signal.aborted) return { kind: "failed", reason: `timed out after ${timeoutMs} ms` };
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "failed", reason: redact(`request failed: ${message}`, secrets) };
    }
  }

  async function run(options: HttpRequestOptions, key: string): Promise<HttpResult> {
    const secrets = [...(deps.secrets ?? []), ...authorizationSecrets(options.headers)];
    const method = options.method ?? "GET";
    const log = (line: string): void => deps.log?.(redact(line, secrets));
    const attemptedUrl = redact(options.url, secrets);
    const unavailable = (reason: string, rateLimitResetAt?: string): HttpResult => {
      const result: HttpResult = {
        status: "unavailable",
        source: options.source,
        attemptedUrl,
        attemptedAt: formatTimestamp(deps.clock.now()),
        reason: redact(reason, secrets),
      };
      if (rateLimitResetAt !== undefined) result.rateLimitResetAt = rateLimitResetAt;
      return result;
    };

    if (options.url.length > MAX_SOURCE_URL_LENGTH) {
      return unavailable(`URL longer than ${MAX_SOURCE_URL_LENGTH} characters`);
    }

    let entry: CacheEntry | undefined;
    try {
      entry = await deps.cache.get(key);
    } catch {
      entry = undefined;
    }

    const fromEntry = (e: CacheEntry, stale: boolean): HttpResult => {
      const result: HttpResult = {
        status: "ok",
        value: { body: e.body, status: e.status },
        provenance: [{ sourceUrl: options.url, fetchedAt: e.fetchedAt }],
      };
      if (stale) result.stale = true;
      return result;
    };

    if (entry !== undefined) {
      const storedAt = Date.parse(entry.fetchedAt);
      if (!Number.isNaN(storedAt)) {
        const age = deps.clock.now().getTime() - storedAt;
        if (age <= deps.ttlMs) return fromEntry(entry, false);
      } else {
        entry = undefined; // unreadable timestamp: not a usable entry
      }
    }

    const outcome = await attempt(options, secrets);

    if (outcome.kind === "ok") {
      const fetchedAt = formatTimestamp(deps.clock.now());
      try {
        await deps.cache.put(key, {
          body: outcome.response.body,
          status: outcome.response.status,
          fetchedAt,
        });
      } catch {
        log(`[http] ${options.source} ${method} ${options.url}: cache write failed`);
      }
      return {
        status: "ok",
        value: outcome.response,
        provenance: [{ sourceUrl: options.url, fetchedAt }],
      };
    }

    if (outcome.kind === "not-found") {
      return {
        status: "not-found",
        source: options.source,
        url: options.url,
        fetchedAt: outcome.fetchedAt,
      };
    }

    log(`[http] ${options.source} ${method} ${options.url} failed: ${outcome.reason}`);
    if (entry !== undefined) {
      log(`[http] ${options.source} ${method} ${options.url}: using stale cache entry`);
      return fromEntry(entry, true);
    }
    return unavailable(outcome.reason, outcome.rateLimitResetAt);
  }

  function request(options: HttpRequestOptions): Promise<HttpResult> {
    const key = requestCacheKey(options);
    const existing = inflight.get(key);
    if (existing !== undefined) return existing;
    const promise = run(options, key).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  return {
    request,
    get: (source, url, options) => request({ ...options, source, url, method: "GET" }),
    post: (source, url, body, options) =>
      request({ ...options, source, url, method: "POST", body }),
  };
}
