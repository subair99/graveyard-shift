// Nightly shell (R16.3, R16.9 to R16.11, R16.13, R16.17, R16.21): lists graveyard/, classifies each entry, re-runs the
// Coroner for new advisory ids, compares Tool_Versions, runs the Replay when they are equal, verifies the three
// attestations of an `alive` entry with `gh attestation verify ... --format json`, and writes the report.
// It commits nothing and deploys nothing. All I/O is injected: the file system, `gh`, the Coroner, the Replay deps.

import * as path from "node:path";

import type { AutopsyRun, DeathCertificate, Result } from "../../../engine/types";
import { deserialize } from "../../../engine/serialize/deserialize";
import { deserializeReport } from "../../../proof/serialize/deserialize";
import { ProofReportSchema, type ProofReport } from "../../../proof/types";
import { deserializeEligibilityRecord } from "../../gravedigger/core/eligibility";
import type { IdentityValues, Platform } from "../../common/canonical";
import { GH_MIN_VERSION, PINNED_NODE_VERSION, PREDICATE_TYPE } from "../../common/constants";
import { ENTRY_FILES, deriveEntryKind } from "../core/layout";
import type { EntryKind } from "../core/layout";
import {
  classifyEntry,
  compareCodePoint,
  differingToolFields,
  NIGHTLY_FAILING_RESULTS,
  NIGHTLY_RESULT_ORDER,
  nightlyOrder,
} from "../core/nightlyClassify";
import type { NightlyReplay, NightlyResult, ToolVersions } from "../core/nightlyClassify";
import {
  buildNightlyReport,
  renderNightlyCountLines,
  renderNightlyLine,
  renderNightlyReportJson,
  renderNightlySummary,
  renderNoEntriesNotice,
  renderNotCheckedWarning,
} from "../core/nightlyReport";
import type { NightlyEntryInput, NightlyFact, NightlyReport } from "../core/nightlyReport";
import { verifyCommands } from "../core/verifyCommands";
import { runReplay } from "./replay";
import type { ReplayDeps } from "./replay";

export const NIGHTLY_REPORT_FILE = "nightly-report.json";
export const GRAVEYARD_DIR = "graveyard";
/** A file that exists in the repository root and nowhere else on the runner; its presence shows the cwd is the root. */
export const REPO_ROOT_MARKER = ".github/workflows/nightly.yml";
const BUNDLE_SUFFIX = ".sigstore.json";
const TARBALL_SUFFIX = ".tgz";

export interface NightlyFs {
  /** Names of the sub-directories of `dir`, or null when `dir` does not exist. */
  listDirs(dir: string): string[] | null;
  /** Names of the files directly in `dir`. */
  listFiles(dir: string): string[];
  /** True when `file` (relative to the current directory) exists; used to check that the cwd is the repository root. */
  exists(file: string): boolean;
  readBytes(file: string): Uint8Array | null;
  writeText(file: string, text: string): void;
}

export interface GhResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `gh` with an argument list (no shell) in `cwd`. */
export type GhRunner = (argv: readonly string[], options: { readonly cwd?: string }) => Promise<GhResult>;

export interface NightlyIo {
  log(line: string): void;
  error(line: string): void;
  /** Markdown for `$GITHUB_STEP_SUMMARY`. */
  summary(markdown: string): void;
}

export interface NightlyDeps {
  /** The graveyard directory, `graveyard` in production. */
  readonly root: string;
  /** Where the report is written, `nightly-report.json` in production. */
  readonly reportFile: string;
  readonly fs: NightlyFs;
  readonly runGh: GhRunner;
  readonly sha256: (bytes: Uint8Array) => string;
  readonly io: NightlyIo;
  /** The Tool_Versions of this run; see `runningToolVersions`. */
  readonly runningTools: ToolVersions;
  /** The Coroner for one package version (runAutopsy of src/engine in production). */
  readonly coroner: (name: string, version: string) => Promise<AutopsyRun>;
  readonly replay: ReplayDeps;
  /** A fresh empty directory for one Replay. */
  readonly makeWorkDir: () => string;
  readonly removeDir: (dir: string) => void;
  readonly identity: IdentityValues;
  readonly platform: Platform;
}

