// Requirements: 9.1, 9.2, 23.7
import { describe, expect, it } from "vitest";
import { validateDispatchInputs } from "../../../src/pipeline/undertaker/core/dispatchInputs";

const good = { ref: "refs/heads/main", package: "lodash.set", version: "4.3.2", branch: "", mediumMode: "local" };

describe("validateDispatchInputs", () => {
  it("accepts a valid dispatch with an empty branch", () => {
    expect(validateDispatchInputs(good)).toEqual({
      ok: true,
      value: { package: "lodash.set", version: "4.3.2", branch: null, mediumMode: "local" },
    });
  });

  it("accepts the own resurrect branch and stub mode", () => {
    const r = validateDispatchInputs({ ...good, branch: "resurrect/lodash.set", mediumMode: "stub" });
    expect(r.ok && r.value.branch).toBe("resurrect/lodash.set");
  });

  it.each([
    ["ref", { ref: "refs/heads/dev" }],
    ["scoped package", { package: "@a/b" }],
    ["version range", { version: "^4.3.2" }],
    ["v-prefixed version", { version: "v4.3.2" }],
    ["other package branch", { branch: "resurrect/ip" }],
    ["publish branch", { branch: "publish/lodash-set-run1-a1" }],
    ["mode", { mediumMode: "remote" }],
  ])("rejects a bad %s", (_name, patch) => {
    expect(validateDispatchInputs({ ...good, ...patch }).ok).toBe(false);
  });

  it("lists every problem", () => {
    const r = validateDispatchInputs({ ref: "x", package: "@a/b", version: "1", branch: "y", mediumMode: "z" });
    expect(!r.ok && r.error.length).toBe(5);
  });
});
