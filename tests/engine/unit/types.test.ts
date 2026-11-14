import { describe, expect, it } from "vitest";
import {
  DeathCertificateSchema,
  DepsDevDependentsSchema,
  GitHubRepoSchema,
  NpmPackumentSchema,
  OsvResponseSchema,
  safeParseResult,
} from "../../../src/engine/types";

const unavailable = {
  available: false,
  source: "npm",
  attemptedUrl: "https://registry.npmjs.org/x",
  attemptedAt: "2026-01-01T00:00:00Z",
  reason: "timeout",
};

function validCert(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    package: { name: "ip", version: "2.0.1" },
    analysisDate: "2026-11-14T12:00:00Z",
    status: "dead",
    causes: ["unpatched-cve"],
    openVulnerabilityIds: ["GHSA-aaaa"],
    timeOfDeath: { available: true, value: "2024-01-01T00:00:00Z" },
    daysSinceDeath: 10,
    vitalSigns: {
      maintainers: { available: true, value: ["a"] },
      openVulnerabilities: { available: true, value: [] },
      scorecard: { available: true, value: 4.5 },
      dependents: unavailable,
      weeklyDownloads: { available: true, value: 5 },
    },
    riskScore: 50,
    risk: {
      contributions: [{ component: "cause:unpatched-cve", points: 25 }],
      rawScore: 25,
      formula: { weights: { a: 1 }, thresholds: { b: 2 } },
      unavailable: ["dependents"],
    },
    facts: [
      {
        key: "maintainers",
        value: ["a"],
        provenance: [
          { sourceUrl: "https://registry.npmjs.org/ip", fetchedAt: "2026-11-14T11:00:00Z" },
        ],
      },
    ],
    notes: { githubTokenUsed: false, omittedFacts: [] },
  };
}

describe("DeathCertificateSchema", () => {
  it("accepts a valid certificate", () => {
    expect(DeathCertificateSchema.safeParse(validCert()).success).toBe(true);
  });

  it("rejects a fact with no provenance", () => {
    const c = validCert();
    (c.facts as Array<Record<string, unknown>>)[0]!.provenance = [];
    expect(DeathCertificateSchema.safeParse(c).success).toBe(false);
  });

  it("rejects riskScore 101", () => {
    expect(DeathCertificateSchema.safeParse({ ...validCert(), riskScore: 101 }).success).toBe(
      false,
    );
  });

  it("rejects a fetchedAt with milliseconds or an invalid date", () => {
    for (const bad of ["2026-11-14T11:00:00.123Z", "2026-02-30T11:00:00Z"]) {
      const c = validCert();
      (c.facts as Array<{ provenance: Array<{ fetchedAt: string }> }>)[0]!.provenance[0]!.fetchedAt =
        bad;
      expect(DeathCertificateSchema.safeParse(c).success).toBe(false);
    }
  });

  it("allows missing status only with statusError", () => {
    const { status: _status, ...rest } = validCert();
    expect(DeathCertificateSchema.safeParse(rest).success).toBe(false);
    expect(DeathCertificateSchema.safeParse({ ...rest, statusError: "no risk" }).success).toBe(
      true,
    );
  });
});

describe("upstream schemas", () => {
  it("tolerate extra fields", () => {
    expect(
      safeParseResult(GitHubRepoSchema, { archived: true, pushed_at: null, id: 1 }).ok,
    ).toBe(true);
    expect(
      safeParseResult(NpmPackumentSchema, { name: "x", readme: "...", other: 1 }).ok,
    ).toBe(true);
    expect(safeParseResult(OsvResponseSchema, { vulns: [{ id: "A", extra: 1 }] }).ok).toBe(true);
  });

  it("return a typed failure, not an exception, on missing used fields", () => {
    const r = safeParseResult(DepsDevDependentsSchema, { directDependentCount: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.issues[0]).toContain("dependentCount");
  });
});
