import { describe, expect, it } from "vitest";
import {
  buildCertificate,
  type NpmSignal,
  type Signals,
} from "../../../src/engine/core/certificate";
import { extractCandidates, findSuccessor } from "../../../src/engine/core/successor";
import { DeathCertificateSchema, type Provenance, type SourceResult } from "../../../src/engine/types";

const ANALYSIS = new Date("2026-11-14T12:00:00.000Z");
const FETCHED = "2026-11-14T10:00:00Z";

function prov(url: string, at = FETCHED): Provenance[] {
  return [{ sourceUrl: url, fetchedAt: at }];
}

function ok<T>(value: T, url: string, at = FETCHED): SourceResult<T> {
  return { status: "ok", value, provenance: prov(url, at) };
}

function notFound(name: string): SourceResult<never> {
  return {
    status: "not-found",
    source: "npm",
    url: `https://registry.npmjs.org/${name}`,
    fetchedAt: "2026-11-14T10:15:00Z",
  };
}

function failed(source: "npm" | "osv" | "deps.dev" | "github", url: string): SourceResult<never> {
  return {
    status: "unavailable",
    source,
    attemptedUrl: url,
    attemptedAt: "2026-11-14T10:30:00Z",
    reason: "timeout after 10 s",
  };
}

const NPM_URL = "https://registry.npmjs.org/left-pad";
const OSV_URL = "https://api.osv.dev/v1/query";
const GH_URL = "https://api.github.com/repos/a/left-pad";

function npmSignal(over: Partial<NpmSignal> = {}): NpmSignal {
  return {
    maintainers: ["zed", "alice"],
    time: { created: "2010-01-01T00:00:00.000Z", "1.0.0": "2026-10-01T00:00:00.000Z" },
    ...over,
  };
}

function baseSignals(over: Partial<Signals> = {}): Signals {
  return {
    name: "left-pad",
    version: "1.0.0",
    publishedVersions: ["1.0.0"],
    npm: ok(npmSignal(), NPM_URL),
    osv: ok([], OSV_URL),
    scorecard: ok(8, "https://api.deps.dev/v3/projects/github.com%2Fa%2Fleft-pad"),
    dependents: ok(0, "https://api.deps.dev/v3alpha/systems/npm/packages/left-pad/versions/1.0.0:dependents"),
    weeklyDownloads: ok(1200, "https://api.npmjs.org/downloads/point/last-week/left-pad"),
    github: ok({ archived: false, pushedAt: "2026-10-30T00:00:00Z" }, GH_URL),
    successor: { lookups: [] },
    githubTokenUsed: true,
    ...over,
  };
}

function expectValid(c: unknown): void {
  const parsed = DeathCertificateSchema.safeParse(c);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
}

