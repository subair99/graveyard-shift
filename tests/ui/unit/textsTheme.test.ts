// Requirements: 3.1, 3.2, 3.3, 3.4, 5.7, 5.8, 5.9, 8.1, 8.2, 12.6, 12.10, 12.11, 13.3
import { describe, expect, it } from "vitest";
import * as texts from "../../../src/ui/core/texts";
import { MIN_RATIO, PAIRS, PALETTE, contrastRatio } from "../../../src/ui/core/theme";

function allFixedStrings(): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(visit);
  };
  for (const v of Object.values(texts)) {
    if (typeof v === "function") continue;
    visit(v);
  }
  out.push(
    texts.ghVersionSentence("X"),
    texts.nightlyNoReport("L", "T", "C"),
    texts.nightlyReportRejected("L", "T", "C"),
    texts.nightlyCommitMismatch("H", "B"),
  );
  return out;
}

describe("texts", () => {
  it("fills the nightly templates with the three slots", () => {
    expect(texts.nightlyNoReport("https://x/1", "2026-11-17T03:00:00Z", "failure")).toBe(
      "The last nightly run (https://x/1, 2026-11-17T03:00:00Z) ended failure without a report.",
    );
    expect(texts.nightlyReportRejected("https://x/1", "2026-11-17T03:00:00Z", "success")).toBe(
      "The last nightly run (https://x/1, 2026-11-17T03:00:00Z) ended success; its report did not pass validation.",
    );
    expect(texts.NIGHTLY_NONE).toBe("No recent nightly result in this build.");
    expect(texts.nightlyReportRejected("a", "b", "c")).not.toContain(texts.NIGHTLY_NONE);
  });

  it("states the attempts caption and note of Requirement 13.3", () => {
    expect(texts.ATTEMPTS_CAPTION).toBe("Attempts recorded in ledger.json");
    expect(texts.ATTEMPTS_NOTE).toBe("credit meter readings as typed by the user (the meter shows credits used)");
  });

  it("names the four roles and the four outcomes", () => {
    expect(texts.ROLES.map((r) => r.name)).toEqual(["Coroner", "Gravedigger", "Medium", "Undertaker"]);
    expect(Object.keys(texts.OUTCOME_DEFINITIONS)).toEqual(["alive", "restless", "inconclusive", "not-resurrected"]);
  });

  it("puts the gh version in only through the argument", () => {
    expect(texts.ghVersionSentence("9.9.9")).toContain("9.9.9");
    expect(texts.ghVersionSentence("9.9.9")).toContain("exit status 0");
  });

  it("holds no digit of its own and no Deferred item", () => {
    for (const s of allFixedStrings()) {
      // "exit status 0" is the wording of resurrection-pipeline R18.2 (Requirement 5.7).
      expect(s.replace("exit status 0", ""), s).not.toMatch(/\d/);
      expect(s, s).not.toMatch(/exhume|source diff|custom domain|light theme|vercel|in the browser/i);
    }
  });
});

describe("theme", () => {
  it("computes the WCAG reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBe(contrastRatio("#000000", "#ffffff"));
  });

  it("meets the minimum ratio of every pair", () => {
    expect(PAIRS.length).toBeGreaterThan(0);
    for (const p of PAIRS) {
      expect(contrastRatio(PALETTE[p.foreground], PALETTE[p.background]), p.id).toBeGreaterThanOrEqual(MIN_RATIO[p.kind]);
    }
  });
});
