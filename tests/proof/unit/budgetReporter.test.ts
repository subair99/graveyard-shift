/**
 * Budget check per project, on the span of its test files (Requirement 15.8). Spans and clocks are
 * injected, so no slow suite runs and the journal is never written.
 */
// Requirements: 15.7, 15.8
import { describe, expect, it } from "vitest";
import { BUDGET_SECONDS, concludeRun, createSpanTracker, evaluateBudget, evaluateRun, parseBudgetScale } from "../helpers/budgetReporter";

const spanAt = (project: string, spanSeconds: number, mode?: string) =>
  evaluateBudget({ project, spanSeconds, wallSeconds: 500, targetSeconds: BUDGET_SECONDS[project] ?? 0, mode });

describe("budget check on the span", () => {
  it("has the targets 60 s, 90 s, 120 s, 90 s (pipeline) and 120 s (pipeline-integration)", () => {
    expect(BUDGET_SECONDS).toEqual({ "proof-property": 60, "proof-heavy": 90, "proof-integration": 120, pipeline: 90, "pipeline-integration": 120 });
  });

  it("checks the span, not the whole-run wall-clock", () => {
    const r = spanAt("proof-property", 12.34);
    expect(r).toMatchObject({ ok: true, level: "info", checkedSeconds: 12.34, usedFallback: false });
    expect(r.lines).toEqual([
      "[budget] proof-property: 12.3 s span, first test file start to last test file end (checked against target 60 s)",
      "[budget] proof-property: 500.0 s whole-run wall-clock (info only: all projects run in parallel; an upper bound for this project)",
    ]);
  });

  it("prints the sum as information only", () => {
    const r = evaluateBudget({ project: "proof-heavy", spanSeconds: 40, sumSeconds: 104.8, wallSeconds: 54.7, targetSeconds: 90, mode: undefined });
    expect(r.lines[1]).toBe(
      "[budget] proof-heavy: 104.8 s sum of file durations (info only: files run in parallel, so the sum can exceed the span)",
    );
    expect(r.ok).toBe(true);
  });

  it.each(["proof-property", "proof-heavy", "proof-integration", "pipeline", "pipeline-integration"])("%s: exactly at target is ok", (project) => {
    expect(spanAt(project, BUDGET_SECONDS[project] ?? 0)).toMatchObject({ ok: true, level: "info" });
  });

  it.each(["proof-property", "proof-heavy", "proof-integration", "pipeline", "pipeline-integration"])("%s: over target in strict mode is an error", (project) => {
    const target = BUDGET_SECONDS[project] ?? 0;
    const r = spanAt(project, target + 0.5);
    expect(r).toMatchObject({ ok: false, level: "error" });
    expect(r.message).toBe(
      `[budget] ${project} took ${(target + 0.5).toFixed(1)} s, over the ${target} s target. Set PROOF_BUDGET_MODE=warn to downgrade.`,
    );
  });

  it.each([undefined, "", "strict", "WARN", "1"])("over target in strict mode (%s) is an error", (mode) => {
    expect(spanAt("proof-integration", 120.5, mode)).toMatchObject({ ok: false, level: "error" });
  });

  it.each(["proof-property", "proof-heavy", "proof-integration", "pipeline", "pipeline-integration"])("%s: over target in warn mode warns and does not fail", (project) => {
    const target = BUDGET_SECONDS[project] ?? 0;
    const r = spanAt(project, target + 1, "warn");
    expect(r).toMatchObject({ ok: true, level: "warn" });
    expect(r.message).toBe(`[budget] WARNING: ${project} took ${(target + 1).toFixed(1)} s, over the ${target} s target`);
  });

  it("a long whole-run wall-clock does not fail a project whose span is under target", () => {
    expect(evaluateBudget({ project: "proof-property", spanSeconds: 30, wallSeconds: 300, targetSeconds: 60, mode: undefined }).ok).toBe(true);
  });

  it("falls back to the whole-run wall-clock when the span is unavailable, and says so", () => {
    const r = evaluateBudget({ project: "proof-property", spanSeconds: undefined, wallSeconds: 54.7, targetSeconds: 60, mode: undefined });
    expect(r).toMatchObject({ ok: true, usedFallback: true, checkedSeconds: 54.7 });
    expect(r.lines).toEqual(["[budget] proof-property: 54.7 s whole-run wall-clock (span unavailable; checked against target 60 s)"]);
    const over = evaluateBudget({ project: "proof-property", spanSeconds: undefined, wallSeconds: 61, targetSeconds: 60, mode: undefined });
    expect(over).toMatchObject({ ok: false, level: "error", usedFallback: true });
  });
});

