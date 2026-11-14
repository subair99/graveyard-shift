import { describe, expect, it } from "vitest";
import { fc, fcConfig, fcParams, numRuns } from "./fc";

describe("fast-check helper", () => {
  it("runs at least 100 cases", () => {
    expect(numRuns).toBeGreaterThanOrEqual(100);
    expect(fcConfig.numRuns).toBeGreaterThanOrEqual(100);
  });

  it("uses FC_SEED when set", () => {
    const previous = process.env["FC_SEED"];
    process.env["FC_SEED"] = "12345";
    try {
      expect(fcParams().seed).toBe(12345);
    } finally {
      if (previous === undefined) delete process.env["FC_SEED"];
      else process.env["FC_SEED"] = previous;
    }
  });

  it("reports the seed and shrunk counterexample on failure", () => {
    let message = "";
    try {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (n) => n < 10),
        { ...fcParams(), seed: 42 },
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("seed: 42");
    expect(message).toContain("Counterexample: [10]");
  });
});
