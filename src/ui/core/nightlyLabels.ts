// Site-owned labels of the nightly results (crypt-ui Requirements 12.3, 12.5). Pure.
// The report's `reason` is shown together with the label, not instead of it.

import type { Verdict } from "../../proof/types";
import type { NightlyResult } from "../../pipeline/undertaker/core/nightlyClassify";

export const VERIFIED_LABEL_ALIVE = "replay identical and all three attestations verified by the nightly run";
export const VERIFIED_LABEL_NOT_ALIVE = "replay identical; no attestation for this Verdict";

const FIXED_LABELS: Readonly<Record<Exclude<NightlyResult, "verified">, string>> = {
  "replay-mismatch": "the replay produced a report that differs from the committed one",
  "tool-versions-changed": "the tool versions differ from the committed ones; the replay was not run",
  "attestation-failed": "an attestation did not verify, or fewer than three were found",
  "unexpected-attestation": "attestation bundles exist for an entry that is not alive",
  "new-advisory": "the nightly Coroner found an advisory that the committed certificate does not list",
  "not-resurrected": "not resurrected; nothing to replay or attest",
  "not-checked": "the check could not be completed",
};

export function nightlyLabel(result: NightlyResult, verdict: Verdict | null): string {
  if (result === "verified") return verdict === "alive" ? VERIFIED_LABEL_ALIVE : VERIFIED_LABEL_NOT_ALIVE;
  return FIXED_LABELS[result];
}
