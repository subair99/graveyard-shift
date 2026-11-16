// Requirements: 2.6, 11.14, 11.16, 11.17, 13.2, 13.3, 13.4, 13.5, 13.9, 14.1, 14.14, 15.11
import { describe, expect, it } from "vitest";
import { fallbackReport } from "../../../src/proof/core/report";
import type { ReportInput } from "../../../src/proof/core/report";
import { canonicalReportJson } from "../../../src/proof/serialize/canonicalReport";
import { computeSri } from "../../../src/proof/shell/integrity";
import { computeTreeHash } from "../../../src/proof/shell/treeHash";
import { ProofReportSchema } from "../../../src/proof/types";
import { parsePredicate } from "../../../src/pipeline/undertaker/core/predicate";
import { PREDICATE_TYPE } from "../../../src/pipeline/common/constants";
import { collectStep, prepareStep } from "../../../scripts/ci/lib/attestSteps";
import type { AttestDeps } from "../../../scripts/ci/lib/attestSteps";
import { runChecksSummary } from "../../../scripts/ci/lib/checksSteps";
import { buildEntryStep, failedRulesOf, gateStep } from "../../../scripts/ci/lib/publishSteps";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { BuildRecordInput } from "../../../src/pipeline/gravedigger/core/record";
import { renderPrBody } from "../../../src/pipeline/undertaker/core/prText";
import { INFLIGHT_CERT, OSV_UNAVAILABLE_CERT } from "../helpers/gravediggerCerts";
import type { PublishStepDeps } from "../../../scripts/ci/lib/publishSteps";
import { sha256Hex } from "../../../scripts/ci/lib/stepSupport";
import type { FileOps, StepIo } from "../../../scripts/ci/lib/stepSupport";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function memoryFiles(initial: Record<string, Uint8Array> = {}): FileOps & { store: Map<string, Uint8Array> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    readFile: async (f) => {
      const v = store.get(f);
      if (v === undefined) throw new Error(`no file ${f}`);
      return v;
    },
    writeFile: async (f, b) => void store.set(f, b),
    makeDir: async () => undefined,
  };
}

function capture(): StepIo & { outputs: Record<string, string>; summaries: string[]; errors: string[] } {
  const outputs: Record<string, string> = {};
  const summaries: string[] = [];
  const errors: string[] = [];
  return {
    outputs,
    summaries,
    errors,
    log: () => undefined,
    error: (l) => void errors.push(l),
    setOutput: (n, v) => void (outputs[n] = v),
    summary: (m) => void summaries.push(m),
  };
}

const OK3 = { GS_CHECK_TYPECHECK: "success", GS_CHECK_LINT: "success", GS_CHECK_TEST: "success", GS_RUN_URL: "https://github.com/x/y/actions/runs/1" };

describe("checks summary", () => {
  it("writes checks-results.json and exits 0 when all three succeed", async () => {
    const files = memoryFiles();
    const io = capture();
    expect(await runChecksSummary({ env: OK3, io, files })).toBe(0);
    const written = JSON.parse(dec(files.store.get("checks-results.json")!)) as { runUrl: string; checks: { outcome: string }[] };
    expect(written.runUrl).toBe(OK3.GS_RUN_URL);
    expect(written.checks.map((c) => c.outcome)).toEqual(["success", "success", "success"]);
    expect(io.summaries.join("\n")).toContain(OK3.GS_RUN_URL);
  });

  it("exits 1 when an outcome is not success or missing", async () => {
    expect(await runChecksSummary({ env: { ...OK3, GS_CHECK_LINT: "failure" }, io: capture(), files: memoryFiles() })).toBe(1);
    const { GS_CHECK_TEST: _unused, ...rest } = OK3;
    expect(await runChecksSummary({ env: rest, io: capture(), files: memoryFiles() })).toBe(1);
  });
});

// ---- attest ----

const ORIGINAL = enc("original tarball bytes");
const PKG_FILES = [
  { path: "package.json", bytes: enc('{"name":"@graveyard-shift/ip","version":"2.0.2"}') },
  { path: "index.js", bytes: enc("module.exports = 1;\n") },
];
const TREE = computeTreeHash(PKG_FILES);
const SHA = "a".repeat(40);

