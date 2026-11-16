// Logic of the `intake` job steps (task 8.15). Every side effect (registry, git, gh, extraction,
// output files) is injected through `IntakeDeps`; files of the job are read and written below `cwd`.
// Inputs reach these functions as environment variables only. A step returns its exit code.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../../../src/engine/serialize/canonicalJson";
import type { AutopsyRun, DeathCertificate } from "../../../src/engine/types";
import { resurrectBranchName } from "../../../src/pipeline/common/branchNames";
import { redactText } from "../../../src/pipeline/common/canonical";
import type { IdentityValues, Platform } from "../../../src/pipeline/common/canonical";
import { ALLOWED_MEDIUM_PATHS, PINNED_NODE_VERSION, REPO } from "../../../src/pipeline/common/constants";
import {
  deserializeEligibilityRecord,
  serializeEligibilityRecord,
} from "../../../src/pipeline/gravedigger/core/eligibility";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import type { IntakeEntry, Violation } from "../../../src/pipeline/intake/core/types";
import type { GitEntriesOptions } from "../../../src/pipeline/intake/shell/gitEntries";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";
import { checkNecromancy, isLicenseFileName } from "../../../src/pipeline/necromancy/core/gate";
import type { LicenseFile, PackageJson } from "../../../src/pipeline/necromancy/core/gate";
import { validateDispatchInputs } from "../../../src/pipeline/undertaker/core/dispatchInputs";
import type { ValidDispatchInputs } from "../../../src/pipeline/undertaker/core/dispatchInputs";
import { BRANCH_REQUIRED_MESSAGE, planIntake } from "../../../src/pipeline/undertaker/core/planIntake";
import type { ExtractedFile, PackEntry } from "../../../src/proof/shell/tarball/tarballExtractor";
import type { Result } from "../../../src/engine/types";

export type Env = Readonly<Record<string, string | undefined>>;

/** Names of the environment variables that carry the dispatch inputs (the workflow assigns them from `github.*`). */
export const INPUT_ENV = {
  ref: "GS_REF",
  package: "GS_PACKAGE",
  version: "GS_VERSION",
  branch: "GS_BRANCH",
  mediumMode: "GS_MEDIUM_MODE",
  branchCommit: "GS_BRANCH_COMMIT",
} as const;

export const FILES = {
  certificate: "certificate.json",
  eligibility: "eligibility.json",
  original: "original.tgz",
  resurrection: "resurrection.tgz",
  deltas: "deltas.json",
  harness: "harness.json",
  mediumDir: "work/medium",
} as const;

export const BRANCH_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export interface StepIo {
  /** One line to stdout. */
  log(line: string): void;
  /** One line to stderr. */
  error(line: string): void;
  /** `$GITHUB_OUTPUT` entry; the value is a single line. */
  setOutput(name: string, value: string): void;
  /** Markdown appended to `$GITHUB_STEP_SUMMARY`. */
  summary(markdown: string): void;
}

export interface RawSinks {
  stdout(text: string): void;
  stderr(text: string): void;
  appendOutput(text: string): void;
  appendSummary(text: string): void;
}

