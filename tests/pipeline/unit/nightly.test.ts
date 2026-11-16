// Requirements: 16.3, 16.9, 16.10, 16.11, 16.13, 16.14, 16.15, 16.17, 16.21, 16.22, 16.24
// Fakes only: in-memory files, a fake gh, a fake Coroner, a fake Replay CLI. No network, no real gh.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runProve, type ProveDeps } from "../../../scripts/ci/prove";
import { sha256Hex } from "../../../scripts/ci/lib/stepSupport";
import type { AutopsyRun, DeathCertificate } from "../../../src/engine/types";
import { REPO } from "../../../src/pipeline/common/constants";
import type { ToolVersions } from "../../../src/pipeline/undertaker/core/nightlyClassify";
import {
  runNightly,
  runningToolVersions,
  REPO_ROOT_MARKER,
  REPORT_SCHEMA_VERSION,
  type GhResult,
  type NightlyDeps,
} from "../../../src/pipeline/undertaker/shell/nightly";
import { sriSha512 } from "../../../src/pipeline/undertaker/shell/replay";
import type { CliDeps, CliResult } from "../../../src/proof/cli";
import { deserializeReport } from "../../../src/proof/serialize/deserialize";
import { DeathCertificateSchema } from "../../../src/engine/types";
import { LODASH_SET_CERT, OSV_UNAVAILABLE_CERT } from "../helpers/gravediggerCerts";

/** The committed not-resurrected entry graveyard/inflight (PR #6), read as bytes from the repository. */
const INFLIGHT_DIR = new URL("../../../graveyard/inflight/", import.meta.url);
const INFLIGHT_CERT_BYTES = new Uint8Array(readFileSync(new URL("certificate.json", INFLIGHT_DIR)));
const INFLIGHT_ELIGIBILITY_BYTES = new Uint8Array(readFileSync(new URL("eligibility.json", INFLIGHT_DIR)));
const INFLIGHT_CERT: DeathCertificate = DeathCertificateSchema.parse(JSON.parse(new TextDecoder().decode(INFLIGHT_CERT_BYTES)));

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

const ORIGINAL_BYTES = new Uint8Array([1, 2, 3]);
const TOOLS: ToolVersions = { node: "v26.13.1", fastCheck: "4.0.0", reportSchema: 1 };
const GH_OK = "gh version 2.67.0 (2025-02-13)\nhttps://github.com/cli/cli/releases/tag/v2.67.0\n";
const ELIGIBILITY = JSON.stringify({
  schemaVersion: 1,
  package: { name: "lodash.set", version: "4.3.2" },
  eligible: true,
  integrity: { expected: "sha512-AAAA", computed: "sha512-AAAA", matches: true },
  rules: [],
  failedRules: [],
  facts: [],
});
const DELTAS = JSON.stringify({
  schemaVersion: 1,
  package: "lodash.set",
  deltas: [{ kind: "prototype-unchanged", id: "proto-pollution", function: "default", advisory: "GHSA-p6mc-m468-83gw" }],
});
const HARNESS = JSON.stringify({ schemaVersion: 1, package: "lodash.set", functions: { default: { preset: "lodash-set" } } });

function baseProve(files: Map<string, Uint8Array>): ProveDeps {
  return {
    system: { randomSeed: () => 1, env: () => ({}), platform: "linux" },
    toolVersions: { node: "v0.0.0", fastCheck: "0.0.0" },
    readText: (f) => {
      const b = files.get(f);
      return b === undefined ? null : dec(b);
    },
    writeText: (f, t) => void files.set(f, enc(t)),
    setOutput: () => undefined,
    log: () => undefined,
    runCli: async () => ({ exitCode: 2, stdout: "", stderr: "" }),
  };
}

/** A schema-valid report text (the fallback of the prove script), then edited. */
async function reportText(over: { verdict: string; tools: ToolVersions }): Promise<string> {
  const files = new Map<string, Uint8Array>([["deltas.json", enc("{")]]);
  await runProve(baseProve(files));
  const r = JSON.parse(dec(files.get("proof-report.json")!)) as Record<string, any>;
  r["package"] = { name: "lodash.set", version: "4.3.2" };
  r["original"].integrity = sriSha512(ORIGINAL_BYTES);
  r["verdict"] = over.verdict;
  r["toolVersions"] = over.tools;
  const text = JSON.stringify(r);
  if (!deserializeReport(text).ok) throw new Error("test report is not valid");
  return text;
}

