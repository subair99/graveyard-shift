// Local_Runner (`npm run resurrect`), steps 1 to 10 of the design (R6, R7, R23). Every side effect
// (file system, network, kiro-cli, prompts, clock, push) is injected through `ResurrectDeps`;
// `createResurrectDeps` is the production wiring, used only by `scripts/resurrect.ts`.
import { execFile } from "node:child_process";
import { constants as fsConstants, promises as fsp } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { runAutopsy } from "../../../engine";
import { createMemoryCache } from "../../../engine/cache/cache";
import { systemClock } from "../../../engine/clock";
import { canonicalJson } from "../../../engine/serialize/canonicalJson";
import { formatTimestamp } from "../../../engine/sources/http";
import type { AutopsyRun, Clock, DeathCertificate } from "../../../engine/types";
import { ALLOWED_MEDIUM_PATHS, CREDIT_CEILING } from "../../common/constants";
import { isSupportedPackageName } from "../../common/packageNames";
import { runGravedigger, type GravediggerResult } from "../../gravedigger/shell/gravedigger";
import { deriveIpDeltas, parseIpMeasurement } from "../../harness/core/ipMeasurement";
import { safePathForLog } from "../../intake/core/safePath";
import { validateIntake } from "../../intake/core/validator";
import type { IntakeEntry } from "../../intake/core/types";
import { readFsEntries } from "../../intake/shell/fsEntries";
import { createKiroRunner, defaultSpawn, describeKiroFailure, type KiroRunner } from "../../medium/shell/kiroRunner";
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
}

export interface ResurrectDeps {
  readonly repoRoot: string;
  /** `path.win32` or `path.posix` in tests, `path` in production. */
  readonly path: PathFns & StubPathFns;
  readonly fs: ResurrectFs;
  readonly coroner: (name: string) => Promise<AutopsyRun>;
  readonly gravedigger: (cert: DeathCertificate) => Promise<GravediggerResult>;
  /** Builds the runner; `env` already holds `GRAVEYARD_CERTIFICATE_PATH`. The runner removes `GITHUB_TOKEN`. */
  readonly kiro: (env: Record<string, string | undefined>) => KiroRunner;
  /** The kiro-cli version text, or null when it cannot be read. */
  readonly kiroVersion: () => Promise<string | null>;
  readonly prompt: { ask(question: string): Promise<string> };
  readonly readEntries: (root: string) => Promise<IntakeEntry[]>;
  readonly push: (input: PushInput) => Promise<number>;
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
  await deps.fs.writeText(CERTIFICATE_FILE, `${canonicalJson(cert)}\n`);
  const certificatePath = deps.path.join(deps.repoRoot, ...CERTIFICATE_FILE.split("/"));

  // 7. Medium, or the stub copy.
  let entry: LedgerEntry;
  let mediumFailed = false;
  let failureNote: string | null = null;
  if (args.stubDir === undefined) {
    deps.out(
      `Credit_Ceiling: ${CREDIT_CEILING} credits. This is a documented rule that this command does not enforce.`,
    );
    const kiroVersion = (await deps.kiroVersion()) ?? NOT_PROVIDED;
    const creditBefore = await deps.prompt.ask("Credit meter reading before (press Enter to skip): ");
    const runner = deps.kiro({ ...deps.env, [CERTIFICATE_ENV_VAR]: certificatePath });
    const outcome = await runner.run(args.package);
    if (outcome.kind !== "exited") {
      return fail(
        describeKiroFailure(outcome) ??
          `kiro-cli could not be started${outcome.kind === "failed-to-start" ? `: ${outcome.message}` : ""}. No ledger entry was written.`,
      );
    }
    const creditAfter = await deps.prompt.ask("Credit meter reading after (press Enter to skip): ");
    entry = buildLocalEntry({
      package: args.package,
      version,
      date: formatTimestamp(deps.clock.now()),
      creditBefore,
      creditAfter,
      exitCode: outcome.exitCode,
      kiroCliVersion: kiroVersion,
    });
    mediumFailed = outcome.exitCode !== 0;
    failureNote = describeKiroFailure(outcome);
    if (mediumFailed) deps.err(`The Medium exited with code ${outcome.exitCode}.`);
    if (failureNote !== null) deps.err(failureNote);
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
  if (mediumFailed) return { exitCode: 1 };

  // 9. Intake_Validator on the three paths; nothing is deleted (R6.8).
  const validated = validateIntake(await deps.readEntries(deps.repoRoot));
  if (!validated.ok) {
    deps.err("The Medium output fails the intake check; nothing was pushed and nothing was deleted:");
    for (const v of validated.violations) deps.err(`  ${safePathForLog(v.path)}: ${v.code}: ${v.message}`);
    return { exitCode: 1 };
  }

  // 10. One push call (R6.10).
  const exitCode = await deps.push({
    package: args.package,
    version,
    mode: stub ? "stub" : "local",
    root: deps.repoRoot,
  });
  return { exitCode };
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
    return new Promise((resolve) => reader.question(question, resolve));
  };
  const token = env["GITHUB_TOKEN"];
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
    clock: systemClock,
    env,
    out,
    err,
  };
  return { deps, close: () => rl?.close() };
}
