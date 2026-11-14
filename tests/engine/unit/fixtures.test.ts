import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareCertificates, runAutopsy } from "../../../src/engine/autopsy";
import { createMemoryCache } from "../../../src/engine/cache/cache";
import { canonicalJson } from "../../../src/engine/serialize/canonicalJson";
import type {
  AutopsyError,
  AutopsyRun,
  Clock,
  DeathCertificate,
  EngineConfig,
  EngineInput,
  Vulnerability,
} from "../../../src/engine/types";
import {
  createReplayFetch,
  FixtureUnparseableError,
  UnrecordedRequestError,
} from "../helpers/replayFetch";

/**
 * Fixture verdict tests (Requirement 11). Only the recorded files are used, through
 * createReplayFetch. The Clock and the analysisDate are fixed. The real fetch is never
 * called (the global network guard replaces it and would fail the run).
 */

const CLOCK: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const ANALYSIS_DATE = new Date("2026-01-01T00:00:00Z");
const CONFIG: EngineConfig = { requestTimeoutMs: 10_000, concurrency: 8 };
const FIXTURES = join(__dirname, "..", "fixtures");

type FixtureName = "inflight" | "ip" | "lodash.set";
const DEMO: readonly { name: FixtureName; version: string }[] = [
  { name: "inflight", version: "1.0.6" },
  { name: "ip", version: "2.0.1" },
  { name: "lodash.set", version: "4.3.2" },
];

function dirOf(root: string, name: FixtureName): string {
  return join(root, name);
}

async function runDemo(
  input: EngineInput,
  dirs: readonly string[],
): Promise<{ run: AutopsyRun; unrecorded: number }> {
  const replay = createReplayFetch(dirs);
  const run = await runAutopsy(
    input,
    CONFIG,
    { fetch: replay.fetch, clock: CLOCK, cache: createMemoryCache() },
    ANALYSIS_DATE,
  );
  expect(replay.unrecordedCalls()).toEqual([]);
  replay.assertNoUnrecordedRequests();
  return { run, unrecorded: replay.unrecordedCalls().length };
}

function packageJsonOfAll(): EngineInput {
  const dependencies: Record<string, string> = {};
  for (const p of DEMO) dependencies[p.name] = p.version;
  return { kind: "package.json", text: JSON.stringify({ name: "demo", dependencies }) };
}

function single(run: AutopsyRun): DeathCertificate {
  expect(run.errors).toEqual([]);
  expect(run.certificates).toHaveLength(1);
  const cert = run.certificates[0];
  if (cert === undefined) throw new Error("no certificate");
  return cert;
}

function vulnerabilities(cert: DeathCertificate): Vulnerability[] {
  const vs = cert.vitalSigns.openVulnerabilities;
  if (!vs.available) throw new Error(`open vulnerabilities unavailable: ${vs.reason}`);
  return vs.value;
}

function hasCve(cert: DeathCertificate, cve: string): boolean {
  return vulnerabilities(cert).some((v) => v.id === cve || v.aliases.includes(cve));
}

/** Facts that must match across runs: status, causes, Successor, vulnerability id and aliases. */
function verdict(cert: DeathCertificate): unknown {
  return {
    name: cert.package.name,
    version: cert.package.version,
    status: cert.status,
    causes: cert.causes,
    successor: cert.successor,
    vulnerabilities: vulnerabilities(cert).map((v) => ({ id: v.id, aliases: v.aliases })),
  };
}

describe("fixture verdicts (R11)", () => {
  it("ip@2.0.1 is dead with unpatched-cve and CVE-2024-29415 (R11.1)", async () => {
    const { run } = await runDemo({ kind: "name", name: "ip", version: "2.0.1" }, [dirOf(FIXTURES, "ip")]);
    const cert = single(run);
    expect(cert.package).toEqual({ name: "ip", version: "2.0.1" });
    expect(cert.status).toBe("dead");
    expect(cert.causes).toContain("unpatched-cve");
    expect(hasCve(cert, "CVE-2024-29415")).toBe(true);
    expect(cert.openVulnerabilityIds.length).toBeGreaterThan(0);
    // The recorded packument lists 2.0.1 among the published versions.
    expect(cert.facts.some((f) => f.provenance.some((p) => p.sourceUrl === "https://registry.npmjs.org/ip"))).toBe(true);
    expect(JSON.stringify(cert)).not.toContain("Network guard");
  });

  it("lodash.set@4.3.2 is dead with unpatched-cve and CVE-2020-8203 (R11.2)", async () => {
    const { run } = await runDemo({ kind: "name", name: "lodash.set", version: "4.3.2" }, [
      dirOf(FIXTURES, "lodash.set"),
    ]);
    const cert = single(run);
    expect(cert.package).toEqual({ name: "lodash.set", version: "4.3.2" });
    expect(cert.status).toBe("dead");
    expect(cert.causes).toContain("unpatched-cve");
    expect(hasCve(cert, "CVE-2020-8203")).toBe(true);
    expect(JSON.stringify(cert)).not.toContain("Network guard");
  });

  it("inflight@1.0.6 is retired-with-successor (R11.3)", async () => {
    const { run } = await runDemo({ kind: "name", name: "inflight", version: "1.0.6" }, [
      dirOf(FIXTURES, "inflight"),
    ]);
    const cert = single(run);
    expect(cert.package).toEqual({ name: "inflight", version: "1.0.6" });
    expect(cert.status).toBe("retired-with-successor");
    expect(JSON.stringify(cert)).not.toContain("Network guard");
  });

  it("a list of the three yields exactly three certificates ordered inflight, ip, lodash.set (R11.5)", async () => {
    const dirs = DEMO.map((p) => dirOf(FIXTURES, p.name));
    const { run } = await runDemo(packageJsonOfAll(), dirs);
    expect(run.errors).toEqual([]);
    expect(run.certificates.map((c) => c.package.name)).toEqual(["inflight", "ip", "lodash.set"]);
    expect(run.certificates.map((c) => c.status)).toEqual(["retired-with-successor", "dead", "dead"]);
    expect([...run.certificates].sort(compareCertificates)).toEqual(run.certificates);
  });

  it("two runs give identical verdicts and byte-identical canonical JSON (R11.7)", async () => {
    const dirs = DEMO.map((p) => dirOf(FIXTURES, p.name));
    const a = await runDemo(packageJsonOfAll(), dirs);
    const b = await runDemo(packageJsonOfAll(), dirs);
    expect(a.run.certificates.map(verdict)).toEqual(b.run.certificates.map(verdict));
    expect(a.run.certificates.map((c) => canonicalJson(c))).toEqual(
      b.run.certificates.map((c) => canonicalJson(c)),
    );
  });
});

