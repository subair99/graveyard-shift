// Exit code of the Proof of Life run to verdict (R12.4). Pure.

export type ProveVerdict = "alive" | "restless" | "inconclusive";

export interface ProveExitResult {
  readonly verdict: ProveVerdict;
  /** Set when the code is not 0, 1 or 2. */
  readonly harnessError?: "harness-config-error";
}

/** 0 alive, 1 restless, 2 inconclusive; any other code is inconclusive with a harness error, never alive. */
export function mapExitCode(code: number): ProveExitResult {
  if (code === 0) return { verdict: "alive" };
  if (code === 1) return { verdict: "restless" };
  if (code === 2) return { verdict: "inconclusive" };
  return { verdict: "inconclusive", harnessError: "harness-config-error" };
}