function reportText(over: { verdict?: "alive" | "restless"; treeHash?: string; integrity?: string } = {}): string {
  const none = { created: "/no-root" };
  const input: ReportInput = {
    package: { name: "ip", version: "2.0.1" },
    original: { integrity: over.integrity ?? computeSri(ORIGINAL), verified: true },
    resurrection: { source: "tarball", treeHash: over.treeHash ?? TREE },
    sandbox: {
      mechanism: "node-permission",
      restartEvents: { original: 0, resurrection: 0 },
      otherRestarts: { original: 0, resurrection: 0 },
      limits: { callTimeoutMs: 1000, heapLimitMb: 64, outputLimitBytes: 1000, maxRestarts: 1, casesRequested: 100, shrinkBudget: 10 },
    },
    functionsTested: [],
    casesPerFunction: [],
    unencodableValues: [],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    seed: 7,
    toolVersions: { node: "v26.13.1", fastCheck: "4.0.0" },
    roots: { original: none, resurrection: none },
    otherTempRoots: [],
    identity: { pathValues: [], userName: undefined },
    platform: "posix",
    serialize: canonicalReportJson,
  };
  const base = fallbackReport(input, { kind: "harness-config-error", message: "x" });
  return canonicalReportJson({ ...base, verdict: over.verdict ?? "alive", harnessErrors: [] });
}

function attestFixture(over: Parameters<typeof reportText>[0] = {}, env: Record<string, string> = {}) {
  const files = memoryFiles({
    "proof-report.json": enc(reportText(over)),
    "resurrection.tgz": enc("packed"),
    "original.tgz": ORIGINAL,
    "certificate.json": enc("{}"),
  });
  const io = capture();
  const deps: AttestDeps = {
    env: {
      GS_JOB_CHECKS: "success",
      GS_JOB_PROVE: "success",
      GS_MEDIUM_MODE: "local",
      GS_BRANCH_COMMIT: SHA,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      ...env,
    },
    io,
    files,
    sha256: sha256Hex,
    extract: async () => ({ ok: true, value: PKG_FILES }),
  };
  return { deps, files, io };
}

describe("attest prepare", () => {
  it("the fixture report parses with ProofReportSchema", () => {
    expect(ProofReportSchema.safeParse(JSON.parse(reportText())).success).toBe(true);
  });

  it("alive and equal hashes: writes the predicate and prints type and subjects", async () => {
    const { deps, files, io } = attestFixture();
    expect(await prepareStep(deps)).toBe(0);
    expect(io.outputs["decision"]).toBe("attest");
    expect(io.outputs["predicate_type"]).toBe(PREDICATE_TYPE);
    expect([io.outputs["subject_tarball"], io.outputs["subject_report"], io.outputs["subject_certificate"]]).toEqual([
      "resurrection.tgz",
      "proof-report.json",
      "certificate.json",
    ]);
    const parsed = parsePredicate(dec(files.store.get("attest/predicate.json")!));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.digests.tarball).toBe(sha256Hex(enc("packed")));
      expect(parsed.value.resurrection.treeHash).toBe(TREE);
    }
  });

  it("a Tree_Hash mismatch ends without signing", async () => {
    const { deps, files, io } = attestFixture({ treeHash: computeTreeHash([{ path: "x", bytes: enc("y") }]) });
    expect(await prepareStep(deps)).toBe(1);
    expect(io.outputs["decision"]).toBe("skip");
    expect(files.store.has("attest/predicate.json")).toBe(false);
  });

  it("an Integrity_Hash mismatch ends without signing", async () => {
    const { deps, files, io } = attestFixture({ integrity: computeSri(enc("other")) });
    expect(await prepareStep(deps)).toBe(1);
    expect(io.outputs["decision"]).toBe("skip");
    expect(files.store.has("attest/predicate.json")).toBe(false);
  });

  it("a non-alive report ends without signing", async () => {
    const { deps, files, io } = attestFixture({ verdict: "restless" });
    expect(await prepareStep(deps)).toBe(0);
    expect(io.outputs["decision"]).toBe("skip");
    expect(files.store.has("attest/predicate.json")).toBe(false);
  });

  it("a failed checks job ends without signing", async () => {
    const { deps, files, io } = attestFixture({}, { GS_JOB_CHECKS: "failure" });
    expect(await prepareStep(deps)).toBe(1);
    expect(io.outputs["decision"]).toBe("skip");
    expect(files.store.has("attest/predicate.json")).toBe(false);
  });

  it("an unreadable report ends without signing", async () => {
    const { deps, files, io } = attestFixture();
    files.store.set("proof-report.json", enc("{not json"));
    expect(await prepareStep(deps)).toBe(1);
    expect(io.outputs["decision"]).toBe("skip");
  });
});

