// Requirements: 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.14, 2.15
import { describe, expect, it } from "vitest";
import {
  deserializeEligibilityRecord,
  serializeEligibilityRecord,
  ELIGIBILITY_KEY_ORDER,
} from "../../../src/pipeline/gravedigger/core/eligibility";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { BuildRecordInput } from "../../../src/pipeline/gravedigger/core/record";
import { hasCredentialOrPath } from "../../../src/pipeline/common/canonical";
import {
  INFLIGHT_CERT,
  IP_CERT,
  LODASH_SET_CERT,
  OSV_UNAVAILABLE_CERT,
  withCert,
} from "../helpers/gravediggerCerts";

const SRI = "sha512-AAAA";
const AT = "2026-11-16T10:00:00Z";
/** Rule facts whose provenance is copied from the certificate. */
const FROM_CERT = ["rule.status", "rule.causes", "rule.open-vulnerability"];

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
      "rule.causes",
      "rule.open-vulnerability",
      "rule.status",
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
      if (!FROM_CERT.includes(f.key)) {
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

  it("cites the right sources for each rule observation (table)", () => {
    const tarball = "https://registry.npmjs.org/ip/-/ip-2.0.1.tgz";
    const packument = "https://registry.npmjs.org/ip";
    const C = "2026-11-15T19:03:19Z"; // the Coroner's fetch date of every ip certificate fact
    const rec = buildEligibilityRecord(input({ pkg: { license: "MIT", dependencies: {}, type: "commonjs" } }));
    const sources = (key: string) => rec.facts.find((f) => f.key === key)?.provenance;
    const own = (url: string) => [{ sourceUrl: url, fetchedAt: AT }];
    const cert = (...urls: string[]) => urls.map((sourceUrl) => ({ sourceUrl, fetchedAt: C }));
    const table: Array<[string, unknown]> = [
      ["rule.license", own(tarball)],
      ["rule.dependencies", own(tarball)],
      ["rule.module-type", own(tarball)],
      ["rule.line-count", own(tarball)],
      // successor, successorLookup:*, deprecation, the cause facts and the risk facts; ip has no
      // successor or deprecation fact. maintainers and timeOfDeath share one entry.
      [
        "rule.status",
        cert(
          "https://api.deps.dev/v3/projects/github.com%2Findutny%2Fnode-ip",
          "https://api.deps.dev/v3alpha/systems/npm/packages/ip/versions/2.0.1:dependents",
          "https://api.github.com/repos/indutny/node-ip",
          "https://api.npmjs.org/downloads/point/last-week/ip",
          "https://api.osv.dev/v1/query",
          packument,
        ),
      ],
      // maintainers, githubRepo, openVulnerabilities, timeOfDeath
      [
        "rule.causes",
        cert("https://api.github.com/repos/indutny/node-ip", "https://api.osv.dev/v1/query", packument),
      ],
      ["rule.open-vulnerability", cert("https://api.osv.dev/v1/query")],
      ["integrity.expected", own(packument)],
      ["integrity.computed", own(tarball)],
    ];
    for (const [key, expected] of table) expect(sources(key), key).toEqual(expected);
    expect(rec.facts.map((f) => f.key).sort()).toEqual(table.map(([k]) => k).sort());
  });

  it("status of inflight cites the successor lookup once and no Gravedigger date", () => {
    const rec = buildEligibilityRecord(input({ name: "inflight", version: "1.0.6", cert: INFLIGHT_CERT }));
    const status = rec.facts.find((f) => f.key === "rule.status")!;
    expect(status.value).toBe("retired-with-successor");
    const urls = status.provenance.map((p) => p.sourceUrl);
    expect(urls.filter((u) => u === "https://registry.npmjs.org/lru-cache")).toHaveLength(1);
    expect(urls.filter((u) => u === "https://registry.npmjs.org/inflight")).toHaveLength(1);
    expect(status.provenance).toHaveLength(7);
    expect(status.provenance.some((p) => p.fetchedAt === AT)).toBe(false);
  });

  it("unions status and causes provenance: deduplicated, ordered by sourceUrl then fetchedAt, stale carried", () => {
    const npm = "https://registry.npmjs.org/ip";
    const p = (sourceUrl: string, fetchedAt: string) => ({ sourceUrl, fetchedAt });
    const cert = withCert(IP_CERT, {
      facts: [
        // Two facts share the packument URL and date (one entry); a third has the same URL, an earlier date.
        { key: "maintainers", value: [], provenance: [p(npm, "2026-11-15T19:03:19Z")] },
        { key: "timeOfDeath", value: "2020-01-01T00:00:00Z", provenance: [p(npm, "2026-11-15T19:03:19Z")], stale: true },
        { key: "githubRepo", value: { archived: false, pushedAt: null }, provenance: [p(npm, "2026-11-14T00:00:00Z")] },
        { key: "openVulnerabilities", value: [], provenance: [p("https://api.osv.dev/v1/query", "2026-11-15T19:03:19Z")] },
        // Not a cause input: only in status.
        { key: "scorecard", value: 3, provenance: [p("https://api.deps.dev/v3/projects/x", "2026-11-15T19:03:19Z")] },
      ],
    });
    const rec = buildEligibilityRecord(input({ cert }));
    const causes = rec.facts.find((f) => f.key === "rule.causes")!;
    expect(causes.provenance).toEqual([
      p("https://api.osv.dev/v1/query", "2026-11-15T19:03:19Z"),
      p(npm, "2026-11-14T00:00:00Z"),
      p(npm, "2026-11-15T19:03:19Z"),
    ]);
    expect(causes.stale).toBe(true);
    const status = rec.facts.find((f) => f.key === "rule.status")!;
    expect(status.provenance.map((x) => x.sourceUrl)).toEqual([
      "https://api.deps.dev/v3/projects/x",
      "https://api.osv.dev/v1/query",
      npm,
      npm,
    ]);
  });

  it("keeps the first 20 entries in canonical order when the union is larger", () => {
    const lookups = Array.from({ length: 25 }, (_, n) => ({
      key: `successorLookup:c${String(n).padStart(2, "0")}`,
      value: { result: "not-found" },
      provenance: [{ sourceUrl: `https://registry.npmjs.org/c${String(n).padStart(2, "0")}`, fetchedAt: "2026-11-15T19:03:19Z" }],
    }));
    const rec = buildEligibilityRecord(input({ cert: withCert(IP_CERT, { facts: [...IP_CERT.facts, ...lookups] }) }));
    const status = rec.facts.find((f) => f.key === "rule.status")!;
    expect(status.provenance).toHaveLength(20);
    const all = [...new Set([...IP_CERT.facts, ...lookups].flatMap((f) => f.provenance.map((x) => x.sourceUrl)))].sort();
    expect(status.provenance.map((x) => x.sourceUrl)).toEqual(all.slice(0, 20));
    expect(status.provenanceTotal).toBe(all.length);
    expect(all.length).toBeGreaterThan(20);
    const text = serializeEligibilityRecord(rec);
    expect(text).toContain(`"provenance":[`);
    expect(text).toContain(`],"provenanceTotal":${all.length}`);
    const back = deserializeEligibilityRecord(text);
    expect(back.ok && serializeEligibilityRecord(back.value)).toBe(text);
  });

  it("writes provenanceTotal only when entries were dropped, and the schema rejects it otherwise", () => {
    const rec = buildEligibilityRecord(input({}));
    expect(rec.facts.some((f) => "provenanceTotal" in f)).toBe(false);
    const raw = JSON.parse(serializeEligibilityRecord(rec)) as { facts: Array<Record<string, unknown>> };
    raw.facts[0]!.provenanceTotal = 21; // only one provenance entry kept: inconsistent
    const r = deserializeEligibilityRecord(JSON.stringify(raw));
    expect(r).toMatchObject({ ok: false, error: { field: "facts.0.provenanceTotal" } });
  });

  it("causes unverified when no cause was found and GitHub was not read: no rule.causes fact", () => {
    const cert = withCert(IP_CERT, { causes: [], facts: IP_CERT.facts.filter((f) => f.key !== "githubRepo") });
    const rec = buildEligibilityRecord(input({ cert }));
    expect(rec.rules[5]).toEqual({
      rule: "causes",
      holds: false,
      observed: null,
      reason: "unverified",
      missingField: "githubRepo",
    });
    expect(rec.failedRules).toContain("causes");
    expect(rec.facts.some((f) => f.key === "rule.causes")).toBe(false);
    const text = serializeEligibilityRecord(rec);
    const back = deserializeEligibilityRecord(text);
    expect(back.ok && serializeEligibilityRecord(back.value)).toBe(text);
  });

  it("runtime-rot as the only cause with GitHub not read: causes unverified, no rule.causes fact", () => {
    const cert = withCert(IP_CERT, { causes: ["runtime-rot"], facts: IP_CERT.facts.filter((f) => f.key !== "githubRepo") });
    const rec = buildEligibilityRecord(input({ cert }));
    expect(rec.rules[5]).toMatchObject({ holds: false, reason: "unverified", missingField: "githubRepo" });
    expect(rec.facts.some((f) => f.key === "rule.causes")).toBe(false);
  });

  it("OSV unavailable: open-vulnerability is unverified, has no fact, and the record is not eligible", () => {
    const rec = buildEligibilityRecord(input({ cert: OSV_UNAVAILABLE_CERT }));
    expect(rec.rules[6]).toMatchObject({ holds: false, observed: null, reason: "unverified", missingField: "openVulnerabilities" });
    expect(rec.failedRules).toEqual(["open-vulnerability"]);
    expect(rec.eligible).toBe(false);
    expect(rec.facts.some((f) => f.key === "rule.open-vulnerability")).toBe(false);
    // The status and causes facts cite no OSV source, because the OSV fact is absent.
    for (const key of ["rule.status", "rule.causes"]) {
      const fact = rec.facts.find((f) => f.key === key)!;
      expect(fact.provenance.some((p) => p.sourceUrl.includes("osv.dev")), key).toBe(false);
    }
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
