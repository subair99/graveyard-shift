// Requirements: 9.5, 9.6, 9.7, 9.8, 9.9, 9.12
import { describe, expect, it } from "vitest";
import { ALLOWED_MEDIUM_PATHS, INTAKE_LIMITS } from "../../../src/pipeline/common/constants";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import type { IntakeEntry, ViolationCode } from "../../../src/pipeline/intake/core/types";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function file(path: string, text = "x"): IntakeEntry {
  const bytes = enc(text);
  return { path, type: "file", size: bytes.length, bytes };
}

function sized(path: string, size: number): IntakeEntry {
  return { path, type: "file", size };
}

const base = (): IntakeEntry[] => [
  file("resurrection/package.json", "{}"),
  file("deltas.json", "{}"),
  file("harness.json", "{}"),
];

function codes(entries: readonly IntakeEntry[]): ViolationCode[] {
  const result = validateIntake(entries);
  return result.ok ? [] : result.violations.map((v) => v.code);
}

describe("validateIntake", () => {
  it("accepts the three allowed paths and returns the files", () => {
    const entries = [...base(), file("resurrection/LICENSE", "MIT"), file("resurrection/lib/a.js", "1")];
    const result = validateIntake(entries);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files).toHaveLength(entries.length);
  });

  it("uses the allowlist from the shared constants", () => {
    expect(ALLOWED_MEDIUM_PATHS).toEqual(["resurrection/", "deltas.json", "harness.json"]);
  });

  it.each([
    ["/etc/passwd", "bad-path"],
    ["resurrection/../x.js", "bad-path"],
    ["resurrection\\a.js", "bad-path"],
    ["resurrection/a\0.js", "bad-path"],
    ["C:/x.js", "bad-path"],
    ["resurrection//a.js", "bad-path"],
    ["resurrection/.git/config", "bad-path"],
    ["resurrection/.github/x.json", "bad-path"],
    ["resurrection/.KIRO/x.json", "bad-path"],
    ["src/a.js", "outside-allowlist"],
    ["Resurrection/a.js", "outside-allowlist"],
    ["deltas.json.bak", "outside-allowlist"],
  ] as const)("reports %j as %s", (path, code) => {
    expect(codes([...base(), file(path)])).toContain(code);
  });

  it.each(["symlink", "hardlink", "submodule", "device", "other"] as const)("rejects a %s", (type) => {
    expect(codes([...base(), { path: "resurrection/l.js", type, size: 1 }])).toEqual(["link"]);
  });

  it("reports both paths of a case collision", () => {
    const result = validateIntake([...base(), file("resurrection/a.js"), file("resurrection/A.js")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((v) => [v.path, v.code])).toEqual([
        ["resurrection/A.js", "case-collision"],
        ["resurrection/a.js", "case-collision"],
      ]);
    }
  });

  it("accepts limits exactly and rejects one above", () => {
    const many = (n: number): IntakeEntry[] =>
      Array.from({ length: n }, (_, i) => sized(`resurrection/f${i}.js`, 1));
    expect(codes([...base(), ...many(INTAKE_LIMITS.maxFiles - 1)])).toEqual([]); // plus package.json = 200
    expect(codes([...base(), ...many(INTAKE_LIMITS.maxFiles)])).toEqual(["too-many-files"]);

    expect(codes([...base(), sized("resurrection/a.js", INTAKE_LIMITS.maxFileBytes)])).toEqual([]);
    expect(codes([...base(), sized("resurrection/a.js", INTAKE_LIMITS.maxFileBytes + 1)])).toEqual(["file-too-large"]);

    const baseBytes = 6; // three files of "{}"
    const four = Array.from({ length: 4 }, (_, i) => sized(`resurrection/b${i}.js`, INTAKE_LIMITS.maxFileBytes));
    const rest = INTAKE_LIMITS.maxTotalBytes - 4 * INTAKE_LIMITS.maxFileBytes - baseBytes;
    expect(codes([...base(), ...four, sized("resurrection/c.js", rest)])).toEqual([]); // exactly the total limit
    expect(codes([...base(), ...four, sized("resurrection/c.js", rest + 1)])).toEqual(["total-too-large"]);

    const deep = (segments: number): string => `resurrection/${"d/".repeat(segments - 2)}x.js`;
    expect(codes([...base(), sized(deep(8), 1)])).toEqual([]); // 8 segments
    expect(codes([...base(), sized(deep(9), 1)])).toEqual(["too-deep"]);

    const control = (size: number): IntakeEntry[] => [
      file("resurrection/package.json", "{}"),
      sized("deltas.json", size),
      file("harness.json", "{}"),
    ];
    expect(codes(control(INTAKE_LIMITS.maxControlFileBytes))).toEqual([]);
    expect(codes(control(INTAKE_LIMITS.maxControlFileBytes + 1))).toEqual(["control-file-too-large"]);
  });

  it("requires resurrection/package.json, deltas.json and harness.json", () => {
    const result = validateIntake([file("resurrection/a.js")]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((v) => v.path)).toEqual(["deltas.json", "harness.json", "resurrection/package.json"]);
      expect(result.violations.every((v) => v.code === "missing-required")).toBe(true);
    }
    expect(codes([file("deltas.json", "{}"), file("harness.json", "{}")])).toEqual(["missing-required"]);
  });

  it("accepts LICENSE and rejects other extensionless or unknown files", () => {
    expect(codes([...base(), file("resurrection/LICENSE")])).toEqual([]);
    expect(codes([...base(), file("resurrection/license")])).toEqual(["bad-extension"]);
    expect(codes([...base(), file("resurrection/a.ts")])).toEqual(["bad-extension"]);
    expect(codes([...base(), file("resurrection/a.node")])).toEqual(["bad-extension"]);
  });

  it("requires strict UTF-8 for text files and LICENSE", () => {
    const bad = (path: string): IntakeEntry => ({ path, type: "file", size: 2, bytes: new Uint8Array([0xc3, 0x28]) });
    expect(codes([...base(), bad("resurrection/a.js")])).toEqual(["bad-encoding"]);
    expect(codes([...base(), bad("resurrection/LICENSE")])).toEqual(["bad-encoding"]);
    expect(codes([...base(), file("resurrection/a.md", "héllo ✓")])).toEqual([]);
  });

  it("lists all violations sorted by path then code, without partial acceptance", () => {
    const result = validateIntake([
      file("zeta.js"),
      file("resurrection/b.ts"),
      { path: "resurrection/a.js", type: "symlink", size: 1 },
      file("deltas.json", "{}"),
      file("harness.json", "{}"),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((v) => [v.path, v.code])).toEqual([
        ["resurrection/a.js", "link"],
        ["resurrection/b.ts", "bad-extension"],
        ["resurrection/package.json", "missing-required"],
        ["zeta.js", "outside-allowlist"],
      ]);
    }
  });

  it("is a pure function of its input", () => {
    const entries = [...base(), file("src/x.js")];
    expect(validateIntake(entries)).toEqual(validateIntake(entries));
  });
});
