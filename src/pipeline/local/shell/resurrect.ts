// Local_Runner (`npm run resurrect`), steps 1 to 10 of the design (R6, R7, R23). Every side effect
// (file system, network, kiro-cli, prompts, clock, push) is injected through `ResurrectDeps`;
// `createResurrectDeps` is the production wiring, used only by `scripts/resurrect.ts`.
import { execFile } from "node:child_process";
import { constants as fsConstants, promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { runAutopsy } from "../../../engine";
import { createMemoryCache } from "../../../engine/cache/cache";
import { systemClock } from "../../../engine/clock";
import { canonicalJson } from "../../../engine/serialize/canonicalJson";
import { formatTimestamp } from "../../../engine/sources/http";
import type { AutopsyRun, Clock, DeathCertificate, Result } from "../../../engine/types";
import { identityValuesFromEnv } from "../../../proof/core/identity";
import {
  DEFAULT_EXTRACT_LIMITS,
  extractTarball,
  type ExtractedFile,
  type ExtractError,
} from "../../../proof/shell/tarball/tarballExtractor";
import type { IdentityValues, Platform } from "../../common/canonical";
import { serializeEligibilityRecord } from "../../gravedigger/core/eligibility";
import { CI_OWNED_KEYS } from "../../harness/core/compiler";
import { DeltaSchema } from "../../harness/core/deltas";
import { PRESETS } from "../../harness/core/presets";
import { buildPresetMenu, deltaKindsOf, printPresetMenu } from "../../medium/core/presetMenu";
import { summarizeGuardLog } from "../../medium/core/guardLog";
import { parseDeltasFile } from "../../harness/core/deltas";
import { parseHarnessFile } from "../../harness/core/harnessFile";
import { dirtyTreeLines, GIT_STATUS_ARGV, parsePorcelainZ, unexpectedChangedPaths } from "../core/porcelain";
import {
  contextScanFindings,
  GUARD_LOG_FILE_REL,
  MEDIUM_CONTEXT_DIR,
  measurementFilePath,
  planMediumContext,
} from "../core/mediumContext";
import { ALLOWED_MEDIUM_PATHS, CREDIT_CEILING } from "../../common/constants";
import { isSupportedPackageName } from "../../common/packageNames";
import { runGravedigger, type GravediggerResult } from "../../gravedigger/shell/gravedigger";
import { deriveIpDeltas, parseIpMeasurement } from "../../harness/core/ipMeasurement";
import { safePathForLog } from "../../intake/core/safePath";
import { validateIntake } from "../../intake/core/validator";
import type { IntakeEntry } from "../../intake/core/types";
import { readFsEntries } from "../../intake/shell/fsEntries";
import {
  createKiroRunner,
  defaultSpawn,
  describeKiroFailure,
  type KiroOutcome,
  type KiroRunner,
} from "../../medium/shell/kiroRunner";
import { parseResurrectArgs, type PathFns } from "../core/cliArgs";
import {
  appendEntry,
  buildLocalEntry,
  buildStubEntry,
  describeLedgerFailure,
  emptyLedger,
  LEDGER_FILE_NAME,
  NOT_PROVIDED,
  parseLedger,
  printLedger,
  type Ledger,
  type LedgerEntry,
} from "../core/ledger";
import { planStubCopy, type StubCopyItem, type StubListEntry, type StubPathFns } from "../core/stubPlan";
import { formatUsageError, USAGE_EXIT_CODE } from "../core/usage";
import { nodeCommandRunner, commandText } from "./gitPlumbing";
import { writeFileAtomic } from "./atomicWrite";
import { defaultPushDeps, runPush, type PushInput } from "./push";
import { planEligibilityDispatch } from "../core/pushPlan";

export const CERTIFICATE_DIR = ".graveyard-work";
export const CERTIFICATE_FILE = ".graveyard-work/certificate.json";
export const CERTIFICATE_ENV_VAR = "GRAVEYARD_CERTIFICATE_PATH";
export const IP_MEASUREMENT_FILE = "docs/measurements/ip-2.0.1.json";
export const GUARD_LOG_ENV_VAR = "GUARD_LOG_FILE";
/** Exit code of an interrupted run (128 + SIGINT). */
export const INTERRUPT_EXIT_CODE = 130;
export const STUB_NO_CREDIT_TEXT = "A stub run uses no credit.";

/** File operations, all relative to the repository root unless noted. */
export interface ResurrectFs {
  /** True when something (file, directory or link) exists at the path. */
  exists(rel: string): Promise<boolean>;
  /** The file text, or null when the file does not exist. */
  readText(rel: string): Promise<string | null>;
  mkdir(rel: string): Promise<void>;
  writeText(rel: string, text: string): Promise<void>;
  /** Atomic write: temp file in the same directory, then rename (R7.8). */
  writeAtomic(rel: string, text: string): Promise<void>;
  /** Lists a fixture directory recursively, directories included, paths relative to it. */
  listDir(dir: string): Promise<StubListEntry[]>;
  /** Plain copy of each item, in order (directories are listed before their children). */
  copy(items: readonly StubCopyItem[]): Promise<void>;
  /** The file bytes, or null when the file does not exist; other read errors throw. */
  readOptional(rel: string): Promise<Uint8Array | null>;
  /** Removes a directory tree. Nothing there is fine; a symbolic link at `rel` throws. */
  removeTree(rel: string): Promise<void>;
  /** Writes bytes, creating parent directories. */
  writeBytes(rel: string, bytes: Uint8Array): Promise<void>;
  /** Creates the file empty, or empties it to 0 bytes (parent directories are created). */
  truncate(rel: string): Promise<void>;
}

export interface ResurrectDeps {
  readonly repoRoot: string;
  /** `path.win32` or `path.posix` in tests, `path` in production. */
  readonly path: PathFns & StubPathFns;
  readonly fs: ResurrectFs;
  readonly coroner: (name: string) => Promise<AutopsyRun>;
  readonly gravedigger: (cert: DeathCertificate) => Promise<GravediggerResult>;
  /** Builds the runner; `env` already holds `GRAVEYARD_CERTIFICATE_PATH`. The runner keeps only the Medium_Env_Keys. */
  readonly kiro: (env: Record<string, string | undefined>) => KiroRunner;
  /** The kiro-cli version text, or null when it cannot be read. */
  readonly kiroVersion: () => Promise<string | null>;
  readonly prompt: { ask(question: string): Promise<string> };
  readonly readEntries: (root: string) => Promise<IntakeEntry[]>;
  readonly push: (input: PushInput) => Promise<number>;
  /** Stdout of `git status --porcelain -z --untracked-files=all` at the repository root, or the failure. */
  readonly gitStatus: () => Promise<Result<string, string>>;
  /** Extracts the Original tarball in memory terms (no file is kept). */
  readonly extract: (tarball: Uint8Array) => Promise<Result<ExtractedFile[], ExtractError>>;
  readonly identity: IdentityValues;
  readonly platform: Platform;
  readonly clock: Clock;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface ResurrectResult {
  exitCode: number;
}

export const LEDGER_REMINDER = [
  "Reminder: commit ledger.json yourself. It is written in this clone (the WSL clone ~/graveyard-shift).",
  "Commit it and push it to main from there, then run `git pull origin main` in the Windows clone.",
  "The push script does not push it, and no workflow commits it.",
];

const OUTPUT_PATHS = ALLOWED_MEDIUM_PATHS.map((p) => p.replace(/\/$/, ""));

export async function runResurrect(argv: readonly string[], deps: ResurrectDeps): Promise<ResurrectResult> {
  try {
    return await run(argv, deps);
  } catch {
    // The message carries no environment value and no path (R6.7, R7.10).
    deps.err("The run stopped on an unexpected error. Nothing was pushed.");
    return { exitCode: 1 };
  }
}

async function run(argv: readonly string[], deps: ResurrectDeps): Promise<ResurrectResult> {
  const fail = (line: string, exitCode = 1): ResurrectResult => {
    deps.err(line);
    return { exitCode };
  };

  // 1. Parse the arguments (R6.1, R6.2, R23.3).
  const parsed = parseResurrectArgs(argv, deps.path);
  if (!parsed.ok) {
    deps.err(formatUsageError(parsed.error.message).trimEnd());
    return { exitCode: USAGE_EXIT_CODE };
  }
  const args = parsed.value;
  const stub = args.stubDir !== undefined;

  // 2. Read the Ledger; a malformed file stops the run before anything else (R7.9).
  const ledgerText = await deps.fs.readText(LEDGER_FILE_NAME);
  let ledger: Ledger = emptyLedger();
  if (ledgerText !== null) {
    const read = parseLedger(ledgerText, LEDGER_FILE_NAME);
    if (!read.ok) return fail(`${describeLedgerFailure(read.error)}. The file is unchanged and nothing was started.`);
    ledger = read.value;
  }

  // 3. Refuse leftovers of an earlier attempt at the repository root.
  const present: string[] = [];
  for (const rel of OUTPUT_PATHS) if (await deps.fs.exists(rel)) present.push(rel);
  if (present.length > 0) {
    return fail(
      `Found ${present.join(", ")} at the repository root. Remove ${present.length === 1 ? "it" : "them"} and run again; ` +
        "an earlier attempt must not mix with this one. Nothing was started.",
    );
  }

  // Stub copy plan, checked before any network call: the fixture must hold exactly the three entries (R23.2).
  let stubItems: StubCopyItem[] = [];
  if (args.stubDir !== undefined) {
    const fixtureDir = deps.path.join(deps.repoRoot, ...args.stubDir.split("/"));
    const plan = planStubCopy(fixtureDir, deps.repoRoot, await deps.fs.listDir(fixtureDir), deps.path);
    if (!plan.ok) {
      deps.err(formatUsageError(plan.error.message).trimEnd());
      return { exitCode: USAGE_EXIT_CODE };
    }
    stubItems = plan.value;
  }

  // 4. Coroner, then Gravedigger (R6.3).
  if (!isSupportedPackageName(args.package)) return fail("The package name is not supported.", USAGE_EXIT_CODE);
  const autopsy = await deps.coroner(args.package);
  const cert = autopsy.certificates[0];
  if (cert === undefined) {
    for (const e of autopsy.errors) deps.err(e.message);
    return fail(`The Coroner produced no Death Certificate for ${args.package}. Nothing was started.`);
  }
  const version = cert.package.version;
  const dug = await deps.gravedigger(cert);
  const record = dug.record;
  if (!record.eligible) {
    deps.err(`${args.package}@${version} is not eligible for resurrection.`);
    if (record.reason !== undefined) deps.err(`  reason: ${record.reason}`);
    for (const rule of record.rules.filter((r) => !r.holds)) {
      deps.err(`  failed rule: ${rule.rule} (observed: ${String(rule.observed)}${rule.reason !== undefined ? `, ${rule.reason}` : ""})`);
    }
    const argvPlan = planEligibilityDispatch({ package: args.package, version });
    if (argvPlan.ok) deps.err(`To record a Not_Resurrected_Entry, the dispatch command is: ${commandText("gh", argvPlan.value)}`);
    return { exitCode: 1 };
  }

  // 5. ip gate (R6.5, R3).
  if (args.package === "ip") {
    const text = await deps.fs.readText(IP_MEASUREMENT_FILE);
    if (text === null) return fail(`${IP_MEASUREMENT_FILE} is missing. Record the ip measurement first (npm run measure:ip).`);
    const measurement = parseIpMeasurement(text);
    if (!measurement.ok) return fail(`${IP_MEASUREMENT_FILE} is not valid: ${measurement.error.issues.join("; ")}`);
    if (!deriveIpDeltas(measurement.value).ipInDemo) {
      return fail("The ip measurement leaves no delta to declare. ip is not started.");
    }
  }

  // 6. Certificate for the Medium's read-only tool; gitignored and never pushed (R6.11).
  await deps.fs.mkdir(CERTIFICATE_DIR);
  const certificateText = `${canonicalJson(cert)}\n`;
  await deps.fs.writeText(CERTIFICATE_FILE, certificateText);
  const certificatePath = deps.path.join(deps.repoRoot, ...CERTIFICATE_FILE.split("/"));

  // 7. Medium, or the stub copy.
  let entry: LedgerEntry;
  let exitedOutcome: Extract<KiroOutcome, { kind: "exited" }> | null = null;
  if (args.stubDir === undefined) {
    const prepared = await prepareMedium(deps, args.package, version, cert, dug, certificateText);
    if (prepared !== null) return fail(prepared);
    deps.out(
      `Credit_Ceiling: ${CREDIT_CEILING} credits. This is a documented rule that this command does not enforce.`,
    );
    const kiroVersion = (await deps.kiroVersion()) ?? NOT_PROVIDED;
    let creditBefore: string;
    try {
      creditBefore = await deps.prompt.ask("Credit meter reading before (press Enter to skip): ");
    } catch {
      return fail("Interrupted before the Medium started. Nothing was written and nothing was pushed.", INTERRUPT_EXIT_CODE);
    }
    const guardLogPath = deps.path.join(deps.repoRoot, ...GUARD_LOG_FILE_REL.split("/"));
    const runner = deps.kiro({ ...deps.env, [CERTIFICATE_ENV_VAR]: certificatePath, [GUARD_LOG_ENV_VAR]: guardLogPath });
    const outcome = await runner.run(args.package);
    if (outcome.kind !== "exited") {
      return fail(
        describeKiroFailure(outcome) ??
          `kiro-cli could not be started${outcome.kind === "failed-to-start" ? `: ${outcome.message}` : ""}. No ledger entry was written.`,
      );
    }
    exitedOutcome = outcome;
    let creditAfter: string;
    try {
      creditAfter = await deps.prompt.ask("Credit meter reading after (press Enter to skip): ");
    } catch {
      deps.err("Interrupted at the second meter reading. No ledger entry was written and nothing was pushed.");
      deps.err("Record the meter readings of this run in docs/kiro-journal.md by hand.");
      return { exitCode: INTERRUPT_EXIT_CODE };
    }
    entry = buildLocalEntry({
      package: args.package,
      version,
      date: formatTimestamp(deps.clock.now()),
      creditBefore,
      creditAfter,
      exitCode: outcome.exitCode,
      kiroCliVersion: kiroVersion,
    });
  } else {
    await deps.fs.copy(stubItems);
    deps.out(STUB_NO_CREDIT_TEXT);
    entry = buildStubEntry({
      package: args.package,
      version,
      date: formatTimestamp(deps.clock.now()),
      fixture: args.stubDir,
    });
  }

  // 8. Ledger, atomically, even when the Medium failed (R6.9, R7.8).
  try {
    await deps.fs.writeAtomic(LEDGER_FILE_NAME, printLedger(appendEntry(ledger, entry)));
  } catch {
    return fail(`${LEDGER_FILE_NAME} could not be written; the previous file is unchanged. Nothing was pushed.`);
  }
  deps.out(`Wrote an entry to ${LEDGER_FILE_NAME}.`);
  for (const line of LEDGER_REMINDER) deps.out(line);

  // 9. Checks after the run, in the order 10.7, 10.3, 10.4, 10.5, 10.8; the first failure ends the run,
  // the Ledger entry stays and no file is deleted (medium-agent R10.10).
  if (exitedOutcome !== null) {
    const failed = await checksAfterMedium(deps, exitedOutcome);
    if (failed) return { exitCode: 1 };
  }
  if (!(await intakeAndParseCheck(deps))) return { exitCode: 1 };

  // 10. One push call (R6.10).
  const exitCode = await deps.push({
    package: args.package,
    version,
    mode: stub ? "stub" : "local",
    root: deps.repoRoot,
  });
  return { exitCode };
}

/** Checks 10.7, 10.3, 10.4 and 10.5 of a run without --stub. Returns true when one failed (already printed). */
async function checksAfterMedium(
  deps: ResurrectDeps,
  outcome: Extract<KiroOutcome, { kind: "exited" }>,
): Promise<boolean> {
  // 10.7: exit code or usage-limit text.
  const failureNote = describeKiroFailure(outcome);
  if (outcome.exitCode !== 0) deps.err(`The Medium exited with code ${outcome.exitCode}.`);
  if (failureNote !== null) deps.err(failureNote);
  if (outcome.exitCode !== 0 || failureNote !== null) return true;

  // 10.3 and 10.4 read the Guard_Log; a missing file counts as zero lines.
  let logText = "";
  try {
    const bytes = await deps.fs.readOptional(GUARD_LOG_FILE_REL);
    if (bytes !== null) logText = new TextDecoder().decode(bytes);
  } catch {
    deps.err(`${GUARD_LOG_FILE_REL} could not be read. Nothing was pushed and nothing was deleted.`);
    return true;
  }
  const summary = summarizeGuardLog(logText);
  if (summary.denyLines.length > 0) {
    deps.err("The Write_Guard blocked writes during the run; nothing was pushed and nothing was deleted:");
    for (const line of summary.denyLines) deps.err(`  ${safePathForLog(line)}`);
    return true;
  }
  if (summary.lineCount === 0) {
    for (const rel of OUTPUT_PATHS) {
      if (await deps.fs.exists(rel)) {
        deps.err(
          "The Write_Guard left no record in the Guard_Log, but the Medium produced output. " +
            "Nothing was pushed and nothing was deleted.",
        );
        return true;
      }
    }
  }

  // 10.5 (with 10.6): paths changed outside the three outputs and ledger.json.
  const status = await deps.gitStatus().catch(() => null);
  const changed = status !== null && status.ok ? parsePorcelainZ(status.value) : null;
  if (changed === null || !changed.ok) {
    deps.err("Could not read git status after the run. Nothing was pushed and nothing was deleted.");
    return true;
  }
  const unexpected = unexpectedChangedPaths(changed.value);
  if (unexpected.length > 0) {
    deps.err("The Medium changed paths outside its three outputs; nothing was pushed and nothing was deleted:");
    for (const p of unexpected) deps.err(`  ${safePathForLog(p)}`);
    return true;
  }
  return false;
}

/** Check 10.8, both modes: parse deltas.json and harness.json when present, then the Intake_Validator. True when it passes. */
async function intakeAndParseCheck(deps: ResurrectDeps): Promise<boolean> {
  const problems: string[] = [];
  const parsers = [
    ["deltas.json", parseDeltasFile],
    ["harness.json", parseHarnessFile],
  ] as const;
  for (const [file, parse] of parsers) {
    const text = await deps.fs.readText(file);
    if (text === null) continue;
    const parsed = parse(text);
    if (!parsed.ok) for (const issue of parsed.error.issues) problems.push(`${file}: ${safePathForLog(issue)}`);
  }
  const validated = validateIntake(await deps.readEntries(deps.repoRoot));
  if (!validated.ok) {
    for (const v of validated.violations) problems.push(`${safePathForLog(v.path)}: ${v.code}: ${v.message}`);
  }
  if (problems.length === 0) return true;
  deps.err("The Medium output fails the intake check; nothing was pushed and nothing was deleted:");
  for (const p of problems) deps.err(`  ${p}`);
  return false;
}

/**
 * Step 7 before the Medium (run without --stub): clean tree, Medium_Context plan, scan, write, Guard_Log
 * (medium-agent R4.5, R4.6, R5.1 to R5.7, R10.1, R10.2, R10.6). Returns the failure text, or null when
 * the Medium may start. No text of a scan match is ever returned.
 */
async function prepareMedium(
  deps: ResurrectDeps,
  name: string,
  version: string,
  cert: DeathCertificate,
  dug: GravediggerResult,
  certificateText: string,
): Promise<string | null> {
  // Clean tree (R10.1, R10.2, R10.6): a read failure fails closed.
  const status = await deps.gitStatus().catch(() => null);
  if (status === null || !status.ok) return "Could not read git status. Nothing was started.";
  const changed = parsePorcelainZ(status.value);
  if (!changed.ok) return "Could not read git status. Nothing was started.";
  if (changed.value.length > 0) {
    return [
      "The working tree is not clean. Commit or remove these changes first; nothing was started:",
      ...dirtyTreeLines(changed.value).map((l) => `  ${l}`),
    ].join("\n");
  }

  // Plan (R5.1 to R5.3, R5.6).
  if (dug.tarball === null) return "No tarball is available for the Original files. Nothing was started.";
  let extracted: Awaited<ReturnType<ResurrectDeps["extract"]>>;
  try {
    extracted = await deps.extract(dug.tarball);
  } catch {
    return "The Original tarball could not be read. Nothing was started.";
  }
  if (!extracted.ok) {
    const e = extracted.error;
    const reason = "reason" in e ? e.reason : e.limit;
    return `The Original tarball could not be extracted: ${e.kind}: ${reason}. Nothing was started.`;
  }
  const measurementRel = measurementFilePath(name, version);
  let measurementBytes: Uint8Array | null;
  try {
    measurementBytes = await deps.fs.readOptional(measurementRel);
  } catch {
    return `${safePathForLog(measurementRel)} could not be read. Nothing was started.`;
  }
  const menuText = printPresetMenu(buildPresetMenu(PRESETS, deltaKindsOf(DeltaSchema), CI_OWNED_KEYS));
  const files = planMediumContext({
    certificateText,
    eligibilityText: serializeEligibilityRecord(dug.record),
    menuText,
    measurementBytes,
    original: extracted.value,
  });

  // Scan before anything is written (R5.5); names files, never the matched text.
  const findings = contextScanFindings(files, deps.identity, deps.platform);
  if (findings.length > 0) {
    return [
      "The Medium_Context scan found text that must not reach the Medium; nothing was started. Affected files:",
      ...findings.map((rel) => `  ${safePathForLog(rel)}`),
    ].join("\n");
  }

  // Write (R5.1, R5.6).
  let current = MEDIUM_CONTEXT_DIR;
  try {
    await deps.fs.removeTree(MEDIUM_CONTEXT_DIR);
    for (const f of files) {
      current = `${MEDIUM_CONTEXT_DIR}/${f.rel}`;
      await deps.fs.writeBytes(current, f.bytes);
    }
  } catch {
    return `${safePathForLog(current)} could not be written or removed. Nothing was started.`;
  }

  // Guard_Log (R4.5, R4.6).
  try {
    await deps.fs.truncate(GUARD_LOG_FILE_REL);
  } catch {
    return `${GUARD_LOG_FILE_REL} could not be created or emptied. Nothing was started.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Production wiring (not covered by unit tests: it needs the file system, network, kiro-cli, gh and git).
// ---------------------------------------------------------------------------

export interface ProductionResurrect {
  deps: ResurrectDeps;
  /** Releases the terminal reader. */
  close(): void;
}

function nodeFs(root: string): ResurrectFs {
  const full = (rel: string): string => path.join(root, ...rel.split("/"));
  return {
    async exists(rel) {
      try {
        await fsp.lstat(full(rel));
        return true;
      } catch {
        return false;
      }
    },
    async readText(rel) {
      try {
        return await fsp.readFile(full(rel), "utf8");
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") return null;
        throw e;
      }
    },
    async mkdir(rel) {
      await fsp.mkdir(full(rel), { recursive: true });
    },
    writeText: (rel, text) => fsp.writeFile(full(rel), text, { encoding: "utf8" }),
    writeAtomic: (rel, text) => writeFileAtomic(full(rel), text),
    async listDir(dir) {
      const list: StubListEntry[] = [];
      async function visit(rel: string): Promise<void> {
        for (const name of (await fsp.readdir(path.join(dir, rel))).sort()) {
          const sub = rel === "" ? name : `${rel}/${name}`;
          const s = await fsp.lstat(path.join(dir, sub));
          if (s.isDirectory()) {
            list.push({ path: sub, type: "directory" });
            await visit(sub);
          } else {
            list.push({ path: sub, type: s.isFile() ? "file" : "other" });
          }
        }
      }
      await visit("");
      return list;
    },
    async copy(items) {
      for (const item of items) {
        if (item.type === "directory") await fsp.mkdir(item.to, { recursive: true });
        else await fsp.copyFile(item.from, item.to, fsConstants.COPYFILE_EXCL);
      }
    },
    async readOptional(rel) {
      try {
        return new Uint8Array(await fsp.readFile(full(rel)));
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") return null;
        throw e;
      }
    },
    async removeTree(rel) {
      let stat;
      try {
        stat = await fsp.lstat(full(rel));
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") return;
        throw e;
      }
      if (stat.isSymbolicLink()) throw new Error("refusing to remove a symbolic link");
      await fsp.rm(full(rel), { recursive: true, force: true });
    },
    async writeBytes(rel, bytes) {
      await fsp.mkdir(path.dirname(full(rel)), { recursive: true });
      await fsp.writeFile(full(rel), bytes);
    },
    async truncate(rel) {
      await fsp.mkdir(path.dirname(full(rel)), { recursive: true });
      await fsp.writeFile(full(rel), "");
    },
  };
}

function readKiroVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("kiro-cli", ["--version"], { shell: false, timeout: 15_000 }, (error, stdout) => {
      const text = String(stdout).trim();
      resolve(error !== null || text === "" ? null : text);
    });
  });
}

export function createResurrectDeps(repoRoot: string, env: Readonly<Record<string, string | undefined>>): ProductionResurrect {
  const out = (line: string): void => void process.stdout.write(`${line}\n`);
  const err = (line: string): void => void process.stderr.write(`${line}\n`);
  let rl: Interface | undefined;
  const ask = (question: string): Promise<string> => {
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    const reader = rl;
    // A SIGINT or close of the reader while a question is pending rejects it: the runner treats that as an
    // interrupt (medium-agent R9.9). These are readline events; no process SIGINT handler is installed.
    return new Promise((resolve, reject) => {
      const onStop = (): void => {
        reader.off("SIGINT", onStop);
        reader.off("close", onStop);
        reject(new Error("interrupted"));
      };
      reader.once("SIGINT", onStop);
      reader.once("close", onStop);
      reader.question(question, (answer) => {
        reader.off("SIGINT", onStop);
        reader.off("close", onStop);
        resolve(answer);
      });
    });
  };
  const token = env["GITHUB_TOKEN"];
  const platform: Platform = process.platform === "win32" ? "win32" : "posix";
  const deps: ResurrectDeps = {
    repoRoot,
    path,
    fs: nodeFs(repoRoot),
    coroner: (name) =>
      runAutopsy(
        { kind: "name", name },
        { requestTimeoutMs: 10_000, concurrency: 8, ...(token !== undefined && token !== "" ? { githubToken: token } : {}) },
        { fetch, clock: systemClock, cache: createMemoryCache() },
      ),
    gravedigger: (cert) => runGravedigger(cert, { fetch, clock: systemClock }),
    kiro: (kiroEnv) =>
      createKiroRunner({
        spawn: defaultSpawn,
        env: kiroEnv,
        cwd: repoRoot,
        added: {
          GRAVEYARD_CERTIFICATE_PATH:
            kiroEnv[CERTIFICATE_ENV_VAR] ?? path.join(repoRoot, ...CERTIFICATE_FILE.split("/")),
          GUARD_LOG_FILE: kiroEnv[GUARD_LOG_ENV_VAR] ?? path.join(repoRoot, ...GUARD_LOG_FILE_REL.split("/")),
        },
        out: (text) => void process.stdout.write(text),
        err: (text) => void process.stderr.write(text),
      }),
    kiroVersion: readKiroVersion,
    prompt: { ask },
    readEntries: (root) => readFsEntries(root, ALLOWED_MEDIUM_PATHS),
    push: (input) =>
      runPush(
        input,
        defaultPushDeps({
          confirmEmail: async (email) => {
            const answer = await ask(`Commit email: ${email}\nUse this email for the commit? [y/N] `);
            return /^\s*y(es)?\s*$/i.test(answer);
          },
          out,
          err,
        }),
      ),
    gitStatus: async () => {
      const r = await nodeCommandRunner.run("git", ["-C", repoRoot, ...GIT_STATUS_ARGV]);
      return r.code === 0 ? { ok: true, value: r.stdout } : { ok: false, error: "git status failed" };
    },
    extract: async (tarball) => {
      const dir = await fsp.mkdtemp(path.join(tmpdir(), "gs-medium-"));
      try {
        return await extractTarball(tarball, dir, DEFAULT_EXTRACT_LIMITS);
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    },
    identity: identityValuesFromEnv(env, platform),
    platform,
    clock: systemClock,
    env,
    out,
    err,
  };
  return { deps, close: () => rl?.close() };
}
