import { describe, expect, it } from "vitest";
import { buildCertificate, type Signals } from "../../../src/engine/core/certificate";
import { DeathCertificateSchema, type Provenance } from "../../../src/engine/types";
import { fc, fcParams } from "../helpers/fc";
import { signalsWithDateArb } from "../helpers/signalsArb";

// Feature: autopsy-engine, Property 9: Every fact carries valid provenance
// **Validates: Requirements 3.1, 3.4, 3.6, 12.4**
//
// Ordering note: the generators only produce Fetch_Dates at or before the Analysis_Date.
// The guarantee "Fetch_Date <= Analysis_Date" belongs to the orchestrator (design.md, notes on
// the model: the Analysis_Date is read after all fetches, or supplied by the caller for
// fixtures). buildCertificate is pure and does not clamp, so it is not tested against later dates.

const SECOND_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

// Independent oracle, deliberately not reusing the schema code under test.
function urlIsValid(url: string): boolean {
  if (url.length < 1 || url.length > 2048 || url.trim().length === 0) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function dateIsValid(value: string): boolean {
  if (!SECOND_UTC.test(value)) return false;
  const t = Date.parse(value);
  return !Number.isNaN(t) && new Date(t).toISOString() === value.replace("Z", ".000Z");
}

function validCount(entries: readonly Provenance[]): number {
  const seen = new Set<string>();
  for (const e of entries) {
    if (urlIsValid(e.sourceUrl) && dateIsValid(e.fetchedAt)) seen.add(`${e.sourceUrl}\n${e.fetchedAt}`);
  }
  return seen.size;
}

/** Facts that must exist (count > 0) or be omitted (count = 0), derived from the signals alone. */
function expectedPresence(s: Signals): Map<string, number> {
  const out = new Map<string, number>();
  const prov = (r: { status: string; provenance?: Provenance[] }): number =>
    r.status === "ok" ? validCount(r.provenance ?? []) : -1;
  if (s.npm.status === "ok") out.set("maintainers", prov(s.npm));
  if (s.scorecard.status === "ok" && s.scorecard.value !== null) out.set("scorecard", prov(s.scorecard));
  if (s.dependents.status === "ok") out.set("dependents", prov(s.dependents));
  if (s.weeklyDownloads.status === "ok") out.set("weeklyDownloads", prov(s.weeklyDownloads));
  if (s.github.status === "ok") out.set("githubRepo", prov(s.github));
  for (const l of s.successor.lookups) {
    const key = `successorLookup:${l.name}`;
    if (l.outcome === "threw") out.set(key, 0);
    else if (l.result.status === "ok") out.set(key, prov(l.result));
    else out.set(key, 1); // attempted/not-found URL and time are single entries; validity checked below
  }
  return out;
}

describe("Property 9: Every fact carries valid provenance", () => {
  it("every Fact has 1 to 20 valid provenance entries dated at or before the Analysis_Date", () => {
    fc.assert(
      fc.property(signalsWithDateArb, ({ signals, analysis }) => {
        const cert = buildCertificate(signals, analysis.analysisDate);

        expect(DeathCertificateSchema.safeParse(cert).success).toBe(true);

        const analysisIso = cert.analysisDate;
        for (const fact of cert.facts) {
          expect(fact.provenance.length).toBeGreaterThanOrEqual(1);
          expect(fact.provenance.length).toBeLessThanOrEqual(20);
          for (const p of fact.provenance) {
            expect(urlIsValid(p.sourceUrl)).toBe(true);
            expect(dateIsValid(p.fetchedAt)).toBe(true);
            // Same-format UTC strings compare chronologically as strings.
            expect(p.fetchedAt <= analysisIso).toBe(true);
          }
        }

        // Omitted keys: unique, never also present as a Fact.
        const factKeys = new Set(cert.facts.map((f) => f.key));
        const omittedKeys = cert.notes.omittedFacts.map((o) => o.key);
        expect(new Set(omittedKeys).size).toBe(omittedKeys.length);
        for (const key of omittedKeys) expect(factKeys.has(key)).toBe(false);

        // Presence oracle: valid provenance means a Fact, none means omitted.
        for (const [key, count] of expectedPresence(signals)) {
          if (key.startsWith("successorLookup:") && count === 1) {
            // unavailable / not-found lookups: either a Fact or an omission, never neither or both.
            expect(factKeys.has(key) !== omittedKeys.includes(key)).toBe(true);
          } else if (count > 0) {
            expect(factKeys.has(key)).toBe(true);
          } else {
            expect(factKeys.has(key)).toBe(false);
            expect(omittedKeys).toContain(key);
          }
        }
      }),
      fcParams(),
    );
  });

  it("omits a Fact whose only provenance is malformed", () => {
    const analysisDate = new Date("2025-06-01T00:00:00.500Z");
    const signals: Signals = {
      name: "demo",
      version: "1.0.0",
      publishedVersions: ["1.0.0"],
      npm: { status: "unavailable", source: "npm", attemptedUrl: "u", attemptedAt: "2025-05-01T00:00:00Z", reason: "x" },
      osv: { status: "unavailable", source: "osv", attemptedUrl: "u", attemptedAt: "2025-05-01T00:00:00Z", reason: "x" },
      scorecard: { status: "unavailable", source: "deps.dev", attemptedUrl: "u", attemptedAt: "2025-05-01T00:00:00Z", reason: "x" },
      dependents: {
        status: "ok",
        value: 3,
        provenance: [
          { sourceUrl: "   ", fetchedAt: "2025-05-01T00:00:00Z" },
          { sourceUrl: "/relative", fetchedAt: "2025-05-01T00:00:00Z" },
          { sourceUrl: "https://api.deps.dev/x", fetchedAt: "2025-05-01T00:00:00.123Z" },
        ],
      },
      weeklyDownloads: { status: "unavailable", source: "npm", attemptedUrl: "u", attemptedAt: "2025-05-01T00:00:00Z", reason: "x" },
      github: { status: "skipped", reason: "" },
      successor: { lookups: [] },
      githubTokenUsed: false,
    };
    const cert = buildCertificate(signals, analysisDate);
    expect(cert.facts.map((f) => f.key)).not.toContain("dependents");
    expect(cert.notes.omittedFacts).toEqual([{ key: "dependents", reason: "missing-provenance" }]);
    expect(DeathCertificateSchema.safeParse(cert).success).toBe(true);
  });
});
