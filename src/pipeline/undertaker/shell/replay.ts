// Replay (R16.6, R16.7, R16.8, R16.17): the nightly second run of the Proof_Engine over a committed entry.
//
// It reuses the `prove.ts` path (`runProve`) instead of copying it: the entry's files are staged into a
// fresh work directory with the names `runProve` reads, and `runProve` then compiles the harness (the
// returns-expected modules go through its `ensureRealDir`, so the 8.3 fix applies), runs the proof CLI and
// writes `proof-report.json`. The three replay inputs are applied only here, around that call:
//   - the seed: `randomSeed` of the injected system deps returns `report.seed`;
//   - the case count and the radius: the injected `runCli` rewrites the CLI argument list, replacing the
//     value of `--cases` with `report.sandbox.limits.casesRequested` and appending
//     `--radius report.functionsTested`.
// `scripts/ci/prove.ts` is not changed and never builds `--radius` (R12.12); the CI path cannot reach this
// file's wrapper. All I/O is injected.

import { createHash } from "node:crypto";
import * as path from "node:path";

import type { ProveDeps, ProveOutcome } from "../../../../scripts/ci/prove";
import { deserializeReport } from "../../../proof/serialize/deserialize";
import type { ProofReport } from "../../../proof/types";
import type { NightlyReplay } from "../core/nightlyClassify";
import { ENTRY_FILES } from "../core/layout";

const ORIGINAL_FILE = "original.tgz";
const RESURRECTION_FILE = "resurrection.tgz";
const STAGED_TEXT_FILES = [ENTRY_FILES.eligibility, ENTRY_FILES.certificate, ENTRY_FILES.deltas, ENTRY_FILES.harness];

export interface ReplayDeps {
  /** The deps of the `prove.ts` path (production: `productionDeps()` of that script). Used as given except for the two wrappers. */
  readonly prove: ProveDeps;
  /** `runProve` of `scripts/ci/prove.ts`. */
  readonly runProve: (deps: ProveDeps, dir: string) => Promise<ProveOutcome>;
  readonly readBytes: (file: string) => Uint8Array | null;
  readonly writeBytes: (file: string, bytes: Uint8Array) => void;
  /** The Original's tarball from the registry by name and version; may throw or reject. */
  readonly fetchOriginal: (name: string, version: string) => Promise<Uint8Array>;
}

export interface ReplayInput {
  /** The committed `graveyard/<package>/` directory. */
  readonly entryDir: string;
  /** File name of the committed Resurrection tarball in the entry. */
  readonly tarballName: string;
  /** A fresh, empty directory the replay may write to. */
  readonly workDir: string;
}

const fetchFailed = (reason: string): NightlyReplay => ({ status: "fetch-failed", reason });

export const sriSha512 = (bytes: Uint8Array): string =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/** The first path where two parsed JSON values differ, in key order of `a` then extra keys of `b`; null when equal. */
export function firstDifferingPath(a: unknown, b: unknown, at = "$"): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = firstDifferingPath(a[i], b[i], `${at}[${i}]`);
      if (d !== null) return d;
    }
    return a.length === b.length ? null : `${at}[${n}]`;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) return `${at}.${k}`;
      const d = firstDifferingPath(a[k], b[k], `${at}.${k}`);
      if (d !== null) return d;
    }
    for (const k of Object.keys(b)) if (!(k in a)) return `${at}.${k}`;
    return null;
  }
  return Object.is(a, b) ? null : at;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Byte-for-byte comparison of two canonical report texts; on a difference, the first differing path. */
export function compareReportTexts(committed: string, replayed: string): NightlyReplay {
  if (committed === replayed) return { status: "identical" };
  let diff: string | null = null;
  try {
    diff = firstDifferingPath(JSON.parse(committed), JSON.parse(replayed));
  } catch {
    diff = null;
  }
  // Same values but different bytes (key order, spacing): the root is the first differing path.
  return { status: "different", firstDiffPath: diff ?? "$" };
}

/** The proof CLI argument list of a replay: `--cases` replaced, `--radius` added (only here). */
export function replayArgv(argv: readonly string[], report: ProofReport): string[] {
  const out = [...argv];
  const i = out.indexOf("--cases");
  if (i < 0 || i + 1 >= out.length) throw new Error("the prove argument list has no --cases value");
  out[i + 1] = String(report.sandbox.limits.casesRequested);
  if (report.functionsTested.length > 0) out.push("--radius", report.functionsTested.join(","));
  return out;
}

export async function runReplay(input: ReplayInput, deps: ReplayDeps): Promise<NightlyReplay> {
  const entry = (f: string): string => path.join(input.entryDir, f);
  const work = (f: string): string => path.join(input.workDir, f);

  const reportText = deps.prove.readText(entry(ENTRY_FILES.proofReport));
  if (reportText === null) return fetchFailed(`${ENTRY_FILES.proofReport} is missing`);
  const parsed = deserializeReport(reportText);
  if (!parsed.ok) return fetchFailed(`${ENTRY_FILES.proofReport} is not a valid report`);
  const report = parsed.value;

  let original: Uint8Array;
  try {
    original = await deps.fetchOriginal(report.package.name, report.package.version);
  } catch (e) {
    return fetchFailed(`the Original could not be fetched: ${e instanceof Error ? e.message : String(e)}`);
  }
  const digest = sriSha512(original);
  if (digest !== report.original.integrity) {
    return fetchFailed(`the fetched Original has digest ${digest}, the committed report has ${report.original.integrity}`);
  }

  // Stage the entry under the names `runProve` reads.
  const tarball = deps.readBytes(entry(input.tarballName));
  if (tarball === null) return fetchFailed(`${input.tarballName} is missing`);
  for (const f of STAGED_TEXT_FILES) {
    const text = deps.prove.readText(entry(f));
    if (text === null) return fetchFailed(`${f} is missing`);
    deps.prove.writeText(work(f), text);
  }
  deps.writeBytes(work(RESURRECTION_FILE), tarball);
  deps.writeBytes(work(ORIGINAL_FILE), original);

  const proveDeps: ProveDeps = {
    ...deps.prove,
    system: { ...deps.prove.system, randomSeed: () => report.seed },
    runCli: (argv, cliDeps) => deps.prove.runCli(replayArgv(argv, report), cliDeps),
  };
  await deps.runProve(proveDeps, input.workDir);

  const replayed = deps.prove.readText(work(ENTRY_FILES.proofReport));
  if (replayed === null) return fetchFailed("the replay wrote no report");
  return compareReportTexts(reportText, replayed);
}
