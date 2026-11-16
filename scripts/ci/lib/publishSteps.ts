// Logic of the `publish` job steps `gate`, `build-entry` and `push-pr` (R14.1, R14.7, R15.1 to R15.6).
// Files come from `work/` (all downloaded artifacts merged into one directory), `attest-bundles/` and
// `attest/predicate.json`. Side effects are injected through PublishDeps (fs, sha256, runner, summary).

import { ProofReportSchema, VerdictSchema } from "../../../src/proof/types";
import type { ProofReport, Verdict } from "../../../src/proof/types";
import type { Result } from "../../../src/engine/types";
import type { ExtractedFile } from "../../../src/proof/shell/tarball/tarballExtractor";
import { identityValuesFromEnv } from "../../../src/proof/core/identity";
import { supportedPackageNameProblem } from "../../../src/pipeline/common/packageNames";
import { deserializeEligibilityRecord } from "../../../src/pipeline/gravedigger/core/eligibility";
import type { EligibilityRecord } from "../../../src/pipeline/gravedigger/core/eligibility";
import { publishGate } from "../../../src/pipeline/undertaker/core/gates";
import { ENTRY_FILES } from "../../../src/pipeline/undertaker/core/layout";
import type { EntryKind } from "../../../src/pipeline/undertaker/core/layout";
import { renderPrBody, renderPrTitle } from "../../../src/pipeline/undertaker/core/prText";
import type { PrFailedRule, PrInput } from "../../../src/pipeline/undertaker/core/prText";
import { buildEntry, pushPr } from "../../../src/pipeline/undertaker/shell/publish";
import type { PublishDeps } from "../../../src/pipeline/undertaker/shell/publish";
import { toJobResult } from "./attestSteps";
import { decodeText } from "./stepSupport";
import type { Env, StepIo } from "./stepSupport";

export const PUBLISH_ENV = {
  intake: "GS_JOB_INTAKE",
  checks: "GS_JOB_CHECKS",
  prove: "GS_JOB_PROVE",
  attest: "GS_JOB_ATTEST",
  kind: "GS_KIND",
  verdict: "GS_VERDICT",
  package: "GS_PACKAGE",
  mediumMode: "GS_MEDIUM_MODE",
  branchCommit: "GS_BRANCH_COMMIT",
  runUrl: "GS_RUN_URL",
  runId: "GITHUB_RUN_ID",
  runAttempt: "GITHUB_RUN_ATTEMPT",
} as const;

export const PUBLISH_PATHS = {
  sourceDir: "work",
  bundleDir: "attest-bundles",
  predicate: "attest/predicate.json",
  entryRoot: "graveyard",
  bodyFile: "pr-body.md",
  tarballName: "resurrection.tgz",
} as const;

export interface PublishStepDeps {
  readonly env: Env;
  readonly io: StepIo;
  readonly publish: PublishDeps;
  readonly extract: (tarball: Uint8Array) => Promise<Result<ExtractedFile[], string>>;
}

function parseKind(value: string | undefined): EntryKind | null {
  return value === "resurrection" || value === "not-resurrected" ? value : null;
}

