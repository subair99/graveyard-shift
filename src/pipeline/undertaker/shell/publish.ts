// Publish shell (Undertaker): writes graveyard/<package>/ and opens the pull request (design "Publishing", D2).
// All side effects are injected (fs, sha256, command runner, job summary). Never merges, never enables
// auto-merge, never forces a push, never deletes a remote branch.

import type { Verdict } from "../../../proof/types";
import { branchSlug, publishBranchName } from "../../common/branchNames";
import { err, ok, type Result } from "../../common/result";
import {
  BOT_EMAIL,
  BOT_NAME,
  PR_SETTING_NAME,
  commandText,
  ghAuthSetupGitArgv,
  ghPrCreateArgv,
  ghPrListArgv,
  gitAddPathArgv,
  gitCheckoutNewBranchArgv,
  gitCommitArgv,
  gitConfigArgv,
  gitPushArgv,
  parseOpenPrs,
  parsePrUrl,
  type CommandRunner,
} from "./ghCli";
import {
  ENTRY_FILES,
  buildStubMarker,
  deriveEntryKind,
  planEntryFiles,
  type EntryKind,
} from "../core/layout";
import { parsePredicate } from "../core/predicate";
import { checkPublishCollision } from "./publishCollision";

export interface PublishFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Removes the directory and everything in it; no error when it does not exist. */
  removeDir(path: string): Promise<void>;
  makeDir(path: string): Promise<void>;
  /** File names (not paths) directly inside the directory. */
  listFiles(path: string): Promise<string[]>;
}

export interface PublishDeps {
  readonly fs: PublishFs;
  /** Lowercase hex sha256 of the bytes. */
  readonly sha256: (bytes: Uint8Array) => string;
  readonly runner: CommandRunner;
  /** Appends a block of Markdown to the job summary. */
  readonly summary: (markdown: string) => Promise<void>;
}

const join = (...parts: string[]): string => parts.join("/").replace(/\/{2,}/g, "/");
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

export interface BuildEntryInput {
  readonly package: string;
  readonly kind: EntryKind;
  readonly verdict: Verdict | null;
  readonly stub: boolean;
  /** File name of the Resurrection tarball (a resurrection entry only). */
  readonly tarballName: string | null;
  /** Directory holding the artifact files by name (certificate.json, proof-report.json, the tarball, ...). */
  readonly sourceDir: string;
  /** Directory holding `<subject>.sigstore.json` (alive only). */
  readonly bundleDir: string;
  /** `attest/predicate.json`. */
  readonly predicatePath: string;
  /** Usually `graveyard`. */
  readonly entryRoot: string;
}

export interface BuiltEntry {
  readonly entryDir: string;
  readonly files: string[];
}

async function tryRead(fs: PublishFs, path: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(path);
  } catch {
    return null;
  }
}

/**
 * Replaces `<entryRoot>/<package>/` completely with the planned files (bytes copied unchanged). For `alive`, the
 * sha256 of the three subjects must equal the digests of `attest/predicate.json`; a mismatch fails before
 * anything is written. The written directory must give the planned kind through `deriveEntryKind`.
 */
export async function buildEntry(
  input: BuildEntryInput,
  deps: PublishDeps,
): Promise<Result<BuiltEntry, string>> {
  const { fs } = deps;
  let planned: string[];
  try {
    planned = planEntryFiles({
      kind: input.kind,
      verdict: input.verdict,
      stub: input.stub,
      tarballName: input.tarballName,
    });
  } catch (e) {
    return err((e as Error).message);
  }

  // Read every source first, so that a missing file or a digest mismatch leaves the entry untouched.
  const contents = new Map<string, Uint8Array>();
  for (const name of planned) {
    if (name === ENTRY_FILES.stubMarker) {
      contents.set(name, encode(`${JSON.stringify(buildStubMarker())}\n`));
      continue;
    }
    const path = name.endsWith(".sigstore.json")
      ? join(input.bundleDir, name)
      : join(input.sourceDir, name);
    const bytes = await tryRead(fs, path);
    if (bytes === null) return err(`missing file for the entry: ${path}`);
    contents.set(name, bytes);
  }

  if (input.kind === "resurrection" && input.verdict === "alive") {
    const predicateBytes = await tryRead(fs, input.predicatePath);
    if (predicateBytes === null) return err(`missing file for the entry: ${input.predicatePath}`);
    const parsed = parsePredicate(new TextDecoder().decode(predicateBytes));
    if (!parsed.ok) return err(`predicate invalid at ${parsed.error.field}: ${parsed.error.message}`);
    const d = parsed.value.digests;
    const checks: [string, string][] = [
      [input.tarballName!, d.tarball],
      [ENTRY_FILES.proofReport, d.proofReport],
      [ENTRY_FILES.certificate, d.certificate],
    ];
    for (const [name, expected] of checks) {
      const actual = deps.sha256(contents.get(name)!);
      if (actual !== expected) {
        return err(`digest mismatch for ${name}: predicate has ${expected}, file has ${actual}`);
      }
    }
  }

  const entryDir = join(input.entryRoot, input.package);
  await fs.removeDir(entryDir);
  await fs.makeDir(entryDir);
  for (const name of planned) await fs.writeFile(join(entryDir, name), contents.get(name)!);

  const written = (await fs.listFiles(entryDir)).sort();
  const eligibilityBytes = contents.get(ENTRY_FILES.eligibility)!;
  let eligibility: { eligible: boolean } | null = null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(eligibilityBytes)) as { eligible?: unknown };
    if (typeof raw.eligible === "boolean") eligibility = { eligible: raw.eligible };
  } catch {
    eligibility = null;
  }
  const derived = deriveEntryKind(written, eligibility);
  if (!derived.ok) return err(derived.error.message);
  if (derived.value !== input.kind) {
    return err(`entry kind is ${derived.value} but the plan says ${input.kind}`);
  }
  if (written.join("\n") !== [...planned].sort().join("\n")) {
    return err(`entry files differ from the plan: ${written.join(", ")}`);
  }
  return ok({ entryDir, files: written });
}

