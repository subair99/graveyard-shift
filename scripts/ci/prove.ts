// CI step entry `prove` (R12.1 to R12.5, R12.12, R5.11). Thin: it chooses the Run_Seed once, compiles the
// Medium's two files, runs the Proof of Life CLI (`runCli`) and maps its exit code to a verdict.
//
// The seed and the case count come only from this file. There is no `--radius` argument and no radius
// variable: the proof engine tests every exported function of the Original (R12.12). Nothing is read
// from the dispatch inputs, the environment (except the identity values the engine redacts) or the
// Medium_Output, other than the two compiled files.
//
// V13 (read from the code, journal 2026-11-16): `--cases` sets `harness.caseCount`, which the report
// writes as `sandbox.limits.casesRequested`; `functionsTested` is the radius `--radius` would take.
// V14: `runCli` passes `loadHarness` only the spec string, so the closure carries the compiled config;
// a thrown error ends as exit code 2 with no report, and this script then writes `fallbackReport`.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { deserialize } from "../../src/engine/serialize/deserialize";
import type { DeathCertificate } from "../../src/engine/types";
import { systemDeps, type SystemDeps } from "../../src/pipeline/common/shell/system";
import { compileHarnessFiles, CI_RUN_DEFAULTS } from "../../src/pipeline/harness/core/compiler";
import { parseIpMeasurement, type IpMeasurement } from "../../src/pipeline/harness/core/ipMeasurement";
import { mapExitCode, type ProveVerdict } from "../../src/pipeline/undertaker/core/proveExit";
import { deserializeEligibilityRecord } from "../../src/pipeline/gravedigger/core/eligibility";
import { runCli, type CliDeps, type CliResult } from "../../src/proof/cli";
import { identityValuesFromEnv } from "../../src/proof/core/identity";
import { fallbackReport, type ReportInput } from "../../src/proof/core/report";
import { canonicalReportJson } from "../../src/proof/serialize/canonicalReport";
import { deserializeReport } from "../../src/proof/serialize/deserialize";
import type { HarnessConfig } from "../../src/proof/types";

/** The only case count of a CI run (R12.3). */
export const CI_CASE_COUNT = 100;
export const ORIGINAL_FILE = "original.tgz";
export const RESURRECTION_FILE = "resurrection.tgz";
export const REPORT_FILE = "proof-report.json";
export const ELIGIBILITY_FILE = "eligibility.json";
export const CERTIFICATE_FILE = "certificate.json";
export const DELTAS_FILE = "deltas.json";
export const HARNESS_FILE = "harness.json";
export const IP_MEASUREMENT_PATH = "docs/measurements/ip-2.0.1.json";
export const RETURNS_EXPECTED_TEMPLATE_PATH = "src/pipeline/harness/sandbox/returnsExpected.cjs";
export const MODULES_DIR_NAME = "harness-modules";
const HARNESS_SPEC = "pipeline";
const UNKNOWN = "unknown";

export interface ProveDeps {
  readonly system: Pick<SystemDeps, "randomSeed" | "env" | "platform">;
  readonly toolVersions: { node: string; fastCheck: string };
  /** The text of a file, or null when it does not exist. */
  readonly readText: (file: string) => string | null;
  readonly writeText: (file: string, text: string) => void;
  /** Appends `name=value` to the step outputs. */
  readonly setOutput: (name: string, value: string) => void;
  readonly runCli: (argv: readonly string[], deps?: CliDeps) => Promise<CliResult>;
  /** Progress lines and the CLI's standard error. */
  readonly log: (text: string) => void;
}

export interface ProveOutcome {
  readonly verdict: ProveVerdict;
  readonly exitCode: number;
  /** True when this script wrote the report itself. */
  readonly fallbackWritten: boolean;
  readonly argv: readonly string[];
}

/** The argument list of the CLI. Pure: no `--radius`, seed and case count from the arguments only. */
export function buildProveArgv(input: {
  dir: string;
  name: string;
  version: string;
  integrity: string;
  seed: number;
}): string[] {
  const at = (f: string): string => (input.dir === "." || input.dir === "" ? f : path.join(input.dir, f));
  return [
    "--original", at(ORIGINAL_FILE),
    "--integrity", input.integrity,
    "--version", input.version,
    "--name", input.name,
    "--resurrection", at(RESURRECTION_FILE),
    "--harness", HARNESS_SPEC,
    "--seed", String(input.seed),
    "--cases", String(CI_CASE_COUNT),
    "--out", at(REPORT_FILE),
  ];
}

function fallbackInput(
  deps: ProveDeps,
  who: { name: string; version: string; integrity: string },
  seed: number,
): ReportInput {
  const platform = deps.system.platform === "win32" ? "win32" : "posix";
  const none = { created: "/graveyard-shift-no-root" };
  return {
    package: { name: who.name, version: who.version },
    original: { integrity: who.integrity, verified: false },
    resurrection: { source: "tarball", treeHash: null },
    sandbox: {
      mechanism: "node-permission",
      restartEvents: { original: 0, resurrection: 0 },
      otherRestarts: { original: 0, resurrection: 0 },
      limits: {
        callTimeoutMs: CI_RUN_DEFAULTS.perCallTimeoutMs,
        heapLimitMb: CI_RUN_DEFAULTS.heapLimitMb,
        outputLimitBytes: CI_RUN_DEFAULTS.outputLimitBytes,
        maxRestarts: CI_RUN_DEFAULTS.maxRestarts,
        casesRequested: CI_CASE_COUNT,
        shrinkBudget: CI_RUN_DEFAULTS.shrinkBudget,
      },
    },
    functionsTested: [],
    casesPerFunction: [],
    unencodableValues: [],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    seed,
    toolVersions: deps.toolVersions,
    roots: { original: none, resurrection: none },
    otherTempRoots: [],
    identity: identityValuesFromEnv(deps.system.env(), platform),
    platform,
    serialize: canonicalReportJson,
  };
}

