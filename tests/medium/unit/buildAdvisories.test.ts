// Requirements: 6.2
// buildAdvisories: Fetch_Date handling of measurement advisory.sources (amended 2026-11-17).

import { describe, expect, it } from "vitest";
import { UtcTimestampSchema } from "../../../src/engine/types";
import { buildAdvisories } from "../../../src/pipeline/medium/agent/contextServer.mjs";

const CERT = JSON.stringify({
  vitalSigns: { openVulnerabilities: { available: true, value: [{ id: "GHSA-1", aliases: ["CVE-1"], summary: "s" }] } },
  facts: [{ key: "openVulnerabilities", provenance: [{ url: "https://api.osv.dev/x", fetchedAt: "2026-05-01T00:00:00Z" }] }],
});

function served(sources: unknown): Array<Record<string, unknown>> {
  const out = JSON.parse(buildAdvisories(CERT, JSON.stringify({ advisory: { sources } })));
  return out.measurement.content.advisory.sources;
}

describe("buildAdvisories measurement sources", () => {
  it("adds fetchedAt and the date-only label for YYYY-MM-DD", () => {
    expect(served([{ url: "https://e.invalid/a", checkedOn: "2026-11-15" }])).toEqual([
      { url: "https://e.invalid/a", checkedOn: "2026-11-15", fetchedAt: "2026-11-15T00:00:00Z", fetchedAtPrecision: "date-only" },
    ]);
  });

  it("copies an already valid Fetch_Date with no label", () => {
    expect(served([{ url: "u", checkedOn: "2026-11-15T10:20:30Z" }])).toEqual([
      { url: "u", checkedOn: "2026-11-15T10:20:30Z", fetchedAt: "2026-11-15T10:20:30Z" },
    ]);
  });

  it("every served fetchedAt passes UtcTimestampSchema", () => {
    const sources = served([
      { url: "a", checkedOn: "2024-02-29" },
      { url: "b", checkedOn: "2026-11-15T23:59:59Z" },
    ]);
    for (const s of sources) expect(UtcTimestampSchema.safeParse(s.fetchedAt).success).toBe(true);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-11-15T10:20:30.000Z", "2026-11-15T10:20:30+00:00", "yesterday", "", "2026-1-5"])(
    "rejects checkedOn %j as a tool error",
    (checkedOn) => {
      expect(() => buildAdvisories(CERT, JSON.stringify({ advisory: { sources: [{ url: "u", checkedOn }] } }))).toThrow(/checkedOn/);
    },
  );

  it("rejects a missing or non-string checkedOn", () => {
    expect(() => served([{ url: "u" }])).toThrow(/checkedOn/);
    expect(() => served([{ url: "u", checkedOn: 20261115 }])).toThrow(/checkedOn/);
  });

  it("leaves a measurement without advisory.sources unchanged", () => {
    const m = { schemaVersion: 1, advisory: { id: "x" } };
    const out = JSON.parse(buildAdvisories(CERT, JSON.stringify(m)));
    expect(out.measurement).toEqual({ label: "user-checked", content: m });
    const other = JSON.parse(buildAdvisories(CERT, JSON.stringify({ results: [] })));
    expect(other.measurement.content).toEqual({ results: [] });
  });

  it("has no measurement key without measurement text, and keeps certificate provenance unchanged", () => {
    const out = JSON.parse(buildAdvisories(CERT, null));
    expect("measurement" in out).toBe(false);
    expect(out.advisories[0].provenance).toEqual([{ url: "https://api.osv.dev/x", fetchedAt: "2026-05-01T00:00:00Z" }]);
  });
});
