import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TestProject } from "vitest/node";

/**
 * Time budget per vitest project (Requirement 15.7, 15.8).
 *
 * Vitest 5.1.0: `teardown()` receives no arguments, so the project name and
 * start time are kept in module state at `setup(project)`. Each project gets
 * its own module instance. Projects run in parallel, so the measured
 * intervals overlap and must not be summed. The interval includes worker
 * start-up. This file lives in tests/, outside the determinism lint scope,
 * so it may read the clock.
 */

/** Targets in seconds by project name. */
export const BUDGET_SECONDS: Readonly<Record<string, number>> = {
  "proof-property": 60,
  "proof-integration": 120,
};

let projectName = "unknown";
let startedAt = 0;

export function setup(project: TestProject): void {
  projectName = project.name;
  startedAt = performance.now();
}

export interface BudgetEvaluation {
  /** false only when the run is over target in strict mode (teardown throws). */
  ok: boolean;
  level: "info" | "warn" | "error";
  /** Text to log (info, warn) or to throw (error). */
  message: string;
  /** The always-printed timing line. */
  line: string;
}

/** Pure overrun check (Requirement 15.8). `mode` is the value of PROOF_BUDGET_MODE. */
export function evaluateBudget(input: {
  project: string;
  elapsedSeconds: number;
  targetSeconds: number | undefined;
  mode: string | undefined;
}): BudgetEvaluation {
  const { project, elapsedSeconds: seconds, targetSeconds: target, mode } = input;
  // Projects run in parallel, so this is the whole run's wall-clock, an upper
  // bound for the project, not its own cost.
  const line = `[budget] ${project}: ${seconds.toFixed(1)} s whole-run wall-clock, ` +
    "upper bound for this project" +
    (target === undefined ? " (no target)" : ` (target ${target} s)`);
  if (target === undefined || seconds <= target) return { ok: true, level: "info", message: line, line };
  const message = `${project} took ${seconds.toFixed(1)} s, over the ${target} s target`;
  if (mode === "warn") return { ok: true, level: "warn", message: `[budget] WARNING: ${message}`, line };
  return { ok: false, level: "error", message: `[budget] ${message}. Set PROOF_BUDGET_MODE=warn to downgrade.`, line };
}

/** Reports one project's timing; throws on a strict overrun. `journal` is called with the timing entry, if given. */
export function concludeBudget(input: {
  project: string;
  elapsedSeconds: number;
  mode: string | undefined;
  log: (text: string) => void;
  warn: (text: string) => void;
  journal?: (text: string) => void;
}): void {
  const target = BUDGET_SECONDS[input.project];
  const result = evaluateBudget({
    project: input.project,
    elapsedSeconds: input.elapsedSeconds,
    targetSeconds: target,
    mode: input.mode,
  });
  input.log(result.line);
  input.journal?.(
    `\n- Timing ${new Date().toISOString()}: project ${input.project}, ${input.elapsedSeconds.toFixed(1)} s wall-clock` +
      (target === undefined ? "" : `, target ${target} s`) +
      " (includes worker start-up; projects run in parallel, do not sum).\n",
  );
  if (result.level === "warn") input.warn(result.message);
  if (result.level === "error") throw new Error(result.message);
}

export function teardown(): void {
  const journalFile = resolve(process.cwd(), "docs", "kiro-journal.md");
  concludeBudget({
    project: projectName,
    elapsedSeconds: (performance.now() - startedAt) / 1000,
    mode: process.env["PROOF_BUDGET_MODE"],
    log: (text) => console.log(text),
    warn: (text) => console.warn(text),
    ...(process.env["PROOF_LOG_TIMINGS"] === "1" ? { journal: (text: string) => appendFileSync(journalFile, text) } : {}),
  });
}