// Requirements: 11.2, 11.15
import { describe, expect, it } from "vitest";
import { BRANCH_REQUIRED_MESSAGE, planIntake } from "../../../src/pipeline/undertaker/core/planIntake";

describe("planIntake", () => {
  it("not eligible gives not-resurrected and reads no branch", () => {
    expect(planIntake({ eligible: false, branch: "resurrect/ip" })).toEqual({
      ok: true,
      value: { kind: "not-resurrected", branch: null },
    });
    expect(planIntake({ eligible: false, branch: null }).ok).toBe(true);
  });

  it("eligible without a branch fails", () => {
    expect(planIntake({ eligible: true, branch: null })).toEqual({ ok: false, error: BRANCH_REQUIRED_MESSAGE });
    expect(planIntake({ eligible: true, branch: "" }).ok).toBe(false);
    expect(BRANCH_REQUIRED_MESSAGE).toBe("a Resurrection_Branch is required");
  });

  it("eligible with a branch gives resurrection", () => {
    expect(planIntake({ eligible: true, branch: "resurrect/ip" })).toEqual({
      ok: true,
      value: { kind: "resurrection", branch: "resurrect/ip" },
    });
  });
});
