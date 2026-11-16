// Attest decision and publish gate (R1.4, R11.2, R11.16, R11.17, R13.1 to R13.3, R13.10, R14.1, R15.1). Pure.
// The verdict gate is never cut (J10): an alive verdict is published only after a successful attest.

import type { Verdict } from "../../../proof/types";
import type { EntryKind } from "./layout";

export type JobResult = "success" | "failure" | "cancelled" | "skipped";

export interface AttestDecisionInput {
  readonly checks: JobResult;
  readonly prove: JobResult;
  readonly verdict: Verdict | null;
  readonly reportParsed: boolean;
  readonly treeHashEqual: boolean;
  readonly integrityEqual: boolean;
}

export interface PublishGateInput {
  readonly intake: JobResult;
  readonly checks: JobResult;
  readonly prove: JobResult;
  readonly attest: JobResult;
  readonly kind: EntryKind | null;
  readonly verdict: Verdict | null;
}

/** "attest" only when checks and prove succeeded, the verdict is alive, the report parsed and both hashes are equal. */
export function attestDecision(i: AttestDecisionInput): "attest" | "skip" {
  return i.checks === "success" &&
    i.prove === "success" &&
    i.verdict === "alive" &&
    i.reportParsed &&
    i.treeHashEqual &&
    i.integrityEqual
    ? "attest"
    : "skip";
}

/**
 * "publish" only when intake and checks succeeded and either the kind is not-resurrected, or the kind is
 * resurrection, prove succeeded, a verdict exists (null skips: fail closed), and the verdict is not alive or
 * attest succeeded.
 */
export function publishGate(i: PublishGateInput): "publish" | "skip" {
  if (i.intake !== "success" || i.checks !== "success") return "skip";
  if (i.kind === "not-resurrected") return "publish";
  if (i.kind !== "resurrection" || i.prove !== "success") return "skip";
  if (i.verdict === null) return "skip";
  return i.verdict !== "alive" || i.attest === "success" ? "publish" : "skip";
}
