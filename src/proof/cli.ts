// Thin command line of the Proof of Life Engine (Requirement 1.4; run it with `npm run proof:run`).
//
// `runCli(argv, deps)` holds all the logic and touches no process stream: it returns
// `{ exitCode, stdout, stderr }`. Only `main` at the bottom writes to the process streams.
//
// Documented exception to the single-output rule (Requirement 13.28; tests/proof/unit/sourceScan.test.ts
// lists this file): the report must reach the caller on standard output, which `emit` does not offer
// (its sink is one line on standard error). Every log line and error message still goes through
// `emit` first. The report text itself is checked by the Identity_Scanner before it is written, and a
// report that fails that check is never written.
//
// Output: the canonical report JSON goes to the file named by `--out`, or to standard output when
// there is no `--out`. Standard error gets the engine's log lines and one verdict summary line.
// Exit codes: 0 alive, 1 restless, 2 inconclusive (or a failed run), 64 usage error.
//
// Adding a harness: write a module that exports a `HarnessConfig` (named export `harness`, or the
// default export) and either pass its path to `--harness`, or add an entry to `BUILT_IN_HARNESSES`
// below. Nothing here reads secrets, and nothing here performs a network request.

import { mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findIdentity, identityValuesFromEnv } from "./core/identity";
import { lodashSetHarness } from "./harnesses/lodash.set/config";
import { createEmitter } from "./shell/emit";
import { defaultProofDeps, runProofOfLife } from "./shell/orchestrator";
import {
  RequestValidationError,
  type ExecutorFactory,
  type HarnessConfig,
  type ProofDeps,
  type ProofRequest,
  type ProofRun,
} from "./types";

/** Built-in harnesses by name. Add an entry here to make `--harness <name>` know a new package. */
export const BUILT_IN_HARNESSES: Readonly<Record<string, () => HarnessConfig>> = {
  "lodash.set": () => lodashSetHarness,
};

export const EXIT_ALIVE = 0;
export const EXIT_RESTLESS = 1;
export const EXIT_INCONCLUSIVE = 2;
export const EXIT_USAGE = 64;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Seams for tests. Every field has a production default. */
export interface CliDeps {
  /** Default `runProofOfLife`. */
  run?: (request: ProofRequest, deps: Partial<ProofDeps>) => Promise<ProofRun>;
  /** Passed into the request; default: the Sandbox_Executor (chosen by the orchestrator). */
  executorFactory?: ExecutorFactory;
  /** Overrides of the engine dependencies (environment snapshot, platform, temp root). */
  proofDeps?: Partial<ProofDeps>;
  /** Default: create the parent directory, then write the file. */
  writeFile?: (file: string, text: string) => void;
  /** Resolves `--harness` when it is not a built-in name. Default: dynamic import of the path. */
  loadHarness?: (spec: string) => Promise<HarnessConfig>;
}

const USAGE = [
  "usage: npm run proof:run -- --original <tgz> (--integrity <sha512-SRI> [--name <n>] --version <v> | --meta <file>)",
  "         --resurrection <dir|tgz> --harness <name|path> [--seed <int>] [--cases <n>]",
  "         [--radius <fn,fn>] [--out <report.json>] [--timeout <ms>]",
  "exit codes: 0 alive, 1 restless, 2 inconclusive, 64 usage error",
];

class UsageError extends Error {}

interface Parsed {
  original: string;
  integrity: string | undefined;
  meta: string | undefined;
  name: string | undefined;
  version: string | undefined;
  resurrection: string;
  harness: string;
  seed: number | undefined;
  cases: number | undefined;
  radius: string[] | undefined;
  out: string | undefined;
  timeout: number | undefined;
  help: boolean;
}

