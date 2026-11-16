// Nightly classification of one Graveyard_Entry (R16.3 to R16.5, R16.7, R16.8, R16.11 to R16.13, R16.16, R16.18, R16.22, R16.23). Pure.

import type { Verdict } from "../../../proof/types";
import type { EntryKind } from "./layout";

export type NightlyResult =
  | "verified"
  | "replay-mismatch"
  | "tool-versions-changed"
  | "attestation-failed"
  | "unexpected-attestation"
  | "new-advisory"
  | "not-resurrected"
  | "not-checked";

export interface ToolVersions {
  readonly node: string;
  readonly fastCheck: string;
  readonly reportSchema: number;
}

export type ToolVersionField = keyof ToolVersions;

export interface NightlyReplay {
  readonly status: "identical" | "different" | "not-run" | "fetch-failed";
  readonly firstDiffPath?: string;
  readonly reason?: string;
}

export interface NightlyInput {
  readonly kind: EntryKind;
  /** True for an entry produced by a stub run (R23.14). Carried for the report; it does not change the classification. */
  readonly stub: boolean;
  readonly verdict: Verdict | null;
  /** Tool_Versions of the committed proof-report.json, or null when the entry has none. */
  readonly committedTools: ToolVersions | null;
  readonly runningTools: ToolVersions;
  readonly replay: NightlyReplay;
  readonly bundlesPresent: boolean;
  readonly attestations: "not-applicable" | readonly ("ok" | "failed")[];
  readonly newAdvisoryIds: readonly string[];
}

export interface NightlyClassification {
  readonly results: NightlyResult[];
  readonly fails: boolean;
}

/** The fixed order of the results of one entry (the first listed one is the primary result). */
export const NIGHTLY_RESULT_ORDER: readonly NightlyResult[] = [
  "tool-versions-changed",
  "unexpected-attestation",
  "attestation-failed",
  "replay-mismatch",
  "not-checked",
  "new-advisory",
  "verified",
  "not-resurrected",
];

/** Results that fail the workflow run (R16.16). */
export const NIGHTLY_FAILING_RESULTS: readonly NightlyResult[] = [
  "replay-mismatch",
  "attestation-failed",
  "unexpected-attestation",
];

const TOOL_FIELDS: readonly ToolVersionField[] = ["node", "fastCheck", "reportSchema"];

/** Fields that differ between the committed and the running Tool_Versions. A missing committed record differs in every field. */
export function differingToolFields(committed: ToolVersions | null, running: ToolVersions): ToolVersionField[] {
  if (committed === null) return [...TOOL_FIELDS];
  return TOOL_FIELDS.filter((f) => committed[f] !== running[f]);
}

/** Exactly three attestations: resurrection.tgz, proof-report.json, certificate.json (R16.9). Any other count fails closed. */
const REQUIRED_ATTESTATIONS = 3;

export function classifyEntry(i: NightlyInput): NightlyClassification {
  const found = new Set<NightlyResult>();

  if (i.kind === "not-resurrected") {
    if (i.bundlesPresent) found.add("unexpected-attestation");
    if (i.newAdvisoryIds.length > 0) found.add("new-advisory");
    if (found.size === 0) found.add("not-resurrected");
  } else {
    const toolsDiffer = differingToolFields(i.committedTools, i.runningTools).length > 0;
    if (toolsDiffer) found.add("tool-versions-changed");
    else if (i.replay.status === "different") found.add("replay-mismatch");
    else if (i.replay.status === "fetch-failed") found.add("not-checked");

    if (i.verdict !== "alive" && i.bundlesPresent) found.add("unexpected-attestation");
    if (
      i.verdict === "alive" &&
      (i.attestations === "not-applicable" ||
        i.attestations.length !== REQUIRED_ATTESTATIONS ||
        i.attestations.some((a) => a !== "ok"))
    ) {
      found.add("attestation-failed");
    }
    if (i.newAdvisoryIds.length > 0) found.add("new-advisory");
    if (found.size === 0) found.add("verified");
  }

  const results = NIGHTLY_RESULT_ORDER.filter((r) => found.has(r));
  return { results, fails: results.some((r) => NIGHTLY_FAILING_RESULTS.includes(r)) };
}

/** Ascending code-point comparison of two package names (R16.3). Not locale-aware. */
export function compareCodePoint(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let k = 0; k < n; k++) {
    const d = (x[k] as string).codePointAt(0)! - (y[k] as string).codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Package names in ascending code-point order; the input is not modified. */
export function nightlyOrder(names: readonly string[]): string[] {
  return [...names].sort(compareCodePoint);
}
