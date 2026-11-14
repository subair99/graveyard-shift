import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordFixtures, type RecordOptions } from "../../../scripts/lib/recordFixtures";
import { runAutopsy } from "../../../src/engine/autopsy";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { canonicalJson } from "../../../src/engine/serialize/canonicalJson";
import type { Clock, EngineConfig } from "../../../src/engine/types";
import { createReplayFetch } from "../helpers/replayFetch";

const PKG = { name: "demo-pkg", version: "1.0.0" };
const TOKEN = "ghp_FAKE_TOKEN_VALUE_1234567890";
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const analysisDate = new Date("2026-01-02T00:00:00Z");
const config: EngineConfig = { requestTimeoutMs: 10_000, concurrency: 4 };

interface FakeServer {
  fetch: typeof fetch;
  /** Request headers seen, to prove the script sent some but never saved them. */
  headersSeen: Record<string, string>[];
  urls: string[];
}

function fakeServer(echo?: string): FakeServer {
  const headersSeen: Record<string, string>[] = [];
  const urls: string[] = [];
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fake: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (init?.headers !== undefined) headersSeen.push({ ...(init.headers as Record<string, string>) });
    if (url === "https://registry.npmjs.org/demo-pkg") {
      return Promise.resolve(
        json({
          name: "demo-pkg",
          "dist-tags": { latest: "1.0.0" },
          maintainers: [{ name: "alice" }],
          time: { created: "2015-01-01T00:00:00.000Z", modified: "2016-01-01T00:00:00.000Z", "1.0.0": "2016-01-01T00:00:00.000Z" },
          versions: { "1.0.0": { deprecated: "Please use ghost-lib instead" } },
        }),
      );
    }
    if (url === "https://registry.npmjs.org/ghost-lib") return Promise.resolve(json({ error: "Not found" }, 404));
    if (url === "https://api.osv.dev/v1/query") {
      return Promise.resolve(json({ vulns: [], ...(echo !== undefined ? { note: echo } : {}) }));
    }
    if (url.startsWith("https://api.npmjs.org/downloads/")) return Promise.resolve(json({ downloads: 42 }));
    if (url.includes(":dependents")) return Promise.resolve(json({ dependentCount: 3 }));
    return Promise.resolve(json({ error: "unexpected" }, 500));
  };
  return { fetch: fake, headersSeen, urls };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "record-fixtures-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(server: FakeServer, extra: Partial<RecordOptions> = {}): RecordOptions {
  return {
    fetch: server.fetch,
    clock,
    outDir: dir,
    token: TOKEN,
    packages: [PKG],
    ...extra,
  };
}

function readFixtures(): Record<string, unknown>[] {
  const pkgDir = join(dir, PKG.name);
  return readdirSync(pkgDir).map((n) => JSON.parse(readFileSync(join(pkgDir, n), "utf8")) as Record<string, unknown>);
}

describe("recordFixtures", () => {
  it("writes one file per cache key with only the five fields, sorted names, trailing newline", async () => {
    const server = fakeServer();
    const summary = await recordFixtures(options(server));
    const names = readdirSync(join(dir, PKG.name));
    expect(summary.written[PKG.name]).toBe(names.length);
    expect(names).toEqual([...names].sort());
    expect(names.every((n) => /^[a-z.]+-[0-9a-f]{12}\.json$/.test(n))).toBe(true);
    const fixtures = readFixtures();
    for (const f of fixtures) {
      expect(Object.keys(f).sort()).toEqual(["body", "cacheKey", "fetchedAt", "sourceUrl", "status"]);
    }
    const keys = fixtures.map((f) => f["cacheKey"]);
    expect(new Set(keys).size).toBe(keys.length);
    const raw = readFileSync(join(dir, PKG.name, names[0] ?? ""), "utf8");
    expect(raw.endsWith("}\n")).toBe(true);
    expect(raw).toContain("\n  \"cacheKey\"");
  });

  it("captures the 404 response of a successor candidate lookup", async () => {
    await recordFixtures(options(fakeServer()));
    const notFound = readFixtures().filter((f) => f["status"] === 404);
    expect(notFound).toHaveLength(1);
    expect(notFound[0]?.["sourceUrl"]).toBe("https://registry.npmjs.org/ghost-lib");
    expect(notFound[0]?.["fetchedAt"]).toBe("2026-01-01T00:00:00Z");
  });

  it("sends the token upstream (headers exist) but never writes it or any header", async () => {
    const server = fakeServer();
    await recordFixtures(options(server));
    const all = readdirSync(join(dir, PKG.name))
      .map((n) => readFileSync(join(dir, PKG.name, n), "utf8"))
      .join("\n");
    expect(server.headersSeen.length).toBeGreaterThan(0);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("Authorization");
    expect(all).not.toContain("Bearer");
    expect(all.toLowerCase()).not.toContain("content-type");
  });

  it("aborts without writing anything when a body echoes the token, and does not print it", async () => {
    const lines: string[] = [];
    const run = recordFixtures(options(fakeServer(`echo ${TOKEN}`), { log: (l) => lines.push(l) }));
    await expect(run).rejects.toThrow(/GitHub token value/);
    await run.catch((e: unknown) => {
      expect(String(e instanceof Error ? e.message : e)).not.toContain(TOKEN);
    });
    expect(readdirSync(dir)).toEqual([]);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("aborts when a body contains Bearer", async () => {
    await expect(recordFixtures(options(fakeServer("Bearer abc"), { token: undefined }))).rejects.toThrow(/Bearer/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says it runs unauthenticated when the token is empty, without printing token details", async () => {
    const lines: string[] = [];
    await recordFixtures(options(fakeServer(), { token: "", log: (l) => lines.push(l) }));
    expect(lines.join("\n")).toContain("unauthenticated");
  });

  it("refuses to overwrite existing fixtures without force, and overwrites with force", async () => {
    const pkgDir = join(dir, PKG.name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "old.json"), "{}\n");
    const server = fakeServer();
    await expect(recordFixtures(options(server))).rejects.toThrow(/--force/);
    expect(server.urls).toEqual([]);
    expect(readdirSync(pkgDir)).toEqual(["old.json"]);
    await recordFixtures(options(server, { force: true }));
    expect(readdirSync(pkgDir)).not.toContain("old.json");
  });

  it("dry run makes no request and writes nothing", async () => {
    const server = fakeServer();
    const lines: string[] = [];
    const summary = await recordFixtures(options(server, { dryRun: true, log: (l) => lines.push(l) }));
    expect(summary.dryRun).toBe(true);
    expect(server.urls).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    expect(lines.join("\n")).toContain("dry run");
  });

  it("round trip: the replay fetch serves what was recorded and gives an identical certificate", async () => {
    const server = fakeServer();
    const cache = createMemoryCache();
    const live = await runAutopsy(
      { kind: "name", name: PKG.name, version: PKG.version },
      { ...config, githubToken: TOKEN },
      { fetch: server.fetch, clock, cache },
      analysisDate,
    );
    await recordFixtures(options(server));
    const replay = createReplayFetch([join(dir, PKG.name)]);
    const replayed = await runAutopsy(
      { kind: "name", name: PKG.name, version: PKG.version },
      config,
      { fetch: replay.fetch, clock, cache: createMemoryCache() },
      analysisDate,
    );
    replay.assertNoUnrecordedRequests();
    expect(replayed.errors).toEqual([]);
    expect(replayed.certificates).toHaveLength(1);
    const [a] = replayed.certificates;
    const [b] = live.certificates;
    if (a === undefined || b === undefined) throw new Error("expected one certificate");
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});