export interface NightlyOutcome {
  readonly exitCode: 0 | 1;
  readonly report: NightlyReport;
  /** Entries that could not be read, each as `<path>: <problem>`. They fail the run. */
  readonly malformed: readonly string[];
}

// ---------------------------------------------------------------------------
// Tool versions and gh version
// ---------------------------------------------------------------------------

/** The report schema version of this engine, read from the ProofReport schema (the literal of `toolVersions.reportSchema`). */
export const REPORT_SCHEMA_VERSION: number = ProofReportSchema.shape.toolVersions.shape.reportSchema.value;

/** Tool_Versions as the proof engine records them: `process.version`, the fast-check version, the report schema. */
export function runningToolVersions(nodeVersion: string, fastCheckVersion: string): ToolVersions {
  return { node: nodeVersion, fastCheck: fastCheckVersion, reportSchema: REPORT_SCHEMA_VERSION };
}

/** The `major.minor.patch` of the first line of `gh --version`, or null. */
export function parseGhVersion(stdout: string): [number, number, number] | null {
  const first = stdout.split(/\r?\n/)[0] ?? "";
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(first);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function ghVersionAtLeast(stdout: string, min: string = GH_MIN_VERSION): boolean {
  const have = parseGhVersion(stdout);
  const want = parseGhVersion(`gh version ${min}`);
  if (have === null || want === null) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i]! !== want[i]!) return have[i]! > want[i]!;
  }
  return true;
}

// ---------------------------------------------------------------------------
// gh attestation verify
// ---------------------------------------------------------------------------

/** The argument list (after `gh`) of the verification of one file in the current directory, built by `verifyCommands`. Null when the name needs shell quoting. */
export function ghVerifyArgv(fileName: string): string[] | null {
  const command = verifyCommands({ subjects: [{ name: fileName }] })[0] ?? "";
  const parts = command.split(" ");
  if (parts[0] !== "gh" || parts[1] !== "attestation" || parts[2] !== "verify" || parts[3] !== fileName) return null;
  return parts.slice(1);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The sha256 digests (lower case hex) of the subjects of the statements in `gh attestation verify --format json` output.
 * UNVERIFIED FIELD NAMES until M8 (second run): the shape is the one documented in spikes/attest/DECISION.md, an
 * array of results, each with `verificationResult.statement` (this parser also accepts `statement` directly), and
 * `statement.subject[].digest.sha256`. Fails closed: an error when the output is not JSON or when no statement with a
 * subject digest is found. A statement whose `predicateType` is present and is not PREDICATE_TYPE is not counted.
 */
export function parseGhVerifyJson(stdout: string): Result<string[], string> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "gh did not print JSON" };
  }
  const results: unknown[] = Array.isArray(raw) ? raw : [raw];
  const digests: string[] = [];
  for (const r of results) {
    if (!isRecord(r)) continue;
    const vr = r["verificationResult"];
    const statement = isRecord(vr) && isRecord(vr["statement"]) ? vr["statement"] : r["statement"];
    if (!isRecord(statement)) continue;
    const type = statement["predicateType"];
    if (type !== undefined && type !== PREDICATE_TYPE) continue;
    const subject = statement["subject"];
    if (!Array.isArray(subject)) continue;
    for (const s of subject) {
      if (!isRecord(s) || !isRecord(s["digest"])) continue;
      const d = s["digest"]["sha256"];
      if (typeof d === "string" && /^[0-9a-fA-F]{64}$/.test(d)) digests.push(d.toLowerCase());
    }
  }
  if (digests.length === 0) {
    return { ok: false, error: "the gh JSON has no statement.subject[].digest.sha256 (field names unverified)" };
  }
  return { ok: true, value: digests };
}

const shortText = (text: string): string => text.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "";

