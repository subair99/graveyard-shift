// Requirements: 2.1, 2.2, 2.7, 2.8, 2.11
import { describe, expect, it } from "vitest";
import { runGravedigger } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import { computeSri } from "../../../src/proof/shell/integrity";
import { tarballOf } from "../../proof/helpers/buildTarball";
import { INFLIGHT_CERT, IP_CERT } from "../helpers/gravediggerCerts";
import type { DeathCertificate } from "../../../src/engine/types";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const clock = { now: (): Date => new Date("2026-11-16T10:00:00.900Z") };

function tarballFor(manifest: Record<string, unknown>): ReturnType<typeof tarballOf> {
  return tarballOf([
    { path: "package.json", bytes: enc(JSON.stringify(manifest)) },
    { path: "index.js", bytes: enc("module.exports = 1;\nmodule.exports.a = 2;\n") },
  ]);
}

interface Setup {
  fetch: typeof fetch;
  urls: string[];
}

function fakeFetch(
  cert: DeathCertificate,
  tarball: Uint8Array,
  integrity: string,
  override?: (url: string) => Response | undefined,
): Setup {
  const { name, version } = cert.package;
  const tarballUrl = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
  const packument = { versions: { [version]: { dist: { tarball: tarballUrl, integrity } } } };
  const urls: string[] = [];
  const fn = (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const forced = override?.(url);
    if (forced !== undefined) return Promise.resolve(forced);
    if (url === `https://registry.npmjs.org/${name}`) return Promise.resolve(new Response(JSON.stringify(packument)));
    if (url === tarballUrl) return Promise.resolve(new Response(Buffer.from(tarball)));
    return Promise.resolve(new Response("", { status: 404 }));
  };
  return { fetch: fn as typeof fetch, urls };
}

describe("runGravedigger", () => {
  it("returns an eligible record and the tarball when the digest matches", async () => {
    const t = tarballFor({ name: "ip", version: "2.0.1", license: "MIT" });
    const { fetch } = fakeFetch(IP_CERT, t.bytes, t.integrity);
    const out = await runGravedigger(IP_CERT, { fetch, clock });
    expect(out.record.integrity).toEqual({ expected: t.integrity, computed: t.integrity, matches: true });
    expect(out.record.eligible).toBe(true);
    expect(out.tarball).toEqual(t.bytes);
    const lines = out.record.rules.find((r) => r.rule === "line-count");
    expect(lines?.observed).toBeGreaterThan(2);
    for (const f of out.record.facts) {
      expect(f.provenance[0]!.fetchedAt).toBe("2026-11-16T10:00:00Z");
      expect(f.provenance[0]!.sourceUrl).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it("writes an integrity-mismatch record and no tarball on a wrong digest", async () => {
    const t = tarballFor({ license: "MIT" });
    const wrong = computeSri(enc("something else"));
    const { fetch } = fakeFetch(IP_CERT, t.bytes, wrong);
    const out = await runGravedigger(IP_CERT, { fetch, clock });
    expect(out.tarball).toBeNull();
    expect(out.record).toMatchObject({
      eligible: false,
      reason: "integrity-mismatch",
      integrity: { expected: wrong, computed: t.integrity, matches: false },
    });
  });

  it("records the successor of inflight and fails its rules", async () => {
    const t = tarballFor({ license: "ISC", dependencies: { once: "1", wrappy: "1" } });
    const { fetch } = fakeFetch(INFLIGHT_CERT, t.bytes, t.integrity);
    const out = await runGravedigger(INFLIGHT_CERT, { fetch, clock });
    expect(out.record.eligible).toBe(false);
    expect(out.record.successor).toBe("lru-cache");
    expect(out.record.failedRules).toContain("dependencies");
  });

  it("gives unverified for an absent license field", async () => {
    const t = tarballFor({ name: "ip" });
    const { fetch } = fakeFetch(IP_CERT, t.bytes, t.integrity);
    const out = await runGravedigger(IP_CERT, { fetch, clock });
    expect(out.record.eligible).toBe(false);
    expect(out.record.rules[0]).toMatchObject({ reason: "unverified", missingField: "license" });
  });

  it("refuses a tarball URL outside the registry host before fetching it", async () => {
    const t = tarballFor({ license: "MIT" });
    const packument = {
      versions: { "2.0.1": { dist: { tarball: "https://example.com/ip.tgz", integrity: t.integrity } } },
    };
    const urls: string[] = [];
    const fetchFn = ((input: string | URL | Request) => {
      urls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify(packument)));
    }) as typeof fetch;
    await expect(runGravedigger(IP_CERT, { fetch: fetchFn, clock })).rejects.toThrow(/only https:\/\/registry\.npmjs\.org/);
    expect(urls).toEqual(["https://registry.npmjs.org/ip"]);
  });

  it("refuses redirects", async () => {
    const t = tarballFor({ license: "MIT" });
    const { fetch } = fakeFetch(IP_CERT, t.bytes, t.integrity, (url) =>
      url.endsWith(".tgz") ? new Response("", { status: 302, headers: { location: "https://evil.example/x" } }) : undefined,
    );
    await expect(runGravedigger(IP_CERT, { fetch, clock })).rejects.toThrow(/redirected/);
  });

  it("reads the clock once", async () => {
    const t = tarballFor({ license: "MIT" });
    const { fetch } = fakeFetch(IP_CERT, t.bytes, t.integrity);
    let reads = 0;
    await runGravedigger(IP_CERT, {
      fetch,
      clock: {
        now: () => {
          reads += 1;
          return new Date("2026-11-16T10:00:00Z");
        },
      },
    });
    expect(reads).toBe(1);
  });
});
