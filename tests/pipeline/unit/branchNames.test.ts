// Requirements: 8.3, 14.7
import { describe, expect, it } from "vitest";
import {
  PUBLISH_BRANCH_PATTERN,
  publishBranchName,
  resurrectBranchName,
} from "../../../src/pipeline/common/branchNames";

describe("branchNames", () => {
  it("resurrectBranchName is resurrect/<package>", () => {
    expect(resurrectBranchName("lodash.set")).toBe("resurrect/lodash.set");
  });

  it("publishBranchName follows D2", () => {
    const r = publishBranchName({ package: "lodash.set", runId: 43760001234, runAttempt: 1 });
    expect(r).toEqual({ ok: true, value: "publish/lodash-set-run43760001234-a1" });
  });

  it("matches the pattern and never starts with resurrect/", () => {
    for (const p of ["ip", "a.b_c~d", "inflight"]) {
      const r = publishBranchName({ package: p, runId: 7, runAttempt: 3 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toMatch(PUBLISH_BRANCH_PATTERN);
        expect(r.value.startsWith("resurrect/")).toBe(false);
      }
    }
  });

  it("different run ids give different names for the same package; replacement is not injective", () => {
    const a = publishBranchName({ package: "a.b", runId: 1, runAttempt: 1 });
    const b = publishBranchName({ package: "a.b", runId: 2, runAttempt: 1 });
    const c = publishBranchName({ package: "a-b", runId: 1, runAttempt: 1 });
    expect(a).not.toEqual(b);
    expect(a).toEqual(c);
  });

  it("rejects non-positive or non-integer run numbers and bad packages", () => {
    for (const [runId, runAttempt] of [[0, 1], [1, 0], [-1, 1], [1.5, 1], [1, Number.NaN]] as const) {
      expect(publishBranchName({ package: "ip", runId, runAttempt }).ok).toBe(false);
    }
    expect(publishBranchName({ package: "@s/ip", runId: 1, runAttempt: 1 }).ok).toBe(false);
  });
});