/** Verifies one committed file: runs gh in the entry directory, then compares the signed digest with the file's. */
export async function verifyAttestation(
  deps: Pick<NightlyDeps, "runGh" | "sha256"> & { readonly fs: Pick<NightlyFs, "readBytes"> },
  entryDir: string,
  fileName: string,
): Promise<Result<true, string>> {
  const bytes = deps.fs.readBytes(path.join(entryDir, fileName));
  if (bytes === null) return { ok: false, error: `${fileName} is missing` };
  const argv = ghVerifyArgv(fileName);
  if (argv === null) return { ok: false, error: `${fileName}: the name cannot be passed to gh unquoted` };
  let result: GhResult;
  try {
    result = await deps.runGh(argv, { cwd: entryDir });
  } catch (e) {
    return { ok: false, error: `${fileName}: gh could not run: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (result.code !== 0) {
    return { ok: false, error: `${fileName}: gh attestation verify exited ${result.code}: ${shortText(result.stderr)}` };
  }
  const digests = parseGhVerifyJson(result.stdout);
  if (!digests.ok) return { ok: false, error: `${fileName}: ${digests.error}` };
  const wanted = deps.sha256(bytes).toLowerCase();
  if (!digests.value.includes(wanted)) {
    return { ok: false, error: `${fileName}: no verified statement has the sha256 of the committed file` };
  }
  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// New advisory ids
// ---------------------------------------------------------------------------

interface AdvisoryCheck {
  readonly ids: string[];
  readonly facts: NightlyFact[];
  /** Set when the check could not be completed. */
  readonly problem?: string;
}

async function checkAdvisories(deps: NightlyDeps, committed: DeathCertificate): Promise<AdvisoryCheck> {
  const { name, version } = committed.package;
  let run: AutopsyRun;
  try {
    run = await deps.coroner(name, version);
  } catch (e) {
    return { ids: [], facts: [], problem: `the Coroner failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const fresh = run.certificates[0];
  if (fresh === undefined || fresh.package.name !== name || fresh.package.version !== version) {
    return { ids: [], facts: [], problem: `the Coroner produced no certificate for ${name}@${version}` };
  }
  // An unavailable OSV query leaves the id list empty; that means "unknown", not "none" (as in the Gravedigger rule).
  const open = fresh.vitalSigns.openVulnerabilities;
  if (!open.available) {
    return { ids: [], facts: [], problem: `the advisory re-check could not read OSV (${open.attemptedUrl}): ${open.reason}` };
  }
  const known = new Set(committed.openVulnerabilityIds);
  const ids = [...new Set(fresh.openVulnerabilityIds.filter((id) => !known.has(id)))].sort(compareCodePoint);
  const fact = fresh.facts.find((f) => f.key === "openVulnerabilities");
  const provenance = fact?.provenance.find((p) => p.sourceUrl.includes("osv")) ?? fact?.provenance[0];
  if (provenance === undefined) {
    const what = ids.length === 0 ? "the advisory re-check result" : `new advisory ids ${ids.join(", ")}`;
    return { ids, facts: [], problem: `${what} has no recorded source` };
  }
  // The re-check ran and found nothing new: the report says so, with its source (R16.13, R16.15).
  if (ids.length === 0) {
    return {
      ids,
      facts: [
        {
          text: `advisory re-check: no new advisories for ${name}@${version}`,
          sourceUrl: provenance.sourceUrl,
          fetchedAt: provenance.fetchedAt,
        },
      ],
    };
  }
  return {
    ids,
    facts: ids.map((id) => ({
      text: `new advisory ${id} for ${name}@${version}`,
      sourceUrl: provenance.sourceUrl,
      fetchedAt: provenance.fetchedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

class MalformedEntry extends Error {}

function parseOrThrow<T>(entryDir: string, file: string, text: string | null, parse: (t: string) => T | null): T {
  const where = path.join(entryDir, file);
  if (text === null) throw new MalformedEntry(`${where}: file is missing`);
  const value = parse(text);
  if (value === null) throw new MalformedEntry(`${where}: file is not valid`);
  return value;
}

const decode = (bytes: Uint8Array | null): string | null => (bytes === null ? null : new TextDecoder().decode(bytes));

/** One processed entry and the reasons of its not-checked result (empty when it has none). */
interface ProcessedEntry {
  readonly input: NightlyEntryInput;
  readonly notChecked: readonly string[];
}

async function processEntry(deps: NightlyDeps, name: string): Promise<ProcessedEntry> {
  const entryDir = path.join(deps.root, name);
  const files = deps.fs.listFiles(entryDir);
  const text = (file: string): string | null => decode(deps.fs.readBytes(path.join(entryDir, file)));

  const eligibilityText = text(ENTRY_FILES.eligibility);
  const eligibility =
    eligibilityText === null
      ? null
      : parseOrThrow(entryDir, ENTRY_FILES.eligibility, eligibilityText, (t) => {
          const r = deserializeEligibilityRecord(t);
          return r.ok ? r.value : null;
        });
  const kindResult = deriveEntryKind(files, eligibility === null ? null : { eligible: eligibility.eligible });
  if (!kindResult.ok) throw new MalformedEntry(`${entryDir}: ${kindResult.error.message}`);
  const kind: EntryKind = kindResult.value;

  const certificate = parseOrThrow(entryDir, ENTRY_FILES.certificate, text(ENTRY_FILES.certificate), (t) => {
    const r = deserialize(t);
    return r.ok ? r.value : null;
  });

  let report: ProofReport | null = null;
  let tarballName: string | null = null;
  if (kind === "resurrection") {
    report = parseOrThrow(entryDir, ENTRY_FILES.proofReport, text(ENTRY_FILES.proofReport), (t) => {
      const r = deserializeReport(t);
      return r.ok ? r.value : null;
    });
    const tarballs = files.filter((f) => f.endsWith(TARBALL_SUFFIX));
    if (tarballs.length !== 1) {
      throw new MalformedEntry(`${entryDir}: expected exactly one ${TARBALL_SUFFIX} file, found ${tarballs.length}`);
    }
    tarballName = tarballs[0]!;
  }

  const stub = files.includes(ENTRY_FILES.stubMarker);
  const bundlesPresent = files.some((f) => f.endsWith(BUNDLE_SUFFIX));
  const verdict = report === null ? null : report.verdict;
  const committedTools: ToolVersions | null = report === null ? null : { ...report.toolVersions };
  const toolsEqual = differingToolFields(committedTools, deps.runningTools).length === 0;

  // Replay only when the Tool_Versions are equal (R16.5, R16.17).
  let replay: NightlyReplay = { status: "not-run" };
  if (kind === "resurrection" && toolsEqual && tarballName !== null) {
    const workDir = deps.makeWorkDir();
    try {
      replay = await runReplay({ entryDir, tarballName, workDir }, deps.replay);
    } catch (e) {
      replay = { status: "fetch-failed", reason: `the Replay stopped: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      deps.removeDir(workDir);
    }
  }

  // The three attested subjects of an alive entry (R13.4): tarball, proof report, certificate.
  let attestations: "not-applicable" | ("ok" | "failed")[] = "not-applicable";
  const attestationProblems: string[] = [];
  if (verdict === "alive" && tarballName !== null) {
    attestations = [];
    for (const subject of [tarballName, ENTRY_FILES.proofReport, ENTRY_FILES.certificate]) {
      const r = await verifyAttestation(deps, entryDir, subject);
      attestations.push(r.ok ? "ok" : "failed");
      if (!r.ok) attestationProblems.push(r.error);
    }
  }

  const advisories = await checkAdvisories(deps, certificate);

  const classification = classifyEntry({
    kind,
    stub,
    verdict,
    committedTools,
    runningTools: deps.runningTools,
    replay,
    bundlesPresent,
    attestations,
    newAdvisoryIds: advisories.ids,
  });

  // A check that could not be completed is reported as not-checked, never as verified.
  let results: NightlyResult[] = classification.results;
  const notChecked: string[] = [];
  if (replay.status === "fetch-failed") notChecked.push(replay.reason ?? "the Replay could not be completed");
  if (advisories.problem !== undefined) {
    notChecked.push(advisories.problem);
    const set = new Set<NightlyResult>(results.filter((r) => r !== "verified" && r !== "not-resurrected"));
    set.add("not-checked");
    results = NIGHTLY_RESULT_ORDER.filter((r) => set.has(r));
  }

  const primary = results[0];
  const reason =
    primary === "attestation-failed" && attestationProblems.length > 0
      ? attestationProblems.join("; ")
      : primary === "not-checked" && notChecked.length > 0
        ? notChecked.join("; ")
        : undefined;

  const input: NightlyEntryInput = {
    package: certificate.package.name,
    results,
    ...(reason === undefined ? {} : { reason }),
    stub,
    committedTools,
    runningTools: deps.runningTools,
    ...(replay.firstDiffPath === undefined ? {} : { firstDiffPath: replay.firstDiffPath }),
    ...(advisories.facts.length === 0 ? {} : { facts: advisories.facts }),
  };
  return { input, notChecked: results.includes("not-checked") ? notChecked : [] };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runNightly(deps: NightlyDeps): Promise<NightlyOutcome> {
  const { io } = deps;
  const malformed: string[] = [];
  const inputs: NightlyEntryInput[] = [];
  const warnings: string[] = [];
  let failed = false;
  let wrongCwd: string | null = null;

  // gh first: its version is printed and checked before any attestation is trusted (CVE-2025-25204 below 2.67.0).
  let ghVersion: string | null = null;
  try {
    const v = await deps.runGh(["--version"], {});
    if (v.code === 0) ghVersion = v.stdout.split(/\r?\n/)[0]?.trim() ?? null;
  } catch {
    ghVersion = null;
  }
  if (ghVersion === null || ghVersion === "") {
    ghVersion = null;
    io.error("gh --version could not be read");
    failed = true;
  } else {
    io.log(ghVersion);
    if (!ghVersionAtLeast(ghVersion)) {
      io.error(`gh is older than ${GH_MIN_VERSION} (or its version is unreadable); the run fails`);
      failed = true;
    }
  }

  if (!failed) {
    if (deps.runningTools.node !== `v${PINNED_NODE_VERSION}`) {
      io.log(`note: running Node ${deps.runningTools.node} is not the pinned v${PINNED_NODE_VERSION}`);
    }
    const names = deps.fs.listDirs(deps.root);
    if (names === null && !deps.fs.exists(REPO_ROOT_MARKER)) {
      // A missing graveyard/ is only the empty Crypt when we stand in the repository root (R16.24).
      wrongCwd = `the current directory is not the repository root (${REPO_ROOT_MARKER} not found), so a missing ${deps.root}/ cannot be read as an empty graveyard`;
      io.error(wrongCwd);
      failed = true;
    } else {
      // A missing graveyard/ in the repository root is the same as an empty one: zero entries (R16.24).
      for (const name of nightlyOrder(names ?? [])) {
        try {
          const processed = await processEntry(deps, name);
          inputs.push(processed.input);
          if (processed.input.results.includes("not-checked")) {
            const reason = processed.notChecked.join("; ") || "the check could not be completed";
            warnings.push(renderNotCheckedWarning(processed.input.package, `${deps.root}/${name}`, reason, deps.identity, deps.platform));
          }
        } catch (e) {
          if (e instanceof MalformedEntry) malformed.push(e.message);
          else malformed.push(`${path.join(deps.root, name)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  const report = buildNightlyReport({ entries: inputs, ghVersion, identity: deps.identity, platform: deps.platform });
  // The count lines go to the job log as well as to the summary.
  for (const l of renderNightlyCountLines(report)) io.log(l);
  for (const e of report.entries) io.log(renderNightlyLine(e));
  for (const w of warnings) io.log(w);
  // Nothing to verify: only when the graveyard was read (missing or empty) and nothing is malformed or failed.
  if (!failed && wrongCwd === null && malformed.length === 0 && inputs.length === 0) {
    io.log(renderNoEntriesNotice(deps.identity, deps.platform));
  }
  for (const m of malformed) io.error(`malformed entry: ${m}`);
  let summary = renderNightlySummary(report);
  if (wrongCwd !== null) summary += `\nThe run failed: ${wrongCwd}.\n`;
  if (malformed.length > 0) summary += `\nMalformed entries (the run fails):\n${malformed.map((m) => `- ${m}`).join("\n")}\n`;
  deps.fs.writeText(deps.reportFile, renderNightlyReportJson(report));
  io.summary(summary);

  const resultFails = report.entries.some((e) => e.results.some((r) => (NIGHTLY_FAILING_RESULTS as readonly string[]).includes(r)));
  return { exitCode: failed || malformed.length > 0 || resultFails ? 1 : 0, report, malformed };
}
