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

export function teardown(): void {
  const elapsedMs = performance.now() - startedAt;
  const seconds = elapsedMs / 1000;
  const target = BUDGET_SECONDS[projectName];
  const line = `[budget] ${projectName}: ${seconds.toFixed(1)} s wall-clock` +
    (target === undefined ? " (no target)" : ` (target ${target} s)`);
  console.log(line);

  if (process.env["PROOF_LOG_TIMINGS"] === "1") {
    const journal = resolve(process.cwd(), "docs", "kiro-journal.md");
    const date = new Date().toISOString();
    appendFileSync(
      journal,
      `\n- Timing ${date}: project ${projectName}, ${seconds.toFixed(1)} s wall-clock` +
        (target === undefined ? "" : `, target ${target} s`) +
        " (includes worker start-up; projects run in parallel, do not sum).\n",
    );
  }

  if (target !== undefined && seconds > target) {
    const message = `${projectName} took ${seconds.toFixed(1)} s, over the ${target} s target`;
    if (process.env["PROOF_BUDGET_MODE"] === "warn") {
      console.warn(`[budget] WARNING: ${message}`);
    } else {
      throw new Error(`[budget] ${message}. Set PROOF_BUDGET_MODE=warn to downgrade.`);
    }
  }
}