describe("missing or unparseable recordings (R11.6)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gs-fixtures-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function jsonFiles(dir: string): string[] {
    return readdirSync(dir).filter((n) => n.endsWith(".json"));
  }

  /**
   * The engine reports a failed upstream read as an `unavailable` fact, so the fixture
   * mapping lives here: each package runs alone against its own replay fetch, and a
   * replay error (unrecorded request or unparseable file) fails only that package
   * with a fixture-missing / fixture-unparseable AutopsyError naming package and response.
   */
  async function analyzeEach(root: string): Promise<{ certificates: DeathCertificate[]; errors: AutopsyError[]; calls: number }> {
    const certificates: DeathCertificate[] = [];
    const errors: AutopsyError[] = [];
    let calls = 0;
    for (const p of DEMO) {
      const replay = createReplayFetch([dirOf(root, p.name)]);
      let failure: AutopsyError | undefined;
      const watching: typeof fetch = async (input, init) => {
        calls++;
        try {
          return await replay.fetch(input, init);
        } catch (e) {
          if (failure === undefined && e instanceof UnrecordedRequestError) {
            failure = {
              package: p.name,
              kind: "fixture-missing",
              message: `Package "${p.name}": recorded response missing for ${e.method} ${e.url}`,
            };
          } else if (failure === undefined && e instanceof FixtureUnparseableError) {
            failure = {
              package: p.name,
              kind: "fixture-unparseable",
              message: `Package "${p.name}": recorded response cannot be parsed (${e.message})`,
            };
          }
          throw e;
        }
      };
      const run = await runAutopsy(
        { kind: "name", name: p.name, version: p.version },
        CONFIG,
        { fetch: watching, clock: CLOCK, cache: createMemoryCache() },
        ANALYSIS_DATE,
      );
      if (failure !== undefined) errors.push(failure);
      else {
        expect(run.errors).toEqual([]);
        expect(replay.unrecordedCalls()).toEqual([]);
        certificates.push(...run.certificates);
      }
    }
    return { certificates: certificates.sort(compareCertificates), errors, calls };
  }

  it("a missing recording fails only that package; the others still get certificates", async () => {
    const root = join(tmp, "missing");
    cpSync(FIXTURES, root, { recursive: true });
    // Delete the OSV recording of lodash.set.
    const osvFile = jsonFiles(dirOf(root, "lodash.set")).find((n) => n.startsWith("osv-"));
    if (osvFile === undefined) throw new Error("osv recording not found");
    rmSync(join(dirOf(root, "lodash.set"), osvFile));

    const r = await analyzeEach(root);
    expect(r.certificates.map((c) => c.package.name)).toEqual(["inflight", "ip"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("fixture-missing");
    expect(r.errors[0]?.package).toBe("lodash.set");
    expect(r.errors[0]?.message).toContain("lodash.set");
    expect(r.errors[0]?.message).toContain("https://api.osv.dev/v1/query");
  });

  it("an unparseable recording fails only that package; the others still get certificates", async () => {
    const root = join(tmp, "corrupt");
    cpSync(FIXTURES, root, { recursive: true });
    // Corrupt the OSV recording of ip.
    const osvFile = jsonFiles(dirOf(root, "ip")).find((n) => n.startsWith("osv-"));
    if (osvFile === undefined) throw new Error("osv recording not found");
    writeFileSync(join(dirOf(root, "ip"), osvFile), "{ this is not json", "utf8");

    const r = await analyzeEach(root);
    expect(r.certificates.map((c) => c.package.name)).toEqual(["inflight", "lodash.set"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("fixture-unparseable");
    expect(r.errors[0]?.package).toBe("ip");
    expect(r.errors[0]?.message).toContain('"ip"');
    expect(r.errors[0]?.message).toContain(osvFile);
  });
});
