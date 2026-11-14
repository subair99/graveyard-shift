/**
 * Fixture recording logic (task 9.1). Testable: fetch, clock, output directory
 * and token are injected. The CLI wrapper is `scripts/recordFixtures.ts`.
 *
 * Recorded files are written from Cache entries (`{ body, status, fetchedAt }`,
 * which hold no credentials by design) plus captured 404 responses (status and
 * body only). Request objects and headers are never read for recording.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAutopsy } from "../../src/engine/autopsy";
import { createMemoryCache } from "../../src/engine/cache/cache";
import { formatTimestamp, requestCacheKey } from "../../src/engine/sources/http";
import type { Cache, CacheEntry, Clock, EngineInput, SourceName } from "../../src/engine/types";

/** Packages recorded by default (docs/demo-packages.md). */
export const DEMO_PACKAGES: readonly { name: string; version: string }[] = [
  { name: "inflight", version: "1.0.6" },
  { name: "ip", version: "2.0.1" },
  { name: "lodash.set", version: "4.3.2" },
];

/** The only fields a fixture file may contain. */
export interface FixtureFile {
  cacheKey: string;
  sourceUrl: string;
  body: string;
  status: number;
  fetchedAt: string;
}

export interface RecordOptions {
  fetch: typeof fetch;
  clock: Clock;
  /** Directory that receives one sub-directory per package. */
  outDir: string;
  /** GITHUB_TOKEN value. Empty or undefined runs unauthenticated. Never printed or written. */
  token?: string | undefined;
  packages?: readonly { name: string; version: string }[];
  force?: boolean;
  dryRun?: boolean;
  /** Receives console lines. Never receives the token. */
  log?: (line: string) => void;
}

export interface RecordSummary {
  dryRun: boolean;
  /** Files written (or that would be written in a dry run is not known: 0), per package. */
  written: Record<string, number>;
}

/** Thrown when a fixture would contain a credential. The message never holds the token. */
export class FixtureSecretError extends Error {
  readonly file: string;
  constructor(file: string, what: string) {
    super(`Refusing to write fixture ${file}: content contains ${what}. Nothing was written.`);
    this.name = "FixtureSecretError";
    this.file = file;
  }
}

const HOST_SOURCES: Record<string, SourceName> = {
  "registry.npmjs.org": "npm",
  "api.npmjs.org": "npm",
  "api.osv.dev": "osv",
  "api.deps.dev": "deps.dev",
  "api.github.com": "github",
};

function sourceForUrl(url: string): SourceName | undefined {
  try {
    return HOST_SOURCES[new URL(url).hostname];
  } catch {
    return undefined;
  }
}

/** File name for a cache key: `<source>-<first 12 hex of sha256(cacheKey)>.json`. */
export function fixtureFileName(source: string, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `${source.replace(/[^A-Za-z0-9.]/g, "_")}-${hash}.json`;
}

function sourceOfCacheKey(key: string): string {
  try {
    const parsed: unknown = JSON.parse(key);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
  } catch {
    // fall through
  }
  return "unknown";
}

/** `sourceUrl` is the URL element of the cache key. */
function sourceUrlOfCacheKey(key: string): string {
  const parsed: unknown = JSON.parse(key);
  if (Array.isArray(parsed) && typeof parsed[1] === "string") return parsed[1];
  throw new Error(`Malformed cache key: ${key}`);
}

function toFixture(key: string, entry: CacheEntry): FixtureFile {
  return {
    cacheKey: key,
    sourceUrl: sourceUrlOfCacheKey(key),
    body: entry.body,
    status: entry.status,
    fetchedAt: entry.fetchedAt,
  };
}

/** Throws FixtureSecretError when `content` holds the token, "Authorization" or "Bearer". */
export function assertNoSecrets(file: string, content: string, token: string | undefined): void {
  if (token !== undefined && token !== "" && content.includes(token)) {
    throw new FixtureSecretError(file, "the GitHub token value");
  }
  if (content.includes("Authorization")) throw new FixtureSecretError(file, '"Authorization"');
  if (content.includes("Bearer")) throw new FixtureSecretError(file, '"Bearer"');
}

