// Reads the committed graveyard, the ledger and the uncommitted nightly input into a SiteInput
// (crypt-ui Requirements 1.1, 1.6, 2.1 to 2.7, 2.9, 5.11, 10.6, 12.1, 12.6). All file access goes through
// the injected SiteFs. Committed input fails closed; only the nightly input degrades to a warning.

import { deserialize } from "../../engine/serialize/deserialize";
import { safeParseResult } from "../../engine/types";
import { REPO } from "../../pipeline/common/constants";
import { supportedPackageNameProblem } from "../../pipeline/common/packageNames";
import { err, ok, type Result } from "../../pipeline/common/result";
import { deserializeEligibilityRecord } from "../../pipeline/gravedigger/core/eligibility";
import { parseDeltasFile } from "../../pipeline/harness/core/deltas";
import { parseHarnessFile } from "../../pipeline/harness/core/harnessFile";
import { describeLedgerFailure, LEDGER_FILE_NAME, parseLedger } from "../../pipeline/local/core/ledger";
import {
  deriveEntryKind,
  ENTRY_FILES,
  planEntryFiles,
  StubMarkerSchema,
  type StubMarker,
} from "../../pipeline/undertaker/core/layout";
import { NightlyReportSchema } from "../../pipeline/undertaker/core/nightlyReport";
import { deserializeReport } from "../../proof/serialize/deserialize";
import type { ProofReport } from "../../proof/types";
import { checkEntryFileNames } from "../core/entryFiles";
import { NightlyRunRecordSchema } from "../core/nightlyRun";
import {
  GRAVEYARD_PATH,
  NIGHTLY_INPUT_DIR,
  NIGHTLY_REPORT_FILE,
  NIGHTLY_RUN_FILE,
} from "../core/site";
import type { DeltasFile } from "../../pipeline/harness/core/deltas";
import type { HarnessFile } from "../../pipeline/harness/core/harnessFile";
import type { EntryInput, NightlyInput, SiteInput } from "../core/viewModel";

export interface SiteFs {
  /** Sub-directory names, or null when the directory does not exist. */
  listDirs(dir: string): string[] | null;
  /** Every directory entry with its kind from lstat (no link is followed). */
  listEntries(dir: string): { name: string; kind: "file" | "directory" | "symlink" | "other" }[];
  /** File bytes, or null when the file does not exist. */
  readBytes(file: string): Uint8Array | null;
}

export interface SiteReadDeps {
  /** Repository root. */
  readonly root: string;
  readonly fs: SiteFs;
  readonly resurrectionVersion: (tarball: Uint8Array) => Promise<Result<string, string>>;
  readonly warn: (line: string) => void;
}

/** `message` names the file relative to the repository root and the failing path. */
export interface SiteReadError {
  readonly file: string;
  readonly message: string;
}

/** The name a missing tarball is reported under (the Undertaker writes `resurrection.tgz`). */
const TARBALL_FILE = "resurrection.tgz";
const BUNDLE_SUFFIX = ".sigstore.json";

const compareCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

class ReadFailure extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`${file}: ${detail}`);
  }
}

function join(...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, ""))).join("/");
}

function decodeUtf8(file: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ReadFailure(file, "(root): file is not valid UTF-8");
  }
}

