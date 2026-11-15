// Requirements: 2.1, 2.5, 2.10, 2.12, 4.2
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { createHttpClient } from "../../../src/engine/sources/http";
import {
  createNpmClient,
  downloadsUrl,
  normalizeGithubUrl,
  packumentUrl,
} from "../../../src/engine/sources/npm";
import type { Clock } from "../../../src/engine/types";

const NOW = "2026-03-01T12:00:00Z";
const clock: Clock = { now: () => new Date(NOW) };

function setup(handler: (url: string) => Response) {
  const urls: string[] = [];
  const f = (async (input: unknown) => {
    urls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  const http = createHttpClient({ fetch: f, clock, cache: createMemoryCache(), ttlMs: 60_000 });
  return { npm: createNpmClient(http), urls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe("npm client packument", () => {
  it("builds the endpoint, percent-encoding the slash of scoped names", async () => {
    const plain = setup(() => json({}));
    await plain.npm.packument("left-pad");
    expect(plain.urls).toEqual(["https://registry.npmjs.org/left-pad"]);
    const scoped = setup(() => json({}));
    await scoped.npm.packument("@scope/name");
    expect(scoped.urls).toEqual(["https://registry.npmjs.org/@scope%2Fname"]);
  });

  it("returns maintainers in registry order, time passthrough, deprecation, latest, versions and provenance", async () => {
    const time = { created: "2015-01-01T00:00:00.000Z", "1.0.0": "2016-01-01T00:00:00.000Z", modified: "x" };
    const { npm } = setup(() =>
      json({
        maintainers: [{ name: "zed" }, { name: "amy" }],
        time,
        "dist-tags": { latest: "2.0.0" },
        versions: { "1.0.0": { deprecated: "Use `lru-cache` instead" }, "2.0.0": {} },
        repository: { type: "git", url: "git+https://github.com/o/r.git" },
      }),
    );
    const r = await npm.packument("pkg", "1.0.0");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.value.maintainers).toEqual(["zed", "amy"]);
    expect(r.value.time).toEqual(time);
    expect(r.value.deprecation).toBe("Use `lru-cache` instead");
    expect(r.value.latest).toBe("2.0.0");
    expect(r.value.versions).toEqual(["1.0.0", "2.0.0"]);
    expect(r.value.repository).toEqual({
      original: "git+https://github.com/o/r.git",
      github: "https://github.com/o/r",
    });
    expect(r.provenance).toEqual([{ sourceUrl: "https://registry.npmjs.org/pkg", fetchedAt: NOW }]);
    const other = await npm.packument("pkg", "2.0.0");
    if (other.status !== "ok") throw new Error("expected ok");
    expect(other.value.deprecation).toBeUndefined();
  });

  it("reports empty maintainers as ok and an HTTP failure as unavailable", async () => {
    const empty = setup(() => json({ maintainers: [] }));
    const ok = await empty.npm.packument("pkg");
    expect(ok.status === "ok" && ok.value.maintainers).toEqual([]);
    const failing = setup(() => new Response("boom", { status: 500 }));
    const bad = await failing.npm.packument("pkg");
    expect(bad.status).toBe("unavailable");
  });

  it("returns not-found for a 404", async () => {
    const { npm } = setup(() => new Response("{}", { status: 404 }));
    const r = await npm.packument("nope");
    expect(r).toEqual({
      status: "not-found",
      source: "npm",
      url: "https://registry.npmjs.org/nope",
      fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    });
  });

  it("returns unavailable naming the source for unparseable bodies, without throwing", async () => {
    const notJson = await setup(() => new Response("<html>", { status: 200 })).npm.packument("pkg");
    expect(notJson.status).toBe("unavailable");
    if (notJson.status === "unavailable") {
      expect(notJson.source).toBe("npm");
      expect(notJson.reason).toContain("npm packument");
      expect(notJson.attemptedUrl).toBe("https://registry.npmjs.org/pkg");
      expect(notJson.attemptedAt).toBe(NOW);
    }
    const badShape = await setup(() => json({ maintainers: "x" })).npm.packument("pkg");
    expect(badShape.status).toBe("unavailable");
    if (badShape.status === "unavailable") expect(badShape.reason).toContain("maintainers");
  });
});

describe("normalizeGithubUrl", () => {
  it.each([
    ["git+https://github.com/o/r.git", "https://github.com/o/r"],
    ["git://github.com/o/r.git", "https://github.com/o/r"],
    ["github:o/r", "https://github.com/o/r"],
    ["o/r", "https://github.com/o/r"],
    ["git@github.com:o/r.git", "https://github.com/o/r"],
    ["git+ssh://git@github.com/o/r.git", "https://github.com/o/r"],
    ["ssh://git@github.com/o/r", "https://github.com/o/r"],
    ["https://github.com/o/r/tree/main", "https://github.com/o/r"],
  ])("%s", (raw, expected) => {
    expect(normalizeGithubUrl(raw)).toBe(expected);
  });

  it("returns undefined for non-github hosts", () => {
    expect(normalizeGithubUrl("git+https://gitlab.com/o/r.git")).toBeUndefined();
    expect(normalizeGithubUrl("https://example.com/o/r")).toBeUndefined();
  });
});

describe("npm client downloads", () => {
  it("returns the count, and zero as ok with value 0", async () => {
    const s = setup(() => json({ downloads: 0 }));
    const r = await s.npm.weeklyDownloads("pkg");
    expect(s.urls).toEqual(["https://api.npmjs.org/downloads/point/last-week/pkg"]);
    expect(r.status === "ok" && r.value).toBe(0);
    const n = await setup(() => json({ downloads: 1234 })).npm.weeklyDownloads("pkg");
    expect(n.status === "ok" && n.value).toBe(1234);
  });

  it("keeps scoped names unencoded in the downloads URL and cites it as the Source_URL", async () => {
    const s = setup(() => json({ downloads: 42, package: "@babel/core" }));
    const r = await s.npm.weeklyDownloads("@babel/core");
    const url = "https://api.npmjs.org/downloads/point/last-week/@babel/core";
    expect(s.urls).toEqual([url]);
    expect(downloadsUrl("@babel/core")).toBe(url);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value).toBe(42);
      expect(r.provenance).toEqual([{ sourceUrl: url, fetchedAt: NOW }]);
    }
  });

  it("encodes the slash in the packument URL for the same scoped name, unlike downloads", () => {
    expect(packumentUrl("@babel/core")).toBe("https://registry.npmjs.org/@babel%2Fcore");
  });

  it("builds the downloads URL for an unscoped name with a dot", () => {
    expect(downloadsUrl("lodash.set")).toBe(
      "https://api.npmjs.org/downloads/point/last-week/lodash.set",
    );
  });

  it("returns unavailable on failure or an invalid body", async () => {
    expect((await setup(() => new Response("x", { status: 503 })).npm.weeklyDownloads("p")).status).toBe(
      "unavailable",
    );
    const bad = await setup(() => json({ downloads: -1 })).npm.weeklyDownloads("p");
    expect(bad.status).toBe("unavailable");
    if (bad.status === "unavailable") expect(bad.reason).toContain("npm downloads");
  });
});

describe("npm client lookupPackage", () => {
  it("is ok with provenance for an existing package", async () => {
    const r = await setup(() => json({ name: "lru-cache" })).npm.lookupPackage("lru-cache");
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.provenance).toEqual([
        { sourceUrl: "https://registry.npmjs.org/lru-cache", fetchedAt: NOW },
      ]);
    }
  });

  it("is not-found for 404 and unavailable for failures", async () => {
    const nf = await setup(() => new Response("", { status: 404 })).npm.lookupPackage("zzz");
    expect(nf.status).toBe("not-found");
    const un = await setup(() => new Response("", { status: 500 })).npm.lookupPackage("zzz");
    expect(un.status).toBe("unavailable");
  });
});
