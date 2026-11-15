import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  META_FILE_NAME,
  TARBALL_FILE_NAME,
  assertRegistryUrl,
  recordTarball,
} from "../../../scripts/lib/recordTarball";
import { computeSri } from "../../../src/proof/shell/integrity";

const TARBALL_URL = "https://registry.npmjs.org/lodash.set/-/lodash.set-4.3.2.tgz";
const BYTES = new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
const AUTHOR = { name: "A. Author", email: "a@example.com", url: "http://example.com/" };
const CONTRIBUTORS = [{ name: "C. Contributor", email: "c@example.com" }];
const MAINTAINERS = [{ name: "m1", email: "m1@example.com" }];

let dir: string;
let packumentPath: string;
let outDir: string;

function writePackument(tarball: string, integrity: string): void {
  const body = {
    versions: {
      "4.3.2": {
        license: "MIT",
        author: AUTHOR,
        contributors: CONTRIBUTORS,
        maintainers: MAINTAINERS,
        dist: { tarball, integrity },
      },
    },
  };
  const fixture = {
    cacheKey: "[]",
    sourceUrl: "https://registry.npmjs.org/lodash.set",
    body: JSON.stringify(body),
    status: 200,
    fetchedAt: "2026-11-14T18:29:34Z",
  };
  writeFileSync(packumentPath, JSON.stringify(fixture), "utf8");
}

interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; redirect: RequestRedirect | undefined }[];
}

function fakeFetch(bytes: Uint8Array, status = 200): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, redirect: init?.redirect });
    return new Response(status === 200 ? new Blob([Buffer.from(bytes)]) : null, { status });
  };
  return { fetch: fn, calls };
}

const clock = { now: (): Date => new Date("2030-01-02T03:04:05.678Z") };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "record-tarball-"));
  packumentPath = join(dir, "npm-fake.json");
  outDir = join(dir, "out");
  writePackument(TARBALL_URL, computeSri(BYTES));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("recordTarball", () => {
  it("writes the tarball and the metadata file with the exact key set", async () => {
    const fake = fakeFetch(BYTES);
    const summary = await recordTarball({ fetch: fake.fetch, clock, packumentPath, outDir });
    expect(summary.written).toHaveLength(2);
    expect(fake.calls).toEqual([{ url: TARBALL_URL, redirect: "manual" }]);
    expect(new Uint8Array(readFileSync(join(outDir, TARBALL_FILE_NAME)))).toEqual(BYTES);

    const text = readFileSync(join(outDir, META_FILE_NAME), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    const meta = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(meta)).toEqual([
      "name",
      "version",
      "tarballUrl",
      "integrity",
      "sourceUrl",
      "fetchedAt",
      "license",
      "author",
      "maintainers",
      "contributors",
      "packument",
    ]);
    expect(meta).toEqual({
      name: "lodash.set",
      version: "4.3.2",
      tarballUrl: TARBALL_URL,
      integrity: computeSri(BYTES),
      sourceUrl: "https://registry.npmjs.org/lodash.set",
      fetchedAt: "2030-01-02T03:04:05Z",
      license: "MIT",
      author: AUTHOR,
      maintainers: MAINTAINERS,
      contributors: CONTRIBUTORS,
      packument: { file: "npm-fake.json", integrity: computeSri(BYTES) },
    });
  });

  it("writes nothing when the integrity does not match", async () => {
    const changed = BYTES.slice();
    changed[5] = (changed[5] ?? 0) ^ 1;
    await expect(
      recordTarball({ fetch: fakeFetch(changed).fetch, clock, packumentPath, outDir }),
    ).rejects.toThrow(/Integrity mismatch.*Nothing was written/s);
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects a non-npm host without making a request", async () => {
    writePackument("https://evil.example.com/lodash.set-4.3.2.tgz", computeSri(BYTES));
    const fake = fakeFetch(BYTES);
    await expect(recordTarball({ fetch: fake.fetch, clock, packumentPath, outDir })).rejects.toThrow(
      /only https:\/\/registry\.npmjs\.org/,
    );
    expect(fake.calls).toHaveLength(0);
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects redirects and writes nothing", async () => {
    await expect(
      recordTarball({ fetch: fakeFetch(BYTES, 302).fetch, clock, packumentPath, outDir }),
    ).rejects.toThrow(/redirect/);
    expect(existsSync(outDir)).toBe(false);
  });

  it("rejects a download larger than 5 MiB even when its integrity matches, and writes nothing", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    writePackument(TARBALL_URL, computeSri(big));
    await expect(recordTarball({ fetch: fakeFetch(big).fetch, clock, packumentPath, outDir })).rejects.toThrow(
      /larger than 5242880 bytes/,
    );
    expect(existsSync(outDir)).toBe(false);
  });

  it("validates registry URLs", () => {
    expect(() => assertRegistryUrl(TARBALL_URL)).not.toThrow();
    expect(() => assertRegistryUrl("http://registry.npmjs.org/x.tgz")).toThrow();
    expect(() => assertRegistryUrl("https://registry.npmjs.org.evil.com/x.tgz")).toThrow();
    expect(() => assertRegistryUrl("https://user@registry.npmjs.org/x.tgz")).toThrow();
    expect(() => assertRegistryUrl("not a url")).toThrow();
  });

  it("does not overwrite existing files without force, and does with force", async () => {
    await recordTarball({ fetch: fakeFetch(BYTES).fetch, clock, packumentPath, outDir });
    const fake = fakeFetch(BYTES);
    await expect(recordTarball({ fetch: fake.fetch, clock, packumentPath, outDir })).rejects.toThrow(/--force/);
    expect(fake.calls).toHaveLength(0);

    const later = { now: (): Date => new Date("2031-05-06T07:08:09Z") };
    await recordTarball({ fetch: fake.fetch, clock: later, packumentPath, outDir, force: true });
    const meta = JSON.parse(readFileSync(join(outDir, META_FILE_NAME), "utf8")) as { fetchedAt: string };
    expect(meta.fetchedAt).toBe("2031-05-06T07:08:09Z");
  });

  it("dry run makes no request and writes nothing", async () => {
    const fake = fakeFetch(BYTES);
    const lines: string[] = [];
    const summary = await recordTarball({
      fetch: fake.fetch,
      clock,
      packumentPath,
      outDir,
      dryRun: true,
      log: (l) => lines.push(l),
    });
    expect(summary).toEqual({ dryRun: true, written: [] });
    expect(fake.calls).toHaveLength(0);
    expect(existsSync(outDir)).toBe(false);
    expect(lines.join("\n")).toContain(TARBALL_URL);
  });

  it("omits credit fields that the packument does not have", async () => {
    const body = {
      versions: { "4.3.2": { license: "MIT", dist: { tarball: TARBALL_URL, integrity: computeSri(BYTES) } } },
    };
    writeFileSync(
      packumentPath,
      JSON.stringify({ sourceUrl: "https://registry.npmjs.org/lodash.set", body: JSON.stringify(body) }),
      "utf8",
    );
    await recordTarball({ fetch: fakeFetch(BYTES).fetch, clock, packumentPath, outDir });
    const meta = JSON.parse(readFileSync(join(outDir, META_FILE_NAME), "utf8")) as Record<string, unknown>;
    expect(Object.keys(meta)).not.toContain("author");
    expect(Object.keys(meta)).not.toContain("contributors");
  });
});
