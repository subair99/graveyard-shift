import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Reporter } from "vitest/node";

/**
 * Time budget per vitest project (Requirement 15.7, 15.8).
 *
 * Pass or fail is decided in one place: this reporter, in `onTestRunEnd`. The check uses the SPAN of
 * a project, from the start of its first test file to the end of its last test file, taken from the
 * reporter hooks `onTestModuleStart` and `onTestModuleEnd` with `performance.now()` in the main
 * process. `onTestModuleQueued` is not used: vitest queues every file at the start of the run, so
 * the span would equal the whole run. The span starts when the first file begins running its tests,
 * so the import time of that first file is not in it. `TestModule.diagnostic().duration` is a per
 * file sum of test and hook durations; files run in parallel, so the sum is informational only.
 * When no span exists for a project, its check falls back to the whole-run wall-clock (from
 * `onTestRunStart` to `onTestRunEnd`), an upper bound for the project.
 *
 * A strict overrun fails the run with `process.exitCode = 1` (vitest 5.1.0 does the same for failed
 * tests and exits through `process.exit()` without an argument, which keeps the exit code). This
 * file lives in tests/, outside the determinism lint scope, so it may read the clock.
 *
 * PROOF_BUDGET_SCALE is a TEST AID ONLY (never set in CI, never for real budget measurements). It is
 * a positive number, default 1, that multiplies every target, so a strict overrun (exit code 1) and
 * a warn-mode overrun (exit code unchanged) can be confirmed without a slow suite. A value that is
 * not a finite number strictly greater than 0 is a configuration error: the run fails with exit code
 * 1 whatever PROOF_BUDGET_MODE is, and no budget is evaluated. When the scale is not 1, nothing is
 * appended to docs/kiro-journal.md (the numbers are not budget measurements).
 */

/** Targets in seconds by project name. */
export const BUDGET_SECONDS: Readonly<Record<string, number>> = {
  "proof-property": 60,
  "proof-heavy": 90,
  "proof-integration": 120,
  // A target, not a measurement (resurrection-pipeline R21.9); the first span comes from a pasted run.
  pipeline: 90,
};

/** Result of reading PROOF_BUDGET_SCALE. */
export type ScaleParse = { ok: true; scale: number } | { ok: false; message: string };

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Strict parse of PROOF_BUDGET_SCALE: unset is 1; otherwise a finite number > 0 after trimming (no parseFloat). */
export function parseBudgetScale(raw: string | undefined): ScaleParse {
  if (raw === undefined) return { ok: true, scale: 1 };
  const trimmed = raw.trim();
  const value = NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (Number.isFinite(value) && value > 0) return { ok: true, scale: value };
  return { ok: false, message: `[budget] PROOF_BUDGET_SCALE rejected: must be a positive number (got ${JSON.stringify(raw)})` };
}

/** Readable seconds for a scaled run: three significant digits, exponent notation under 0.01. */
export function formatScaledSeconds(seconds: number): string {
  if (seconds === 0) return "0";
  return seconds < 0.01 ? seconds.toExponential(2) : String(Number(seconds.toPrecision(3)));
}

export interface SpanTracker {
  start(project: string, timeMs: number): void;
  end(project: string, timeMs: number): void;
  /** Span in ms per project that has both a start and an end. Projects never seen are absent. */
  spans(): Map<string, number>;
}

/** Earliest start and latest end per project (not a sum: files run in parallel). */
export function createSpanTracker(): SpanTracker {
  const firstStart = new Map<string, number>();
  const lastEnd = new Map<string, number>();
  return {
    start(project, timeMs) {
      const known = firstStart.get(project);
      if (known === undefined || timeMs < known) firstStart.set(project, timeMs);
    },
    end(project, timeMs) {
      const known = lastEnd.get(project);
      if (known === undefined || timeMs > known) lastEnd.set(project, timeMs);
    },
    spans() {
      const result = new Map<string, number>();
      for (const [project, start] of firstStart) {
        const end = lastEnd.get(project);
        if (end !== undefined) result.set(project, Math.max(0, end - start));
      }
      return result;
    },
  };
}

