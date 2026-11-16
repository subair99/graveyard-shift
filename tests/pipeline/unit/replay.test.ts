// Requirements: 16.6, 16.7, 16.8, 16.17
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runProve, type ProveDeps } from "../../../scripts/ci/prove";
import {
  compareReportTexts,
  firstDifferingPath,
  replayArgv,
  runReplay,
  sriSha512,
  type ReplayDeps,
} from "../../../src/pipeline/undertaker/shell/replay";
import type { CliDeps, CliResult } from "../../../src/proof/cli";
import { deserializeReport } from "../../../src/proof/serialize/deserialize";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const COMMITTED_SEED = 424242;
const CASES = 7;
const ORIGINAL_BYTES = new Uint8Array([1, 2, 3]);
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
const HARNESS = JSON.stringify({
  schemaVersion: 1,
  package: "lodash.set",
  functions: { default: { preset: "lodash-set" } },
});

function baseDeps(files: Map<string, string>): ProveDeps {
  return {
    system: { randomSeed: () => 1, env: () => ({}), platform: "linux" },
    toolVersions: { node: "v0.0.0", fastCheck: "0.0.0" },
    readText: (f) => files.get(f) ?? null,
    writeText: (f, t) => void files.set(f, t),
    setOutput: () => undefined,
    log: () => undefined,
    runCli: async () => ({ exitCode: 2, stdout: "", stderr: "" }),
  };
}

/** A schema-valid report text, written by the prove script's own fallback. */
async function fallbackText(): Promise<string> {
  const files = new Map<string, string>([["deltas.json", "{"]]);
  await runProve(baseDeps(files));
  return files.get("proof-report.json")!;
}

async function committedReport(): Promise<string> {
  const r = JSON.parse(await fallbackText()) as Record<string, any>;
  r["seed"] = COMMITTED_SEED;
  r["functionsTested"] = ["default", "other"];
  r["sandbox"].limits.casesRequested = CASES;
  r["original"].integrity = sriSha512(ORIGINAL_BYTES);
  r["package"] = { name: "lodash.set", version: "4.3.2" };
  const text = JSON.stringify(r);
  if (!deserializeReport(text).ok) throw new Error("test report is not valid");
  return text;
}

interface Rig {
  deps: ReplayDeps;
  work: Map<string, string>;
  bytes: Map<string, Uint8Array>;
  argv: string[][];
  seeds: number[];
}

function rig(opts: {
  committed: string;
  /** Text the fake CLI writes as the replayed report. */
  replayed: string;
  fetch?: () => Promise<Uint8Array>;
}): Rig {
  const files = new Map<string, string>([
    [join("entry", "proof-report.json"), opts.committed],
    [join("entry", "eligibility.json"), ELIGIBILITY],
    [join("entry", "certificate.json"), JSON.stringify(LODASH_SET_CERT)],
    [join("entry", "deltas.json"), DELTAS],
    [join("entry", "harness.json"), HARNESS],
  ]);
  const bytes = new Map<string, Uint8Array>([[join("entry", "lodash.set-4.3.2.tgz"), new Uint8Array([9, 9])]]);
  const argv: string[][] = [];
  const seeds: number[] = [];
  const prove: ProveDeps = {
    ...baseDeps(files),
    runCli: async (a: readonly string[], cli: CliDeps = {}): Promise<CliResult> => {
      argv.push([...a]);
      await cli.loadHarness!("pipeline");
      const out = a[a.indexOf("--out") + 1]!;
      files.set(out, opts.replayed);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  const deps: ReplayDeps = {
    prove,
    runProve: (d, dir) => {
      seeds.push(d.system.randomSeed());
      return runProve(d, dir);
    },
    readBytes: (f) => bytes.get(f) ?? null,
    writeBytes: (f, b) => void bytes.set(f, b),
    fetchOriginal: opts.fetch ?? (async () => ORIGINAL_BYTES),
  };
  return { deps, work: files, bytes, argv, seeds };
}

const INPUT = { entryDir: "entry", tarballName: "lodash.set-4.3.2.tgz", workDir: "work" };

describe("runReplay", () => {
  it("is identical when the second run writes the committed bytes, with the committed seed, cases and radius", async () => {
    const committed = await committedReport();
    const r = rig({ committed, replayed: committed });
    expect(await runReplay(INPUT, r.deps)).toEqual({ status: "identical" });
    expect(r.seeds).toEqual([COMMITTED_SEED]);
    const a = r.argv[0]!;
    expect(a[a.indexOf("--seed") + 1]).toBe(String(COMMITTED_SEED));
    expect(a[a.indexOf("--cases") + 1]).toBe(String(CASES));
    expect(a[a.indexOf("--radius") + 1]).toBe("default,other");
    expect(a.filter((x) => x === "--cases")).toHaveLength(1);
    expect(r.bytes.get(join("work", "original.tgz"))).toEqual(ORIGINAL_BYTES);
    expect(r.bytes.get(join("work", "resurrection.tgz"))).toEqual(new Uint8Array([9, 9]));
  });

  it("is different with the first differing path", async () => {
    const committed = await committedReport();
    const other = JSON.parse(committed) as Record<string, unknown>;
    other["seed"] = COMMITTED_SEED + 1;
    const r = rig({ committed, replayed: JSON.stringify(other) });
    expect(await runReplay(INPUT, r.deps)).toEqual({ status: "different", firstDiffPath: "$.seed" });
  });

  it("is fetch-failed when the fetch fails, and runs nothing", async () => {
    const committed = await committedReport();
    const r = rig({
      committed,
      replayed: committed,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const result = await runReplay(INPUT, r.deps);
    expect(result.status).toBe("fetch-failed");
    expect(result.reason).toContain("offline");
    expect(r.argv).toEqual([]);
  });

  it("is fetch-failed when the digest differs from report.original.integrity", async () => {
    const committed = await committedReport();
    const r = rig({ committed, replayed: committed, fetch: async () => new Uint8Array([7]) });
    const result = await runReplay(INPUT, r.deps);
    expect(result.status).toBe("fetch-failed");
    expect(result.reason).toContain(sriSha512(new Uint8Array([7])));
    expect(r.argv).toEqual([]);
  });
});

describe("replay helpers", () => {
  it("replayArgv replaces --cases and appends --radius only for a non-empty radius", async () => {
    const report = deserializeReport(await committedReport());
    if (!report.ok) throw new Error("invalid");
    const argv = replayArgv(["--seed", "1", "--cases", "100", "--out", "x"], report.value);
    expect(argv).toEqual(["--seed", "1", "--cases", String(CASES), "--out", "x", "--radius", "default,other"]);
    const none = replayArgv(["--cases", "100"], { ...report.value, functionsTested: [] });
    expect(none).toEqual(["--cases", String(CASES)]);
  });

  it("finds paths in objects and arrays", () => {
    expect(firstDifferingPath({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe("$.a[1].b");
    expect(firstDifferingPath({ a: [1] }, { a: [1, 2] })).toBe("$.a[1]");
    expect(firstDifferingPath({ a: 1 }, { a: 1 })).toBeNull();
    expect(compareReportTexts('{"a":1,"b":2}', '{"b":2,"a":1}')).toEqual({ status: "different", firstDiffPath: "$" });
  });
});
