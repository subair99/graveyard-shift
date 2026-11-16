// Requirements: 2.3, 2.4, 2.5, 2.6, 2.8
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

  it("fails causes and open-vulnerability when the lists are empty", () => {
    const cert = withCert(IP_CERT, { causes: [], openVulnerabilityIds: [] });
    const rules = evaluateRules({ pkg: goodPkg, lineCount: 1, cert });
    expect(rules[5]).toMatchObject({ holds: false, observed: 0 });
    expect(rules[6]).toMatchObject({ holds: false, observed: 0 });
  });
});