/** Runs the step. Never throws for a bad input; it writes the fallback report instead (R5.11). */
export async function runProve(deps: ProveDeps, dir = "."): Promise<ProveOutcome> {
  const at = (f: string): string => (dir === "." || dir === "" ? f : path.join(dir, f));
  const seed = deps.system.randomSeed();
  const problems: string[] = [];

  const eligibilityText = deps.readText(at(ELIGIBILITY_FILE));
  const eligibility =
    eligibilityText === null ? null : deserializeEligibilityRecord(eligibilityText);
  if (eligibility === null) problems.push(`${ELIGIBILITY_FILE} is missing`);
  else if (!eligibility.ok) problems.push(`${ELIGIBILITY_FILE}: ${eligibility.error.field}`);
  const who =
    eligibility !== null && eligibility.ok
      ? {
          name: eligibility.value.package.name,
          version: eligibility.value.package.version,
          integrity: eligibility.value.integrity.expected,
        }
      : { name: UNKNOWN, version: UNKNOWN, integrity: "" };

  let config: HarnessConfig | null = null;
  let certificate: DeathCertificate | null = null;
  const certificateText = deps.readText(at(CERTIFICATE_FILE));
  if (certificateText === null) problems.push(`${CERTIFICATE_FILE} is missing`);
  else {
    const parsed = deserialize(certificateText);
    if (parsed.ok) certificate = parsed.value;
    else problems.push(`${CERTIFICATE_FILE}: ${parsed.error.message}`);
  }
  const deltasJson = deps.readText(at(DELTAS_FILE));
  const harnessJson = deps.readText(at(HARNESS_FILE));
  if (deltasJson === null) problems.push(`${DELTAS_FILE} is missing`);
  if (harnessJson === null) problems.push(`${HARNESS_FILE} is missing`);

  let measurement: IpMeasurement | undefined;
  if (who.name === "ip") {
    const text = deps.readText(IP_MEASUREMENT_PATH);
    const parsed = text === null ? null : parseIpMeasurement(text);
    if (parsed !== null && parsed.ok) measurement = parsed.value;
  }

  if (certificate !== null && deltasJson !== null && harnessJson !== null) {
    // The compiler is pure: it returns the generated returns-expected modules, and this script writes
    // them into `<dir>/harness-modules` (absolute, so the engine can grant read access to each file).
    const template = deps.readText(RETURNS_EXPECTED_TEMPLATE_PATH);
    const modulesDir = path.resolve(dir, MODULES_DIR_NAME);
    const compiled = compileHarnessFiles({
      deltasJson,
      harnessJson,
      certificate,
      ...(measurement === undefined ? {} : { measurement }),
      ...(template === null ? {} : { returnsExpected: { template, modulesDir } }),
    });
    if (compiled.ok) {
      config = compiled.value.config;
      for (const m of compiled.value.modules) deps.writeText(path.join(modulesDir, m.name), m.text);
    } else for (const e of compiled.error) problems.push(e.message);
  }

  const argv = buildProveArgv({ dir, ...who, seed });
  const compiledConfig = config;
  const result = await deps.runCli(argv, {
    loadHarness: async () => {
      if (compiledConfig === null) throw new Error(`the harness did not compile: ${problems.join("; ")}`);
      return compiledConfig;
    },
  });
  if (result.stderr !== "") deps.log(result.stderr);

  const mapped = mapExitCode(result.exitCode);
  const reportText = deps.readText(at(REPORT_FILE));
  const reportValid = reportText !== null && deserializeReport(reportText).ok;

  // Exit code 2 without a report is a compile or load failure (V14); so is any missing or invalid report.
  if (config === null || !reportValid) {
    const message =
      problems.length > 0
        ? problems.join("; ")
        : `the proof run ended with exit code ${result.exitCode} and no valid report`;
    const report = fallbackReport(fallbackInput(deps, who, seed), { kind: "harness-config-error", message });
    deps.writeText(at(REPORT_FILE), canonicalReportJson(report));
    deps.setOutput("verdict", "inconclusive");
    return { verdict: "inconclusive", exitCode: result.exitCode, fallbackWritten: true, argv };
  }
  deps.setOutput("verdict", mapped.verdict);
  return { verdict: mapped.verdict, exitCode: result.exitCode, fallbackWritten: false, argv };
}

/** Production wiring. */
export function productionDeps(): ProveDeps {
  const fcVersion = (JSON.parse(readFileSync("node_modules/fast-check/package.json", "utf8")) as { version: string })
    .version;
  const output = process.env["GITHUB_OUTPUT"];
  return {
    system: systemDeps(),
    toolVersions: { node: process.version, fastCheck: fcVersion },
    readText: (file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    writeText: (file, text) => {
      mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      writeFileSync(file, text, "utf8");
    },
    setOutput: (name, value) => {
      if (output !== undefined && output !== "") appendFileSync(output, `${name}=${value}\n`, "utf8");
      else process.stdout.write(`${name}=${value}\n`);
    },
    runCli,
    log: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
  };
}

async function main(): Promise<void> {
  const outcome = await runProve(productionDeps());
  // The step succeeds whenever a verdict was produced; the verdict is the `verdict` output (R12.4).
  process.stderr.write(`verdict ${outcome.verdict}\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`prove failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
