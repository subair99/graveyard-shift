// The fixed Medium prompt. The only variable part is the package name; no other input
// (certificate text, registry text, user text) is ever put into the prompt.

import { supportedPackageNameProblem } from "../../common/packageNames";

export const MEDIUM_PROMPT_PREFIX = "Resurrect the npm package ";

/** Builds the prompt for `packageName`. Throws when the name is not a supported package name. */
export function buildMediumPrompt(packageName: string): string {
  const problem = supportedPackageNameProblem(packageName);
  if (problem !== null) {
    throw new Error(`Invalid package name for the Medium prompt: ${problem}`);
  }
  return (
    `${MEDIUM_PROMPT_PREFIX}${packageName}. ` +
    "Read the Death Certificate with your certificate tool, follow your agent instructions, " +
    "and write only resurrection/, deltas.json and harness.json at the repository root."
  );
}
