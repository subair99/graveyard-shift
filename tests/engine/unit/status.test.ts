import { describe, expect, it } from "vitest";
import { assignStatus } from "../../../src/engine/core/status";

describe("assignStatus", () => {
  it("successor wins regardless of causes, deprecation and risk", () => {
    expect(
      assignStatus({
        successor: "lru-cache",
        deprecation: "Check out lru-cache",
        causes: ["repo-archived"],
        risk: undefined,
      }),
    ).toEqual({ status: "retired-with-successor" });
  });

  it("deprecation without successor is dead and returns the full message", () => {
    const msg = "This package is no longer maintained.";
    expect(assignStatus({ deprecation: msg, causes: [], risk: 0 })).toEqual({
      status: "dead",
      deprecationMessage: msg,
    });
  });

  it("deprecation is dead even when risk is missing", () => {
    expect(assignStatus({ deprecation: "gone", causes: [], risk: undefined })).toMatchObject({
      status: "dead",
    });
  });

  it("an empty deprecation string is treated as not deprecated", () => {
    expect(assignStatus({ deprecation: "", causes: [], risk: 10 })).toEqual({ status: "alive" });
  });

  it("any cause is dead, even with low risk", () => {
    expect(assignStatus({ causes: ["runtime-rot"], risk: 5 })).toEqual({ status: "dead" });
  });

  it("any cause is dead, even with missing risk", () => {
    expect(assignStatus({ causes: ["unpatched-cve"], risk: undefined })).toEqual({
      status: "dead",
    });
  });

  it.each([undefined, -1, 101, 40.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "invalid risk %s with no cause and no deprecation gives an error and no status",
    (risk) => {
      const result = assignStatus({ causes: [], risk });
      expect(result).toHaveProperty("error");
      expect(result).not.toHaveProperty("status");
    },
  );

  it("39 is alive and 40 is dying", () => {
    expect(assignStatus({ causes: [], risk: 39 })).toEqual({ status: "alive" });
    expect(assignStatus({ causes: [], risk: 40 })).toEqual({ status: "dying" });
  });

  it("covers the range ends: 0 alive, 100 dying", () => {
    expect(assignStatus({ causes: [], risk: 0 })).toEqual({ status: "alive" });
    expect(assignStatus({ causes: [], risk: 100 })).toEqual({ status: "dying" });
  });
});
