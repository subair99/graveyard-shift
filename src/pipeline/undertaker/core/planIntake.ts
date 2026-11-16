// Intake decision table (R11.2, R11.15). Pure.

import type { Result } from "../../../engine/types";

export const BRANCH_REQUIRED_MESSAGE = "a Resurrection_Branch is required";

export type IntakeKind = "not-resurrected" | "resurrection";

export interface PlanIntakeInput {
  readonly eligible: boolean;
  /** Null or empty when no branch was given. */
  readonly branch: string | null;
}

export interface IntakePlan {
  readonly kind: IntakeKind;
  /** The branch to read; null when none is read. */
  readonly branch: string | null;
}

export function planIntake(input: PlanIntakeInput): Result<IntakePlan, string> {
  if (!input.eligible) return { ok: true, value: { kind: "not-resurrected", branch: null } };
  if (input.branch === null || input.branch === "") return { ok: false, error: BRANCH_REQUIRED_MESSAGE };
  return { ok: true, value: { kind: "resurrection", branch: input.branch } };
}
