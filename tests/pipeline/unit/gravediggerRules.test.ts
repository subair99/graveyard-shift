// Requirements: 2.3, 2.4, 2.5, 2.6, 2.8, 2.12, 2.13
import { describe, expect, it } from "vitest";
import { countLines, evaluateRules, RULE_IDS } from "../../../src/pipeline/gravedigger/core/rules";
import {
  INFLIGHT_CERT,
  IP_CERT,
  LODASH_SET_CERT,
  OSV_UNAVAILABLE_CERT,
  withCert,
} from "../helpers/gravediggerCerts";

const bytes = (s: string) => new TextEncoder().encode(s);
const file = (path: string, b: Uint8Array) => ({ path, bytes: b });

describe("countLines", () => {
  it("counts newlines plus an unterminated last line", () => {
    expect(countLines([file("a", bytes("a\nb\nc"))])).toBe(3);
    expect(countLines([file("a", bytes("a\nb\nc\n"))])).toBe(3);
    expect(countLines([file("a", bytes("\n"))])).toBe(1);
    expect(countLines([file("a", bytes(""))])).toBe(0);
  });

  it("sums over files and skips files with a NUL byte", () => {
    const bin = new Uint8Array([97, 10, 0, 10, 98]);
    expect(countLines([file("a", bytes("1\n2\n")), file("b", bytes("3")), file("c", bin)])).toBe(3);
  });

  it("skips files that are not strict UTF-8", () => {
    const bad = new Uint8Array([0xff, 0xfe, 10, 10]);
    expect(countLines([file("a", bad), file("b", bytes("x\n"))])).toBe(1);
  });
});