describe("evaluateRun and concludeRun", () => {
  const spansMs = new Map([["proof-property", 30000]]);
  const sumsMs = new Map([["proof-property", 90000], ["proof-heavy", 1000], ["engine", 5000]]);

  it("evaluates only projects that ran and have a target; falls back for a project without a span", () => {
    const results = evaluateRun({ projectsRun: ["engine", "proof-heavy", "proof-property"], spansMs, sumsMs, wallMs: 54700, mode: undefined });
    expect(results.map((r) => r.project)).toEqual(["proof-heavy", "proof-property"]);
    expect(results.map((r) => r.usedFallback)).toEqual([true, false]);
  });

  it("does not evaluate a project without files", () => {
    const results = evaluateRun({ projectsRun: ["proof-property"], spansMs, sumsMs, wallMs: 1000, mode: undefined });
    expect(results.map((r) => r.project)).toEqual(["proof-property"]);
    expect(evaluateRun({ projectsRun: ["engine"], spansMs, sumsMs, wallMs: 1000, mode: undefined })).toEqual([]);
  });

  function conclude(mode: string | undefined, span: number) {
    const logs: string[] = [];
    const warns: string[] = [];
    const fails: string[] = [];
    concludeRun({
      projectsRun: ["proof-property"],
      spansMs: new Map([["proof-property", span]]),
      sumsMs,
      wallMs: 5000,
      mode,
      log: (t) => logs.push(t),
      warn: (t) => warns.push(t),
      fail: (t) => fails.push(t),
    });
    return { logs, warns, fails };
  }

  it("a strict overrun is reported through fail once, after the lines are logged", () => {
    const c = conclude(undefined, 75000);
    expect(c.fails).toEqual(["[budget] proof-property took 75.0 s, over the 60 s target. Set PROOF_BUDGET_MODE=warn to downgrade."]);
    expect(c.logs).toHaveLength(3);
    expect(c.warns).toEqual([]);
  });

  it("warn mode warns and does not fail", () => {
    const c = conclude("warn", 75000);
    expect(c.fails).toEqual([]);
    expect(c.warns).toEqual(["[budget] WARNING: proof-property took 75.0 s, over the 60 s target"]);
  });

  it("under target is quiet", () => {
    const c = conclude(undefined, 10000);
    expect(c.fails).toEqual([]);
    expect(c.warns).toEqual([]);
  });
});

describe("span tracker", () => {
  it("is earliest start to latest end for parallel modules, not a sum", () => {
    const t = createSpanTracker();
    t.start("proof-property", 1000);
    t.start("proof-property", 1200);
    t.end("proof-property", 5000);
    t.end("proof-property", 9000);
    t.end("proof-property", 7000);
    expect(t.spans().get("proof-property")).toBe(8000);
  });

  it("takes the earliest start and latest end regardless of call order", () => {
    const t = createSpanTracker();
    t.start("proof-heavy", 500);
    t.start("proof-heavy", 100);
    t.end("proof-heavy", 900);
    expect(t.spans().get("proof-heavy")).toBe(800);
  });

  it("handles a single module and keeps projects apart", () => {
    const t = createSpanTracker();
    t.start("proof-heavy", 10);
    t.end("proof-heavy", 40);
    t.start("proof-integration", 20);
    t.end("proof-integration", 25);
    expect(Object.fromEntries(t.spans())).toEqual({ "proof-heavy": 30, "proof-integration": 5 });
  });

  it("reports a project never seen, or seen without an end, as unavailable", () => {
    const t = createSpanTracker();
    t.start("proof-property", 10);
    expect(t.spans().has("proof-property")).toBe(false);
    expect(t.spans().has("proof-heavy")).toBe(false);
  });
});

