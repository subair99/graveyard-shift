import { describe, expect, it } from "vitest";
import { computeRisk } from "../../../src/engine/core/risk";
import type { Maybe, VitalSigns } from "../../../src/engine/types";

function missing<T>(): Maybe<T> {
  return {
    available: false,
    source: "npm",
    attemptedUrl: "https://registry.npmjs.org/x",
    attemptedAt: "2026-01-01T00:00:00Z",
    reason: "timeout",
  };
}

function signs(over: Partial<VitalSigns> = {}): VitalSigns {
  return {
    maintainers: missing(),
    openVulnerabilities: missing(),
    scorecard: missing(),
    dependents: missing(),
    weeklyDownloads: missing(),
    ...over,
  };
}

const vulns = (n: number) => ({
  available: true as const,
  value: Array.from({ length: n }, (_, i) => ({ id: `V-${i}`, aliases: [], summary: "" })),
});

describe("computeRisk", () => {
  it("scores 0 with the note when nothing is available and no causes exist", () => {
    const r = computeRisk({ causes: [], vitalSigns: signs() });
    expect(r.riskScore).toBe(0);
    expect(r.risk.rawScore).toBe(0);
    expect(r.risk.contributions).toEqual([]);
    expect(r.risk.note).toBe("no inputs were available");
    expect(r.risk.unavailable).toEqual([
      "dependents",
      "maintainers",
      "openVulnerabilities",
      "scorecard",
      "weeklyDownloads",
    ]);
  });

  it("omits the note when a cause exists or a sign is available", () => {
    expect(computeRisk({ causes: ["runtime-rot"], vitalSigns: signs() }).risk.note).toBeUndefined();
    const r = computeRisk({
      causes: [],
      vitalSigns: signs({ dependents: { available: true, value: 0 } }),
    });
    expect(r.risk.note).toBeUndefined();
    expect(r.risk.contributions).toEqual([{ component: "vitalSign:dependents", points: 0 }]);
  });

  it("applies cause weights in fixed order regardless of input order", () => {
    const r = computeRisk({
      causes: ["runtime-rot", "unpatched-cve", "maintainer-gone", "repo-archived"],
      vitalSigns: signs(),
    });
    expect(r.risk.contributions).toEqual([
      { component: "cause:maintainer-gone", points: 20 },
      { component: "cause:repo-archived", points: 20 },
      { component: "cause:unpatched-cve", points: 25 },
      { component: "cause:runtime-rot", points: 15 },
    ]);
    expect(r.risk.rawScore).toBe(80);
    expect(r.riskScore).toBe(80);
  });

  it("gives 5 per vulnerability, capped at 20", () => {
    const pts = (n: number) =>
      computeRisk({ causes: [], vitalSigns: signs({ openVulnerabilities: vulns(n) }) }).riskScore;
    expect([pts(0), pts(1), pts(3), pts(4), pts(9)]).toEqual([0, 5, 15, 20, 20]);
  });

  it("computes the Scorecard term as round((10 - score) * 2)", () => {
    const pts = (s: number | null) =>
      computeRisk({
        causes: [],
        vitalSigns: signs({ scorecard: { available: true, value: s } }),
      }).riskScore;
    expect([pts(10), pts(7.3), pts(0), pts(null)]).toEqual([0, 5, 20, 0]);
  });

  it("clamps to 100 but keeps the raw sum", () => {
    const r = computeRisk({
      causes: ["maintainer-gone", "repo-archived", "unpatched-cve", "runtime-rot"],
      vitalSigns: signs({
        openVulnerabilities: vulns(10),
        scorecard: { available: true, value: 0 },
      }),
    });
    expect(r.risk.rawScore).toBe(120);
    expect(r.riskScore).toBe(100);
    expect(r.risk.contributions.reduce((s, c) => s + c.points, 0)).toBe(r.risk.rawScore);
  });

  it("lists contributions in fixed order and reports formula weights and thresholds", () => {
    const r = computeRisk({
      causes: ["unpatched-cve"],
      vitalSigns: signs({
        weeklyDownloads: { available: true, value: 5 },
        maintainers: { available: true, value: ["a"] },
        openVulnerabilities: vulns(1),
        scorecard: { available: true, value: 9 },
      }),
    });
    expect(r.risk.contributions.map((c) => c.component)).toEqual([
      "cause:unpatched-cve",
      "vitalSign:maintainers",
      "vitalSign:openVulnerabilities",
      "vitalSign:scorecard",
      "vitalSign:weeklyDownloads",
    ]);
    expect(r.risk.unavailable).toEqual(["dependents"]);
    expect(r.risk.formula.weights["cause:unpatched-cve"]).toBe(25);
    expect(r.risk.formula.thresholds["vitalSign:openVulnerabilities:maxPoints"]).toBe(20);
  });

  it("does not lower the score when a vulnerability or cause is added", () => {
    const base = { causes: [] as const, vitalSigns: signs({ openVulnerabilities: vulns(2) }) };
    const more = computeRisk({
      causes: ["repo-archived"],
      vitalSigns: signs({ openVulnerabilities: vulns(3) }),
    });
    expect(more.riskScore).toBeGreaterThanOrEqual(computeRisk(base).riskScore);
  });

  it("is deterministic", () => {
    const input = { causes: ["runtime-rot" as const], vitalSigns: signs({ openVulnerabilities: vulns(2) }) };
    expect(computeRisk(input)).toEqual(computeRisk(input));
  });
});
