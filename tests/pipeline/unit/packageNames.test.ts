// Requirements: 1.6
import { describe, expect, it } from "vitest";
import { isSupportedPackageName, supportedPackageNameProblem } from "../../../src/pipeline/common/packageNames";

describe("packageNames", () => {
  it("accepts unscoped valid names", () => {
    for (const n of ["lodash.set", "ip", "inflight"]) expect(isSupportedPackageName(n)).toBe(true);
  });

  it("rejects a scoped name with the stated reason", () => {
    expect(supportedPackageNameProblem("@graveyard-shift/ip")).toMatch(/scoped package names are not supported/);
  });

  it("rejects invalid names with the engine reason", () => {
    expect(supportedPackageNameProblem("")).toBe("package name is empty");
    expect(isSupportedPackageName("Upper")).toBe(false);
  });
});
