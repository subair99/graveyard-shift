import type { CauseOfDeath, Status } from "../types";

export interface StatusInput {
  /** Name of a verified successor package, when one was found. */
  successor?: string;
  /** Full npm deprecation message; empty string counts as not deprecated. */
  deprecation?: string;
  causes: readonly CauseOfDeath[];
  /** Risk_Score; must be an integer in 0..100 to be usable. */
  risk: number | undefined;
}

export type StatusResult =
  | {
      status: Status;
      /**
       * Set when the status is `dead` because of a deprecation message with no
       * successor. The certificate builder records this full message as a Fact.
       */
      deprecationMessage?: string;
    }
  | { error: string };

function isValidRisk(risk: number | undefined): risk is number {
  return risk !== undefined && Number.isInteger(risk) && risk >= 0 && risk <= 100;
}

/** Pure status assignment. Precedence follows design.md "Status assignment". */
export function assignStatus(input: StatusInput): StatusResult {
  if (input.successor !== undefined && input.successor.length > 0) {
    return { status: "retired-with-successor" };
  }
  if (input.deprecation !== undefined && input.deprecation.length > 0) {
    return { status: "dead", deprecationMessage: input.deprecation };
  }
  if (input.causes.length > 0) {
    return { status: "dead" };
  }
  if (!isValidRisk(input.risk)) {
    return {
      error: `Risk_Score is missing or not an integer in 0..100 (got ${String(input.risk)}); no status assigned`,
    };
  }
  return { status: input.risk >= 40 ? "dying" : "alive" };
}
