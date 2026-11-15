// Requirements: 11.4, 11.6
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestCacheKey } from "../../../src/engine/sources/http";
import {
  FixtureUnparseableError,
  UnrecordedRequestError,
  createReplayFetch,
} from "../helpers/replayFetch";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "replay-fetch-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(
  name: string,
  cacheKey: string,
  sourceUrl: string,
  body: string,
  status = 200,
): void {
  writeFileSync(
    join(dir, name),
    JSON.stringify({ cacheKey, sourceUrl, body, status, fetchedAt: "2026-01-01T00:00:00Z" }),
  );
}

const GET_URL = "https://registry.npmjs.org/ip";
const POST_URL = "https://api.osv.dev/v1/query";

describe("createReplayFetch", () => {
  it("serves a recorded GET with its status and body", async () => {
    record("a.json", requestCacheKey({ source: "npm", url: GET_URL }), GET_URL, '{"name":"ip"}', 200);
    const replay = createReplayFetch([dir]);
    const res = await replay.fetch(GET_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"name":"ip"}');
  });

  it("keys POST by body hash", async () => {
    const bodyA = JSON.stringify({ package: "a" });
    const bodyB = JSON.stringify({ package: "b" });
    record(
      "a.json",
      requestCacheKey({ source: "osv", url: POST_URL, method: "POST", body: bodyA }),
      POST_URL,
      "A",
    );
    const replay = createReplayFetch([dir]);
    const res = await replay.fetch(POST_URL, { method: "POST", body: bodyA });
    expect(await res.text()).toBe("A");
    await expect(replay.fetch(POST_URL, { method: "POST", body: bodyB })).rejects.toBeInstanceOf(
      UnrecordedRequestError,
    );
    await expect(replay.fetch(POST_URL)).rejects.toBeInstanceOf(UnrecordedRequestError);
  });

  it("throws UnrecordedRequestError with method, url and cache key", async () => {
    const replay = createReplayFetch([dir]);
    const error = await replay.fetch("https://example.com/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnrecordedRequestError);
    const typed = error as UnrecordedRequestError;
    expect(typed.method).toBe("GET");
    expect(typed.url).toBe("https://example.com/x");
    expect(typed.cacheKey).toContain("https://example.com/x");
  });

  it("throws FixtureUnparseableError naming the file for malformed recordings", async () => {
    const key = requestCacheKey({ source: "npm", url: GET_URL });
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ cacheKey: key, sourceUrl: GET_URL }));
    writeFileSync(join(dir, "junk.json"), "{not json");
    const replay = createReplayFetch([dir]);
    const error = await replay.fetch(GET_URL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FixtureUnparseableError);
    expect((error as FixtureUnparseableError).file).toContain("bad.json");
    const other = await replay.fetch("https://example.com/y").catch((e: unknown) => e);
    expect(other).toBeInstanceOf(FixtureUnparseableError);
    expect((other as FixtureUnparseableError).file).toContain("junk.json");
  });

  it("ignores request headers when matching", async () => {
    record("a.json", requestCacheKey({ source: "github", url: GET_URL }), GET_URL, "ok");
    const replay = createReplayFetch([dir]);
    const res = await replay.fetch(GET_URL, { headers: { Authorization: "Bearer secret-token" } });
    expect(await res.text()).toBe("ok");
    expect(JSON.stringify(replay.calls)).not.toContain("secret-token");
  });

  it("logs every call and asserts zero unrecorded requests", async () => {
    record("a.json", requestCacheKey({ source: "npm", url: GET_URL }), GET_URL, "ok");
    const replay = createReplayFetch([dir]);
    await replay.fetch(GET_URL);
    expect(() => replay.assertNoUnrecordedRequests()).not.toThrow();
    await replay.fetch("https://example.com/z").catch(() => undefined);
    expect(replay.calls.map((c) => [c.method, c.url, c.recorded])).toEqual([
      ["GET", GET_URL, true],
      ["GET", "https://example.com/z", false],
    ]);
    expect(replay.unrecordedCalls()).toHaveLength(1);
    expect(() => replay.assertNoUnrecordedRequests()).toThrow(/unrecorded/);
  });

  it("does not simulate redirects: a recorded 301 is returned as is", async () => {
    record("r.json", requestCacheKey({ source: "npm", url: GET_URL }), GET_URL, "moved", 301);
    const replay = createReplayFetch([dir]);
    const res = await replay.fetch(GET_URL);
    expect(res.status).toBe(301);
    expect(replay.calls).toHaveLength(1);
  });
});