describe("PROOF_BUDGET_SCALE (test aid)", () => {
  it("is 1 when unset", () => {
    expect(parseBudgetScale(undefined)).toEqual({ ok: true, scale: 1 });
  });

  it.each([["1", 1], ["0.5", 0.5], ["0.0001", 0.0001], ["1e-6", 1e-6], [" 2 ", 2]])("accepts %j", (raw, scale) => {
    expect(parseBudgetScale(raw)).toEqual({ ok: true, scale });
  });

  it.each(["", " ", "0", "-1", "abc", "1abc", "NaN", "Infinity", "-Infinity"])("rejects %j", (raw) => {
    expect(parseBudgetScale(raw)).toEqual({
      ok: false,
      message: `[budget] PROOF_BUDGET_SCALE rejected: must be a positive number (got ${JSON.stringify(raw)})`,
    });
  });

  it("scales every target", () => {
    const spansMs = new Map(Object.keys(BUDGET_SECONDS).map((p) => [p, 0]));
    const results = evaluateRun({ projectsRun: Object.keys(BUDGET_SECONDS), spansMs, sumsMs: new Map(), wallMs: 0, mode: undefined, scale: 0.5 });
    expect(Object.fromEntries(results.map((r) => [r.project, r.lines[0]]))).toEqual({
      "proof-heavy": "[budget] proof-heavy: 0 s span, first test file start to last test file end (checked against target 45 s = 90 s x PROOF_BUDGET_SCALE 0.5; test aid)",
      "proof-integration": "[budget] proof-integration: 0 s span, first test file start to last test file end (checked against target 60 s = 120 s x PROOF_BUDGET_SCALE 0.5; test aid)",
      "proof-property": "[budget] proof-property: 0 s span, first test file start to last test file end (checked against target 30 s = 60 s x PROOF_BUDGET_SCALE 0.5; test aid)",
      pipeline: "[budget] pipeline: 0 s span, first test file start to last test file end (checked against target 45 s = 90 s x PROOF_BUDGET_SCALE 0.5; test aid)",
      "pipeline-integration": "[budget] pipeline-integration: 0 s span, first test file start to last test file end (checked against target 60 s = 120 s x PROOF_BUDGET_SCALE 0.5; test aid)",
    });
  });

  it("prints a tiny scaled target in exponent notation", () => {
    const [r] = evaluateRun({ projectsRun: ["proof-property"], spansMs: new Map([["proof-property", 5]]), sumsMs: new Map(), wallMs: 0, mode: undefined, scale: 0.0001 });
    expect(r?.lines[0]).toContain("target 6.00e-3 s = 60 s x PROOF_BUDGET_SCALE 0.0001; test aid");
  });

  function conclude(opts: { mode?: string; scaleRaw?: string; spanMs: number; withJournal?: boolean }) {
    const logs: string[] = [];
    const warns: string[] = [];
    const fails: string[] = [];
    const notes: string[] = [];
    const journal: string[] = [];
    concludeRun({
      projectsRun: ["proof-property"],
      spansMs: new Map([["proof-property", opts.spanMs]]),
      sumsMs: new Map(),
      wallMs: 1000,
      mode: opts.mode,
      scaleRaw: opts.scaleRaw,
      log: (t) => logs.push(t),
      warn: (t) => warns.push(t),
      fail: (t) => fails.push(t),
      note: (t) => notes.push(t),
      ...(opts.withJournal ? { journal: (t: string) => journal.push(t) } : {}),
    });
    return { logs, warns, fails, notes, journal };
  }

  it("a span under the real target but over the scaled one fails in strict mode", () => {
    const c = conclude({ scaleRaw: "0.1", spanMs: 30000 });
    expect(c.fails).toEqual(["[budget] proof-property took 30 s, over the 6 s target (60 s x PROOF_BUDGET_SCALE 0.1; test aid). Set PROOF_BUDGET_MODE=warn to downgrade."]);
    expect(c.logs[0]).toContain("target 6 s = 60 s x PROOF_BUDGET_SCALE 0.1; test aid");
  });

  it("the same overrun only warns in warn mode", () => {
    const c = conclude({ scaleRaw: "0.1", spanMs: 30000, mode: "warn" });
    expect(c.fails).toEqual([]);
    expect(c.warns).toHaveLength(1);
  });

  it.each([undefined, "warn"])("a rejected scale is a configuration error in mode %s, and nothing is evaluated", (mode) => {
    const c = conclude({ scaleRaw: "1abc", spanMs: 1, mode, withJournal: true });
    expect(c.fails).toEqual(['[budget] PROOF_BUDGET_SCALE rejected: must be a positive number (got "1abc")']);
    expect(c.logs).toEqual([]);
    expect(c.journal).toEqual([]);
  });

  it("a scale other than 1 never writes the journal and prints a note", () => {
    const c = conclude({ scaleRaw: "2", spanMs: 1000, withJournal: true });
    expect(c.journal).toEqual([]);
    expect(c.notes).toHaveLength(1);
  });

  it("scale 1 still writes the journal and prints no note", () => {
    const c = conclude({ scaleRaw: "1", spanMs: 1000, withJournal: true });
    expect(c.journal).toHaveLength(1);
    expect(c.notes).toEqual([]);
  });
});