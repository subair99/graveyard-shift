import { describe, expect, it } from "vitest";
import { detectCauses, filterOpenVulnerabilities, type CauseSignals } from "../../../src/engine/core/causes";

const analysis = new Date("2026-01-01T00:00:00Z");
const unavailable = {
  available: false as const,
  source: "npm" as const,
  attemptedUrl: "https://registry.npmjs.org/x",
  attemptedAt: "2026-01-01T00:00:00Z",
  reason: "down",
};
const ok = <T>(value: T) => ({ available: true as const, value });

function signals(over: Partial<CauseSignals> = {}): CauseSignals {
  return {
    maintainers: ok(["a"]),
    archived: ok(false),
    openVulnerabilityIds: ok([]),
    timeOfDeath: ok("2025-12-31T00:00:00Z"),
    lastPush: ok("2025-12-31T00:00:00Z"),
    ...over,
  };
}

// 730 days before 2026-01-01T00:00:00Z is 2024-01-02T00:00:00Z (2024 is a leap year).
const EXACT_730 = "2024-01-02T00:00:00Z";
const DAYS_731 = "2024-01-01T00:00:00Z";

describe("detectCauses", () => {
  it("returns empty when no condition holds", () => {
    expect(detectCauses(signals(), analysis)).toEqual([]);
  });

  it("emits all causes in fixed order", () => {
    const c = detectCauses(
      signals({
        maintainers: ok([]),
        archived: ok(true),
        openVulnerabilityIds: ok(["GHSA-1"]),
        timeOfDeath: ok(DAYS_731),
        lastPush: ok(DAYS_731),
      }),
      analysis,
    );
    expect(c).toEqual(["maintainer-gone", "repo-archived", "unpatched-cve", "runtime-rot"]);
  });

  it("uses a strict > 730 threshold", () => {
    expect(detectCauses(signals({ timeOfDeath: ok(EXACT_730), lastPush: ok(EXACT_730) }), analysis)).toEqual([]);
    expect(detectCauses(signals({ timeOfDeath: ok(DAYS_731), lastPush: ok(DAYS_731) }), analysis)).toEqual([
      "runtime-rot",
    ]);
  });

  it("does not flag runtime-rot when the push is recent", () => {
    expect(detectCauses(signals({ timeOfDeath: ok(DAYS_731) }), analysis)).toEqual([]);
  });

  it("does not flag runtime-rot when the push is exactly 730 days old", () => {
    expect(detectCauses(signals({ timeOfDeath: ok(DAYS_731), lastPush: ok(EXACT_730) }), analysis)).toEqual([]);
  });

  it("flags runtime-rot when no push date exists", () => {
    expect(detectCauses(signals({ timeOfDeath: ok(DAYS_731), lastPush: ok(null) }), analysis)).toEqual([
      "runtime-rot",
    ]);
    expect(detectCauses(signals({ timeOfDeath: ok(DAYS_731), lastPush: unavailable }), analysis)).toEqual([
      "runtime-rot",
    ]);
  });

  it("never produces a cause from unavailable signals", () => {
    expect(
      detectCauses(
        signals({
          maintainers: unavailable,
          archived: unavailable,
          openVulnerabilityIds: unavailable,
          timeOfDeath: unavailable,
          lastPush: unavailable,
        }),
        analysis,
      ),
    ).toEqual([]);
  });
});

describe("filterOpenVulnerabilities", () => {
  const published = ["1.0.0", "1.2.0", "2.0.0"];

  it("drops a vulnerability fixed in a later published version", () => {
    expect(filterOpenVulnerabilities([{ id: "A", fixedVersions: ["1.2.0"] }], "1.0.0", published)).toEqual([]);
  });

  it("keeps a vulnerability whose fixed version is not published", () => {
    expect(filterOpenVulnerabilities([{ id: "A", fixedVersions: ["1.5.0"] }], "1.0.0", published)).toEqual(["A"]);
  });

  it("keeps a vulnerability whose fixed version is not greater than the analyzed one", () => {
    expect(filterOpenVulnerabilities([{ id: "A", fixedVersions: ["1.0.0"] }], "1.2.0", published)).toEqual(["A"]);
  });

  it("keeps a vulnerability with no fixed version", () => {
    expect(filterOpenVulnerabilities([{ id: "A", fixedVersions: [] }], "1.0.0", published)).toEqual(["A"]);
  });

  it("sorts by code point and removes duplicates", () => {
    const ids = filterOpenVulnerabilities(
      [
        { id: "b", fixedVersions: [] },
        { id: "B", fixedVersions: [] },
        { id: "a", fixedVersions: [] },
        { id: "b", fixedVersions: [] },
      ],
      "1.0.0",
      published,
    );
    expect(ids).toEqual(["B", "a", "b"]);
  });
});