function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; detail: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, detail: `(root): malformed JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function readSite(deps: SiteReadDeps): Promise<Result<SiteInput, SiteReadError>> {
  try {
    return ok(await read(deps));
  } catch (e) {
    if (e instanceof ReadFailure) return err({ file: e.file, message: e.message });
    throw e;
  }
}

async function read(deps: SiteReadDeps): Promise<SiteInput> {
  const { fs, root } = deps;
  const graveyardDir = join(root, GRAVEYARD_PATH);
  const listed = fs.listDirs(graveyardDir);
  if (listed !== null) {
    // The layout has one directory per package and nothing else: a link, a stray file or any other
    // non-directory under graveyard/ fails the read instead of being skipped.
    for (const item of fs.listEntries(graveyardDir)) {
      if (item.kind !== "directory") {
        throw new ReadFailure(`${GRAVEYARD_PATH}/${item.name}`, `not a directory (${item.kind}); links are not followed`);
      }
    }
  }
  const names = (listed ?? []).slice().sort(compareCodePoint);
  const entries: EntryInput[] = [];
  for (const name of names) entries.push(await readEntry(deps, name));

  const ledgerFile = LEDGER_FILE_NAME;
  const ledgerBytes = fs.readBytes(join(root, ledgerFile));
  if (ledgerBytes === null) throw new ReadFailure(ledgerFile, "file is missing");
  const ledger = parseLedger(decodeUtf8(ledgerFile, ledgerBytes), ledgerFile);
  if (!ledger.ok) throw new ReadFailure(ledgerFile, describeLedgerFailure(ledger.error));

  return { entries, ledger: ledger.value, nightly: readNightly(deps) };
}

async function readEntry(deps: SiteReadDeps, name: string): Promise<EntryInput> {
  const { fs, root } = deps;
  const rel = `${GRAVEYARD_PATH}/${name}`;
  const nameProblem = supportedPackageNameProblem(name);
  if (nameProblem !== null) throw new ReadFailure(rel, nameProblem);

  const items = fs.listEntries(join(root, rel));
  for (const item of items) {
    if (item.kind !== "file") {
      throw new ReadFailure(`${rel}/${item.name}`, `not a regular file (${item.kind}); links are not followed`);
    }
  }
  const files = items.map((i) => i.name).sort(compareCodePoint);
  const checked = checkEntryFileNames(files);
  if (!checked.ok) throw new ReadFailure(rel, checked.error);
  const tarballName = checked.value.tarballName;

  const bytesOf = (file: string): Uint8Array => {
    const bytes = fs.readBytes(join(root, rel, file));
    if (bytes === null) throw new ReadFailure(`${rel}/${file}`, "file is missing");
    return bytes;
  };
  const textOf = (file: string): string => decodeUtf8(`${rel}/${file}`, bytesOf(file));
  const fail = (file: string, detail: string): never => {
    throw new ReadFailure(`${rel}/${file}`, detail);
  };

  const eligibility = (() => {
    const r = deserializeEligibilityRecord(textOf(ENTRY_FILES.eligibility));
    return r.ok ? r.value : fail(ENTRY_FILES.eligibility, `${r.error.field}: ${r.error.message}`);
  })();
  const kind = deriveEntryKind(files, { eligible: eligibility.eligible });
  if (!kind.ok) throw new ReadFailure(rel, kind.error.message);

  const certificate = (() => {
    const r = deserialize(textOf(ENTRY_FILES.certificate));
    return r.ok ? r.value : fail(ENTRY_FILES.certificate, r.error.message);
  })();
  if (certificate.package.name !== name) {
    throw new ReadFailure(
      `${rel}/${ENTRY_FILES.certificate}`,
      `package.name: certificate names a different package than the directory ${name}`,
    );
  }

  let report: ProofReport | null = null;
  let deltas: DeltasFile | null = null;
  let harness: HarnessFile | null = null;
  let resurrectionVersion: string | null = null;
  if (kind.value === "resurrection") {
    const r = deserializeReport(textOf(ENTRY_FILES.proofReport));
    report = r.ok ? r.value : fail(ENTRY_FILES.proofReport, r.error.message);
    const d = parseDeltasFile(textOf(ENTRY_FILES.deltas));
    deltas = d.ok ? d.value : fail(ENTRY_FILES.deltas, d.error.issues.join("; "));
    const h = parseHarnessFile(textOf(ENTRY_FILES.harness));
    harness = h.ok ? h.value : fail(ENTRY_FILES.harness, h.error.issues.join("; "));

    // planEntryFiles (layout.ts) writes the tarball for every resurrection entry whatever the verdict.
    if (tarballName === null) throw new ReadFailure(`${rel}/${TARBALL_FILE}`, "file is missing");
    const v = await deps.resurrectionVersion(bytesOf(tarballName));
    resurrectionVersion = v.ok ? v.value : fail(tarballName, v.error);
  }

  // The non-bundle file set must be exactly what the Undertaker writes for this kind (layout.ts
  // planEntryFiles). Attestation bundles are left out: a missing or unexpected bundle is shown on the
  // Entry_Page (crypt-ui Requirement 5.6), not a read failure.
  const isBundle = (f: string): boolean => f.endsWith(BUNDLE_SUFFIX);
  const expected = planEntryFiles({
    kind: kind.value,
    verdict: report?.verdict ?? null,
    stub: files.includes(ENTRY_FILES.stubMarker),
    tarballName,
  }).filter((f) => !isBundle(f));
  for (const f of expected) if (!files.includes(f)) throw new ReadFailure(`${rel}/${f}`, "file is missing");
  for (const f of files) {
    if (!isBundle(f) && !expected.includes(f)) {
      throw new ReadFailure(`${rel}/${f}`, `unexpected file in a ${kind.value} entry`);
    }
  }

  let stubMarker: StubMarker | null = null;
  if (files.includes(ENTRY_FILES.stubMarker)) {
    const parsed = parseJsonText(textOf(ENTRY_FILES.stubMarker));
    if (!parsed.ok) return fail(ENTRY_FILES.stubMarker, parsed.detail);
    const s = safeParseResult(StubMarkerSchema, parsed.value);
    stubMarker = s.ok ? s.value : fail(ENTRY_FILES.stubMarker, s.error.issues.join("; "));
  }

  return {
    name,
    files,
    kind: kind.value,
    certificate,
    eligibility,
    report,
    deltas,
    harness,
    stubMarker,
    tarballName,
    resurrectionVersion,
  };
}

function readNightly(deps: SiteReadDeps): NightlyInput | null {
  const { fs, root, warn } = deps;
  const dir = NIGHTLY_INPUT_DIR;
  const runFile = `${dir}/${NIGHTLY_RUN_FILE}`;
  const reportFile = `${dir}/${NIGHTLY_REPORT_FILE}`;

  const readJson = (file: string): { state: "missing" } | { state: "bad"; detail: string } | { state: "ok"; value: unknown } => {
    const bytes = fs.readBytes(join(root, file));
    if (bytes === null) return { state: "missing" };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { state: "bad", detail: "(root): file is not valid UTF-8" };
    }
    const parsed = parseJsonText(text);
    return parsed.ok ? { state: "ok", value: parsed.value } : { state: "bad", detail: parsed.detail };
  };

  const runRead = readJson(runFile);
  if (runRead.state === "missing") {
    if (fs.readBytes(join(root, reportFile)) !== null) {
      warn(`${reportFile}: ignored because ${runFile} is missing`);
    }
    return null;
  }
  if (runRead.state === "bad") {
    warn(`${runFile}: ${runRead.detail}`);
    return null;
  }
  const run = safeParseResult(NightlyRunRecordSchema, runRead.value);
  if (!run.ok) {
    warn(`${runFile}: ${run.error.issues.join("; ")}`);
    return null;
  }

  const reportRead = readJson(reportFile);
  if (reportRead.state === "missing") return { run: run.value, report: null, reportState: "missing" };
  if (reportRead.state === "bad") {
    warn(`${reportFile}: ${reportRead.detail}`);
    return { run: run.value, report: null, reportState: "rejected" };
  }
  const report = safeParseResult(NightlyReportSchema, reportRead.value);
  if (!report.ok) {
    warn(`${reportFile}: ${report.error.issues.join("; ")}`);
    return { run: run.value, report: null, reportState: "rejected" };
  }
  if (report.value.repo !== REPO) {
    warn(`${reportFile}: repo: the report is for another repository`);
    return { run: run.value, report: null, reportState: "rejected" };
  }
  return { run: run.value, report: report.value, reportState: "accepted" };
}
