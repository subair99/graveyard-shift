// Requirements: 2.2, 2.9, 2.11, 7.5, 7.6, 7.7
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { createHttpClient } from "../../../src/engine/sources/http";
import { MAX_OSV_PAGES, OSV_QUERY_URL, createOsvClient } from "../../../src/engine/sources/osv";
import type { Clock } from "../../../src/engine/types";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function setup(handler: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  const http = createHttpClient({ fetch: f, clock, cache: createMemoryCache(), ttlMs: 1000 });
  return { osv: createOsvClient(http, clock), calls };
}

const json = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

const bodyOf = (c: Call): unknown => JSON.parse(String(c.init?.body));

describe("OSV source client", () => {
  it("POSTs the query body to the OSV endpoint", async () => {
    const { osv, calls } = setup(() => json({}));
    await osv.queryVulnerabilities("left-pad", "1.3.0");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(OSV_QUERY_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(bodyOf(calls[0] as Call)).toEqual({
      package: { name: "left-pad", ecosystem: "npm" },
      version: "1.3.0",
    });
  });

  it("returns an available empty list when OSV has no vulnerabilities", async () => {
    const { osv } = setup(() => json({}));
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r).toEqual({
      status: "ok",
      value: [],
      provenance: [{ sourceUrl: OSV_QUERY_URL, fetchedAt: "2026-01-01T00:00:00Z" }],
    });
  });

  it("normalizes aliases, summary, severity and fixed versions", async () => {
    const { osv } = setup(() =>
      json({
        vulns: [
          {
            id: "GHSA-2",
            aliases: ["CVE-2", "CVE-1", "CVE-2"],
            summary: "Bad thing",
            database_specific: { severity: "HIGH" },
            severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N" }],
            affected: [
              {
                package: { name: "a", ecosystem: "npm" },
                ranges: [{ events: [{ introduced: "0" }, { fixed: "1.2.0" }, { fixed: "1.10.0" }] }],
              },
              {
                package: { name: "other", ecosystem: "npm" },
                ranges: [{ events: [{ fixed: "9.9.9" }] }],
              },
              {
                package: { name: "a", ecosystem: "PyPI" },
                ranges: [{ events: [{ fixed: "8.8.8" }] }],
              },
              // No package field: must not contribute (was kept before the filter was tightened).
              { ranges: [{ events: [{ fixed: "7.7.7" }] }] },
            ],
          },
          {
            id: "GHSA-1",
            details: "\nFirst line of details\nsecond line",
            severity: [
              { type: "CVSS_V3", score: "CVSS:3.1/AV:N" },
              { type: "CVSS_V2", score: "AV:N/AC:L" },
            ],
          },
          { id: "GHSA-0" },
        ],
      }),
    );
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.value).toEqual([
      { id: "GHSA-0", aliases: [], summary: "", fixedVersions: [] },
      {
        id: "GHSA-1",
        aliases: [],
        summary: "First line of details",
        severity: "CVSS_V2:AV:N/AC:L; CVSS_V3:CVSS:3.1/AV:N",
        fixedVersions: [],
      },
      {
        id: "GHSA-2",
        aliases: ["CVE-1", "CVE-2"],
        summary: "Bad thing",
        severity: "HIGH",
        fixedVersions: ["1.10.0", "1.2.0"],
      },
    ]);
  });

  it("follows next_page_token and merges pages", async () => {
    const { osv, calls } = setup((_c, n) =>
      n === 1
        ? json({ vulns: [{ id: "A" }], next_page_token: "tok" })
        : json({ vulns: [{ id: "B" }] }),
    );
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.value.map((v) => v.id)).toEqual(["A", "B"]);
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1] as Call)).toEqual({
      package: { name: "a", ecosystem: "npm" },
      version: "1.0.0",
      page_token: "tok",
    });
  });

  it("is unavailable when pages never end", async () => {
    const { osv, calls } = setup((_c, n) => json({ vulns: [], next_page_token: `t${n}` }));
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r.status).toBe("unavailable");
    expect(calls).toHaveLength(MAX_OSV_PAGES);
  });

  it("is unavailable when a later page fails", async () => {
    const { osv } = setup((_c, n) =>
      n === 1 ? json({ vulns: [{ id: "A" }], next_page_token: "t" }) : new Response("x", { status: 500 }),
    );
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r).toMatchObject({ status: "unavailable", source: "osv", reason: "HTTP 500" });
  });

  it("is unavailable on an unparseable body", async () => {
    const { osv } = setup(() => new Response("not json", { status: 200 }));
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r).toMatchObject({
      status: "unavailable",
      source: "osv",
      attemptedUrl: OSV_QUERY_URL,
      attemptedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("is unavailable on a body with the wrong shape", async () => {
    const { osv } = setup(() => json({ vulns: [{ summary: "no id" }] }));
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r.status).toBe("unavailable");
  });

  it("reports rate limits as unavailable with the reset time", async () => {
    const { osv } = setup(
      () => new Response("slow down", { status: 429, headers: { "retry-after": "60" } }),
    );
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r).toMatchObject({
      status: "unavailable",
      source: "osv",
      attemptedUrl: OSV_QUERY_URL,
      reason: "rate limited (HTTP 429)",
      rateLimitResetAt: "2026-01-01T00:01:00Z",
    });
  });

  it("is unavailable on a network error without throwing", async () => {
    const { osv } = setup(() => {
      throw new Error("boom");
    });
    const r = await osv.queryVulnerabilities("a", "1.0.0");
    expect(r).toMatchObject({ status: "unavailable", source: "osv" });
  });
});
