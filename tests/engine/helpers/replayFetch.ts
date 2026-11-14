/**
 * Replay `fetch` for fixture tests (R11.4, R11.6).
 *
 * Serves ONLY recorded files from fixture directories such as
 * `tests/engine/fixtures/<package>/`. Each file is JSON:
 * `{ cacheKey, sourceUrl, body, status, fetchedAt }`.
 *
 * Matching: the incoming request (method, URL, body) is turned into the same
 * cache key the HTTP wrapper uses (`requestCacheKey`, so POST includes the
 * body hash). The request carries no source name, so the key is tried for each
 * source name. Request headers (including Authorization) are ignored and never
 * stored. Redirects are not simulated: the recorded status and body are returned
 * as is. There is no network fallback and the real `fetch` is never called.
 *
 * Usage in a fixture test: inject the replay fetch, a fixed Clock and a fixed
 * `analysisDate`, so two runs give identical output:
 *
 *   const replay = createReplayFetch([fixtureDir("ip")]);
 *   const clock = { now: () => new Date("2026-01-01T00:00:00Z") };
 *   // pass `replay.fetch`, `clock` and `analysisDate: "2026-01-01"` to the engine
 *   replay.assertNoUnrecordedRequests();
 *
 * The engine's HTTP layer stamps `fetchedAt` from the injected Clock; the
 * recorded `fetchedAt` is not used when replaying through a fresh Cache.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requestCacheKey } from "../../../src/engine/sources/http";
import { SourceNameSchema } from "../../../src/engine/types";
import type { SourceName } from "../../../src/engine/types";

/** Thrown for a request with no recorded file. */
export class UnrecordedRequestError extends Error {
  readonly method: string;
  readonly url: string;
  readonly cacheKey: string;
  constructor(method: string, url: string, missingCacheKey: string) {
    super(`Unrecorded request: ${method} ${url} (cache key ${missingCacheKey})`);
    this.name = "UnrecordedRequestError";
    this.method = method;
    this.url = url;
    this.cacheKey = missingCacheKey;
  }
}

/** Thrown for a fixture file with missing fields or an unparseable body. */
export class FixtureUnparseableError extends Error {
  readonly file: string;
  constructor(file: string, detail: string) {
    super(`Unparseable fixture ${file}: ${detail}`);
    this.name = "FixtureUnparseableError";
    this.file = file;
  }
}

export interface ReplayCall {
  method: string;
  url: string;
  /** Matching cache key, or the source-less key tried first when unrecorded. */
  cacheKey: string;
  recorded: boolean;
}

export interface ReplayFetch {
  fetch: typeof fetch;
  /** Every request made, in order, including unrecorded ones. Never holds headers. */
  readonly calls: readonly ReplayCall[];
  /** Calls that had no recorded file. */
  unrecordedCalls(): ReplayCall[];
  /** Throws if any request was unrecorded. Use to assert zero network requests. */
  assertNoUnrecordedRequests(): void;
}

interface Recorded {
  file: string;
  body: string;
  status: number;
}

type Slot = { ok: Recorded } | { error: FixtureUnparseableError };

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
const SOURCES: readonly SourceName[] = SourceNameSchema.options;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadFile(path: string, label: string): { key?: string; slot: Slot } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { slot: { error: new FixtureUnparseableError(label, `not valid JSON (${detail})`) } };
  }
  if (!isRecord(parsed)) {
    return { slot: { error: new FixtureUnparseableError(label, "not a JSON object") } };
  }
  const key = typeof parsed["cacheKey"] === "string" ? parsed["cacheKey"] : undefined;
  const fail = (detail: string): { key?: string; slot: Slot } => {
    const result: { key?: string; slot: Slot } = {
      slot: { error: new FixtureUnparseableError(label, detail) },
    };
    if (key !== undefined) result.key = key;
    return result;
  };
  for (const field of ["cacheKey", "sourceUrl", "body", "fetchedAt"] as const) {
    if (typeof parsed[field] !== "string") return fail(`missing or invalid field "${field}"`);
  }
  const status = parsed["status"];
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) {
    return fail('missing or invalid field "status"');
  }
  return {
    key,
    slot: { ok: { file: label, body: parsed["body"] as string, status } },
  };
}

/**
 * Builds a replay `fetch` from fixture directories (each holding `*.json` files).
 * A directory that cannot be read throws the underlying filesystem error.
 */
export function createReplayFetch(directories: readonly string[]): ReplayFetch {
  const byKey = new Map<string, Slot>();
  const unreadable: FixtureUnparseableError[] = [];
  for (const dir of directories) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
      const label = join(dir, name);
      const { key, slot } = loadFile(label, label);
      if (key !== undefined) byKey.set(key, slot);
      else if ("error" in slot) unreadable.push(slot.error);
    }
  }

  const calls: ReplayCall[] = [];

  const replay: typeof fetch = (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (request?.url ?? "");
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      return Promise.reject(new TypeError(`replayFetch supports GET and POST only, got ${method}`));
    }
    const body = init?.body;
    if (body !== undefined && body !== null && typeof body !== "string") {
      return Promise.reject(new TypeError("replayFetch supports string request bodies only"));
    }
    const candidates = SOURCES.map((source) =>
      requestCacheKey({
        source,
        url,
        method,
        ...(typeof body === "string" ? { body } : {}),
      }),
    );
    const hit = candidates.find((key) => byKey.has(key));
    if (hit === undefined) {
      const first = candidates[0] ?? "";
      calls.push({ method, url, cacheKey: first, recorded: false });
      const bad = unreadable[0];
      return Promise.reject(bad ?? new UnrecordedRequestError(method, url, first));
    }
    calls.push({ method, url, cacheKey: hit, recorded: true });
    const slot = byKey.get(hit);
    if (slot === undefined || "error" in slot) {
      return Promise.reject(slot?.error);
    }
    const { status, body: text } = slot.ok;
    return Promise.resolve(
      new Response(NULL_BODY_STATUSES.has(status) ? null : text, { status }),
    );
  };

  return {
    fetch: replay,
    calls,
    unrecordedCalls: () => calls.filter((c) => !c.recorded),
    assertNoUnrecordedRequests: () => {
      const missing = calls.filter((c) => !c.recorded);
      if (missing.length > 0) {
        throw new Error(
          `${missing.length} unrecorded request(s): ${missing
            .map((c) => `${c.method} ${c.url}`)
            .join(", ")}`,
        );
      }
    },
  };
}
