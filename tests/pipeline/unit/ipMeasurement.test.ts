// Requirements: 3.3, 3.5, 3.6, 3.7, 3.8, 3.11, 19.3, 19.4
import { describe, expect, it } from "vitest";
import {
  ADVISORY_ADDRESSES,
  INFORMATIONAL_ADDRESSES,
  canonicalIpMeasurementJson,
  deriveIpDeltas,
  parseIpMeasurement,
  printIpMeasurement,
  type IpMeasurement,
  type MeasuredInput,
} from "../../../src/pipeline/harness/core/ipMeasurement";

type Outcome = MeasuredInput["outcome"];

const returned = (value: boolean | string | number | null): Outcome => ({ kind: "returned", value });

function measurement(
  results: Outcome[],
  informational: Outcome[] = [returned(false), returned(false)],
): IpMeasurement {
  return {
    schemaVersion: 1,
    package: "ip",
    version: "2.0.1",
    integrity: "sha512-" + "A".repeat(86) + "==",
    node: "v22.0.0",
    measuredAt: "2026-11-16T10:00:00Z",
    advisory: {
      id: "GHSA-2p57-rm9w-gvfp",
      aliases: ["CVE-2024-29415"],
      sources: [{ url: "https://github.com/advisories/GHSA-2p57-rm9w-gvfp", checkedOn: "2026-11-15" }],
    },
    results: ADVISORY_ADDRESSES.map((input, i) => ({ input, outcome: results[i]! })),
    informational: INFORMATIONAL_ADDRESSES.map((input, i) => ({ input, outcome: informational[i]! })),
  };
}

const allFalse = (): Outcome[] => ADVISORY_ADDRESSES.map(() => returned(false));

describe("deriveIpDeltas", () => {
  it("removes ip from the demo when all five return false", () => {
    expect(deriveIpDeltas(measurement(allFalse()))).toEqual({ addresses: [], ipInDemo: false });
  });

  it("keeps only the addresses that returned true, in fixed order", () => {
    const r = allFalse();
    r[1] = returned(true);
    r[4] = returned(true);
    expect(deriveIpDeltas(measurement(r))).toEqual({
      addresses: ["01200034567", "::fFFf:127.0.0.1"],
      ipInDemo: true,
    });
  });

  it("gives no delta for a thrown error or a value other than true", () => {
    const r: Outcome[] = [
      { kind: "threw", error: "boom" },
      returned("true"),
      returned(1),
      returned(null),
      returned(true),
    ];
    expect(deriveIpDeltas(measurement(r))).toEqual({
      addresses: ["::fFFf:127.0.0.1"],
      ipInDemo: true,
    });
  });

  it("ignores informational inputs", () => {
    const m = measurement(allFalse(), [returned(true), returned(true)]);
    expect(deriveIpDeltas(m)).toEqual({ addresses: [], ipInDemo: false });
  });
});

describe("parse and print", () => {
  it("round-trips through the printed and canonical forms", () => {
    const m = measurement([returned(true), returned(false), { kind: "threw", error: "x" }, returned(false), returned(false)]);
    const printed = parseIpMeasurement(printIpMeasurement(m));
    expect(printed).toEqual({ ok: true, value: m });
    const canonical = parseIpMeasurement(canonicalIpMeasurementJson(m));
    expect(canonical).toEqual({ ok: true, value: m });
    expect(canonicalIpMeasurementJson(m)).not.toContain("\n");
    expect(printIpMeasurement(m).endsWith("}\n")).toBe(true);
  });

  it("writes keys in the fixed order whatever the construction order", () => {
    const m = measurement(allFalse());
    const shuffled = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(shuffled).reverse()) as unknown as IpMeasurement;
    expect(canonicalIpMeasurementJson(reversed)).toBe(canonicalIpMeasurementJson(m));
    expect(canonicalIpMeasurementJson(m).startsWith('{"schemaVersion":1,"package":"ip"')).toBe(true);
  });

  it("names the failing path of malformed JSON text", () => {
    const r = parseIpMeasurement("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.issues[0]).toMatch(/^\(root\): malformed JSON/);
  });

  it("names the failing path of a schema violation", () => {
    const bad = JSON.parse(canonicalIpMeasurementJson(measurement(allFalse()))) as {
      results: { input: string }[];
    };
    bad.results[2]!.input = "1.2.3.4";
    const r = parseIpMeasurement(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.issues.join("\n")).toContain("results.2.input");
  });

  it("rejects a result list that is not five long and names the path", () => {
    const bad = JSON.parse(canonicalIpMeasurementJson(measurement(allFalse()))) as {
      results: unknown[];
    };
    bad.results.pop();
    const r = parseIpMeasurement(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.issues.join("\n")).toContain("results");
  });

  it("rejects an unknown key and a bad integrity with their paths", () => {
    const bad = JSON.parse(canonicalIpMeasurementJson(measurement(allFalse()))) as Record<string, unknown>;
    bad["integrity"] = "sha512-short";
    bad["extra"] = 1;
    const r = parseIpMeasurement(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = r.error.issues.join("\n");
      expect(text).toContain("integrity");
      expect(text).toContain("extra");
    }
  });
});
