import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { compareCertificates, runAutopsy } from "../../../src/engine/autopsy";
import type {
  AutopsyRun,
  Clock,
  DeathCertificate,
  EngineConfig,
  EngineInput,
} from "../../../src/engine/types";

const BASE_MS = Date.parse("2026-03-01T00:00:00Z");
const TOKEN = "ghp_SuperSecretToken123";

interface PackageFixture {
  versions?: Record<string, { deprecated?: string }>;
  latest?: string;
  time?: Record<string, string>;
  maintainers?: string[];
  repository?: string;
  vulns?: unknown[];
}

interface Harness {
  fetchFn: typeof fetch;
  /** Every fetch call: method, url and headers. */
  calls: { method: string; url: string; headers: Record<string, string> }[];
  clock: Clock;
  /** Number of `clock.now()` reads. */
  reads: () => number;
  /** Last value returned by the clock. */
  lastRead: () => Date;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

function harness(
  packages: Record<string, PackageFixture>,
  options: { githubError?: string } = {},
): Harness {
  let reads = 0;
  let last = new Date(BASE_MS);
  const clock: Clock = {
    now: () => {
      last = new Date(BASE_MS + reads * 1000);
      reads++;
      return last;
    },
  };
  const calls: Harness["calls"] = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      method: init?.method ?? "GET",
      url,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    });
    const u = new URL(url);

    if (u.host === "registry.npmjs.org") {
      const name = decodeURIComponent(u.pathname.slice(1));
      const p = packages[name];
      if (p === undefined) return json({ error: "Not found" }, 404);
      const versions = p.versions ?? { "1.0.0": {} };
      return json({
        name,
        maintainers: (p.maintainers ?? ["bob"]).map((n) => ({ name: n })),
        time: p.time ?? { created: "2020-01-01T00:00:00.000Z", "1.0.0": "2026-01-01T00:00:00.000Z" },
        "dist-tags": { latest: p.latest ?? Object.keys(versions).at(-1) },
        versions,
        repository: { url: p.repository ?? `git+https://github.com/o/${name}.git` },
      });
    }
    if (u.host === "api.npmjs.org") return json({ downloads: 1234 });
    if (u.host === "api.osv.dev") {
      const body = JSON.parse(String(init?.body)) as { package: { name: string } };
      return json({ vulns: packages[body.package.name]?.vulns ?? [] });
    }
    if (u.host === "api.deps.dev") {
      if (u.pathname.startsWith("/v3alpha/")) return json({ dependentCount: 7 });
      return json({ scorecard: { overallScore: 8 } });
    }
    if (u.host === "api.github.com") {
      if (options.githubError !== undefined) throw new Error(options.githubError);
      return json({ archived: false, pushed_at: "2026-01-02T00:00:00Z" });
    }
    return json({}, 404);
  };

  return { fetchFn, calls, clock, reads: () => reads, lastRead: () => last };
}

const config: EngineConfig = { requestTimeoutMs: 10_000, concurrency: 8 };

function run(
  h: Harness,
  input: EngineInput,
  cfg: EngineConfig = config,
  analysisDate?: Date,
): Promise<AutopsyRun> {
  return runAutopsy(
    input,
    cfg,
    { fetch: h.fetchFn, clock: h.clock, cache: createMemoryCache() },
    analysisDate,
  );
}

const manifest = (deps: Record<string, string>): EngineInput => ({
  kind: "package.json",
  text: JSON.stringify({ dependencies: deps }),
});

