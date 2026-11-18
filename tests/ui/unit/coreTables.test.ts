// Requirements: 2.5, 2.10, 4.2, 12.2, 12.3, 12.5
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NIGHTLY_RESULT_ORDER } from "../../../src/pipeline/undertaker/core/nightlyClassify";
import { causeView } from "../../../src/ui/core/causes";
import { checkEntryFileNames } from "../../../src/ui/core/entryFiles";
import { nightlyLabel } from "../../../src/ui/core/nightlyLabels";
import { DOCUMENTED_CONCLUSIONS, NightlyRunRecordSchema } from "../../../src/ui/core/nightlyRun";
import { versionFromPackageJson } from "../../../src/ui/core/resurrectionVersion";

const SHA = "a".repeat(40);
const record = (conclusion: unknown): unknown => ({
  schemaVersion: 1,
  runId: 123,
  runStartedAt: "2026-11-17T03:00:00Z",
  conclusion,
  headSha: SHA,
  buildSha: SHA,
});

describe("causeView", () => {
  it("labels the four codes and keeps the code", () => {
    for (const code of ["maintainer-gone", "repo-archived", "unpatched-cve", "runtime-rot"]) {
      const v = causeView(code);
      expect(v.code).toBe(code);
      expect(v.label).not.toBeNull();
    }
  });
  it("gives an unknown code no label", () => {
    expect(causeView("toString")).toEqual({ code: "toString", label: null });
  });
});

describe("nightlyLabel", () => {
  it("has a non-empty label for every NightlyResult and Verdict", () => {
    for (const result of NIGHTLY_RESULT_ORDER) {
      for (const verdict of ["alive", "restless", "inconclusive", null] as const) {
        expect(nightlyLabel(result, verdict).length).toBeGreaterThan(0);
      }
    }
  });
  it("the non-alive verified label names neither verification nor attestation", () => {
    for (const verdict of ["restless", "inconclusive", null] as const) {
      const label = nightlyLabel("verified", verdict).toLowerCase();
      expect(label).not.toContain("verified");
      expect(label).not.toContain("attested");
    }
  });
});

describe("checkEntryFileNames", () => {
  const root = join(process.cwd(), "graveyard");
  const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  it("finds committed entries", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });
  for (const d of dirs) {
    it(`accepts the committed file set of ${d.name}`, () => {
      const files = readdirSync(join(root, d.name));
      expect(checkEntryFileNames(files).ok).toBe(true);
    });
  }
  const base = ["certificate.json", "eligibility.json", "deltas.json", "harness.json", "proof-report.json"];
  it("returns the tarball name", () => {
    const r = checkEntryFileNames([...base, "x-1.0.0.tgz", "x-1.0.0.tgz.sigstore.json"]);
    expect(r).toEqual({ ok: true, value: { tarballName: "x-1.0.0.tgz" } });
  });
  it("rejects a second .tgz", () => {
    expect(checkEntryFileNames([...base, "a.tgz", "b.tgz"]).ok).toBe(false);
  });
  it("rejects an unknown name and a bundle of an unknown subject", () => {
    const r = checkEntryFileNames([...base, "notes.txt"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("notes.txt");
    expect(checkEntryFileNames([...base, "deltas.json.sigstore.json"]).ok).toBe(false);
  });
});

describe("NightlyRunRecordSchema", () => {
  it("accepts every documented conclusion and an undocumented well-formed one", () => {
    for (const c of [...DOCUMENTED_CONCLUSIONS, "some_new_value"]) {
      expect(NightlyRunRecordSchema.safeParse(record(c)).success).toBe(true);
    }
  });
  it("rejects an empty, null, capitalised or 33-character conclusion", () => {
    for (const c of ["", null, "Success", "a".repeat(33)]) {
      expect(NightlyRunRecordSchema.safeParse(record(c)).success).toBe(false);
    }
  });
  it("accepts a 32-character conclusion", () => {
    expect(NightlyRunRecordSchema.safeParse(record("a".repeat(32))).success).toBe(true);
  });
});

describe("versionFromPackageJson", () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  it("reads a valid version", () => {
    expect(versionFromPackageJson(enc('{"version":"1.2.3"}'))).toEqual({ ok: true, value: "1.2.3" });
  });
  it("rejects bad UTF-8, bad JSON, non-objects, missing and non-canonical versions", () => {
    expect(versionFromPackageJson(new Uint8Array([0xff, 0xfe])).ok).toBe(false);
    expect(versionFromPackageJson(enc("{")).ok).toBe(false);
    expect(versionFromPackageJson(enc("[]")).ok).toBe(false);
    expect(versionFromPackageJson(enc("{}")).ok).toBe(false);
    expect(versionFromPackageJson(enc('{"version":"v1.2.3"}')).ok).toBe(false);
    expect(versionFromPackageJson(enc('{"version":1}')).ok).toBe(false);
  });
});
