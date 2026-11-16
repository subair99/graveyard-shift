// Logic of the `attest` job steps `prepare` and `collect` (R11.17, R13.2 to R13.6, R13.9). The decision is the
// pure attestDecision; this file reads the files, recomputes the two hashes and writes `attest/predicate.json`.
// Exit code 1 means "do not publish": a report that cannot be read, or an alive verdict that cannot be attested.

import { ProofReportSchema } from "../../../src/proof/types";
import type { ProofReport } from "../../../src/proof/types";
import { computeSri, verifyIntegrity } from "../../../src/proof/shell/integrity";
import { computeTreeHash } from "../../../src/proof/shell/treeHash";
import type { Result } from "../../../src/engine/types";
import type { ExtractedFile } from "../../../src/proof/shell/tarball/tarballExtractor";
import { attestDecision } from "../../../src/pipeline/undertaker/core/gates";
import type { JobResult } from "../../../src/pipeline/undertaker/core/gates";
import { ENTRY_FILES, bundleName } from "../../../src/pipeline/undertaker/core/layout";
import { buildPredicate, printPredicate } from "../../../src/pipeline/undertaker/core/predicate";
import { decodeText, encodeText } from "./stepSupport";
import type { Env, FileOps, StepIo } from "./stepSupport";

export const ATTEST_ENV = {
  checks: "GS_JOB_CHECKS",
  prove: "GS_JOB_PROVE",
  mediumMode: "GS_MEDIUM_MODE",
  branchCommit: "GS_BRANCH_COMMIT",
  /** sha256 (hex) of resurrection.tgz and certificate.json, from the job outputs of `intake` (V16). */
  intakeSha256Tarball: "GS_INTAKE_SHA256_TARBALL",
  intakeSha256Certificate: "GS_INTAKE_SHA256_CERTIFICATE",
  runId: "GITHUB_RUN_ID",
  runAttempt: "GITHUB_RUN_ATTEMPT",
  bundleTarball: "GS_BUNDLE_TARBALL",
  bundleReport: "GS_BUNDLE_REPORT",
  bundleCertificate: "GS_BUNDLE_CERTIFICATE",
} as const;

export const ATTEST_FILES = {
  original: "original.tgz",
  tarball: "resurrection.tgz",
  report: ENTRY_FILES.proofReport,
  certificate: ENTRY_FILES.certificate,
  predicate: "attest/predicate.json",
  bundleDir: "attest-bundles",
} as const;

/** The three attested subjects, in the order of R13.4. */
export const SUBJECTS = [ATTEST_FILES.tarball, ATTEST_FILES.report, ATTEST_FILES.certificate] as const;

export interface AttestDeps {
  readonly env: Env;
  readonly io: StepIo;
  readonly files: FileOps;
  readonly sha256: (bytes: Uint8Array) => string;
  readonly extract: (tarball: Uint8Array) => Promise<Result<ExtractedFile[], string>>;
}

/** A job result from a `needs.<job>.result` value; anything unknown counts as a failure. */
export function toJobResult(value: string | undefined): JobResult {
  return value === "success" || value === "failure" || value === "cancelled" || value === "skipped" ? value : "failure";
}

function skip(deps: AttestDeps, reason: string, exitCode: number): number {
  deps.io.setOutput("decision", "skip");
  deps.io.summary(`### Not attested\n\n${reason}`);
  (exitCode === 0 ? deps.io.log : deps.io.error)(`not attested: ${reason}`);
  return exitCode;
}

