// Requirements: 11.14, 11.16, 11.17, 13.2, 13.3, 13.4, 13.5, 13.9, 14.1
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
import { buildEntryStep, gateStep } from "../../../scripts/ci/lib/publishSteps";
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