function parseVerdict(value: string | undefined): Verdict | null {
  const parsed = VerdictSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Step `gate`: output `publish` is `true` or `false`. */
export async function gateStep(deps: PublishStepDeps): Promise<number> {
  const env = deps.env;
  const decision = publishGate({
    intake: toJobResult(env[PUBLISH_ENV.intake]),
    checks: toJobResult(env[PUBLISH_ENV.checks]),
    prove: toJobResult(env[PUBLISH_ENV.prove]),
    attest: toJobResult(env[PUBLISH_ENV.attest]),
    kind: parseKind(env[PUBLISH_ENV.kind]),
    verdict: parseVerdict(env[PUBLISH_ENV.verdict]),
  });
  deps.io.setOutput("publish", decision === "publish" ? "true" : "false");
  deps.io.log(`publish gate: ${decision}`);
  return 0;
}

function readPackage(deps: PublishStepDeps): string | null {
  const name = deps.env[PUBLISH_ENV.package] ?? "";
  return name !== "" && supportedPackageNameProblem(name) === null ? name : null;
}

function fail(deps: PublishStepDeps, message: string): number {
  deps.io.error(message);
  deps.io.summary(`### Publish failed\n\n${message}`);
  return 1;
}

/** Step `build-entry`. */
export async function buildEntryStep(deps: PublishStepDeps): Promise<number> {
  const name = readPackage(deps);
  const kind = parseKind(deps.env[PUBLISH_ENV.kind]);
  if (name === null || kind === null) return fail(deps, "the package or the kind is missing or invalid");
  const verdict = kind === "resurrection" ? parseVerdict(deps.env[PUBLISH_ENV.verdict]) : null;
  if (kind === "resurrection" && verdict === null) return fail(deps, "the verdict is missing or invalid");
  const built = await buildEntry(
    {
      package: name,
      kind,
      verdict,
      stub: deps.env[PUBLISH_ENV.mediumMode] === "stub",
      tarballName: kind === "resurrection" ? PUBLISH_PATHS.tarballName : null,
      sourceDir: PUBLISH_PATHS.sourceDir,
      bundleDir: PUBLISH_PATHS.bundleDir,
      predicatePath: PUBLISH_PATHS.predicate,
      entryRoot: PUBLISH_PATHS.entryRoot,
    },
    deps.publish,
  );
  if (!built.ok) return fail(deps, built.error);
  deps.io.log(`entry ${built.value.entryDir}: ${built.value.files.join(", ")}`);
  return 0;
}

function parseReport(text: string): ProofReport | null {
  try {
    const parsed = ProofReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The failed rules with the source URL and fetch date of the fact that recorded each one. */
export function failedRulesOf(record: EligibilityRecord): { rules: PrFailedRule[]; unsourced: string[] } {
  const rules: PrFailedRule[] = [];
  const unsourced: string[] = [];
  const fallback = record.facts.find((f) => f.key === "integrity.expected")?.provenance[0];
  for (const id of record.failedRules) {
    const fact = record.facts.find((f) => f.key === `rule.${id}`);
    const source = fact?.provenance[0] ?? fallback;
    const observed = record.rules.find((r) => r.rule === id)?.observed ?? null;
    if (source === undefined) unsourced.push(id);
    else rules.push({ rule: id, observed, sourceUrl: source.sourceUrl, fetchedAt: source.fetchedAt });
  }
  return { rules, unsourced };
}

/** Step `push-pr`. */
export async function pushPrStep(deps: PublishStepDeps): Promise<number> {
  const { env } = deps;
  const name = readPackage(deps);
  const kind = parseKind(env[PUBLISH_ENV.kind]);
  if (name === null || kind === null) return fail(deps, "the package or the kind is missing or invalid");
  const runId = Number(env[PUBLISH_ENV.runId]);
  const runAttempt = Number(env[PUBLISH_ENV.runAttempt]);
  const platform = process.platform === "win32" ? "win32" : "posix";
  const common = {
    package: name,
    runUrl: env[PUBLISH_ENV.runUrl] ?? "",
    stub: env[PUBLISH_ENV.mediumMode] === "stub",
    identity: identityValuesFromEnv(env, platform),
    platform,
  } as const;
  const fs = deps.publish.fs;
  const source = (file: string): string => `${PUBLISH_PATHS.sourceDir}/${file}`;

  let input: PrInput;
  if (kind === "resurrection") {
    const report = parseReport(decodeText(await fs.readFile(source(ENTRY_FILES.proofReport))));
    if (report === null) return fail(deps, `${ENTRY_FILES.proofReport} is not a valid Proof_Report`);
    const extracted = await deps.extract(await fs.readFile(source(PUBLISH_PATHS.tarballName)));
    const manifest = extracted.ok ? extracted.value.find((f) => f.path === "package.json") : undefined;
    let version: unknown;
    try {
      version = manifest === undefined ? undefined : (JSON.parse(decodeText(manifest.bytes)) as { version?: unknown }).version;
    } catch {
      version = undefined;
    }
    if (typeof version !== "string") return fail(deps, "the Resurrection version could not be read");
    input = {
      ...common,
      kind: "resurrection",
      version,
      verdict: report.verdict,
      report,
      branchCommit: env[PUBLISH_ENV.branchCommit] ?? "",
      subjects: [PUBLISH_PATHS.tarballName, ENTRY_FILES.proofReport, ENTRY_FILES.certificate],
      subjectPrefix: `${PUBLISH_PATHS.entryRoot}/${name}/`,
    };
  } else {
    const record = deserializeEligibilityRecord(decodeText(await fs.readFile(source(ENTRY_FILES.eligibility))));
    if (!record.ok) return fail(deps, `${ENTRY_FILES.eligibility} is not valid: ${record.error.field}`);
    const { rules, unsourced } = failedRulesOf(record.value);
    const reasons = [
      ...(record.value.reason === undefined ? [] : [record.value.reason]),
      ...(unsourced.length === 0 ? [] : [`no source recorded for ${unsourced.join(", ")}`]),
    ];
    input = {
      ...common,
      kind: "not-resurrected",
      version: record.value.package.version,
      failedRules: rules,
      ...(reasons.length === 0 ? {} : { reason: reasons.join("; ") }),
    };
  }

  const pushed = await pushPr(
    {
      package: name,
      runId,
      runAttempt,
      title: renderPrTitle(input),
      body: renderPrBody(input),
      bodyFile: PUBLISH_PATHS.bodyFile,
      entryRoot: PUBLISH_PATHS.entryRoot,
    },
    deps.publish,
  );
  if (!pushed.ok) return fail(deps, pushed.error);
  deps.io.setOutput("branch", pushed.value.branch);
  if (pushed.value.url !== null) deps.io.setOutput("pr_url", pushed.value.url);
  deps.io.log(`pull request opened from ${pushed.value.branch}`);
  return 0;
}

export const PUBLISH_STEPS = { gate: gateStep, "build-entry": buildEntryStep, "push-pr": pushPrStep } as const;
export type PublishStepName = keyof typeof PUBLISH_STEPS;
export function isPublishStep(value: string | undefined): value is PublishStepName {
  return value !== undefined && Object.prototype.hasOwnProperty.call(PUBLISH_STEPS, value);
}