/** Cache wrapper that remembers every `put`. */
function capturingCache(): { cache: Cache; entries: Map<string, CacheEntry> } {
  const inner = createMemoryCache();
  const entries = new Map<string, CacheEntry>();
  const cache: Cache = {
    get: (key) => inner.get(key),
    put: async (key, entry) => {
      entries.set(key, { body: entry.body, status: entry.status, fetchedAt: entry.fetchedAt });
      await inner.put(key, entry);
    },
  };
  return { cache, entries };
}

/**
 * Wraps `fetch` to capture 404 responses (the engine does not cache them).
 * Only the response status and body are read; headers are never touched.
 */
function capturing404Fetch(
  real: typeof fetch,
  clock: Clock,
  notFound: Map<string, CacheEntry>,
): typeof fetch {
  return async (input, init) => {
    const response = await real(input, init);
    if (response.status !== 404) return response;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const source = sourceForUrl(url);
    if (source !== undefined && (method === "GET" || method === "POST")) {
      const body = init?.body;
      const key = requestCacheKey({
        source,
        url,
        method,
        ...(typeof body === "string" ? { body } : {}),
      });
      const text = await response.clone().text();
      notFound.set(key, { body: text, status: 404, fetchedAt: formatTimestamp(clock.now()) });
    }
    return response;
  };
}

function existingFixtureFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json"));
}

/**
 * Runs the engine once per package and writes the recorded upstream responses to
 * `<outDir>/<package>/`. All packages are fetched and scanned for secrets before
 * any file is written.
 */
export async function recordFixtures(options: RecordOptions): Promise<RecordSummary> {
  const log = options.log ?? ((): void => undefined);
  const packages = options.packages ?? DEMO_PACKAGES;
  const token = options.token !== undefined && options.token.trim() !== "" ? options.token.trim() : undefined;
  const force = options.force === true;

  log(
    token === undefined
      ? "GITHUB_TOKEN is not set: GitHub requests run unauthenticated (rate limit is low)."
      : "GITHUB_TOKEN is set: GitHub requests are authenticated.",
  );

  const existing = packages.filter((p) => existingFixtureFiles(join(options.outDir, p.name)).length > 0);
  if (existing.length > 0 && !force) {
    throw new Error(
      `Fixtures already exist for: ${existing.map((p) => p.name).join(", ")}. Use --force to overwrite.`,
    );
  }

  if (options.dryRun === true) {
    for (const p of packages) {
      log(`[dry run] would record ${p.name}@${p.version} into ${join(options.outDir, p.name)}`);
    }
    log("[dry run] no network requests made, nothing written.");
    return { dryRun: true, written: {} };
  }

  const pending: { dir: string; name: string; files: { fileName: string; text: string }[] }[] = [];
  for (const p of packages) {
    const { cache, entries } = capturingCache();
    const notFound = new Map<string, CacheEntry>();
    const input: EngineInput = { kind: "name", name: p.name, version: p.version };
    log(`Recording ${p.name}@${p.version} ...`);
    const run = await runAutopsy(
      input,
      {
        requestTimeoutMs: 10_000,
        concurrency: 8,
        ...(token !== undefined ? { githubToken: token } : {}),
      },
      { fetch: capturing404Fetch(options.fetch, options.clock, notFound), clock: options.clock, cache },
    );
    if (run.certificates.length === 0 || run.errors.length > 0) {
      const detail = run.errors.map((e) => e.message).join("; ");
      throw new Error(`Recording ${p.name}@${p.version} failed${detail === "" ? "" : `: ${detail}`}`);
    }

    const all = new Map<string, CacheEntry>([...notFound, ...entries]);
    const files = [...all.entries()]
      .map(([key, entry]) => ({
        fileName: fixtureFileName(sourceOfCacheKey(key), key),
        text: `${JSON.stringify(toFixture(key, entry), null, 2)}\n`,
      }))
      .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
    for (const f of files) assertNoSecrets(join(p.name, f.fileName), f.text, token);
    pending.push({ dir: join(options.outDir, p.name), name: p.name, files });
  }

  const written: Record<string, number> = {};
  for (const item of pending) {
    mkdirSync(item.dir, { recursive: true });
    for (const old of existingFixtureFiles(item.dir)) rmSync(join(item.dir, old));
    for (const f of item.files) writeFileSync(join(item.dir, f.fileName), f.text, "utf8");
    written[item.name] = item.files.length;
    log(`${item.name}: ${item.files.length} file(s) written`);
  }
  return { dryRun: false, written };
}
