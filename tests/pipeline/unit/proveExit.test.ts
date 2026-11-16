// Requirements: 12.4
import { describe, expect, it } from "vitest";
import { mapExitCode } from "../../../src/pipeline/undertaker/core/proveExit";

describe("mapExitCode", () => {
  it("maps 0, 1 and 2", () => {
    expect(mapExitCode(0)).toEqual({ verdict: "alive" });
    expect(mapExitCode(1)).toEqual({ verdict: "restless" });
    expect(mapExitCode(2)).toEqual({ verdict: "inconclusive" });
  });

  it.each([64, 3, 127, -1, 137, Number.NaN])("maps %s to inconclusive with a harness error", (code) => {
    expect(mapExitCode(code)).toEqual({ verdict: "inconclusive", harnessError: "harness-config-error" });
  });
});