describe("attest collect", () => {
  it("copies the three bundles to attest-bundles/<subject>.sigstore.json", async () => {
    const files = memoryFiles({ "b/1": enc("one"), "b/2": enc("two"), "b/3": enc("three") });
    const env = { GS_BUNDLE_TARBALL: "b/1", GS_BUNDLE_REPORT: "b/2", GS_BUNDLE_CERTIFICATE: "b/3" };
    const deps = { env, io: capture(), files, sha256: sha256Hex, extract: async () => ({ ok: false as const, error: "unused" }) };
    expect(await collectStep(deps)).toBe(0);
    expect(dec(files.store.get("attest-bundles/resurrection.tgz.sigstore.json")!)).toBe("one");
    expect(dec(files.store.get("attest-bundles/proof-report.json.sigstore.json")!)).toBe("two");
    expect(dec(files.store.get("attest-bundles/certificate.json.sigstore.json")!)).toBe("three");
  });

  it("exits 1 when a bundle path is missing", async () => {
    const deps = { env: { GS_BUNDLE_TARBALL: "b/1" }, io: capture(), files: memoryFiles(), sha256: sha256Hex, extract: async () => ({ ok: false as const, error: "unused" }) };
    expect(await collectStep(deps)).toBe(1);
  });
});

// ---- publish ----

function publishDeps(env: Record<string, string>, files: ReturnType<typeof memoryFiles>): PublishStepDeps & { io: ReturnType<typeof capture> } {
  const io = capture();
  const fs = {
    readFile: files.readFile,
    writeFile: files.writeFile,
    makeDir: files.makeDir,
    removeDir: async (dir: string) => {
      for (const k of [...files.store.keys()]) if (k.startsWith(`${dir}/`)) files.store.delete(k);
    },
    listFiles: async (dir: string) =>
      [...files.store.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes("/")).map((k) => k.slice(dir.length + 1)),
  };
  return {
    env,
    io,
    extract: async () => ({ ok: true, value: PKG_FILES }),
    publish: { fs, sha256: sha256Hex, runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }) }, summary: async () => undefined },
  };
}

describe("publish gate", () => {
  const base = { GS_JOB_INTAKE: "success", GS_JOB_CHECKS: "success", GS_JOB_PROVE: "success", GS_JOB_ATTEST: "success", GS_KIND: "resurrection", GS_VERDICT: "alive" };
  const run = async (env: Record<string, string>): Promise<string | undefined> => {
    const d = publishDeps(env, memoryFiles());
    expect(await gateStep(d)).toBe(0);
    return d.io.outputs["publish"];
  };

  it("publishes an attested alive resurrection", async () => {
    expect(await run(base)).toBe("true");
  });

  it("skips an alive verdict whose attest job did not succeed, and a failed checks job", async () => {
    expect(await run({ ...base, GS_JOB_ATTEST: "failure" })).toBe("false");
    expect(await run({ ...base, GS_JOB_CHECKS: "failure" })).toBe("false");
  });

  it("skips a resurrection whose verdict is empty, missing or invalid", async () => {
    expect(await run({ ...base, GS_VERDICT: "" })).toBe("false");
    expect(await run({ ...base, GS_VERDICT: "bogus" })).toBe("false");
    const { GS_VERDICT: _omitted, ...noVerdict } = base;
    expect(await run(noVerdict)).toBe("false");
  });

  it("publishes a not-resurrected entry without prove or attest", async () => {
    expect(await run({ ...base, GS_KIND: "not-resurrected", GS_VERDICT: "", GS_JOB_PROVE: "skipped", GS_JOB_ATTEST: "skipped" })).toBe("true");
  });
});

describe("publish build-entry", () => {
  it("writes a not-resurrected entry from certificate.json and eligibility.json", async () => {
    const files = memoryFiles({
      "work/certificate.json": enc("{}"),
      "work/eligibility.json": enc('{"eligible":false}'),
    });
    const d = publishDeps({ GS_PACKAGE: "ip", GS_KIND: "not-resurrected", GS_MEDIUM_MODE: "local" }, files);
    expect(await buildEntryStep(d)).toBe(0);
    expect([...files.store.keys()].filter((k) => k.startsWith("graveyard/ip/")).sort()).toEqual([
      "graveyard/ip/certificate.json",
      "graveyard/ip/eligibility.json",
    ]);
  });

  it("fails for an alive entry whose bundles are missing", async () => {
    const files = memoryFiles({
      "work/certificate.json": enc("{}"),
      "work/eligibility.json": enc('{"eligible":true}'),
      "work/deltas.json": enc("{}"),
      "work/harness.json": enc("{}"),
      "work/resurrection.tgz": enc("packed"),
      "work/proof-report.json": enc(reportText()),
    });
    const d = publishDeps({ GS_PACKAGE: "ip", GS_KIND: "resurrection", GS_VERDICT: "alive", GS_MEDIUM_MODE: "local" }, files);
    expect(await buildEntryStep(d)).toBe(1);
    expect([...files.store.keys()].some((k) => k.startsWith("graveyard/"))).toBe(false);
  });
});