describe("evaluateRules", () => {
  const goodPkg = { license: "MIT" };

  it("returns the seven rules in fixed order", () => {
    const rules = evaluateRules({ pkg: goodPkg, lineCount: 10, cert: IP_CERT });
    expect(rules.map((r) => r.rule)).toEqual([...RULE_IDS]);
  });

  it("holds for ip@2.0.1 and lodash.set@4.3.2 style inputs", () => {
    for (const cert of [IP_CERT, LODASH_SET_CERT]) {
      const rules = evaluateRules({ pkg: goodPkg, lineCount: 800, cert });
      expect(rules.every((r) => r.holds)).toBe(true);
    }
  });

  it("fails dependencies and status for inflight, which is retired with a successor", () => {
    const pkg = { license: "ISC", dependencies: { once: "^1.3.0", wrappy: "1" } };
    const rules = evaluateRules({ pkg, lineCount: 100, cert: INFLIGHT_CERT });
    const failed = rules.filter((r) => !r.holds).map((r) => r.rule);
    expect(failed).toEqual(["dependencies", "status", "open-vulnerability"]);
    expect(rules[1]).toMatchObject({ observed: 2 });
    expect(rules[4]).toMatchObject({ observed: "retired-with-successor" });
  });

  it("applies each limit at its boundary", () => {
    const at = evaluateRules({ pkg: goodPkg, lineCount: 5000, cert: IP_CERT })[3]!;
    const over = evaluateRules({ pkg: goodPkg, lineCount: 5001, cert: IP_CERT })[3]!;
    expect(at.holds).toBe(true);
    expect(over).toMatchObject({ holds: false, observed: 5001 });
  });

  it("rejects licenses outside the list, SPDX expressions and the module type", () => {
    const run = (pkg: object) => evaluateRules({ pkg, lineCount: 1, cert: IP_CERT });
    expect(run({ license: "GPL-3.0" })[0]!.holds).toBe(false);
    expect(run({ license: "(MIT OR ISC)" })[0]!.holds).toBe(false);
    expect(run({ license: "BSD-3-Clause" })[0]!.holds).toBe(true);
    expect(run({ license: "MIT", type: "module" })[2]!.holds).toBe(false);
    expect(run({ license: "MIT", type: "commonjs" })[2]!.holds).toBe(true);
    expect(run({ license: "MIT", dependencies: {} })[1]!.holds).toBe(true);
  });

  it("records an unreadable field as unverified with its name, never as holding", () => {
    const rules = evaluateRules({ pkg: {}, lineCount: null, cert: IP_CERT });
    expect(rules[0]).toMatchObject({ holds: false, reason: "unverified", missingField: "license" });
    expect(rules[3]).toMatchObject({ holds: false, reason: "unverified", missingField: "lineCount" });
    const noPkg = evaluateRules({ pkg: null, lineCount: null, cert: IP_CERT });
    expect(noPkg.slice(0, 3).map((r) => r.missingField)).toEqual([
      "package.json",
      "package.json",
      "package.json",
    ]);
  });

  it("marks status unverified when the certificate has no status", () => {
    const cert = withCert(IP_CERT, { status: undefined, statusError: "npm unavailable" });
    const rule = evaluateRules({ pkg: goodPkg, lineCount: 1, cert })[4]!;
    expect(rule).toMatchObject({ holds: false, reason: "unverified", missingField: "status" });
  });

  it("marks open-vulnerability unverified when OSV was unavailable, never failed with observed 0", () => {
    const rule = evaluateRules({ pkg: goodPkg, lineCount: 1, cert: OSV_UNAVAILABLE_CERT })[6]!;
    expect(rule).toEqual({
      rule: "open-vulnerability",
      holds: false,
      observed: null,
      reason: "unverified",
      missingField: "openVulnerabilities",
    });
  });

  describe("causes with an unavailable input (R2.6)", () => {
    const off = (source: "npm" | "osv" | "github") => ({
      available: false as const,
      source,
      attemptedUrl: "https://example.org/x",
      attemptedAt: "2026-11-15T19:03:19Z",
      reason: "timeout after 10 seconds",
    });
    const noGithub = IP_CERT.facts.filter((f) => f.key !== "githubRepo");
    const causesOf = (patch: Partial<typeof IP_CERT>) =>
      evaluateRules({ pkg: goodPkg, lineCount: 1, cert: withCert(IP_CERT, patch) })[5]!;

    it("no cause found and one input unavailable: unverified, naming the input", () => {
      const cases: Array<[Partial<typeof IP_CERT>, string]> = [
        [{ vitalSigns: { ...IP_CERT.vitalSigns, maintainers: off("npm") } }, "maintainers"],
        [{ facts: noGithub }, "githubRepo"],
        [{ vitalSigns: { ...IP_CERT.vitalSigns, openVulnerabilities: off("osv") } }, "openVulnerabilities"],
        [{ timeOfDeath: off("npm") }, "timeOfDeath"],
      ];
      for (const [patch, field] of cases) {
        expect(causesOf({ ...patch, causes: [] }), field).toEqual({
          rule: "causes",
          holds: false,
          observed: null,
          reason: "unverified",
          missingField: field,
        });
      }
    });

    it("names every unavailable input, comma-separated in detectCauses order", () => {
      const rule = causesOf({
        causes: [],
        timeOfDeath: off("npm"),
        facts: noGithub,
        vitalSigns: { ...IP_CERT.vitalSigns, maintainers: off("npm"), openVulnerabilities: off("osv") },
      });
      expect(rule.missingField).toBe("maintainers,githubRepo,openVulnerabilities,timeOfDeath");
    });

    it("a githubRepo fact omitted for missing provenance counts as read", () => {
      const notes = { ...IP_CERT.notes, omittedFacts: [{ key: "githubRepo", reason: "missing-provenance" as const }] };
      expect(causesOf({ causes: [], facts: noGithub, notes })).toEqual({ rule: "causes", holds: false, observed: 0 });
    });

    it("a cause whose inputs are all available holds even when an unrelated input is unavailable", () => {
      const rule = causesOf({
        causes: ["maintainer-gone"],
        facts: noGithub,
        vitalSigns: { ...IP_CERT.vitalSigns, openVulnerabilities: off("osv") },
      });
      expect(rule).toEqual({ rule: "causes", holds: true, observed: 1 });
    });

    it("runtime-rot alone with githubRepo unavailable: unverified, naming githubRepo only", () => {
      const rule = causesOf({
        causes: ["runtime-rot"],
        facts: noGithub,
        vitalSigns: { ...IP_CERT.vitalSigns, openVulnerabilities: off("osv") },
      });
      expect(rule).toEqual({
        rule: "causes",
        holds: false,
        observed: null,
        reason: "unverified",
        missingField: "githubRepo",
      });
    });

    it("runtime-rot with githubRepo unavailable plus a cause with all inputs available: holds", () => {
      const rule = causesOf({ causes: ["maintainer-gone", "runtime-rot"], facts: noGithub });
      expect(rule).toEqual({ rule: "causes", holds: true, observed: 2 });
    });

    it("runtime-rot with all inputs available holds", () => {
      expect(causesOf({ causes: ["runtime-rot"] })).toEqual({ rule: "causes", holds: true, observed: 1 });
    });
  });

  it("fails causes and open-vulnerability when the lists are empty", () => {
    const cert = withCert(IP_CERT, { causes: [], openVulnerabilityIds: [] });
    const rules = evaluateRules({ pkg: goodPkg, lineCount: 1, cert });
    expect(rules[5]).toMatchObject({ holds: false, observed: 0 });
    expect(rules[6]).toMatchObject({ holds: false, observed: 0 });
  });
});
