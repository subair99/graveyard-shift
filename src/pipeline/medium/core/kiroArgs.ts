// The argument list of the Medium process (R6.6): an array, never a shell string.

import { buildMediumPrompt } from "./prompt";

export const KIRO_COMMAND = "kiro-cli";
export const MEDIUM_AGENT = "medium";

export function buildKiroArgs(packageName: string): string[] {
  return ["chat", "--v3", "--no-interactive", "--require-mcp-startup", "--agent", MEDIUM_AGENT, buildMediumPrompt(packageName)];
}
