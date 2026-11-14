import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { filterOpenVulnerabilities } from "../../../src/engine/core/causes";
import { createHttpClient } from "../../../src/engine/sources/http";
import { createOsvClient, type OsvVulnerability } from "../../../src/engine/sources/osv";
import type { Clock } from "../../../src/engine/types";
import { createReplayFetch } from "../helpers/replayFetch";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const dir = join(__dirname, "..", "fixtures", "lodash.set");
const GHSA = "GHSA-p6mc-m468-83gw";

function readFixtures(): { osvBody: string; published: string[] } {
  let osvBody = "";
  let published: string[] = [];
  for (const file of ["osv-702cd01e9bf2.json", "npm-449996e32bd2.json"]) {
    const rec = JSON.parse(readFileSync(join(dir, file), "utf8")) as { sourceUrl: string; body: string };
    if (rec.sourceUrl === "https://api.osv.dev/v1/query") osvBody = rec.body;
    else published = Object.keys((JSON.parse(rec.body) as { versions: Record<string, unknown> }).versions);
  }
  return { osvBody, published };
}

async function viaReplay(name: string, version: string): Promise<OsvVulnerability[]> {
  const replay = createReplayFetch([dir]);
  const http = createHttpClient({ fetch: replay.fetch, clock, cache: createMemoryCache(), ttlMs: 1000 });
  const r = await createOsvClient(http, clock).queryVulnerabilities(name, version);
  if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
  replay.assertNoUnrecordedRequests();
  return r.value;
}

/** Serves an arbitrary OSV body, for the synthetic cases. */
async function viaBody(body: unknown, name: string): Promise<OsvVulnerability[]> {
  const f = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  const http = createHttpClient({ fetch: f, clock, cache: createMemoryCache(), ttlMs: 1000 });
  const r = await createOsvClient(http, clock).queryVulnerabilities(name, "4.3.2");
  if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
  return r.value;
}

describe("OSV affected[] filter against the recorded lodash.set response", () => {
  const { osvBody, published } = readFixtures();

  it("the recording lists lodash and lodash-es fixes next to lodash.set", () => {
    const names = (JSON.parse(osvBody) as { vulns: { affected: { package: { name: string } }[] }[] }).vulns[0]
      ?.affected.map((a) => a.package.name);
    expect(names).toEqual(expect.arrayContaining(["lodash", "lodash-es", "lodash.set"]));
    expect(osvBody).toContain("4.17.19");
    expect(osvBody).toContain("4.17.20");
  });

  it("(a) ignores fixes listed for lodash and lodash-es", async () => {
    const vulns = await viaReplay("lodash.set", "4.3.2");
    const v = vulns.find((x) => x.id === GHSA);
    expect(v).toBeDefined();
    expect(v?.aliases).toContain("CVE-2020-8203");
    expect(v?.fixedVersions).toEqual([]);
  });

  it("(b) keeps the vulnerability open for lodash.set@4.3.2", async () => {
    const vulns = await viaReplay("lodash.set", "4.3.2");
    expect(published).toContain("4.3.2");
    const open = filterOpenVulnerabilities(
      vulns.map((v) => ({ id: v.id, fixedVersions: v.fixedVersions })),
      "4.3.2",
      published,
    );
    expect(open).toContain(GHSA);
  });

  it("(c) control: analyzed as lodash, 4.17.19 is picked up and the record closes", async () => {
    const { osvBody: raw } = readFixtures();
    const vulns = await viaBody(JSON.parse(raw), "lodash");
    const v = vulns.find((x) => x.id === GHSA);
    expect(v?.fixedVersions).toEqual(["4.17.19"]);
    const open = filterOpenVulnerabilities(
      vulns.map((x) => ({ id: x.id, fixedVersions: x.fixedVersions })),
      "4.3.2",
      [...published, "4.17.19"],
    );
    expect(open).not.toContain(GHSA);
  });

  it("(d) ignores an entry with the same name in another ecosystem", async () => {
    const body = {
      vulns: [
        {
          id: "X-1",
          affected: [
            { package: { name: "lodash.set", ecosystem: "PyPI" }, ranges: [{ events: [{ fixed: "9.0.0" }] }] },
            { package: { name: "lodash.set", ecosystem: "NPM" }, ranges: [{ events: [{ fixed: "5.0.0" }] }] },
            { package: { name: "Lodash.set", ecosystem: "npm" }, ranges: [{ events: [{ fixed: "6.0.0" }] }] },
          ],
        },
      ],
    };
    const [v] = await viaBody(body, "lodash.set");
    expect(v?.fixedVersions).toEqual(["5.0.0"]);
  });
});