describe("buildCertificate", () => {
  it("builds an alive certificate with all vital signs, time of death and facts", () => {
    const c = buildCertificate(baseSignals(), ANALYSIS);
    expectValid(c);
    expect(c.status).toBe("alive");
    expect(c.analysisDate).toBe("2026-11-14T12:00:00Z");
    expect(c.timeOfDeath).toEqual({ available: true, value: "2026-10-01T00:00:00Z" });
    expect(c.daysSinceDeath).toBe(44);
    expect(c.vitalSigns.maintainers).toEqual({ available: true, value: ["zed", "alice"] });
    expect(c.vitalSigns.openVulnerabilities).toEqual({ available: true, value: [] });
    expect(c.vitalSigns.dependents).toEqual({ available: true, value: 0 });
    expect(c.notes.githubTokenUsed).toBe(true);
    expect(c.notes.omittedFacts).toEqual([]);
    expect(c.facts.map((f) => f.key)).toEqual([
      "dependents",
      "githubRepo",
      "maintainers",
      "openVulnerabilities",
      "scorecard",
      "timeOfDeath",
      "weeklyDownloads",
    ]);
    for (const f of c.facts) expect(f.provenance.length).toBeGreaterThanOrEqual(1);
    expect(c.risk.formula.weights).toBeDefined();
  });

  it("is a pure function of its arguments", () => {
    const s = baseSignals();
    expect(buildCertificate(s, ANALYSIS)).toEqual(buildCertificate(s, new Date(ANALYSIS.getTime())));
  });

  it("keeps maintainers in registry order and distinguishes empty from unavailable", () => {
    const empty = buildCertificate(baseSignals({ npm: ok(npmSignal({ maintainers: [] }), NPM_URL) }), ANALYSIS);
    expect(empty.vitalSigns.maintainers).toEqual({ available: true, value: [] });
    expect(empty.causes).toContain("maintainer-gone");
    expect(empty.status).toBe("dead");

    const gone = buildCertificate(baseSignals({ npm: failed("npm", NPM_URL) }), ANALYSIS);
    expectValid(gone);
    expect(gone.vitalSigns.maintainers).toEqual({
      available: false,
      source: "npm",
      attemptedUrl: NPM_URL,
      attemptedAt: "2026-11-14T10:30:00Z",
      reason: "timeout after 10 s",
    });
    expect(gone.timeOfDeath.available).toBe(false);
    expect(gone.daysSinceDeath).toBeUndefined();
    expect(gone.causes).not.toContain("maintainer-gone");
    expect(gone.risk.unavailable).toContain("maintainers");
  });

  it("reports a zero count as available and a failed count as unavailable with the attempt", () => {
    const url = "https://api.deps.dev/v3alpha/systems/npm/packages/left-pad/versions/1.0.0:dependents";
    const c = buildCertificate(
      baseSignals({ weeklyDownloads: ok(0, "https://api.npmjs.org/downloads/point/last-week/left-pad"), dependents: failed("deps.dev", url) }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.vitalSigns.weeklyDownloads).toEqual({ available: true, value: 0 });
    expect(c.vitalSigns.dependents).toMatchObject({ available: false, attemptedUrl: url, attemptedAt: "2026-11-14T10:30:00Z" });
    expect(c.facts.some((f) => f.key === "dependents")).toBe(false);
  });

  it("reports a missing Scorecard as unavailable with reason 'no scorecard'", () => {
    const url = "https://api.deps.dev/v3/projects/github.com%2Fa%2Fleft-pad";
    const c = buildCertificate(baseSignals({ scorecard: ok(null, url) }), ANALYSIS);
    expectValid(c);
    expect(c.vitalSigns.scorecard).toEqual({
      available: false,
      source: "deps.dev",
      attemptedUrl: url,
      attemptedAt: FETCHED,
      reason: "no scorecard",
    });
  });

  it("filters fixed vulnerabilities and orders open ones by id with sorted unique aliases", () => {
    const osv = ok(
      [
        { id: "GHSA-b", aliases: ["CVE-2", "CVE-1", "CVE-2"], summary: "b", severity: "HIGH", fixedVersions: [] },
        { id: "GHSA-a", aliases: [], summary: "a", fixedVersions: ["1.0.1"] },
        { id: "GHSA-c", aliases: [], summary: "c", fixedVersions: ["2.0.0"] },
        { id: "GHSA-a0", aliases: [], summary: "a0", fixedVersions: [] },
      ],
      OSV_URL,
    );
    const c = buildCertificate(baseSignals({ osv, publishedVersions: ["1.0.0", "1.0.1"] }), ANALYSIS);
    expectValid(c);
    expect(c.openVulnerabilityIds).toEqual(["GHSA-a0", "GHSA-b", "GHSA-c"]);
    expect(c.causes).toContain("unpatched-cve");
    const list = c.vitalSigns.openVulnerabilities;
    expect(list.available && list.value.map((v) => v.id)).toEqual(["GHSA-a0", "GHSA-b", "GHSA-c"]);
    expect(list.available && list.value[1]).toEqual({
      id: "GHSA-b",
      aliases: ["CVE-1", "CVE-2"],
      summary: "b",
      severity: "HIGH",
    });
    // OSV and npm both contributed (fixed versions were checked against published versions).
    const fact = c.facts.find((f) => f.key === "openVulnerabilities");
    expect(fact?.provenance.map((p) => p.sourceUrl)).toEqual([OSV_URL, NPM_URL]);
  });

  it("omits Facts without valid provenance and lists them in notes.omittedFacts", () => {
    const c = buildCertificate(
      baseSignals({
        dependents: { status: "ok", value: 5, provenance: [] },
        weeklyDownloads: { status: "ok", value: 9, provenance: [{ sourceUrl: "  ", fetchedAt: FETCHED }] },
        scorecard: { status: "ok", value: 5, provenance: [{ sourceUrl: "https://x.test/a", fetchedAt: "yesterday" }] },
      }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.notes.omittedFacts).toEqual([
      { key: "dependents", reason: "missing-provenance" },
      { key: "scorecard", reason: "missing-provenance" },
      { key: "weeklyDownloads", reason: "missing-provenance" },
    ]);
    expect(c.facts.map((f) => f.key)).not.toContain("dependents");
  });

  it("caps provenance at 20 sorted unique entries and flags stale facts", () => {
    const many: Provenance[] = Array.from({ length: 25 }, (_, i) => ({
      sourceUrl: `https://registry.npmjs.org/p${String(24 - i).padStart(2, "0")}`,
      fetchedAt: FETCHED,
    }));
    const c = buildCertificate(
      baseSignals({
        weeklyDownloads: { status: "ok", value: 3, provenance: [...many, many[0] as Provenance], stale: true },
      }),
      ANALYSIS,
    );
    expectValid(c);
    const f = c.facts.find((x) => x.key === "weeklyDownloads");
    expect(f?.stale).toBe(true);
    expect(f?.provenance).toHaveLength(20);
    expect(f?.provenance[0]?.sourceUrl).toBe("https://registry.npmjs.org/p00");
    expect(c.facts.find((x) => x.key === "maintainers")?.stale).toBeUndefined();
  });

  it("records the GitHub skip reason and token flag", () => {
    const c = buildCertificate(
      baseSignals({
        github: { status: "skipped", reason: "no github.com repository URL was available" },
        githubTokenUsed: false,
      }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.notes.githubSkippedReason).toBe("no github.com repository URL was available");
    expect(c.notes.githubTokenUsed).toBe(false);
    expect(c.facts.some((f) => f.key === "githubRepo")).toBe(false);
  });

  it("assigns retired-with-successor and records the successor and lookups as Facts", () => {
    const lookupUrl = "https://registry.npmjs.org/lru-cache";
    const c = buildCertificate(
      baseSignals({
        npm: ok(npmSignal({ deprecation: "Do not use it. Check out lru-cache" }), NPM_URL),
        successor: {
          successor: "lru-cache",
          lookups: [
            { name: "missing-pkg", outcome: "result", result: notFound("missing-pkg") },
            { name: "flaky", outcome: "result", result: failed("npm", "https://registry.npmjs.org/flaky") },
            { name: "lru-cache", outcome: "result", result: ok({}, lookupUrl) },
          ],
        },
      }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.status).toBe("retired-with-successor");
    expect(c.successor).toBe("lru-cache");
    const keys = c.facts.map((f) => f.key);
    expect(keys).toContain("successor");
    expect(keys).toContain("successorLookup:lru-cache");
    expect(keys).toContain("successorLookup:flaky");
    expect(keys).not.toContain("deprecation");
    expect(c.facts.find((f) => f.key === "successor")?.provenance).toEqual(prov(lookupUrl));
    expect(keys).toContain("successorLookup:missing-pkg");
    expect(c.notes.omittedFacts).toEqual([]);
  });

  describe("successor lookup Facts (R4.2, R3.1)", () => {
    const lookupFactOf = (c: ReturnType<typeof buildCertificate>, name: string) =>
      c.facts.find((f) => f.key === `successorLookup:${name}`);
    const SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

    it("records a rejected (404) candidate as a not-found Fact with the requested URL and response time", () => {
      const c = buildCertificate(
        baseSignals({
          npm: ok(npmSignal({ deprecation: "Use `gone-pkg` instead" }), NPM_URL),
          successor: { lookups: [{ name: "gone-pkg", outcome: "result", result: notFound("gone-pkg") }] },
        }),
        ANALYSIS,
      );
      expectValid(c);
      const f = lookupFactOf(c, "gone-pkg");
      expect(f?.value).toEqual({ result: "not-found" });
      expect(f?.provenance).toEqual(prov("https://registry.npmjs.org/gone-pkg", "2026-11-14T10:15:00Z"));
      expect(f?.provenance[0]?.fetchedAt).toMatch(SECOND);
      expect(c.successor).toBeUndefined();
      expect(c.notes.omittedFacts).toEqual([]);
    });

    it("records a failed lookup as unavailable with the attempted URL and attempt time", () => {
      const url = "https://registry.npmjs.org/flaky";
      const c = buildCertificate(
        baseSignals({
          successor: { lookups: [{ name: "flaky", outcome: "result", result: failed("npm", url) }] },
        }),
        ANALYSIS,
      );
      expectValid(c);
      const f = lookupFactOf(c, "flaky");
      expect(f?.value).toEqual({ result: "unavailable", reason: "timeout after 10 s" });
      expect(f?.provenance).toEqual(prov(url, "2026-11-14T10:30:00Z"));
    });

    it("inflight: stoplisted `it` has no Fact, `lru-cache` exists and is the Successor", async () => {
      const message =
        "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value.";
      const lookedUp: string[] = [];
      const outcome = await findSuccessor(extractCandidates(message), (name) => {
        lookedUp.push(name);
        return Promise.resolve(ok({}, `https://registry.npmjs.org/${name}`));
      });
      expect(lookedUp).toEqual(["lru-cache"]);
      const c = buildCertificate(
        baseSignals({ npm: ok(npmSignal({ deprecation: message }), NPM_URL), successor: outcome }),
        ANALYSIS,
      );
      expectValid(c);
      expect(c.successor).toBe("lru-cache");
      expect(lookupFactOf(c, "it")).toBeUndefined();
      expect(lookupFactOf(c, "lru-cache")?.value).toEqual({ result: "exists" });
    });

    it("keeps both Facts when the first candidate is not found and the second exists", () => {
      const c = buildCertificate(
        baseSignals({
          successor: {
            successor: "second",
            lookups: [
              { name: "first", outcome: "result", result: notFound("first") },
              { name: "second", outcome: "result", result: ok({}, "https://registry.npmjs.org/second") },
            ],
          },
        }),
        ANALYSIS,
      );
      expectValid(c);
      expect(lookupFactOf(c, "first")?.value).toEqual({ result: "not-found" });
      expect(lookupFactOf(c, "second")?.value).toEqual({ result: "exists" });
      expect(c.successor).toBe("second");
      expect(c.facts.find((f) => f.key === "successor")?.provenance).toEqual(
        prov("https://registry.npmjs.org/second"),
      );
    });

    it("reports a lookup that threw (defensive path) in omittedFacts", () => {
      const c = buildCertificate(
        baseSignals({ successor: { lookups: [{ name: "boom", outcome: "threw", error: "x" }] } }),
        ANALYSIS,
      );
      expect(lookupFactOf(c, "boom")).toBeUndefined();
      expect(c.notes.omittedFacts).toEqual([{ key: "successorLookup:boom", reason: "missing-provenance" }]);
    });
  });

  it("records the full deprecation message as a Fact when dead without a successor", () => {
    const message = "This package is no longer supported.";
    const c = buildCertificate(baseSignals({ npm: ok(npmSignal({ deprecation: message }), NPM_URL) }), ANALYSIS);
    expectValid(c);
    expect(c.status).toBe("dead");
    expect(c.successor).toBeUndefined();
    expect(c.facts.find((f) => f.key === "deprecation")).toMatchObject({ value: message, provenance: prov(NPM_URL) });
  });

  it("includes time of death and days since for every status, floored and clamped at zero", () => {
    const dying = buildCertificate(
      baseSignals({ scorecard: ok(0, "https://api.deps.dev/v3/projects/x"), osv: ok([{ id: "A", aliases: [], summary: "s", fixedVersions: [] }, { id: "B", aliases: [], summary: "s", fixedVersions: [] }], OSV_URL) }),
      ANALYSIS,
    );
    expect(dying.daysSinceDeath).toBeDefined();
    const future = buildCertificate(baseSignals(), new Date("2026-09-01T00:00:00Z"));
    expect(future.daysSinceDeath).toBe(0);
  });

  it("adds runtime-rot and the risk breakdown for an old, archived package", () => {
    const c = buildCertificate(
      baseSignals({
        npm: ok(npmSignal({ time: { "1.0.0": "2020-01-01T00:00:00.000Z" } }), NPM_URL),
        github: ok({ archived: true, pushedAt: null }, GH_URL),
      }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.causes).toEqual(["repo-archived", "runtime-rot"]);
    expect(c.status).toBe("dead");
    expect(c.risk.contributions.slice(0, 2)).toEqual([
      { component: "cause:repo-archived", points: 20 },
      { component: "cause:runtime-rot", points: 15 },
    ]);
    expect(c.risk.rawScore).toBe(c.risk.contributions.reduce((a, x) => a + x.points, 0));
  });

  it("reports unavailable time of death when the time map has no publish date", () => {
    const c = buildCertificate(
      baseSignals({ npm: ok(npmSignal({ time: { created: "2020-01-01T00:00:00.000Z" } }), NPM_URL) }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.timeOfDeath).toMatchObject({ available: false, reason: "no release publish date was found", attemptedUrl: NPM_URL });
    expect(c.daysSinceDeath).toBeUndefined();
  });

  it("states that no inputs were available when every source fails", () => {
    const c = buildCertificate(
      baseSignals({
        npm: failed("npm", NPM_URL),
        osv: failed("osv", OSV_URL),
        scorecard: failed("deps.dev", "https://api.deps.dev/v3/projects/x"),
        dependents: failed("deps.dev", "https://api.deps.dev/v3alpha/x"),
        weeklyDownloads: failed("npm", "https://api.npmjs.org/downloads/point/last-week/left-pad"),
        github: failed("github", GH_URL),
      }),
      ANALYSIS,
    );
    expectValid(c);
    expect(c.riskScore).toBe(0);
    expect(c.risk.note).toBe("no inputs were available");
    expect(c.status).toBe("alive");
    expect(c.facts).toEqual([]);
  });
});