export interface BudgetEvaluation {
  /** false only when the check is over target in strict mode. */
  ok: boolean;
  level: "info" | "warn" | "error";
  /** Text to warn with (warn) or fail with (error); equals the checked line when level is info. */
  message: string;
  /** Lines to print, each starting `[budget] <project>:`. */
  lines: string[];
  /** Seconds the target was checked against. */
  checkedSeconds: number;
  /** true when the span was unavailable and the whole-run wall-clock was checked. */
  usedFallback: boolean;
}

/** Pure overrun check (Requirement 15.8). `mode` is the value of PROOF_BUDGET_MODE. */
export function evaluateBudget(input: {
  project: string;
  /** Span in seconds, or undefined when it could not be measured. */
  spanSeconds: number | undefined;
  /** Sum of the file durations in seconds (info only), if known. */
  sumSeconds?: number | undefined;
  wallSeconds: number;
  /** The target to check against, already multiplied by `scale`. */
  targetSeconds: number;
  mode: string | undefined;
  /** PROOF_BUDGET_SCALE (test aid), default 1. */
  scale?: number;
}): BudgetEvaluation {
  const { project, spanSeconds, sumSeconds, wallSeconds, targetSeconds, mode } = input;
  const scale = input.scale ?? 1;
  const scaled = scale !== 1;
  const target = scaled ? formatScaledSeconds(targetSeconds) : String(targetSeconds);
  const targetText = scaled ? `${target} s = ${Number((targetSeconds / scale).toPrecision(12))} s x PROOF_BUDGET_SCALE ${scale}; test aid` : `${target} s`;
  const seconds = (n: number): string => (scaled ? formatScaledSeconds(n) : n.toFixed(1));
  const usedFallback = spanSeconds === undefined;
  const checked = spanSeconds ?? wallSeconds;
  const lines: string[] = [];
  if (spanSeconds === undefined) {
    lines.push(`[budget] ${project}: ${seconds(wallSeconds)} s whole-run wall-clock (span unavailable; checked against target ${targetText})`);
  } else {
    lines.push(`[budget] ${project}: ${seconds(spanSeconds)} s span, first test file start to last test file end (checked against target ${targetText})`);
  }
  if (sumSeconds !== undefined) {
    lines.push(`[budget] ${project}: ${sumSeconds.toFixed(1)} s sum of file durations (info only: files run in parallel, so the sum can exceed the span)`);
  }
  if (!usedFallback) {
    lines.push(`[budget] ${project}: ${wallSeconds.toFixed(1)} s whole-run wall-clock (info only: all projects run in parallel; an upper bound for this project)`);
  }
  const base = { lines, checkedSeconds: checked, usedFallback };
  if (checked <= targetSeconds) return { ...base, ok: true, level: "info", message: lines[0] ?? "" };
  const message = `${project} took ${seconds(checked)} s, over the ${target} s target${scaled ? ` (${targetText.slice(targetText.indexOf("=") + 2)})` : ""}`;
  if (mode === "warn") return { ...base, ok: true, level: "warn", message: `[budget] WARNING: ${message}` };
  return { ...base, ok: false, level: "error", message: `[budget] ${message}. Set PROOF_BUDGET_MODE=warn to downgrade.` };
}

export interface RunEvaluationInput {
  /** Projects that have at least one test file in this run, in any order. */
  projectsRun: readonly string[];
  spansMs: ReadonlyMap<string, number>;
  sumsMs: ReadonlyMap<string, number>;
  wallMs: number;
  mode: string | undefined;
  /** Validated PROOF_BUDGET_SCALE, default 1. */
  scale?: number;
}

