// Requirements: 5.4, 5.11, 12.1, 12.2, 12.3, 12.4, 12.5, 12.12
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProveArgv,
  CI_CASE_COUNT,
  MODULES_DIR_NAME,
  productionDeps,
  RETURNS_EXPECTED_TEMPLATE_PATH,
  runProve,
  type ProveDeps,
} from "../../../scripts/ci/prove";
import { deserializeReport } from "../../../src/proof/serialize/deserialize";
import type { CliDeps, CliResult } from "../../../src/proof/cli";
import type { HarnessConfig } from "../../../src/proof/types";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const INTEGRITY = "sha512-AAAA";
const SEED = 1234567;

const ELIGIBILITY = JSON.stringify({
  schemaVersion: 1,
  package: { name: "lodash.set", version: "4.3.2" },
  eligible: true,
  integrity: { expected: INTEGRITY, computed: INTEGRITY, matches: true },
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

interface Setup {
  deps: ProveDeps;
  files: Map<string, string>;
  outputs: Map<string, string>;
  argvSeen: string[][];
  loaded: HarnessConfig[];
  loadError: string[];
}

function setup(
  opts: {
    files?: Record<string, string>;
    exitCode?: number;
    /** Report text the fake CLI writes before it returns. */
    report?: string;
    env?: Record<string, string>;
  } = {},
): Setup {
  const files = new Map<string, string>(
    Object.entries({
      "eligibility.json": ELIGIBILITY,
      "certificate.json": JSON.stringify(LODASH_SET_CERT),
      "deltas.json": DELTAS,
      "harness.json": HARNESS,
      ...opts.files,
    }),
  );
  const outputs = new Map<string, string>();
  const argvSeen: string[][] = [];
  const loaded: HarnessConfig[] = [];
  const loadError: string[] = [];
  const deps: ProveDeps = {
    system: { randomSeed: () => SEED, env: () => opts.env ?? {}, platform: "linux" },
    toolVersions: { node: "v0.0.0", fastCheck: "0.0.0" },
    readText: (f) => files.get(f) ?? null,
    writeText: (f, t) => {
      files.set(f, t);
    },
    setOutput: (n, v) => {
      outputs.set(n, v);
    },
    log: () => undefined,
    runCli: async (argv: readonly string[], cliDeps: CliDeps = {}): Promise<CliResult> => {
      argvSeen.push([...argv]);
      try {
        loaded.push(await cliDeps.loadHarness!("pipeline"));
      } catch (e) {
        loadError.push(e instanceof Error ? e.message : String(e));
        return { exitCode: 2, stdout: "", stderr: "error: the run failed\n" };
      }
      if (opts.report !== undefined) files.set("proof-report.json", opts.report);
      return { exitCode: opts.exitCode ?? 0, stdout: "", stderr: "" };
    },
  };
  return { deps, files, outputs, argvSeen, loaded, loadError };
}

/** A schema-valid report text, taken from a fallback report written by the script itself. */
describe("runProve: generated returns-expected modules", () => {
  it("writes each generated module into the work directory the config points at", async () => {
    const template = readFileSync("src/pipeline/harness/sandbox/returnsExpected.cjs", "utf8");
    const deltas = JSON.stringify({
      schemaVersion: 1,
      package: "lodash.set",
      deltas: [
        {
          kind: "returns-expected",
          id: "re",
          function: "default",
          advisory: "GHSA-p6mc-m468-83gw",
          cases: [
            {
              input: ["a"],
              expected: 1,
              source: { url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", fetchedAt: "2026-11-15T10:00:00Z" },
            },
          ],
        },
      ],
    });
    const s = setup({ files: { "deltas.json": deltas, [RETURNS_EXPECTED_TEMPLATE_PATH]: template } });
    await runProve(s.deps);
    const modulePath = resolve(MODULES_DIR_NAME, "returns-expected-re.cjs");
    expect(s.files.get(modulePath)).toContain('JSON.parse("1")');
    expect(s.loaded[0]?.deltas[0]?.propertyModule).toBe(modulePath);
    expect(s.loaded[0]?.readPaths).toEqual([modulePath]);
  });
});

describe("runProve: modules directory is canonicalized before compiling", () => {
  const template = readFileSync("src/pipeline/harness/sandbox/returnsExpected.cjs", "utf8");
  const deltas = JSON.stringify({
    schemaVersion: 1,
    package: "lodash.set",
    deltas: [
      {
        kind: "returns-expected",
        id: "re",
        function: "default",
        advisory: "GHSA-p6mc-m468-83gw",
        cases: [
          {
            input: ["a"],
            expected: 1,
            source: { url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", fetchedAt: "2026-11-15T10:00:00Z" },
          },
        ],
      },
    ],
  });

  // Portable form: the injected function stands for fs.realpathSync.native on a short-name path.
  it("writes, grants and passes the module under the directory that ensureRealDir returns", async () => {
    const s = setup({ files: { "deltas.json": deltas, [RETURNS_EXPECTED_TEMPLATE_PATH]: template } });
    const asked: string[] = [];
    const real = resolve("a-long-real-directory-name", MODULES_DIR_NAME);
    s.deps = {
      ...s.deps,
      ensureRealDir: (d) => {
        asked.push(d);
        return real;
      },
    };
    await runProve(s.deps);
    const modulePath = resolve(real, "returns-expected-re.cjs");
    expect(asked).toEqual([resolve(MODULES_DIR_NAME)]);
    expect(s.files.get(modulePath)).toContain('JSON.parse("1")');
    expect(s.files.has(resolve(MODULES_DIR_NAME, "returns-expected-re.cjs"))).toBe(false);
    expect(s.loaded[0]?.deltas[0]?.propertyModule).toBe(modulePath);
    expect(s.loaded[0]?.readPaths).toEqual([modulePath]);
  });

  it("the production ensureRealDir returns the real form of a directory given by its 8.3 short name", (ctx) => {
    if (process.platform !== "win32") return ctx.skip("8.3 short names exist only on Windows");
    const base = mkdtempSync(join(tmpdir(), "gs-eight-three-modules-long-name-"));
    try {
      const longBase = realpathSync.native(base);
      const run = spawnSync("cmd.exe", ["/d", "/c", `"for %I in ("${longBase}") do @echo %~sI"`], {
        encoding: "utf8",
        shell: false,
        windowsVerbatimArguments: true,
      });
      const shortBase = (run.stdout ?? "").trim();
      if (shortBase === "" || !shortBase.includes("~") || shortBase === longBase) {
        return ctx.skip("8.3 short name generation is disabled or the short path could not be obtained");
      }
      const got = productionDeps().ensureRealDir!(join(shortBase, MODULES_DIR_NAME));
      expect(got).toBe(join(longBase, MODULES_DIR_NAME));
      expect(got).not.toContain("~");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

async function validReportText(): Promise<string> {
  const s = setup({ files: { "deltas.json": "{" } });
  await runProve(s.deps);
  return s.files.get("proof-report.json")!;
}

describe("prove entry argument list", () => {
  it("never contains --radius and has the fixed shape", async () => {
    const s = setup({ report: await validReportText() });
    const outcome = await runProve(s.deps);
    expect(outcome.argv).toEqual([
      "--original", "original.tgz",
      "--integrity", INTEGRITY,
      "--version", "4.3.2",
      "--name", "lodash.set",
      "--resurrection", "resurrection.tgz",
      "--harness", "pipeline",
      "--seed", String(SEED),
      "--cases", "100",
      "--out", "proof-report.json",
    ]);
    expect(outcome.argv.some((a) => a.includes("radius"))).toBe(false);
    expect(s.argvSeen[0]).toEqual([...outcome.argv]);
  });

  it("takes seed and case count only from the script, not from the environment", async () => {
    const env = { SEED: "1", CASES: "5", RADIUS: "default", CASE_COUNT: "5", INPUT_CASES: "5" };
    const s = setup({ env, report: await validReportText() });
    const { argv } = await runProve(s.deps);
    expect(argv[argv.indexOf("--seed") + 1]).toBe(String(SEED));
    expect(argv[argv.indexOf("--cases") + 1]).toBe(String(CI_CASE_COUNT));
    expect(CI_CASE_COUNT).toBe(100);
  });

  it("uses the directory prefix for file arguments only", () => {
    const argv = buildProveArgv({ dir: "work", name: "a", version: "1.0.0", integrity: "sha512-x", seed: 1 });
    expect(argv).toContain("--out");
    expect(argv.some((a) => a.includes("radius"))).toBe(false);
    expect(argv[argv.indexOf("--original") + 1]).toMatch(/work[\\/]original\.tgz$/);
  });
});

describe("prove entry verdicts", () => {
  it("passes the compiled config to the CLI through loadHarness", async () => {
    const s = setup({ report: await validReportText() });
    await runProve(s.deps);
    expect(s.loaded).toHaveLength(1);
    expect(s.loaded[0]?.package).toBe("lodash.set");
  });

  it.each([
    [0, "alive"],
    [1, "restless"],
    [2, "inconclusive"],
  ])("exit code %i with a valid report gives %s and keeps the report", async (code, verdict) => {
    const report = await validReportText();
    const s = setup({ exitCode: code, report });
    const outcome = await runProve(s.deps);
    expect(outcome.verdict).toBe(verdict);
    expect(outcome.fallbackWritten).toBe(false);
    expect(s.outputs.get("verdict")).toBe(verdict);
    expect(s.files.get("proof-report.json")).toBe(report);
  });

  it("is never alive without a valid report", async () => {
    const s = setup({ exitCode: 0 });
    const outcome = await runProve(s.deps);
    expect(outcome.verdict).toBe("inconclusive");
    expect(outcome.fallbackWritten).toBe(true);
    expect(s.outputs.get("verdict")).toBe("inconclusive");
  });

  it("treats an unknown exit code without a report as a harness-config-error fallback", async () => {
    const s = setup({ exitCode: 64 });
    const outcome = await runProve(s.deps);
    expect(outcome.verdict).toBe("inconclusive");
    expect(outcome.fallbackWritten).toBe(true);
  });
});

describe("prove entry fallback report", () => {
  it("writes a fallback report with harness-config-error and the compile messages on a compile failure", async () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      package: "lodash.set",
      functions: { default: { preset: "lodash-set", caseCount: 1 } },
    });
    const s = setup({ files: { "harness.json": bad } });
    const outcome = await runProve(s.deps);
    expect(outcome.fallbackWritten).toBe(true);
    expect(outcome.verdict).toBe("inconclusive");
    expect(s.loaded).toHaveLength(0);
    expect(s.loadError[0]).toContain("did not compile");
    expect(s.outputs.get("verdict")).toBe("inconclusive");

    const parsed = deserializeReport(s.files.get("proof-report.json")!);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const report = parsed.value;
    expect(report.verdict).toBe("inconclusive");
    expect(report.seed).toBe(SEED);
    expect(report.sandbox.limits.casesRequested).toBe(100);
    const error = report.harnessErrors.find((e) => e.kind === "harness-config-error");
    expect(error?.message).toContain("caseCount");
    expect(error?.message).toContain("belongs to CI");
    expect(report.package).toEqual({ name: "lodash.set", version: "4.3.2" });
  });

  it("writes a fallback report when an input file is missing", async () => {
    const s = setup();
    s.files.delete("deltas.json");
    const outcome = await runProve(s.deps);
    expect(outcome.fallbackWritten).toBe(true);
    const parsed = deserializeReport(s.files.get("proof-report.json")!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.harnessErrors[0]?.message).toContain("deltas.json is missing");
  });
});
