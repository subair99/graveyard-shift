import { describe, expect, it } from "vitest";
import {
  createRestartBudget,
  restartBudgetError,
  toHarnessError,
} from "../../../src/proof/shell/executor/types";
import { HarnessErrorSchema } from "../../../src/proof/types";

describe("createRestartBudget", () => {
  it("starts empty and keeps separate counters", () => {
    const b = createRestartBudget(5);
    expect(b.max).toBe(5);
    expect([b.used(), b.restartEvents(), b.otherRestarts()]).toEqual([0, 0, 0]);
    expect(b.consume("restart-event")).toBe(true);
    expect(b.consume("other")).toBe(true);
    expect(b.consume("other")).toBe(true);
    expect([b.used(), b.restartEvents(), b.otherRestarts()]).toEqual([3, 1, 2]);
  });

  it("counts a Restart_Event toward the maximum (R5.14)", () => {
    const b = createRestartBudget(2);
    expect(b.consume("restart-event")).toBe(true);
    expect(b.consume("restart-event")).toBe(true);
    expect(b.consume("other")).toBe(false);
    expect(b.used()).toBe(2);
  });

  it("refuses without counting once exhausted", () => {
    const b = createRestartBudget(1);
    expect(b.consume("other")).toBe(true);
    expect(b.consume("restart-event")).toBe(false);
    expect(b.consume("other")).toBe(false);
    expect([b.used(), b.restartEvents(), b.otherRestarts()]).toEqual([1, 0, 1]);
  });

  it("a zero maximum refuses the first restart", () => {
    expect(createRestartBudget(0).consume("other")).toBe(false);
  });

  it("rejects an invalid maximum", () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) {
      expect(() => createRestartBudget(bad)).toThrow(RangeError);
    }
  });

  it("budgets are independent", () => {
    const a = createRestartBudget(1);
    const b = createRestartBudget(1);
    a.consume("other");
    expect(b.used()).toBe(0);
  });
});

describe("executor errors", () => {
  it("exhaustion maps to the too-many-crashes harness error (R16.4)", () => {
    const err = restartBudgetError(createRestartBudget(20));
    expect(err.kind).toBe("too-many-crashes");
    expect(err.message).toContain("20");
    const harness = toHarnessError(err, "set");
    expect(HarnessErrorSchema.safeParse(harness).success).toBe(true);
    expect(harness.function).toBe("set");
    expect("function" in toHarnessError(err)).toBe(false);
  });
});