/** Every line printed or written to the summary passes redactText (R11.12). Output values are validated single lines. */
export function createRedactingIo(sinks: RawSinks, identity: IdentityValues, platform: Platform): StepIo {
  const clean = (text: string): string => redactText(text, identity, platform);
  return {
    log: (line) => sinks.stdout(`${clean(line)}\n`),
    error: (line) => sinks.stderr(`${clean(line)}\n`),
    setOutput: (name, value) => {
      if (!/^[a-z_]+$/.test(name) || /[\r\n]/.test(value)) throw new Error("invalid step output");
      sinks.appendOutput(`${name}=${clean(value)}\n`);
    },
    summary: (markdown) => sinks.appendSummary(`${clean(markdown)}\n`),
  };
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface IntakeDeps {
  readonly cwd: string;
  readonly env: Env;
  readonly io: StepIo;
  /** `process.version`. */
  readonly nodeVersion: string;
  readonly coroner: (name: string, version: string, githubToken: string | undefined) => Promise<AutopsyRun>;
  readonly gravedigger: (cert: DeathCertificate) => Promise<GravediggerResult>;
  /** Runs `gh` with an argument list and exactly this environment. */
  readonly runGh: (argv: readonly string[], env: Readonly<Record<string, string>>) => Promise<CommandResult>;
  readonly readGitEntries: (options: GitEntriesOptions) => Promise<Result<IntakeEntry[], string>>;
  /** Extracts the Original tarball in memory terms (no file of the package is kept). */
  readonly extractOriginal: (tarball: Uint8Array) => Promise<Result<ExtractedFile[], string>>;
  readonly packTarball: (entries: readonly PackEntry[]) => Result<Uint8Array, { kind: string; entry: string }>;
}

const abs = (deps: IntakeDeps, rel: string): string => path.join(deps.cwd, ...rel.split("/"));

function fail(deps: IntakeDeps, title: string, lines: readonly string[]): number {
  deps.io.error(lines.length === 0 ? title : `${title}: ${lines.join("; ")}`);
  deps.io.summary(`### Intake failed: ${title}\n\n${lines.map((l) => `- ${l}`).join("\n")}`.trimEnd());
  return 1;
}

function readInputs(deps: IntakeDeps): Result<ValidDispatchInputs, string[]> {
  return validateDispatchInputs({
    ref: deps.env[INPUT_ENV.ref] ?? "",
    package: deps.env[INPUT_ENV.package] ?? "",
    version: deps.env[INPUT_ENV.version] ?? "",
    branch: deps.env[INPUT_ENV.branch] ?? "",
    mediumMode: deps.env[INPUT_ENV.mediumMode] ?? "",
  });
}

/** Step `validate-inputs` (R9.1, R9.2, R12.6, R23.7). */
export async function validateInputsStep(deps: IntakeDeps): Promise<number> {
  const problems: string[] = [];
  const inputs = readInputs(deps);
  if (!inputs.ok) problems.push(...inputs.error);
  if (deps.nodeVersion !== `v${PINNED_NODE_VERSION}`) {
    problems.push(`Node ${deps.nodeVersion} is running, the pinned version is v${PINNED_NODE_VERSION}`);
  }
  if (!inputs.ok || problems.length > 0) return fail(deps, "invalid dispatch inputs", problems);
  deps.io.setOutput("package", inputs.value.package);
  deps.io.setOutput("version", inputs.value.version);
  deps.io.setOutput("medium_mode", inputs.value.mediumMode);
  deps.io.setOutput("has_branch", inputs.value.branch === null ? "false" : "true");
  return 0;
}

/** Step `coroner`: Coroner, then Gravedigger; writes the three files and the `eligible` output (R9.1, R11.1). */
export async function coronerStep(deps: IntakeDeps): Promise<number> {
  const inputs = readInputs(deps);
  if (!inputs.ok) return fail(deps, "invalid dispatch inputs", inputs.error);
  const { package: name, version } = inputs.value;
  const token = deps.env["GITHUB_TOKEN"];
  const run = await deps.coroner(name, version, token === "" ? undefined : token);
  const cert = run.certificates[0];
  if (cert === undefined) {
    return fail(deps, "the Coroner produced no certificate", run.errors.map((e) => e.message));
  }
  if (cert.package.name !== name || cert.package.version !== version) {
    return fail(deps, "the Coroner examined another version", [
      `asked for ${name}@${version}, got ${cert.package.name}@${cert.package.version}`,
    ]);
  }
  const dug = await deps.gravedigger(cert);
  if (dug.record.eligible && dug.tarball === null) {
    return fail(deps, "the Gravedigger kept no tarball for an eligible package", []);
  }
  await writeFile(abs(deps, FILES.certificate), `${canonicalJson(cert)}\n`);
  await writeFile(abs(deps, FILES.eligibility), `${serializeEligibilityRecord(dug.record)}\n`);
  if (dug.tarball !== null) await writeFile(abs(deps, FILES.original), dug.tarball);
  deps.io.setOutput("eligible", dug.record.eligible ? "true" : "false");
  return 0;
}

/** Step `plan`: the decision table of planIntake (R11.2, R11.15). */
export async function planStep(deps: IntakeDeps): Promise<number> {
  const inputs = readInputs(deps);
  if (!inputs.ok) return fail(deps, "invalid dispatch inputs", inputs.error);
  const record = deserializeEligibilityRecord(await readFile(abs(deps, FILES.eligibility), "utf8"));
  if (!record.ok) return fail(deps, "eligibility.json is not valid", [`${record.error.field}: ${record.error.message}`]);
  const plan = planIntake({ eligible: record.value.eligible, branch: inputs.value.branch });
  if (!plan.ok) return fail(deps, plan.error, []);
  deps.io.setOutput("kind", plan.value.kind);
  return 0;
}

/**
 * Step `resolve-branch`: the only step that holds a token next to the branch, and it reads no content,
 * only the SHA of the ref (R11.3). The branch name is derived from the validated package, not taken from the input.
 */
export async function resolveBranchStep(deps: IntakeDeps): Promise<number> {
  const inputs = readInputs(deps);
  if (!inputs.ok) return fail(deps, "invalid dispatch inputs", inputs.error);
  if (inputs.value.branch === null) return fail(deps, BRANCH_REQUIRED_MESSAGE, []);
  const token = deps.env["GITHUB_TOKEN"] ?? "";
  const branch = resurrectBranchName(inputs.value.package);
  const result = await deps.runGh(
    ["api", `repos/${REPO}/git/ref/heads/${branch}`, "--jq", ".object.sha"],
    { GH_TOKEN: token },
  );
  const sha = result.stdout.trim();
  if (result.code !== 0 || !BRANCH_COMMIT_PATTERN.test(sha)) {
    return fail(deps, `could not resolve ${branch}`, [`gh api exited with ${result.code}`]);
  }
  deps.io.setOutput("branch_commit", sha);
  return 0;
}

function violationLines(violations: readonly Violation[]): string[] {
  return violations.map((v) => `${v.code} ${v.path}: ${v.message}`);
}

function parseJsonObject(bytes: Uint8Array): PackageJson | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PackageJson) : null;
  } catch {
    return null;
  }
}