export interface PushPrInput {
  readonly package: string;
  readonly runId: number;
  readonly runAttempt: number;
  readonly title: string;
  readonly body: string;
  /** Written before `gh pr create`; never committed. Usually `pr-body.md`. */
  readonly bodyFile: string;
  readonly entryRoot: string;
}

export interface PushedPr {
  readonly branch: string;
  readonly url: string | null;
}

async function must(
  deps: PublishDeps,
  command: "git" | "gh",
  argv: readonly string[],
): Promise<Result<string, string>> {
  const r = await deps.runner.run(command, argv);
  if (r.code !== 0) return err(`command failed: ${commandText(command, argv)}`);
  return ok(r.stdout);
}

/** Lists open `publish/<slug>-*` pull requests in the job summary. A failure here is reported, not fatal. */
async function summarizeOpenPrs(slug: string, deps: PublishDeps): Promise<void> {
  const r = await deps.runner.run("gh", ghPrListArgv(slug));
  const parsed = r.code === 0 ? parseOpenPrs(r.stdout) : err("gh pr list failed");
  if (!parsed.ok) {
    await deps.summary(`Could not list open publish pull requests: ${parsed.error}\n`);
    return;
  }
  const lines = ["## Open publish pull requests", ""];
  if (parsed.value.length === 0) lines.push("- none");
  for (const p of parsed.value) lines.push(`- #${p.number} ${p.title} (${p.headRefName}): ${p.url}`);
  lines.push("", "Earlier pull requests stay open. Close the ones you no longer need.", "");
  await deps.summary(lines.join("\n"));
}

/**
 * Collision check (D2), bot identity, `gh auth setup-git`, branch, commit of `<entryRoot>/<package>/` only, a push
 * without force, and `gh pr create`. Never merges.
 */
export async function pushPr(input: PushPrInput, deps: PublishDeps): Promise<Result<PushedPr, string>> {
  const named = publishBranchName({
    package: input.package,
    runId: input.runId,
    runAttempt: input.runAttempt,
  });
  if (!named.ok) return err(named.error);
  const branch = named.value;
  const slug = branchSlug(input.package);

  const steps: ["git" | "gh", string[]][] = [
    ["git", gitConfigArgv("user.name", BOT_NAME)],
    ["git", gitConfigArgv("user.email", BOT_EMAIL)],
    ["gh", ghAuthSetupGitArgv()],
  ];
  for (const [c, a] of steps) {
    const r = await must(deps, c, a);
    if (!r.ok) return err(r.error);
  }

  const collision = await checkPublishCollision((argv) => deps.runner.run("git", argv), {
    package: input.package,
    runId: input.runId,
  });
  if (!collision.ok) return err(collision.error);

  await deps.fs.writeFile(input.bodyFile, encode(input.body));

  const entryPath = join(input.entryRoot, input.package);
  const commitSteps: ["git" | "gh", string[]][] = [
    ["git", gitCheckoutNewBranchArgv(branch)],
    ["git", gitAddPathArgv(`${entryPath}/`)],
    ["git", gitCommitArgv(`graveyard: ${input.package}`)],
    ["git", gitPushArgv(branch)],
  ];
  for (const [c, a] of commitSteps) {
    const r = await must(deps, c, a);
    if (!r.ok) return err(r.error);
  }

  const created = await deps.runner.run(
    "gh",
    ghPrCreateArgv({ branch, title: input.title, bodyFile: input.bodyFile }),
  );
  if (created.code !== 0) {
    const argv = ghPrCreateArgv({ branch, title: input.title, bodyFile: input.bodyFile });
    return err(
      `command failed: ${commandText("gh", argv)}. The repository setting "${PR_SETTING_NAME}" must be on.`,
    );
  }
  await summarizeOpenPrs(slug, deps);
  return ok({ branch, url: parsePrUrl(created.stdout) });
}
