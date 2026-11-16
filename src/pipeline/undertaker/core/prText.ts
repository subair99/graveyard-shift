// Pull request title and body (R15.2 to R15.5, R15.9 to R15.12, R18.1, R18.5, R23.12). Pure.
// Every rendered text passes redactText. No template contains a time or a credit number.

import type { ProofReport, Verdict } from "../../../proof/types";
import { redactText } from "../../common/canonical";
import type { IdentityValues, Platform } from "../../common/canonical";
import { verifyCommands } from "./verifyCommands";

/** Decision D3: true under both readings of how the workflow token starts workflows. */
export const EXISTING_CI_SENTENCE =
  "The existing CI workflow may not run for this pull request, or may wait for approval, because the pull request was opened with the workflow token. The checks listed above ran in the dispatch run.";

/** R15.12: the reviewer can start the existing CI by hand. */
export const EXISTING_CI_DISPATCH_SENTENCE =
  "The existing CI workflow has a workflow_dispatch trigger, so it can be run by hand on this branch.";

/** Assumption A12: what an attestation proves. */
export const ATTESTATION_SCOPE_SENTENCE =
  "A successful verification proves which workflow run of this repository signed which digests. It does not prove that the content of the predicate is true.";

export const NOT_ATTESTED_SENTENCE =
  "This entry is not attested and is not a successful resurrection.";

export const NOT_RESURRECTED_SENTENCE = "Nothing was resurrected, proven or attested.";

export const STUB_NOTICE =
  "This is a stub run: it was produced from a committed fixture and not by the Medium.";

const CHECK_NAMES = ["typecheck", "lint", "full test suite"] as const;

/** Fields of the Proof_Report that the text reads. */
export type PrReport = Pick<
  ProofReport,
  "seed" | "toolVersions" | "casesPerFunction" | "deltas" | "divergences" | "harnessErrors"
>;

export interface PrFailedRule {
  rule: string;
  observed: string | number | boolean | null;
  sourceUrl: string;
  fetchedAt: string;
}

interface PrCommon {
  package: string;
  /** Link to the workflow run. */
  runUrl: string;
  stub: boolean;
  identity: IdentityValues;
  platform: Platform;
}

export interface ResurrectionPrInput extends PrCommon {
  kind: "resurrection";
  /** The exact Resurrection version. */
  version: string;
  verdict: Verdict;
  report: PrReport;
  branchCommit: string;
  /** The three attested subjects, with `subjectPrefix` (for example `graveyard/ip/`) put before each. */
  subjects: readonly string[];
  subjectPrefix?: string;
}

export interface NotResurrectedPrInput extends PrCommon {
  kind: "not-resurrected";
  /** The exact Original version. */
  version: string;
  failedRules: readonly PrFailedRule[];
  /** Set when the integrity check failed and no rule could be judged. */
  reason?: string;
}

export type PrInput = ResurrectionPrInput | NotResurrectedPrInput;

function plain(value: string | number | boolean | null): string {
  return value === null ? "null" : String(value);
}

function renderTitle(i: PrInput): string {
  const head =
    i.kind === "resurrection"
      ? `${i.package} ${i.version}: ${i.verdict}`
      : `${i.package} ${i.version}: not resurrected`;
  return i.stub ? `${head} (stub run)` : head;
}

export function renderPrTitle(i: PrInput): string {
  return redactText(renderTitle(i), i.identity, i.platform);
}

function checkLines(runUrl: string): string[] {
  return [
    "## Checks",
    ...CHECK_NAMES.map((n) => `- ${n}: passed (${runUrl})`),
    "",
    EXISTING_CI_SENTENCE,
    EXISTING_CI_DISPATCH_SENTENCE,
  ];
}

function resurrectionLines(i: ResurrectionPrInput): string[] {
  const r = i.report;
  const lines: string[] = [];
  lines.push(
    `Verdict: ${i.verdict}`,
    `Seed: ${r.seed}`,
    `Tool versions: node ${r.toolVersions.node}, fast-check ${r.toolVersions.fastCheck}, report schema ${r.toolVersions.reportSchema}`,
    `Branch commit: ${i.branchCommit}`,
    `Workflow run: ${i.runUrl}`,
    "",
    "## Cases per function",
    ...(r.casesPerFunction.length === 0
      ? ["- none"]
      : r.casesPerFunction.map((c) => `- ${c.function}: ${c.cases}`)),
    "",
    "## Declared deltas",
    ...(r.deltas.length === 0
      ? ["- none"]
      : r.deltas.map(
          (d) =>
            `- ${d.id} (${d.function}): ${d.status === "demonstrated" ? "demonstrated" : "not demonstrated"}`,
        )),
    "",
  );
  if (i.verdict === "alive") {
    const cmds = verifyCommands({
      subjects: i.subjects.map((name) => ({ name })),
      ...(i.subjectPrefix === undefined ? {} : { prefix: i.subjectPrefix }),
    });
    lines.push(
      "## Verify",
      "Requires gh 2.67.0 or later. Read the JSON output; do not rely on the exit status alone.",
      "```sh",
      ...cmds,
      "```",
      ATTESTATION_SCOPE_SENTENCE,
      "",
    );
  } else {
    lines.push("## Not attested", NOT_ATTESTED_SENTENCE, "");
    const findings: string[] = [];
    for (const d of r.divergences) {
      const paths = "differences" in d ? d.differences.map((x) => `${x.part} at ${x.path}`).join(", ") : "";
      const detail =
        d.kind === "api-surface"
          ? `api-surface difference in export ${d.apiSurface.export}`
          : `${d.kind}${d.deltaId === undefined ? "" : ` ${d.deltaId}`}${paths === "" ? "" : ` (${paths})`}`;
      findings.push(`- Divergence in ${d.function}: ${detail}`);
    }
    for (const d of r.deltas) {
      if (d.status === "not-demonstrated") {
        findings.push(`- Delta ${d.id} (${d.function}) was not demonstrated`);
      }
    }
    for (const e of r.harnessErrors) {
      findings.push(`- Harness error ${e.kind}${e.function === undefined ? "" : ` in ${e.function}`}: ${e.message}`);
    }
    lines.push("## Findings", ...(findings.length === 0 ? ["- none recorded"] : findings), "");
  }
  return lines;
}

function notResurrectedLines(i: NotResurrectedPrInput): string[] {
  const lines: string[] = [];
  lines.push("## Failed eligibility rules");
  if (i.failedRules.length === 0) {
    lines.push(`- none listed${i.reason === undefined ? "" : ` (reason: ${i.reason})`}`);
  } else {
    for (const f of i.failedRules) {
      lines.push(
        `- ${f.rule}: observed ${plain(f.observed)} (source: ${f.sourceUrl}, fetched ${f.fetchedAt})`,
      );
    }
  }
  lines.push("", `Workflow run: ${i.runUrl}`, "", NOT_RESURRECTED_SENTENCE, "");
  return lines;
}

export function renderPrBody(i: PrInput): string {
  const lines: string[] = [];
  if (i.stub) lines.push(STUB_NOTICE, "");
  if (i.kind === "resurrection") lines.push(...resurrectionLines(i));
  else lines.push(...notResurrectedLines(i));
  lines.push(...checkLines(i.runUrl), "");
  return redactText(lines.join("\n"), i.identity, i.platform);
}