describe("runAutopsy", () => {
  it("analyzes one package against every source", async () => {
    const h = harness({ alpha: {} });
    const result = await run(h, { kind: "name", name: "alpha" });

    expect(result.errors).toEqual([]);
    expect(result.certificates).toHaveLength(1);
    const cert = result.certificates[0] as DeathCertificate;
    expect(cert.package).toEqual({ name: "alpha", version: "1.0.0" });
    expect(cert.status).toBe("alive");
    expect(cert.vitalSigns.dependents).toEqual({ available: true, value: 7 });
    expect(cert.vitalSigns.weeklyDownloads).toEqual({ available: true, value: 1234 });
    expect(cert.vitalSigns.scorecard).toEqual({ available: true, value: 8 });

    const urls = h.calls.map((c) => c.url);
    expect(urls.some((u) => u.startsWith("https://registry.npmjs.org/alpha"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://api.osv.dev/"))).toBe(true);
    expect(urls.some((u) => u.includes("/v3/projects/"))).toBe(true);
    expect(urls.some((u) => u.includes(":dependents"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://api.npmjs.org/downloads/"))).toBe(true);
    expect(urls.some((u) => u === "https://api.github.com/repos/o/alpha")).toBe(true);
    // One request per unique cache key: the packument is fetched once.
    expect(urls.filter((u) => u === "https://registry.npmjs.org/alpha")).toHaveLength(1);
  });

  it("orders certificates by name regardless of manifest order", async () => {
    const h = harness({ zeta: {}, alpha: {}, mid: {} });
    const result = await run(h, manifest({ zeta: "1.0.0", alpha: "1.0.0", mid: "1.0.0" }));
    expect(result.certificates.map((c) => c.package.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("compareCertificates sorts by name, then semver precedence, then version string", () => {
    const make = (name: string, version: string): DeathCertificate =>
      ({ package: { name, version } }) as DeathCertificate;
    const list = [
      make("b", "1.0.0"),
      make("a", "10.0.0"),
      make("a", "2.0.0"),
      make("a", "2.0.0-beta.1"),
      make("Z", "1.0.0"),
    ];
    const sorted = [...list].sort(compareCertificates).map((c) => `${c.package.name}@${c.package.version}`);
    expect(sorted).toEqual(["Z@1.0.0", "a@2.0.0-beta.1", "a@2.0.0", "a@10.0.0", "b@1.0.0"]);
  });

  it("stops a package on npm not-found and calls no other source for it", async () => {
    const h = harness({ alpha: {} });
    const result = await run(h, manifest({ ghost: "1.0.0", alpha: "1.0.0" }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ kind: "not-found", package: "ghost" });
    expect(result.errors[0]?.message).toContain("ghost");
    expect(result.certificates.map((c) => c.package.name)).toEqual(["alpha"]);

    // The only request naming ghost is the registry packument.
    expect(h.calls.filter((c) => c.url.includes("ghost")).map((c) => c.url)).toEqual([
      "https://registry.npmjs.org/ghost",
    ]);
    // OSV was called only for alpha (one POST).
    expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("collects a range-unsatisfied error without stopping the other packages", async () => {
    const h = harness({ alpha: {}, beta: {} });
    const result = await run(h, manifest({ alpha: "^9.0.0", beta: "1.0.0" }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      kind: "range-unsatisfied",
      package: "alpha",
      range: "^9.0.0",
    });
    expect(result.certificates.map((c) => c.package.name)).toEqual(["beta"]);
  });

  it("finds the successor of a deprecated package and skips the stoplisted word", async () => {
    const h = harness({
      inflight: {
        versions: {
          "1.0.6": {
            deprecated:
              "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.",
          },
        },
      },
      "lru-cache": {},
    });
    const result = await run(h, { kind: "name", name: "inflight", version: "1.0.6" });

    const cert = result.certificates[0] as DeathCertificate;
    expect(cert.status).toBe("retired-with-successor");
    expect(cert.successor).toBe("lru-cache");
    const urls = h.calls.map((c) => c.url);
    expect(urls).toContain("https://registry.npmjs.org/lru-cache");
    expect(urls).not.toContain("https://registry.npmjs.org/it");
    expect(cert.facts.some((f) => f.key === "successorLookup:lru-cache")).toBe(true);
  });

  it("reads the clock once for the Analysis_Date, after the last fetch, when none is supplied", async () => {
    const h = harness({ alpha: {}, beta: {} });
    const withoutDate = await run(h, manifest({ alpha: "1.0.0", beta: "1.0.0" }));

    const fixed = harness({ alpha: {}, beta: {} });
    const date = new Date("2030-01-01T00:00:00Z");
    const withDate = await run(fixed, manifest({ alpha: "1.0.0", beta: "1.0.0" }), config, date);

    // Same fetches, so the only difference in clock reads is the Analysis_Date read.
    expect(h.reads()).toBe(fixed.reads() + 1);

    // The last clock reading of the run is the Analysis_Date, shared by all certificates.
    const expected = h.lastRead().toISOString().replace(".000Z", "Z");
    expect(withoutDate.certificates.map((c) => c.analysisDate)).toEqual([expected, expected]);
    for (const cert of withoutDate.certificates) {
      for (const fact of cert.facts) {
        for (const p of fact.provenance) expect(p.fetchedAt <= cert.analysisDate).toBe(true);
      }
    }

    // A supplied date is used unchanged.
    expect(withDate.certificates.map((c) => c.analysisDate)).toEqual([
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00Z",
    ]);
  });

  it("never puts the GitHub token in the output, and sends it only to GitHub", async () => {
    const h = harness({ alpha: {} }, { githubError: `connect failed with ${TOKEN}` });
    const result = await run(h, { kind: "name", name: "alpha" }, { ...config, githubToken: TOKEN });

    const text = JSON.stringify(result);
    expect(text).not.toContain(TOKEN);
    const withAuth = h.calls.filter((c) => JSON.stringify(c.headers).includes(TOKEN));
    expect(withAuth.length).toBeGreaterThan(0);
    expect(withAuth.every((c) => c.url.startsWith("https://api.github.com/"))).toBe(true);
    expect(result.certificates[0]?.notes.githubTokenUsed).toBe(true);
  });

  it("reports an invalid cache TTL in notes and a parse error for bad input", async () => {
    const h = harness({});
    const result = await run(h, { kind: "other", filename: "yarn.lock", text: "" }, {
      ...config,
      cacheTtlMs: -5,
    });
    expect(result.certificates).toEqual([]);
    expect(result.errors[0]?.kind).toBe("parse");
    expect(result.notes.some((n) => n.includes("Invalid Cache_TTL"))).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("adds the no-packages note for an empty manifest", async () => {
    const h = harness({});
    const result = await run(h, manifest({}));
    expect(result.certificates).toEqual([]);
    expect(result.notes).toContain("no packages found");
  });
});
