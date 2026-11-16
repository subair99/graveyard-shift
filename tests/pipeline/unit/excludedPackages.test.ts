// Requirements: 19.9
// R19.9: safe-eval and node-serialize stay excluded from the Pipeline. The shared package-name check is the entry
// of the Local_Runner arguments, the CI dispatch inputs, the Push_Script plan and the Medium prompt.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supportedPackageNameProblem } from "../../../src/pipeline/common/packageNames";
import { parseResurrectArgs } from "../../../src/pipeline/local/core/cliArgs";
import { planEligibilityDispatch, planPush } from "../../../src/pipeline/local/core/pushPlan";
import { buildMediumPrompt } from "../../../src/pipeline/medium/core/prompt";
import { validateDispatchInputs } from "../../../src/pipeline/undertaker/core/dispatchInputs";

const EXCLUDED = ["safe-eval", "node-serialize"] as const;

describe.each(EXCLUDED)("%s is refused by the Pipeline (R19.9)", (name) => {
  it("the package-name check names the exclusion", () => {
    expect(supportedPackageNameProblem(name)).toContain("excluded from the Pipeline");
  });

  it("the Local_Runner arguments are a usage error", () => {
    const r = parseResurrectArgs([name], path.posix);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("excluded from the Pipeline");
  });

  it("the CI dispatch inputs are rejected, with and without a branch", () => {
    for (const branch of ["", `resurrect/${name}`]) {
      const r = validateDispatchInputs({ ref: "refs/heads/main", package: name, version: "1.0.0", branch, mediumMode: "local" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.join("\n")).toContain("excluded from the Pipeline");
    }
  });

  it("the Push_Script plan, the eligibility dispatch and the Medium prompt refuse it", () => {
    expect(planPush({ package: name, version: "1.0.0", mode: "local", files: [] }).ok).toBe(false);
    expect(planEligibilityDispatch({ package: name, version: "1.0.0" }).ok).toBe(false);
    expect(() => buildMediumPrompt(name)).toThrow(/excluded from the Pipeline/);
  });
});

describe("the exclusion is exact", () => {
  it("accepts the demo packages and names that only resemble an excluded one", () => {
    for (const ok of ["lodash.set", "ip", "inflight", "safe-eval2", "my-node-serialize"]) {
      expect(supportedPackageNameProblem(ok)).toBeNull();
    }
  });
});
