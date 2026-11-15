/**
 * Budget reporter overrun logic (Requirement 15.8). Elapsed time is injected, so no slow suite runs
 * and the journal is never written.
 */
// Requirements: 15.7, 15.8
import { describe, expect, it } from "vitest";
import { BUDGET_SECONDS, concludeBudget, evaluateBudget } from "../helpers/budgetGlobalSetup";

const evalAt = (project: string, elapsedSeconds: number, mode?: string) =>
  evaluateBudget({ project, elapsedSeconds, targetSeconds: BUDGET_SECONDS[project], mode });

function conclude(project: string, elapsedSeconds: number, mode?: string) {
  const logs: string[] = [];
  const warns: string[] = [];
  const run = () => concludeBudget({ project, elapsedSeconds, mode, log: (t) => logs.push(t), warn: (t) => warns.push(t) });
  return { logs, warns, run };
}

describe("budget reporter", () => {
  it("has the targets 60 s and 120 s", () => {
    expect(BUDGET_SECONDS).toEqual({ "proof-property": 60, "proof-integration": 120 });
  });

  it("under target is ok with an info line", () => {
    const r = evalAt("proof-property", 12.34);
    expect(r).toMatchObject({ ok: true, level: "info" });
    expect(r.message).toBe("[budget] proof-property: 12.3 s whole-run wall-clock, upper bound for this project (target 60 s)");
  });

  it("exactly at target is ok", () => {
    expect(evalAt("proof-property", 60)).toMatchObject({ ok: true, level: "info" });
    expect(evalAt("proof-integration", 120)).toMatchObject({ ok: true, level: "info" });
  });

  it.each([undefined, "", "strict", "WARN", "1"])("over target in strict mode (%s) is an error", (mode) => {
    const r = evalAt("proof-integration", 120.5, mode);
    expect(r).toMatchObject({ ok: false, level: "error" });
    expect(r.message).toBe("[budget] proof-integration took 120.5 s, over the 120 s target. Set PROOF_BUDGET_MODE=warn to downgrade.");
  });

  it("over target in warn mode warns and does not fail", () => {
    const r = evalAt("proof-property", 61, "warn");
    expect(r).toMatchObject({ ok: true, level: "warn" });
    expect(r.message).toBe("[budget] WARNING: proof-property took 61.0 s, over the 60 s target");
  });

  it("an unknown project has no target and never fails", () => {
    const r = evalAt("engine", 9999);
    expect(r).toMatchObject({ ok: true, level: "info" });
    expect(r.message).toContain("(no target)");
  });

  it("concludeBudget throws on a strict overrun after logging the timing line", () => {
    const c = conclude("proof-property", 75);
    expect(c.run).toThrow(/over the 60 s target/);
    expect(c.logs).toHaveLength(1);
  });

  it("concludeBudget warns in warn mode and does not throw", () => {
    const c = conclude("proof-property", 75, "warn");
    expect(c.run).not.toThrow();
    expect(c.warns).toEqual(["[budget] WARNING: proof-property took 75.0 s, over the 60 s target"]);
  });

  it("concludeBudget stays quiet about overruns under target", () => {
    const c = conclude("proof-integration", 10);
    expect(c.run).not.toThrow();
    expect(c.warns).toEqual([]);
    expect(c.logs).toHaveLength(1);
  });
});
