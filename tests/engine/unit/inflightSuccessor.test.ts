import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAutopsy } from "../../../src/engine/autopsy";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { extractCandidates, isStoplisted } from "../../../src/engine/core/successor";
import type { Clock, DeathCertificate, EngineConfig } from "../../../src/engine/types";
import { createReplayFetch } from "../helpers/replayFetch";

/** Validates: Requirements 4.8, 11.3 */

const dir = join(__dirname, "..", "fixtures", "inflight");
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const analysisDate = new Date("2026-01-01T00:00:00Z");
const config: EngineConfig = { concurrency: 4, requestTimeoutMs: 10000 };
const SECOND_PRECISION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LRU_URL = "https://registry.npmjs.org/lru-cache";

function recordedDeprecation(): string {
  const rec = JSON.parse(readFileSync(join(dir, "npm-20930bb98bd1.json"), "utf8")) as {
    sourceUrl: string;
    body: string;
  };
  expect(rec.sourceUrl).toBe("https://registry.npmjs.org/inflight");
  const packument = JSON.parse(rec.body) as { versions: Record<string, { deprecated?: string }> };
  const message = packument.versions["1.0.6"]?.deprecated;
  if (message === undefined) throw new Error("recorded inflight@1.0.6 has no deprecation message");
  return message;
}

async function analyze(): Promise<{
  certificate: DeathCertificate;
  calls: readonly { method: string; url: string; recorded: boolean }[];
}> {
  const replay = createReplayFetch([dir]);
  const run = await runAutopsy(
    { kind: "name", name: "inflight", version: "1.0.6" },
    config,
    { fetch: replay.fetch, clock, cache: createMemoryCache() },
    analysisDate,
  );
  replay.assertNoUnrecordedRequests();
  expect(run.errors).toEqual([]);
  const [certificate] = run.certificates;
  if (certificate === undefined) throw new Error("expected one certificate");
  return { certificate, calls: replay.calls };
}

describe("inflight@1.0.6 successor from recorded fixtures", () => {
  it("the recorded deprecation message has the expected wording", () => {
    const message = recordedDeprecation();
    expect(message).toContain("Do not use it");
    expect(message).toContain("Check out lru-cache");
  });

  it("extractCandidates finds `it` before `lru-cache`, and `it` is stoplisted", () => {
    const candidates = extractCandidates(recordedDeprecation());
    const names = candidates.map((c) => c.name);
    const itIndex = names.indexOf("it");
    const lruIndex = names.indexOf("lru-cache");
    expect(itIndex).toBeGreaterThanOrEqual(0);
    expect(lruIndex).toBeGreaterThanOrEqual(0);
    expect(itIndex).toBeLessThan(lruIndex);
    const it = candidates[itIndex];
    const lru = candidates[lruIndex];
    expect(it !== undefined && lru !== undefined && it.position < lru.position).toBe(true);
    expect(isStoplisted("it")).toBe(true);
    expect(isStoplisted("lru-cache")).toBe(false);
  });

  it("the Successor is exactly lru-cache and never it", async () => {
    const { certificate } = await analyze();
    expect(certificate.successor).toBe("lru-cache");
    expect(certificate.successor).not.toBe("it");
    expect(certificate.facts.map((f) => f.key)).not.toContain("successorLookup:it");
  });

  it("looks up lru-cache (recorded) and never looks up it", async () => {
    const { calls } = await analyze();
    const urls = calls.map((c) => c.url);
    expect(urls).not.toContain("https://registry.npmjs.org/it");
    expect(calls.some((c) => new URL(c.url).hostname === "registry.npmjs.org" && new URL(c.url).pathname === "/it")).toBe(
      false,
    );
    const lookup = calls.filter((c) => c.url === LRU_URL);
    expect(lookup.length).toBeGreaterThanOrEqual(1);
    expect(lookup.every((c) => c.recorded)).toBe(true);
  });

  it("has the successor and successorLookup:lru-cache facts with source and second-precision date", async () => {
    const { certificate } = await analyze();
    for (const key of ["successor", "successorLookup:lru-cache"]) {
      const fact = certificate.facts.find((f) => f.key === key);
      expect(fact, key).toBeDefined();
      expect(fact?.provenance.length, key).toBeGreaterThanOrEqual(1);
      for (const p of fact?.provenance ?? []) {
        expect(p.sourceUrl).toBe(LRU_URL);
        expect(p.fetchedAt).toMatch(SECOND_PRECISION);
      }
    }
    expect(certificate.facts.find((f) => f.key === "successor")?.value).toBe("lru-cache");
    expect(certificate.facts.find((f) => f.key === "successorLookup:lru-cache")?.value).toEqual({
      result: "exists",
    });
  });

  it("the status is retired-with-successor", async () => {
    const { certificate } = await analyze();
    expect(certificate.status).toBe("retired-with-successor");
  });
});