/** Evaluates every project of the run that has a target. Projects without a target or without files are skipped. */
export function evaluateRun(input: RunEvaluationInput): Array<BudgetEvaluation & { project: string }> {
  const results: Array<BudgetEvaluation & { project: string }> = [];
  for (const project of [...new Set(input.projectsRun)].sort()) {
    const base = BUDGET_SECONDS[project];
    if (base === undefined) continue;
    const scale = input.scale ?? 1;
    const spanMs = input.spansMs.get(project);
    const sumMs = input.sumsMs.get(project);
    results.push({
      project,
      ...evaluateBudget({
        project,
        spanSeconds: spanMs === undefined ? undefined : spanMs / 1000,
        sumSeconds: sumMs === undefined ? undefined : sumMs / 1000,
        wallSeconds: input.wallMs / 1000,
        targetSeconds: base * scale,
        mode: input.mode,
        scale,
      }),
    });
  }
  return results;
}

/** Prints the evaluations and reports a strict overrun through `fail` (the reporter sets the exit code there). */
export function concludeRun(input: Omit<RunEvaluationInput, "scale"> & {
  /** Raw PROOF_BUDGET_SCALE (undefined when unset); parsed here so a bad value fails whatever the mode. */
  scaleRaw?: string | undefined;
  log: (text: string) => void;
  warn: (text: string) => void;
  fail: (text: string) => void;
  /** stderr note, used when the journal is requested but the scale is not 1. */
  note?: (text: string) => void;
  journal?: (text: string) => void;
}): void {
  const parsed = parseBudgetScale(input.scaleRaw);
  if (!parsed.ok) {
    input.fail(parsed.message);
    return;
  }
  const scale = parsed.scale;
  if (scale !== 1 && input.journal) {
    input.note?.("[budget] PROOF_BUDGET_SCALE is not 1: not writing docs/kiro-journal.md (the numbers are not budget measurements; test aid)");
  }
  for (const result of evaluateRun({ ...input, scale })) {
    for (const line of result.lines) input.log(line);
    if (scale === 1) input.journal?.(
      `\n- Timing ${new Date().toISOString()}: project ${result.project}, ${result.checkedSeconds.toFixed(1)} s ` +
        (result.usedFallback ? "whole-run wall-clock (span unavailable)" : "span") +
        `, target ${BUDGET_SECONDS[result.project]} s (span: first test file start to last test file end; projects run in parallel, do not sum).\n`,
    );
    if (result.level === "warn") input.warn(result.message);
    if (result.level === "error") input.fail(result.message);
  }
}

/** Vitest custom reporter (default export, loaded by path from vitest.config.mts). */
export default class BudgetReporter implements Reporter {
  private readonly tracker = createSpanTracker();
  private runStartMs = performance.now();

  onTestRunStart(): void {
    this.runStartMs = performance.now();
  }

  onTestModuleStart(testModule: { project: { name: string } }): void {
    this.tracker.start(testModule.project.name, performance.now());
  }

  onTestModuleEnd(testModule: { project: { name: string } }): void {
    this.tracker.end(testModule.project.name, performance.now());
  }

  onTestRunEnd(testModules: ReadonlyArray<{ project: { name: string }; diagnostic(): { duration: number } }>): void {
    const sumsMs = new Map<string, number>();
    for (const module of testModules) {
      const name = module.project.name;
      sumsMs.set(name, (sumsMs.get(name) ?? 0) + module.diagnostic().duration);
    }
    const journalFile = resolve(process.cwd(), "docs", "kiro-journal.md");
    concludeRun({
      projectsRun: [...sumsMs.keys()],
      spansMs: this.tracker.spans(),
      sumsMs,
      wallMs: performance.now() - this.runStartMs,
      mode: process.env["PROOF_BUDGET_MODE"],
      scaleRaw: process.env["PROOF_BUDGET_SCALE"],
      note: (text) => console.error(text),
      log: (text) => console.log(text),
      warn: (text) => console.warn(text),
      fail: (text) => {
        console.error(text);
        process.exitCode = 1;
      },
      ...(process.env["PROOF_LOG_TIMINGS"] === "1" ? { journal: (text: string) => appendFileSync(journalFile, text) } : {}),
    });
  }
}