function parseReport(text: string): ProofReport | null {
  try {
    const parsed = ProofReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function manifestOf(files: readonly ExtractedFile[]): { name: string; version: string } | null {
  const manifest = files.find((f) => f.path === "package.json");
  if (manifest === undefined) return null;
  try {
    const raw = JSON.parse(decodeText(manifest.bytes)) as { name?: unknown; version?: unknown };
    return typeof raw.name === "string" && typeof raw.version === "string" ? { name: raw.name, version: raw.version } : null;
  } catch {
    return null;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Returns a reason when an expected digest is missing, malformed or different from the recomputed one; else null. */
function intakeMismatch(deps: AttestDeps, checks: readonly (readonly [string, string, Uint8Array])[]): string | null {
  for (const [file, envName, bytes] of checks) {
    const expected = deps.env[envName] ?? "";
    if (!SHA256_HEX.test(expected)) return `${envName} (the intake digest of ${file}) is missing or not a sha256`;
    if (deps.sha256(bytes) !== expected) return `${file} differs from the bytes the intake job produced`;
  }
  return null;
}

/** Step `prepare`. */
export async function prepareStep(deps: AttestDeps): Promise<number> {
  const { files, env } = deps;
  const report = parseReport(decodeText(await files.readFile(ATTEST_FILES.report)));
  if (report === null) {
    // attestDecision with reportParsed false is always "skip"; the exit code stops the publish job as well.
    return skip(deps, `${ATTEST_FILES.report} is not a valid Proof_Report`, 1);
  }
  if (report.verdict !== "alive") {
    return skip(deps, `the verdict is ${report.verdict}; only an alive verdict is attested`, 0);
  }

  const tarball = await files.readFile(ATTEST_FILES.tarball);
  const original = await files.readFile(ATTEST_FILES.original);

  // V16: the two intake files must be the bytes `intake` produced. The expected digests are job outputs of
  // `intake`, which no other job can change; the artifact copy could be replaced by a process with the token.
  const certificateBytes = await files.readFile(ATTEST_FILES.certificate);
  const mismatch = intakeMismatch(deps, [
    [ATTEST_FILES.tarball, ATTEST_ENV.intakeSha256Tarball, tarball],
    [ATTEST_FILES.certificate, ATTEST_ENV.intakeSha256Certificate, certificateBytes],
  ]);
  if (mismatch !== null) return skip(deps, mismatch, 1);

  const extracted = await deps.extract(tarball);
  const treeHash = extracted.ok ? computeTreeHash(extracted.value.map((f) => ({ path: f.path, bytes: f.bytes }))) : null;
  const manifest = extracted.ok ? manifestOf(extracted.value) : null;
  const integrity = verifyIntegrity(original, report.original.integrity);

  const decision = attestDecision({
    checks: toJobResult(env[ATTEST_ENV.checks]),
    prove: toJobResult(env[ATTEST_ENV.prove]),
    verdict: report.verdict,
    reportParsed: true,
    treeHashEqual: treeHash !== null && treeHash === report.resurrection.treeHash,
    integrityEqual: integrity.ok,
  });
  if (decision === "skip" || treeHash === null || manifest === null || !integrity.ok) {
    return skip(deps, "a job result, the Tree_Hash or the Integrity_Hash does not match the report", 1);
  }

  const bytes = {
    tarball,
    report: await files.readFile(ATTEST_FILES.report),
    certificate: certificateBytes,
  };
  const built = buildPredicate({
    package: { name: report.package.name, version: report.package.version },
    original: { integrity: computeSri(original) },
    resurrection: { name: manifest.name, version: manifest.version, treeHash },
    digests: {
      tarball: deps.sha256(bytes.tarball),
      proofReport: deps.sha256(bytes.report),
      certificate: deps.sha256(bytes.certificate),
    },
    verdict: report.verdict,
    seed: report.seed,
    toolVersions: report.toolVersions,
    branchCommit: env[ATTEST_ENV.branchCommit] ?? "",
    run: { id: env[ATTEST_ENV.runId] ?? "", attempt: env[ATTEST_ENV.runAttempt] ?? "" },
    medium: { mode: env[ATTEST_ENV.mediumMode] ?? "" },
  });
  if (!built.ok) return skip(deps, `predicate invalid at ${built.error.field}: ${built.error.message}`, 1);

  await files.writeFile(ATTEST_FILES.predicate, encodeText(printPredicate(built.value.predicate)));
  deps.io.setOutput("decision", "attest");
  deps.io.setOutput("predicate_type", built.value.predicateType);
  deps.io.setOutput("subject_tarball", ATTEST_FILES.tarball);
  deps.io.setOutput("subject_report", ATTEST_FILES.report);
  deps.io.setOutput("subject_certificate", ATTEST_FILES.certificate);
  deps.io.log(`predicate written to ${ATTEST_FILES.predicate}`);
  return 0;
}

/** Step `collect`: copies the three bundles to `attest-bundles/<subject>.sigstore.json`. */
export async function collectStep(deps: AttestDeps): Promise<number> {
  const sources: [string, string | undefined][] = [
    [ATTEST_FILES.tarball, deps.env[ATTEST_ENV.bundleTarball]],
    [ATTEST_FILES.report, deps.env[ATTEST_ENV.bundleReport]],
    [ATTEST_FILES.certificate, deps.env[ATTEST_ENV.bundleCertificate]],
  ];
  for (const [subject, source] of sources) {
    if (source === undefined || source === "") {
      deps.io.error(`no bundle path for ${subject}`);
      return 1;
    }
  }
  for (const [subject, source] of sources) {
    const bytes = await deps.files.readFile(source as string);
    await deps.files.writeFile(`${ATTEST_FILES.bundleDir}/${bundleName(subject)}`, bytes);
  }
  deps.io.log(`collected ${sources.length} bundles into ${ATTEST_FILES.bundleDir}`);
  return 0;
}

export const ATTEST_STEPS = { prepare: prepareStep, collect: collectStep } as const;
export type AttestStepName = keyof typeof ATTEST_STEPS;
export function isAttestStep(value: string | undefined): value is AttestStepName {
  return value !== undefined && Object.prototype.hasOwnProperty.call(ATTEST_STEPS, value);
}
