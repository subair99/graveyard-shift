// Requirements: 2.2, 2.3, 2.5, 2.7, 2.8, 2.9, 2.10, 2.11
import { describe, expect, it } from "vitest";
import {
  deserializeEligibilityRecord,
  serializeEligibilityRecord,
  ELIGIBILITY_KEY_ORDER,
} from "../../../src/pipeline/gravedigger/core/eligibility";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { BuildRecordInput } from "../../../src/pipeline/gravedigger/core/record";
import { hasCredentialOrPath } from "../../../src/pipeline/common/canonical";
import { INFLIGHT_CERT, IP_CERT, LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const SRI = "sha512-AAAA";
const AT = "2026-11-16T10:00:00Z";

function input(over: Partial<BuildRecordInput>): BuildRecordInput {
  return {
    name: "ip",
    version: "2.0.1",
    cert: IP_CERT,
    expectedIntegrity: SRI,
    computedIntegrity: SRI,
    pkg: { license: "MIT" },
    lineCount: 900,
    packumentUrl: "https://registry.npmjs.org/ip",
    tarballUrl: "https://registry.npmjs.org/ip/-/ip-2.0.1.tgz",
    fetchedAt: AT,
    ...over,
  };
}

describe("buildEligibilityRecord", () => {
  it("is eligible for ip@2.0.1 and lodash.set@4.3.2 when every rule holds", () => {
    expect(buildEligibilityRecord(input({})).eligible).toBe(true);
    const lodash = buildEligibilityRecord(
      input({ name: "lodash.set", version: "4.3.2", cert: LODASH_SET_CERT }),
    );
    expect(lodash.failedRules).toEqual([]);
    expect(lodash.eligible).toBe(true);
  });

  it("records inflight as not eligible with its successor and every failed rule", () => {
    const rec = buildEligibilityRecord(
      input({
        name: "inflight",
        version: "1.0.6",
        cert: INFLIGHT_CERT,
        pkg: { license: "ISC", dependencies: { once: "1", wrappy: "1" } },
      }),
    );
    expect(rec.eligible).toBe(false);
    expect(rec.successor).toBe("lru-cache");
    expect(rec.failedRules).toEqual(["dependencies", "status", "open-vulnerability"]);
    expect(rec.reason).toBeUndefined();
  });

  it("writes integrity-mismatch with both strings and reads no tarball content", () => {
    const rec = buildEligibilityRecord(input({ computedIntegrity: "sha512-BBBB" }));
    expect(rec).toMatchObject({
      eligible: false,
      reason: "integrity-mismatch",
      integrity: { expected: SRI, computed: "sha512-BBBB", matches: false },
    });
    expect(rec.rules[0]).toMatchObject({ reason: "unverified", missingField: "package.json" });
    expect(rec.facts.map((f) => f.key)).toEqual([
      "integrity.computed",
      "integrity.expected",
      "rule.open-vulnerability",
    ]);
  });

  it("marks an absent license as unverified and not eligible", () => {
    const rec = buildEligibilityRecord(input({ pkg: {} }));
    expect(rec.eligible).toBe(false);
    expect(rec.rules[0]).toMatchObject({ holds: false, reason: "unverified", missingField: "license" });
  });

  it("gives every fact a Source_URL and the one Fetch_Date, and no path or credential", () => {
    const rec = buildEligibilityRecord(input({}));
    expect(rec.facts.length).toBeGreaterThan(0);
    for (const f of rec.facts) {
      expect(f.provenance[0]!.sourceUrl).toMatch(/^https:\/\//);
      expect(f.provenance[0]!.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      if (f.key !== "rule.open-vulnerability") {
        expect(f.provenance[0]!.sourceUrl).toMatch(/^https:\/\/registry\.npmjs\.org\//);
        expect(f.provenance[0]!.fetchedAt).toBe(AT);
      }
    }
    expect(hasCredentialOrPath(serializeEligibilityRecord(rec))).toBe(false);
  });

  // Finding 2 (PR #4): the open-vulnerability count cited the npm registry.
  it("cites the certificate's OSV provenance for open-vulnerability, never the registry or the Gravedigger clock", () => {
    for (const [name, cert] of [
      ["ip", IP_CERT],
      ["inflight", INFLIGHT_CERT],
      ["lodash.set", LODASH_SET_CERT],
    ] as const) {
      const rec = buildEligibilityRecord(input({ name, cert }));
      const fact = rec.facts.find((f) => f.key === "rule.open-vulnerability");
      const certFact = cert.facts.find((f) => f.key === "openVulnerabilities")!;
      expect(fact, name).toBeDefined();
      expect(fact!.provenance, name).toEqual(certFact.provenance);
      expect(fact!.provenance[0]!.sourceUrl, name).toBe("https://api.osv.dev/v1/query");
      expect(fact!.provenance[0]!.fetchedAt, name).not.toBe(AT);
      expect(fact!.value, name).toBe(cert.openVulnerabilityIds.length);
    }
  });

  it("omits the open-vulnerability fact when the certificate has no openVulnerabilities fact", () => {
    const cert = { ...IP_CERT, facts: IP_CERT.facts.filter((f) => f.key !== "openVulnerabilities") };
    const rec = buildEligibilityRecord(input({ cert }));
    expect(rec.facts.some((f) => f.key === "rule.open-vulnerability")).toBe(false);
  });

  it("cites the right source for each rule observation (table)", () => {
    const tarball = "https://registry.npmjs.org/ip/-/ip-2.0.1.tgz";
    const packument = "https://registry.npmjs.org/ip";
    const rec = buildEligibilityRecord(input({ pkg: { license: "MIT", dependencies: {}, type: "commonjs" } }));
    const source = (key: string) => rec.facts.find((f) => f.key === key)?.provenance[0]?.sourceUrl;
    const table: Array<[string, string]> = [
      ["rule.license", tarball],
      ["rule.dependencies", tarball],
      ["rule.module-type", tarball],
      ["rule.line-count", tarball],
      ["rule.open-vulnerability", "https://api.osv.dev/v1/query"],
      ["integrity.expected", packument],
      ["integrity.computed", tarball],
    ];
    for (const [key, url] of table) expect(source(key), key).toBe(url);
  });

  it("produces byte-identical output for identical input", () => {
    const a = serializeEligibilityRecord(buildEligibilityRecord(input({})));
    const b = serializeEligibilityRecord(buildEligibilityRecord(input({})));
    expect(a).toBe(b);
  });
});

describe("serialize and deserialize", () => {
  it("round-trips and writes the top-level keys in table order", () => {
    const text = serializeEligibilityRecord(buildEligibilityRecord(input({})));
    const back = deserializeEligibilityRecord(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(serializeEligibilityRecord(back.value)).toBe(text);
    const keys = Object.keys(JSON.parse(text) as object);
    expect(keys).toEqual(ELIGIBILITY_KEY_ORDER.record.filter((k) => keys.includes(k)));
  });

  it("round-trips the mismatch and inflight shapes", () => {
    for (const rec of [
      buildEligibilityRecord(input({ computedIntegrity: "sha512-BBBB" })),
      buildEligibilityRecord(input({ cert: INFLIGHT_CERT, pkg: { dependencies: { a: "1" } } })),
    ]) {
      const text = serializeEligibilityRecord(rec);
      const back = deserializeEligibilityRecord(text);
      expect(back.ok && serializeEligibilityRecord(back.value)).toBe(text);
    }
  });

  it("rejects malformed JSON and names the root", () => {
    const r = deserializeEligibilityRecord("{nope");
    expect(r).toMatchObject({ ok: false, error: { field: "(root)" } });
  });

  it("names the missing, wrong-typed and unknown fields, with no partial record", () => {
    const base = JSON.parse(serializeEligibilityRecord(buildEligibilityRecord(input({})))) as Record<
      string,
      unknown
    >;
    const { eligible: _e, ...noEligible } = base;
    void _e;
    const cases: Array<[unknown, string]> = [
      [noEligible, "eligible"],
      [{ ...base, integrity: { expected: "x", computed: 5, matches: true } }, "integrity.computed"],
      [{ ...base, extra: 1 }, "extra"],
      [{ ...base, schemaVersion: 2 }, "schemaVersion"],
    ];
    for (const [raw, field] of cases) {
      const r = deserializeEligibilityRecord(JSON.stringify(raw));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe(field);
      expect("value" in r).toBe(false);
    }
  });
});
