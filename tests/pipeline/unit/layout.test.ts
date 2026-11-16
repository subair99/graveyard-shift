// Requirements: 14.2, 14.3, 14.4, 14.12, 14.13, 14.15, 23.11
import { describe, expect, it } from "vitest";
import {
  ENTRY_FILES,
  bundleName,
  buildStubMarker,
  deriveEntryKind,
  planEntryFiles,
} from "../../../src/pipeline/undertaker/core/layout";

const TGZ = "lodash.set-4.3.3.tgz";
const SIX = [
  "certificate.json",
  "deltas.json",
  "eligibility.json",
  "harness.json",
  "lodash.set-4.3.3.tgz",
  "proof-report.json",
];

describe("layout", () => {
  it("bundleName appends .sigstore.json", () => {
    expect(bundleName("proof-report.json")).toBe("proof-report.json.sigstore.json");
  });

  it("deriveEntryKind: proof-report.json means resurrection", () => {
    expect(deriveEntryKind(SIX, null)).toEqual({ ok: true, value: "resurrection" });
    expect(deriveEntryKind(["proof-report.json"], { eligible: false })).toEqual({ ok: true, value: "resurrection" });
  });

  it("deriveEntryKind: eligible false without a report is not-resurrected", () => {
    expect(deriveEntryKind(["certificate.json", "eligibility.json"], { eligible: false })).toEqual({
      ok: true,
      value: "not-resurrected",
    });
  });

  it("deriveEntryKind: anything else is malformed-entry", () => {
    for (const e of [null, { eligible: true }]) {
      const r = deriveEntryKind(["certificate.json", "eligibility.json"], e);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("malformed-entry");
    }
  });

  it("alive plan: six files, three bundles, sorted", () => {
    const plan = planEntryFiles({ kind: "resurrection", verdict: "alive", stub: false, tarballName: TGZ });
    expect(plan).toEqual(
      [
        ...SIX,
        "certificate.json.sigstore.json",
        "lodash.set-4.3.3.tgz.sigstore.json",
        "proof-report.json.sigstore.json",
      ].sort(),
    );
    expect(plan).toHaveLength(9);
  });

  it("restless and inconclusive plans have six files and no bundle", () => {
    for (const verdict of ["restless", "inconclusive"] as const) {
      const plan = planEntryFiles({ kind: "resurrection", verdict, stub: false, tarballName: TGZ });
      expect(plan).toEqual(SIX);
      expect(plan.some((f) => f.endsWith(".sigstore.json"))).toBe(false);
    }
  });

  it("stub-run.json only for a stub", () => {
    const stub = planEntryFiles({ kind: "resurrection", verdict: "restless", stub: true, tarballName: TGZ });
    expect(stub).toContain(ENTRY_FILES.stubMarker);
    expect(stub).toEqual([...SIX, "stub-run.json"].sort());
    const real = planEntryFiles({ kind: "resurrection", verdict: "alive", stub: false, tarballName: TGZ });
    expect(real).not.toContain(ENTRY_FILES.stubMarker);
  });

  it("not-resurrected plan is exactly certificate and eligibility", () => {
    expect(planEntryFiles({ kind: "not-resurrected", verdict: null, stub: false, tarballName: null })).toEqual([
      "certificate.json",
      "eligibility.json",
    ]);
  });

  it("planned files derive the planned kind", () => {
    const plan = planEntryFiles({ kind: "resurrection", verdict: "alive", stub: false, tarballName: TGZ });
    expect(deriveEntryKind(plan, null)).toEqual({ ok: true, value: "resurrection" });
  });

  it("stub marker is the fixed object", () => {
    expect(buildStubMarker()).toEqual({ schemaVersion: 1, mode: "stub", label: "stub run" });
  });
});
