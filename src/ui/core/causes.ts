// Cause_Label_Table (crypt-ui Requirement 4.2; labels from autopsy-engine R5.1 to R5.5). Pure.

import type { CauseOfDeath } from "../../engine/types";

export const CAUSE_LABELS: Readonly<Record<CauseOfDeath, string>> = {
  "maintainer-gone": "the npm registry lists no maintainer",
  "repo-archived": "the GitHub repository is archived",
  "unpatched-cve": "at least one known vulnerability has no fix in a published version",
  "runtime-rot": "no release within the dormancy threshold, and no repository push within it or none recorded",
};

/** The code unchanged, with its label; an unknown code gets `label: null` and is shown as itself. */
export function causeView(code: string): { code: string; label: string | null } {
  const label = Object.prototype.hasOwnProperty.call(CAUSE_LABELS, code)
    ? CAUSE_LABELS[code as CauseOfDeath]
    : null;
  return { code, label };
}
