import { describe, expect, it } from "vitest";
import { runAutopsy } from "../../../src/engine/autopsy";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { formatTimestamp } from "../../../src/engine/sources/http";
import type { AutopsyRun, Clock, EngineConfig } from "../../../src/engine/types";

const BASE_MS = Date.parse("2026-03-01T00:00:00Z");
const config: EngineConfig = { requestTimeoutMs: 10_000, concurrency: 8 };

const DEPRECATION =
  "This package is no longer maintained. Check out lru-cache which is a good replacement.";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

interface Trace {
  /** Shared, monotonically increasing sequence for clock reads and fetch events. */
  seq: number;
  clockReads: { seq: number; value: string }[];
  fetchStarts: number[];
  fetchEnds: number[];
  fetchUrls: string[];
}

function setup(): { trace: Trace; clock: Clock; fetchFn: typeof fetch } {
  const trace: Trace = { seq: 0, clockReads: [], fetchStarts: [], fetchEnds: [], fetchUrls: [] };
  let reads = 0;
  const clock: Clock = {
    now: () => {
      const d = new Date(BASE_MS + reads * 1000);
      reads++;
      trace.clockReads.push({ seq: trace.seq++, value: formatTimestamp(d) });
      return d;
    },
  };

  const packument = (name: string, deprecated?: string): Response =>
    json({
      name,
      maintainers: [{ name: "bob" }],
      time: { created: "2020-01-01T00:00:00.000Z", "1.0.0": "2026-01-01T00:00:00.000Z" },
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": deprecated === undefined ? {} : { deprecated } },
      repository: { url: `git+https://github.com/o/${name}.git` },
    });

  const respond = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input));
    // Yield so concurrent requests interleave and later lookups finish last.
    await new Promise<void>((r) => setTimeout(r, 1));
    if (u.host === "registry.npmjs.org") {
      const name = decodeURIComponent(u.pathname.slice(1));
      if (name === "old-pkg") return packument(name, DEPRECATION);
      if (name === "lru-cache" || name === "fresh-pkg") return packument(name);
      return json({ error: "Not found" }, 404);
    }
    if (u.host === "api.npmjs.org") return json({ downloads: 1234 });
    if (u.host === "api.osv.dev") {
      void init;
      return json({ vulns: [] });
    }
    if (u.host === "api.deps.dev") {
      return u.pathname.startsWith("/v3alpha/")
        ? json({ dependentCount: 7 })
        : json({ scorecard: { overallScore: 8 } });
    }
    if (u.host === "api.github.com") {
      return json({ archived: false, pushed_at: "2026-01-02T00:00:00Z" });
    }
    return json({}, 404);
  };

  const fetchFn: typeof fetch = async (input, init) => {
    trace.fetchStarts.push(trace.seq++);
    trace.fetchUrls.push(String(input));
    try {
      return await respond(input, init);
    } finally {
      trace.fetchEnds.push(trace.seq++);
    }
  };

  return { trace, clock, fetchFn };
}

const input = {
  kind: "package.json" as const,
  text: JSON.stringify({ dependencies: { "old-pkg": "1.0.0", "fresh-pkg": "1.0.0" } }),
};

async function go(analysisDate?: Date): Promise<{ result: AutopsyRun; trace: Trace }> {
  const { trace, clock, fetchFn } = setup();
  const result = await runAutopsy(
    input,
    config,
    { fetch: fetchFn, clock, cache: createMemoryCache() },
    analysisDate,
  );
  return { result, trace };
}

describe("default Analysis_Date", () => {
  it("reads the clock once for it, after the last fetch, shared by all certificates", async () => {
    const { result, trace } = await go();

    expect(result.errors).toEqual([]);
    expect(result.certificates).toHaveLength(2);
    // The successor lookup happened (deprecated package names lru-cache).
    expect(trace.fetchUrls).toContain("https://registry.npmjs.org/lru-cache");

    // (a) exactly one clock read is the Analysis_Date, shared by every certificate.
    const dates = new Set(result.certificates.map((c) => c.analysisDate));
    expect(dates.size).toBe(1);
    const analysisDate = [...dates][0] as string;
    const matching = trace.clockReads.filter((r) => r.value === analysisDate);
    expect(matching).toHaveLength(1);
    const dateRead = matching[0] as { seq: number; value: string };
    // The HTTP layer also read the clock (fetchedAt, cache age); those are other reads.
    expect(trace.clockReads.length).toBeGreaterThan(1);

    // (b) it follows the resolution of every fetch, including successor lookups.
    expect(trace.fetchStarts.length).toBe(trace.fetchEnds.length);
    expect(dateRead.seq).toBeGreaterThan(Math.max(...trace.fetchEnds));
    // No fetch response was timestamped after the Analysis_Date was read.
    expect(trace.clockReads.at(-1)).toEqual(dateRead);

    // (c) every Fact Fetch_Date is <= the Analysis_Date.
    let provenanceCount = 0;
    for (const cert of result.certificates) {
      for (const fact of cert.facts) {
        for (const p of fact.provenance) {
          provenanceCount++;
          expect(p.fetchedAt <= cert.analysisDate).toBe(true);
        }
      }
    }
    expect(provenanceCount).toBeGreaterThan(0);
  });

  it("uses an explicit analysisDate unchanged and reads no clock value for it", async () => {
    const supplied = new Date("2030-01-01T00:00:00Z");
    const { result, trace } = await go(supplied);

    expect(result.certificates).toHaveLength(2);
    for (const cert of result.certificates) expect(cert.analysisDate).toBe("2030-01-01T00:00:00Z");

    // (d) clock reads come only from fetch timestamping; none equals the supplied date.
    expect(trace.clockReads.length).toBeGreaterThan(0);
    expect(trace.clockReads.some((r) => r.value === "2030-01-01T00:00:00Z")).toBe(false);
  });
});