function findLicense(files: readonly { path: string; bytes: Uint8Array }[], prefix: string): LicenseFile | null {
  const hits = files
    .filter((f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes("/") && isLicenseFileName(f.path.slice(prefix.length)))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const first = hits[0];
  return first === undefined ? null : { path: first.path.slice(prefix.length), bytes: first.bytes };
}

/**
 * Step `fetch-and-validate`: no token. Reads the branch with gitEntries at the resolved commit, runs
 * validateIntake and checkNecromancy, writes the violations and failed checks to the summary and exits 1 on any
 * failure (R9.3, R9.4, R9.10, R10.8). Only after both pass, the validated files are written to `work/medium/`.
 */
export async function fetchAndValidateStep(deps: IntakeDeps): Promise<number> {
  const inputs = readInputs(deps);
  if (!inputs.ok) return fail(deps, "invalid dispatch inputs", inputs.error);
  if (inputs.value.branch === null) return fail(deps, BRANCH_REQUIRED_MESSAGE, []);
  const sha = deps.env[INPUT_ENV.branchCommit] ?? "";
  if (!BRANCH_COMMIT_PATTERN.test(sha)) return fail(deps, "no valid branch commit", []);
  const branch = resurrectBranchName(inputs.value.package);

  const entries = await deps.readGitEntries({
    cwd: deps.cwd,
    expectedSha: sha,
    remote: "origin",
    branchRef: `refs/heads/${branch}`,
    env: scrubbedEnv(deps.env),
  });
  if (!entries.ok) return fail(deps, "could not read the branch", [entries.error]);

  const validated = validateIntake(entries.value);
  if (!validated.ok) return fail(deps, "the branch is not valid intake", violationLines(validated.violations));

  const tarball = new Uint8Array(await readFile(abs(deps, FILES.original)));
  const extracted = await deps.extractOriginal(tarball);
  if (!extracted.ok) return fail(deps, "could not read the Original tarball", [extracted.error]);
  const originalManifest = extracted.value.find((f) => f.path === "package.json");
  const original = originalManifest === undefined ? null : parseJsonObject(originalManifest.bytes);
  const resurrectionManifest = validated.files.find((f) => f.path === "resurrection/package.json");
  const resurrection =
    resurrectionManifest?.bytes === undefined ? null : parseJsonObject(resurrectionManifest.bytes);
  if (original === null) return fail(deps, "the Original package.json is not valid", []);
  if (resurrection === null) return fail(deps, "resurrection/package.json is not a JSON object", []);

  const withBytes = validated.files.flatMap((f) => (f.bytes === undefined ? [] : [{ path: f.path, bytes: f.bytes }]));
  const necromancy = checkNecromancy({
    original,
    resurrection,
    originalLicense: findLicense(extracted.value, ""),
    resurrectionLicense: findLicense(withBytes, "resurrection/"),
  });
  if (!necromancy.ok) {
    return fail(
      deps,
      "the necromancy laws are not met",
      necromancy.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.message}`),
    );
  }

  const medium = abs(deps, FILES.mediumDir);
  await rm(medium, { recursive: true, force: true });
  for (const file of withBytes) {
    const target = path.join(medium, ...file.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  deps.io.log(`validated ${withBytes.length} files from ${branch} at ${sha}`);
  return 0;
}

function scrubbedEnv(env: Env): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !/^(GITHUB_TOKEN|GH_TOKEN|GH_ENTERPRISE_TOKEN)$/.test(k)) out[k] = v;
  }
  return out as NodeJS.ProcessEnv;
}

/**
 * Step `pack`: re-reads `work/medium/` (a validated copy, not the branch), validates it again, builds
 * `resurrection.tgz` with entries under `package/` (sorted, mtime 0, uid and gid 0) and copies `deltas.json`
 * and `harness.json` next to it (R9.2, R12.1).
 */
export async function packStep(deps: IntakeDeps): Promise<number> {
  const entries = await readFsEntries(abs(deps, FILES.mediumDir), ALLOWED_MEDIUM_PATHS);
  const validated = validateIntake(entries);
  if (!validated.ok) return fail(deps, "work/medium is not valid intake", violationLines(validated.violations));

  const packEntries: PackEntry[] = [];
  for (const file of validated.files) {
    if (file.bytes === undefined || !file.path.startsWith("resurrection/")) continue;
    packEntries.push({ path: file.path.slice("resurrection/".length), bytes: file.bytes });
  }
  const packed = deps.packTarball(packEntries);
  if (!packed.ok) return fail(deps, "could not pack the resurrection", [`${packed.error.kind}: ${packed.error.entry}`]);
  await writeFile(abs(deps, FILES.resurrection), packed.value);
  for (const name of [FILES.deltas, FILES.harness]) {
    const file = validated.files.find((f) => f.path === name);
    if (file?.bytes === undefined) return fail(deps, `${name} is missing`, []);
    await writeFile(abs(deps, name), file.bytes);
  }
  deps.io.log(`packed ${packEntries.length} files into ${FILES.resurrection}`);
  return 0;
}

export const STEPS = {
  "validate-inputs": validateInputsStep,
  coroner: coronerStep,
  plan: planStep,
  "resolve-branch": resolveBranchStep,
  "fetch-and-validate": fetchAndValidateStep,
  pack: packStep,
} as const;

export type StepName = keyof typeof STEPS;

export function isStepName(value: string | undefined): value is StepName {
  return value !== undefined && Object.prototype.hasOwnProperty.call(STEPS, value);
}

/** Runs one step; an unexpected throw becomes exit code 1 with a generic message. */
export async function runStep(name: StepName, deps: IntakeDeps): Promise<number> {
  try {
    return await STEPS[name](deps);
  } catch {
    deps.io.error(`intake ${name} stopped on an unexpected error`);
    return 1;
  }
}