// ---- failed rules of a not-resurrected entry (Finding 2) ----

describe("failedRulesOf", () => {
  const AT = "2026-11-16T10:00:00Z";
  const recordInput = (over: Partial<BuildRecordInput>): BuildRecordInput => ({
    name: "ip",
    version: "2.0.1",
    cert: OSV_UNAVAILABLE_CERT,
    expectedIntegrity: "sha512-AAAA",
    computedIntegrity: "sha512-AAAA",
    pkg: { license: "MIT" },
    lineCount: 10,
    packumentUrl: "https://registry.npmjs.org/ip",
    tarballUrl: "https://registry.npmjs.org/ip/-/ip-2.0.1.tgz",
    fetchedAt: AT,
    ...over,
  });
  const prBody = (rules: ReturnType<typeof failedRulesOf>) =>
    renderPrBody({
      kind: "not-resurrected",
      package: "ip",
      version: "2.0.1",
      failedRules: rules,
      runUrl: "https://github.com/x/y/actions/runs/1",
      stub: false,
      identity: { pathValues: [], userName: undefined },
      platform: "posix",
    });

  it("gives every provenance entry of the rule fact, from the certificate for status", () => {
    const record = buildEligibilityRecord(
      recordInput({ name: "inflight", version: "1.0.6", cert: INFLIGHT_CERT, pkg: { license: "ISC", dependencies: { once: "1" } } }),
    );
    const rules = failedRulesOf(record);
    expect(rules.map((r) => r.rule)).toEqual(["dependencies", "status", "open-vulnerability"]);
    const status = rules.find((r) => r.rule === "status")!;
    expect(status.sources).toEqual(record.facts.find((f) => f.key === "rule.status")!.provenance);
    expect(status.sources).toHaveLength(7);
    expect(status.sources.some((s) => s.fetchedAt === AT)).toBe(false);
    expect(rules.find((r) => r.rule === "dependencies")!.sources).toEqual([
      { sourceUrl: "https://registry.npmjs.org/ip/-/ip-2.0.1.tgz", fetchedAt: AT },
    ]);
  });

  it("OSV unavailable: the rule is shown unverified with no source recorded, never the packument", () => {
    const rules = failedRulesOf(buildEligibilityRecord(recordInput({})));
    expect(rules).toEqual([
      { rule: "open-vulnerability", observed: null, missingField: "openVulnerabilities", sources: [] },
    ]);
    const body = prBody(rules);
    expect(body).toContain(
      "- open-vulnerability: unverified, field openVulnerabilities could not be read (source: none recorded)",
    );
    expect(body).not.toContain("open-vulnerability: observed 0");
  });

  it("integrity mismatch: tarball rules have no source recorded instead of a stand-in", () => {
    const rules = failedRulesOf(buildEligibilityRecord(recordInput({ computedIntegrity: "sha512-BBBB" })));
    const license = rules.find((r) => r.rule === "license")!;
    expect(license).toEqual({ rule: "license", observed: null, missingField: "package.json", sources: [] });
    expect(prBody(rules)).toContain("- license: unverified, field package.json could not be read (source: none recorded)");
  });

  it("passes the fact's stale flag and provenanceTotal on, and the PR text shows both", () => {
    const lookups = Array.from({ length: 25 }, (_, n) => ({
      key: `successorLookup:c${String(n).padStart(2, "0")}`,
      value: { result: "not-found" },
      provenance: [{ sourceUrl: `https://registry.npmjs.org/c${String(n).padStart(2, "0")}`, fetchedAt: "2026-11-15T19:03:19Z" }],
      stale: true,
    }));
    const cert = { ...INFLIGHT_CERT, facts: [...INFLIGHT_CERT.facts, ...lookups] };
    const record = buildEligibilityRecord(recordInput({ name: "inflight", version: "1.0.6", cert }));
    const fact = record.facts.find((f) => f.key === "rule.status")!;
    const status = failedRulesOf(record).find((r) => r.rule === "status")!;
    expect(status.stale).toBe(true);
    expect(status.sources).toHaveLength(20);
    expect(status.sourcesTotal).toBe(fact.provenanceTotal);
    expect(status.sourcesTotal).toBeGreaterThan(20);
    const body = prBody([status]);
    expect(body).toContain(`- status: observed retired-with-successor (first 20 of ${fact.provenanceTotal} sources: source: `);
    expect(body.match(/\(stale\)/g)).toHaveLength(20);
  });
});
