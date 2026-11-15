// Requirements: 10.4, 10.5, 10.6, 10.7
import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalize } from "../../../src/engine/serialize/canonicalJson";
import { deserialize } from "../../../src/engine/serialize/deserialize";
import type { DeathCertificate } from "../../../src/engine/types";

const T = "2025-01-02T03:04:05Z";
const prov = (u: string, t = T) => ({ sourceUrl: u, fetchedAt: t });
const unavailable = {
  available: false as const,
  source: "npm" as const,
  attemptedUrl: "https://registry.npmjs.org/x",
  attemptedAt: T,
  reason: "down",
};

function sample(): DeathCertificate {
  return {
    schemaVersion: 1,
    package: { name: "left-pad", version: "1.3.0" },
    analysisDate: T,
    status: "dead",
    causes: ["runtime-rot", "maintainer-gone"],
    openVulnerabilityIds: ["OSV-2", "OSV-1"],
    timeOfDeath: { available: true, value: T },
    daysSinceDeath: 10,
    vitalSigns: {
      maintainers: { available: true, value: ["zed", "amy"] },
      openVulnerabilities: {
        available: true,
        value: [
          { id: "B", aliases: ["CVE-2", "CVE-1"], summary: "b" },
          { id: "A", aliases: ["Z"], summary: "a2" },
          { id: "A", aliases: ["Y"], summary: "a1" },
        ],
      },
      scorecard: unavailable,
      dependents: { available: true, value: 3 },
      weeklyDownloads: { available: true, value: 4 },
    },
    riskScore: 40,
    risk: {
      contributions: [
        { component: "vitalSign:dependents", points: 0 },
        { component: "cause:runtime-rot", points: 10 },
        { component: "cause:maintainer-gone", points: 20 },
      ],
      rawScore: 30,
      formula: { weights: { b: 1, a: 2 }, thresholds: { t: 1 } },
      unavailable: ["weeklyDownloads", "scorecard"],
    },
    facts: [
      { key: "b", value: { y: 1, x: 2 }, provenance: [prov("https://b/2"), prov("https://b/1", "2025-01-01T00:00:00Z")] },
      { key: "a", value: 1, provenance: [prov("https://z")] },
      { key: "a", value: 2, provenance: [prov("https://y")] },
    ],
    notes: { githubTokenUsed: false, omittedFacts: [] },
  };
}

describe("canonicalJson", () => {
  it("emits keys in fixed order regardless of construction order", () => {
    const a = sample();
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as unknown as DeathCertificate;
    reversed.package = { version: "1.3.0", name: "left-pad" };
    expect(canonicalJson(reversed)).toBe(canonicalJson(a));
    expect(canonicalJson(a).startsWith('{"schemaVersion":1,"package":{"name":"left-pad","version":"1.3.0"},"analysisDate"')).toBe(true);
  });

  it("sorts lists by documented rules with tie-breakers", () => {
    const c = canonicalize(sample()) as unknown as DeathCertificate;
    expect(c.causes).toEqual(["maintainer-gone", "runtime-rot"]);
    expect(c.openVulnerabilityIds).toEqual(["OSV-1", "OSV-2"]);
    expect(c.facts.map((f) => f.key + (f.provenance[0]?.sourceUrl ?? ""))).toEqual([
      "ahttps://y",
      "ahttps://z",
      "bhttps://b/1",
    ]);
    expect(c.facts[2]?.provenance.map((p) => p.sourceUrl)).toEqual(["https://b/1", "https://b/2"]);
    expect(c.risk.contributions.map((x) => x.component)).toEqual([
      "cause:maintainer-gone",
      "cause:runtime-rot",
      "vitalSign:dependents",
    ]);
    expect(c.risk.unavailable).toEqual(["scorecard", "weeklyDownloads"]);
    const vs = c.vitalSigns.openVulnerabilities;
    if (!vs.available) throw new Error("expected available");
    expect(vs.value.map((v) => v.id + v.aliases.join())).toEqual(["AY", "AZ", "BCVE-1,CVE-2"]);
    const m = c.vitalSigns.maintainers;
    if (!m.available) throw new Error("expected available");
    expect(m.value).toEqual(["zed", "amy"]);
  });

  it("compares by code point, not UTF-16 unit", () => {
    const c = sample();
    c.openVulnerabilityIds = ["\u{1F600}", "\uFFFF"];
    const out = canonicalize(c) as unknown as DeathCertificate;
    expect(out.openVulnerabilityIds).toEqual(["\uFFFF", "\u{1F600}"]);
  });

  it("truncates milliseconds to second precision", () => {
    const c = sample();
    (c as { analysisDate: string }).analysisDate = "2025-01-02T03:04:05.678Z";
    expect((canonicalize(c) as unknown as DeathCertificate).analysisDate).toBe(T);
  });
});

describe("deserialize", () => {
  it("round-trips a certificate (after canonical list ordering)", () => {
    const original = sample();
    const result = deserialize(canonicalJson(original));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(canonicalize(original));
    expect(canonicalJson(result.value)).toBe(canonicalJson(original));
  });

  it("rejects malformed JSON", () => {
    const r = deserialize("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("malformed-json");
  });

  it("names a missing required field", () => {
    const obj = JSON.parse(canonicalJson(sample())) as { risk: Record<string, unknown> };
    delete obj.risk.rawScore;
    const r = deserialize(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.issues.map((i) => i.path)).toContain("risk.rawScore");
      expect(r.error.message).toContain("risk.rawScore");
    }
  });

  it("names an invalid field", () => {
    const obj = JSON.parse(canonicalJson(sample())) as { analysisDate: string };
    obj.analysisDate = "yesterday";
    const r = deserialize(JSON.stringify(obj));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("analysisDate");
  });
});
