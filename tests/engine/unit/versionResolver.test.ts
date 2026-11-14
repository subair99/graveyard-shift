import { describe, expect, it } from "vitest";
import { resolveVersion } from "../../../src/engine/resolve/versionResolver";

const published = ["1.0.0", "1.2.0", "1.10.0", "2.0.0", "2.1.0-beta.1"];

describe("resolveVersion", () => {
  it("resolves no spec to dist-tags.latest (R1.4)", () => {
    expect(resolveVersion("left-pad", null, published, "2.0.0")).toEqual({ ok: true, value: "2.0.0" });
  });

  it("errors naming the package when no version is published (R1.11)", () => {
    const r = resolveVersion("left-pad", null, [], null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.package).toBe("left-pad");
      expect(r.error.kind).toBe("no-version");
      expect(r.error.message).toContain("left-pad");
    }
  });

  it("resolves an exact version to itself (R1.5)", () => {
    expect(resolveVersion("x", "1.2.0", published, "2.0.0")).toEqual({ ok: true, value: "1.2.0" });
  });

  it("resolves a range to the highest satisfying version (R1.6)", () => {
    expect(resolveVersion("x", "^1.0.0", published, "2.0.0")).toEqual({ ok: true, value: "1.10.0" });
  });

  it("errors naming package and range when none satisfy (R1.7)", () => {
    const r = resolveVersion("x", "^3.0.0", published, "2.0.0");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("range-unsatisfied");
      expect(r.error.package).toBe("x");
      expect(r.error.range).toBe("^3.0.0");
      expect(r.error.message).toContain("x");
      expect(r.error.message).toContain("^3.0.0");
    }
  });

  it("reports an invalid spec as a parse error", () => {
    const r = resolveVersion("x", "not a range!!", published, "2.0.0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse");
  });
});