function intOption(name: string, text: string | undefined, min: number, max: number): number | undefined {
  if (text === undefined) return undefined;
  if (!/^-?\d+$/.test(text)) throw new UsageError(`--${name} must be an integer`);
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new UsageError(`--${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

function parse(argv: readonly string[]): Parsed {
  let values: ReturnType<typeof parseArgs>["values"];
  try {
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        original: { type: "string" },
        integrity: { type: "string" },
        meta: { type: "string" },
        name: { type: "string" },
        version: { type: "string" },
        resurrection: { type: "string" },
        harness: { type: "string" },
        seed: { type: "string" },
        cases: { type: "string" },
        radius: { type: "string" },
        out: { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean" },
      },
    }).values;
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const str = (k: string): string | undefined => {
    const v = values[k];
    return typeof v === "string" ? v : undefined;
  };
  const help = values["help"] === true;
  if (!help) {
    for (const required of ["original", "resurrection", "harness"]) {
      if (str(required) === undefined || str(required) === "") throw new UsageError(`--${required} is required`);
    }
    const hasMeta = str("meta") !== undefined;
    if (hasMeta && str("integrity") !== undefined) {
      throw new UsageError("use either --meta or --integrity, not both");
    }
    if (!hasMeta && str("integrity") === undefined) throw new UsageError("--integrity or --meta is required");
    if (!hasMeta && str("version") === undefined) throw new UsageError("--version is required without --meta");
  }
  const radiusText = str("radius");
  let radius: string[] | undefined;
  if (radiusText !== undefined) {
    radius = radiusText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (radius.length === 0) throw new UsageError("--radius needs at least one function name");
  }
  return {
    original: str("original") ?? "",
    integrity: str("integrity"),
    meta: str("meta"),
    name: str("name"),
    version: str("version"),
    resurrection: str("resurrection") ?? "",
    harness: str("harness") ?? "",
    seed: intOption("seed", str("seed"), -2147483648, 2147483647),
    cases: intOption("cases", str("cases"), 1, 1_000_000),
    radius,
    out: str("out"),
    timeout: intOption("timeout", str("timeout"), 1, 3_600_000),
    help,
  };
}

function readMeta(file: string): { name: string; version: string; integrity: string } {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new UsageError("--meta could not be read as JSON");
  }
  const rec = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const { name, version, integrity } = rec;
  if (typeof name !== "string" || typeof version !== "string" || typeof integrity !== "string") {
    throw new UsageError("--meta must hold string fields name, version and integrity");
  }
  return { name, version, integrity };
}

async function defaultLoadHarness(spec: string): Promise<HarnessConfig> {
  const mod = (await import(pathToFileURL(path.resolve(spec)).href)) as Record<string, unknown>;
  const config = (mod["harness"] ?? mod["default"]) as HarnessConfig | undefined;
  if (config === undefined || typeof config !== "object") {
    throw new UsageError("the harness module must export `harness` or a default HarnessConfig");
  }
  return config;
}

function defaultWriteFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

/** Applies `--seed`, `--cases` and `--timeout` to a copy of the harness. */
function override(h: HarnessConfig, p: Parsed): HarnessConfig {
  const cases = p.cases;
  const functions: Record<string, HarnessConfig["functions"][string]> = {};
  for (const [name, f] of Object.entries(h.functions)) {
    functions[name] = cases !== undefined && !("excluded" in f) && f.caseCount !== undefined ? { ...f, caseCount: cases } : f;
  }
  return {
    ...h,
    ...(p.seed === undefined ? {} : { seed: p.seed }),
    ...(p.timeout === undefined ? {} : { perCallTimeoutMs: p.timeout }),
    ...(cases === undefined
      ? {}
      : {
          caseCount: cases,
          functions,
          deltas: h.deltas.map((d) => (d.caseCount === undefined ? d : { ...d, caseCount: cases })),
        }),
  };
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<CliResult> {
  const base: ProofDeps = { ...defaultProofDeps(), ...deps.proofDeps };
  const lines: string[] = [];
  const sink = (line: string): void => {
    lines.push(line);
  };
  const identity = identityValuesFromEnv(base.env, base.platform);
  const emit = createEmitter(identity, base.platform, sink);
  const finish = (exitCode: number, stdout = ""): CliResult => ({
    exitCode,
    stdout,
    stderr: lines.map((l) => `${l}\n`).join(""),
  });

  try {
    const p = parse(argv);
    if (p.help) {
      for (const l of USAGE) emit(l);
      return finish(EXIT_ALIVE);
    }
    const meta = p.meta === undefined ? undefined : readMeta(p.meta);
    const builtIn = Object.hasOwn(BUILT_IN_HARNESSES, p.harness) ? BUILT_IN_HARNESSES[p.harness] : undefined;
    const loaded = builtIn !== undefined ? builtIn() : await (deps.loadHarness ?? defaultLoadHarness)(p.harness);
    const harness = override(loaded, p);

    const request: ProofRequest = {
      original: {
        name: meta?.name ?? p.name ?? harness.package,
        version: meta?.version ?? p.version ?? "",
        tarballPath: path.resolve(p.original),
        integrity: meta?.integrity ?? p.integrity ?? "",
      },
      resurrection: {
        kind: isDirectory(p.resurrection) ? "directory" : "tarball",
        path: path.resolve(p.resurrection),
      },
      ...(p.radius === undefined ? {} : { haunting: p.radius }),
      harness,
      ...(deps.executorFactory === undefined ? {} : { executorFactory: deps.executorFactory }),
    };

    const run = await (deps.run ?? runProofOfLife)(request, { ...base, sink });
    const { report } = run;
    const where = `${report.package.name}@${report.package.version}`;

    // A report that failed the leak check is never written (Requirement 13.26).
    const leaked =
      report.harnessErrors.some((e) => e.kind === "identity-leak") ||
      findIdentity(run.json, identity, base.platform).found;
    if (leaked) {
      emit(`no report written for ${where}: it failed the identity leak check`);
      return finish(EXIT_INCONCLUSIVE);
    }

    let stdout = "";
    if (p.out === undefined) {
      stdout = `${run.json}\n`;
    } else {
      try {
        (deps.writeFile ?? defaultWriteFile)(path.resolve(p.out), run.json);
      } catch (e) {
        emit(`the report could not be written: ${e instanceof Error ? e.message : String(e)}`);
        return finish(EXIT_INCONCLUSIVE);
      }
    }
    emit(`verdict ${report.verdict}: ${where}, seed ${report.seed}`);
    const code =
      report.verdict === "alive" ? EXIT_ALIVE : report.verdict === "restless" ? EXIT_RESTLESS : EXIT_INCONCLUSIVE;
    return finish(code, stdout);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (e instanceof UsageError || e instanceof RequestValidationError) {
      emit(`error: ${text}`);
      if (e instanceof UsageError) for (const l of USAGE) emit(l);
      return finish(EXIT_USAGE);
    }
    emit(`error: the run failed: ${text}`);
    return finish(EXIT_INCONCLUSIVE);
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  void main();
}