interface EntrySpec {
  verdict?: string;
  tools?: ToolVersions;
  stub?: boolean;
  bundles?: boolean;
}

interface Rig {
  deps: NightlyDeps;
  files: Map<string, Uint8Array>;
  logs: string[];
  errors: string[];
  summaries: string[];
  ghCalls: { argv: string[]; cwd: string | undefined }[];
  fetched: string[];
  coronerCalls: string[];
}

function rig(opts: {
  cwdIsRoot?: boolean;
  ghVersionOut?: string;
  verifyDigest?: (file: string, actual: string) => string;
  verifyOut?: (file: string) => GhResult | null;
  fresh?: (committed: DeathCertificate) => AutopsyRun;
}): Rig {
  const files = new Map<string, Uint8Array>();
  const logs: string[] = [];
  const errors: string[] = [];
  const summaries: string[] = [];
  const ghCalls: Rig["ghCalls"] = [];
  const fetched: string[] = [];
  const coronerCalls: string[] = [];
  const norm = (p: string): string => p.replaceAll("\\", "/");
  const prefix = (dir: string): string => `${norm(dir)}${norm(dir).endsWith("/") ? "" : "/"}`;

  const prove: ProveDeps = {
    ...baseProve(files),
    runCli: async (a: readonly string[], cli: CliDeps = {}): Promise<CliResult> => {
      await cli.loadHarness!("pipeline");
      const src = [...files.keys()].find((k) => norm(k).endsWith("/proof-report.json") && !norm(k).startsWith("work/"));
      files.set(a[a.indexOf("--out") + 1]!, files.get(src!)!);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };

  const deps: NightlyDeps = {
    root: "graveyard",
    reportFile: "nightly-report.json",
    fs: {
      listDirs: (dir) => {
        const seen = new Set<string>();
        for (const k of files.keys()) {
          const n = norm(k);
          if (n.startsWith(prefix(dir))) seen.add(n.slice(prefix(dir).length).split("/")[0]!);
        }
        return [...seen];
      },
      exists: (f) => (opts.cwdIsRoot ?? true) && norm(f) === REPO_ROOT_MARKER,
      listFiles: (dir) =>
        [...files.keys()]
          .map(norm)
          .filter((n) => n.startsWith(prefix(dir)) && !n.slice(prefix(dir).length).includes("/"))
          .map((n) => n.slice(prefix(dir).length)),
      readBytes: (f) => files.get(f) ?? files.get(norm(f)) ?? null,
      writeText: (f, t) => void files.set(f, enc(t)),
    },
    runGh: async (argv, o) => {
      ghCalls.push({ argv: [...argv], cwd: o.cwd });
      if (argv[0] === "--version") return { code: 0, stdout: opts.ghVersionOut ?? GH_OK, stderr: "" };
      const file = argv[2]!;
      const override = opts.verifyOut?.(file);
      if (override) return override;
      const actual = sha256Hex(files.get(join(o.cwd!, file))!);
      const digest = opts.verifyDigest ? opts.verifyDigest(file, actual) : actual;
      return {
        code: 0,
        stdout: JSON.stringify([{ verificationResult: { statement: { subject: [{ name: file, digest: { sha256: digest } }] } } }]),
        stderr: "",
      };
    },
    sha256: sha256Hex,
    io: {
      log: (l) => void logs.push(l),
      error: (l) => void errors.push(l),
      summary: (m) => void summaries.push(m),
    },
    runningTools: TOOLS,
    coroner: async (name, version) => {
      coronerCalls.push(`${name}@${version}`);
      const committed = { ...LODASH_SET_CERT, package: { name, version } };
      return opts.fresh ? opts.fresh(committed) : { certificates: [committed], errors: [], notes: [] };
    },
    replay: {
      prove,
      runProve,
      readBytes: (f) => files.get(f) ?? null,
      writeBytes: (f, b) => void files.set(f, b),
      fetchOriginal: async (name, version) => {
        fetched.push(`${name}@${version}`);
        return ORIGINAL_BYTES;
      },
    },
    makeWorkDir: () => "work",
    removeDir: () => undefined,
    identity: { pathValues: [], userName: undefined },
    platform: "posix",
  };
  return { deps, files, logs, errors, summaries, ghCalls, fetched, coronerCalls };
}

async function addEntry(r: Rig, dir: string, spec: EntrySpec = {}): Promise<void> {
  const at = (f: string): string => join("graveyard", dir, f);
  const put = (f: string, t: string | Uint8Array): void => void r.files.set(at(f), typeof t === "string" ? enc(t) : t);
  put("certificate.json", JSON.stringify({ ...LODASH_SET_CERT, package: { name: dir, version: "4.3.2" } }));
  put("eligibility.json", ELIGIBILITY);
  put("deltas.json", DELTAS);
  put("harness.json", HARNESS);
  put("lodash.set-4.3.2.tgz", new Uint8Array([9, 9]));
  put("proof-report.json", await reportText({ verdict: spec.verdict ?? "alive", tools: spec.tools ?? TOOLS }));
  if (spec.stub) put("stub-run.json", JSON.stringify({ schemaVersion: 1, mode: "stub", label: "stub run" }));
  if (spec.bundles ?? (spec.verdict ?? "alive") === "alive") {
    for (const s of ["lodash.set-4.3.2.tgz", "proof-report.json", "certificate.json"]) put(`${s}.sigstore.json`, "{}");
  }
}

function addInflight(r: Rig): void {
  r.files.set(join("graveyard", "inflight", "certificate.json"), INFLIGHT_CERT_BYTES);
  r.files.set(join("graveyard", "inflight", "eligibility.json"), INFLIGHT_ELIGIBILITY_BYTES);
}

const primary = (r: Rig, dirIndex = 0): string[] => JSON.parse(dec(r.files.get("nightly-report.json")!)).entries[dirIndex].results;

describe("runNightly", () => {
  it("verifies an alive entry: replay identical, three gh verifications from the entry directory, exit 0", async () => {
    const r = rig({});
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(primary(r)).toEqual(["verified"]);
    expect(r.fetched).toEqual(["lodash.set@4.3.2"]);
    const verifies = r.ghCalls.filter((c) => c.argv[0] === "attestation");
    expect(verifies.map((c) => c.argv[2])).toEqual(["lodash.set-4.3.2.tgz", "proof-report.json", "certificate.json"]);
    for (const c of verifies) {
      expect(c.cwd).toBe(join("graveyard", "lodash.set"));
      expect(c.argv).toContain("--format");
      expect(c.argv).toContain(REPO);
      expect(c.argv).not.toContain("--bundle");
    }
    expect(r.logs[0]).toContain("gh version 2.67.0");
    expect(r.summaries[0]).toContain("lodash.set: verified");
  });

  it("lists entries in code point order", async () => {
    const r = rig({});
    await addEntry(r, "b", { verdict: "restless" });
    await addEntry(r, "Z", { verdict: "restless" });
    await addEntry(r, "a", { verdict: "restless" });
    await runNightly(r.deps);
    expect(r.coronerCalls).toEqual(["Z@4.3.2", "a@4.3.2", "b@4.3.2"]);
    const lines = r.logs.filter((l) => l.startsWith("- "));
    expect(lines.map((l) => l.slice(2, 3))).toEqual(["Z", "a", "b"]);
  });

  it("fails with attestation-failed when a signed digest differs from the committed file", async () => {
    const r = rig({ verifyDigest: (file, actual) => (file === "proof-report.json" ? "0".repeat(64) : actual) });
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(1);
    expect(primary(r)).toContain("attestation-failed");
    const entry = JSON.parse(dec(r.files.get("nightly-report.json")!)).entries[0];
    expect(entry.reason).toContain("proof-report.json");
  });

  it("fails closed when the gh JSON lacks the expected fields", async () => {
    const r = rig({ verifyOut: () => ({ code: 0, stdout: JSON.stringify([{ unexpected: true }]), stderr: "" }) });
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(1);
    expect(primary(r)).toContain("attestation-failed");
  });

  it("does not replay when the Tool_Versions differ and reports tool-versions-changed without failing", async () => {
    const r = rig({});
    await addEntry(r, "lodash.set", { tools: { ...TOOLS, fastCheck: "3.0.0" } });
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(r.fetched).toEqual([]);
    expect(primary(r)).toEqual(["tool-versions-changed"]);
  });

  it("fails the run below the minimum gh version and reports no entry", async () => {
    const r = rig({ ghVersionOut: "gh version 2.66.9 (2025-01-01)\n" });
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("2.67.0");
    expect(r.ghCalls).toHaveLength(1);
    expect(out.report.entries).toEqual([]);
  });

  it("fails the run for a malformed entry, names its path and still reports the others", async () => {
    const r = rig({});
    await addEntry(r, "good", { verdict: "restless" });
    r.files.set(join("graveyard", "broken", "certificate.json"), enc(JSON.stringify(LODASH_SET_CERT)));
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(1);
    expect(out.malformed.join("\n")).toContain(join("graveyard", "broken"));
    expect(r.errors.join("\n")).toContain(join("graveyard", "broken"));
    expect(out.report.entries).toHaveLength(1);
  });

  it("treats a missing graveyard/ in the repository root as zero entries: exit 0, one ::notice::, no malformed entry", async () => {
    const r = rig({});
    r.deps = { ...r.deps, fs: { ...r.deps.fs, listDirs: () => null } };
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(out.malformed).toEqual([]);
    expect(out.report.counts).toEqual({ total: 0, checkable: 0, notChecked: 0 });
    expect(r.logs.filter((l) => l.startsWith("::notice::"))).toEqual(["::notice::No entries in the graveyard: nothing to verify."]);
    expect(r.errors).toEqual([]);
    expect(r.summaries[0]).toContain("No entries in the graveyard: nothing to verify.");
    expect(r.summaries[0]).not.toContain("nothing was verified tonight");
  });

  it("treats an existing but empty graveyard/ the same way", async () => {
    const r = rig({});
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(out.report.counts).toEqual({ total: 0, checkable: 0, notChecked: 0 });
    expect(r.logs.filter((l) => l.startsWith("::notice::"))).toHaveLength(1);
    expect(r.logs).toContain("Entries: 0 total, 0 not-checked.");
    expect(r.logs.some((l) => l.includes("nothing was verified tonight"))).toBe(false);
    expect(r.summaries[0]).toContain("No entries in the graveyard: nothing to verify.");
  });

  it("fails with a clear message when graveyard/ is missing and the cwd is not the repository root", async () => {
    const r = rig({ cwdIsRoot: false });
    r.deps = { ...r.deps, fs: { ...r.deps.fs, listDirs: () => null } };
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("not the repository root");
    expect(r.logs.some((l) => l.startsWith("::notice::"))).toBe(false);
    expect(r.summaries[0]).toContain("The run failed");
  });

  it("still fails for one malformed entry and prints no notice", async () => {
    const r = rig({});
    r.files.set(join("graveyard", "broken", "certificate.json"), enc(JSON.stringify(LODASH_SET_CERT)));
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(1);
    expect(out.malformed.join("\n")).toContain(join("graveyard", "broken"));
    expect(r.logs.some((l) => l.startsWith("::notice::"))).toBe(false);
  });

  it("reports a new advisory id with its Source_URL and Fetch_Date", async () => {
    const r = rig({
      fresh: (committed) => ({
        certificates: [
          {
            ...committed,
            openVulnerabilityIds: [...committed.openVulnerabilityIds, "GHSA-new-0001-aaaa"],
            facts: [
              ...committed.facts.filter((f) => f.key !== "openVulnerabilities"),
              {
                key: "openVulnerabilities",
                value: [],
                provenance: [{ sourceUrl: "https://api.osv.dev/v1/query", fetchedAt: "2026-11-20T03:17:00Z" }],
              },
            ],
          },
        ],
        errors: [],
        notes: [],
      }),
    });
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(primary(r)).toEqual(["new-advisory"]);
    expect(out.report.entries[0]!.facts).toEqual([
      {
        text: "new advisory GHSA-new-0001-aaaa for lodash.set@4.3.2",
        sourceUrl: "https://api.osv.dev/v1/query",
        fetchedAt: "2026-11-20T03:17:00Z",
      },
    ]);
  });

  it("reports not-checked, not verified, when the Coroner fails", async () => {
    const r = rig({ fresh: () => ({ certificates: [], errors: [], notes: [] }) });
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(primary(r)).toEqual(["not-checked"]);
  });

  it("emits one escaped, redacted ::warning:: per not-checked entry and none for a verified entry, exit 0", async () => {
    const r = rig({
      fresh: (committed) => {
        if (committed.package.name === "bad") throw new Error("OSV said 50%\nfor Alice Smith");
        return { certificates: [committed], errors: [], notes: [] };
      },
    });
    r.deps = { ...r.deps, identity: { pathValues: [], userName: "Alice Smith" } };
    await addEntry(r, "lodash.set");
    await addEntry(r, "bad", { verdict: "restless", tools: { ...TOOLS, fastCheck: "3.0.0" } });
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    const warnings = r.logs.filter((l) => l.startsWith("::warning::"));
    expect(warnings).toHaveLength(1);
    const w = warnings[0]!;
    expect(w).toContain("bad not-checked (graveyard/bad): the Coroner failed: OSV said 50%25%0Afor ");
    expect(w).not.toContain("Alice Smith");
    expect(w).not.toContain("\n");
    expect(w).not.toContain("lodash.set");
    expect(primary(r, 1)).toEqual(["verified"]);
    expect(primary(r, 0)).toEqual(["tool-versions-changed", "not-checked"]);
    expect(out.report.counts).toEqual({ total: 2, checkable: 2, notChecked: 1 });
    expect(r.summaries[0]).toContain("Entries: 2 total, 1 not-checked.");
    expect(r.logs).toContain("Entries: 2 total, 1 not-checked.");
    expect(r.summaries[0]).not.toContain("nothing was verified tonight");
  });

  it("says in the summary that nothing was verified when every entry is not-checked", async () => {
    const r = rig({ fresh: () => ({ certificates: [], errors: [], notes: [] }) });
    await addEntry(r, "lodash.set");
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(r.summaries[0]).toContain("All 1 entries not-checked: nothing was verified tonight.");
  });

  it("re-runs the Coroner for a not-resurrected entry and cites the source of 'no new advisories'", async () => {
    const r = rig({ fresh: () => ({ certificates: [INFLIGHT_CERT], errors: [], notes: [] }) });
    addInflight(r);
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(r.coronerCalls).toEqual(["inflight@1.0.6"]);
    expect(r.fetched).toEqual([]);
    expect(r.ghCalls.filter((c) => c.argv[0] === "attestation")).toEqual([]);
    const e = out.report.entries[0]!;
    expect(e.results).toEqual(["not-resurrected"]);
    expect(e.reason).toBe("Not-resurrected entry; nothing to replay or attest.");
    expect(e.committedTools).toBeNull();
    expect(e.differingToolFields).toEqual([]);
    const osv = INFLIGHT_CERT.facts.find((f) => f.key === "openVulnerabilities")!.provenance[0]!;
    expect(e.facts).toEqual([
      { text: "advisory re-check: no new advisories for inflight@1.0.6", sourceUrl: osv.sourceUrl, fetchedAt: osv.fetchedAt },
    ]);
    expect(r.logs).toContain("Entries: 1 total, 0 not-checked.");
    expect(r.logs.some((l) => l.startsWith("- inflight: not-resurrected") && l.includes(`(source: ${osv.sourceUrl}, fetched ${osv.fetchedAt})`))).toBe(true);
    expect(r.logs.some((l) => l.startsWith("::warning::"))).toBe(false);
  });

  it("reports not-checked with a ::warning:: when the re-run Coroner could not read OSV, and logs the count lines", async () => {
    const r = rig({
      fresh: () => ({ certificates: [{ ...OSV_UNAVAILABLE_CERT, package: INFLIGHT_CERT.package }], errors: [], notes: [] }),
    });
    addInflight(r);
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(primary(r)).toEqual(["not-checked"]);
    expect(out.report.entries[0]!.facts).toEqual([]);
    expect(out.report.entries[0]!.reason).toContain("could not read OSV (https://api.osv.dev/v1/query)");
    const warnings = r.logs.filter((l) => l.startsWith("::warning::"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("inflight not-checked (graveyard/inflight): the advisory re-check could not read OSV");
    expect(r.logs).toContain("Entries: 1 total, 1 not-checked.");
    expect(r.logs).toContain("All 1 entries not-checked: nothing was verified tonight.");
  });

  it("labels a stub entry 'stub run' and verifies it like the others", async () => {
    const r = rig({});
    await addEntry(r, "lodash.set", { stub: true });
    const out = await runNightly(r.deps);
    expect(out.exitCode).toBe(0);
    expect(out.report.entries[0]!.stub).toBe(true);
    expect(r.summaries[0]).toContain("stub run");
    expect(primary(r)).toEqual(["verified"]);
  });
});

describe("runningToolVersions", () => {
  it("takes the report schema version from the ProofReport schema", () => {
    expect(runningToolVersions("v26.13.1", "4.0.0")).toEqual({ node: "v26.13.1", fastCheck: "4.0.0", reportSchema: REPORT_SCHEMA_VERSION });
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});
