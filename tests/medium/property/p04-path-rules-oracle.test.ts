// Requirements: 3.11, 3.12; resurrection-pipeline 9.5, 9.6
// Feature: medium-agent, Property 4: Moving the path rules keeps every path result
// Frozen verbatim copies of the pre-move rules are the oracles; pathRules.mjs must give the same result for every path.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as rules from "../../../src/pipeline/medium/agent/pathRules.mjs";
import {
  badPathArb,
  goodPathArb,
  nameArb,
  outsidePathArb,
} from "../../pipeline/helpers/intakePathArbitraries";

// ---- Frozen oracles (copied from the sources before the move; never edit) ----

const ALLOWED_MEDIUM_PATHS = ["resurrection/", "deltas.json", "harness.json"] as const;
const RESURRECTION_DIR = ALLOWED_MEDIUM_PATHS[0];
const DELTAS_FILE = ALLOWED_MEDIUM_PATHS[1];
const HARNESS_FILE = ALLOWED_MEDIUM_PATHS[2];
const CONTROL_FILES: readonly string[] = [DELTAS_FILE, HARNESS_FILE];
const FORBIDDEN_SEGMENTS: readonly string[] = [".git", ".github", ".kiro"];

// safePath.ts
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;

function codePointLabel(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function firstControlCharacter(path: string): string | null {
  const match = CONTROL_CHARACTER_PATTERN.exec(path);
  return match === null ? null : match[0];
}

function safePathForLog(path: string): string {
  return path.replace(CONTROL_CHARACTERS_GLOBAL, (c) => `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`);
}

// validator.ts
function badPathReason(path: string): string | null {
  if (path.length === 0) return "empty path";
  const control = firstControlCharacter(path);
  if (control !== null) return `control character ${codePointLabel(control)} in path`;
  if (path.includes("\\")) return "backslash in path";
  if (/^[A-Za-z]:/.test(path)) return "drive prefix in path";
  if (path.startsWith("/")) return "absolute path";
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "") return "empty path segment";
    if (segment === "..") return "'..' path segment";
    if (FORBIDDEN_SEGMENTS.includes(segment.toLowerCase())) return `forbidden path segment '${segment}'`;
  }
  return null;
}

function isAllowlistedValidator(path: string): boolean {
  return path.startsWith(RESURRECTION_DIR) || CONTROL_FILES.includes(path);
}

// fsEntries.ts and gitEntries.ts (identical bodies)
function isAllowlistedEntries(path: string): boolean {
  return path.startsWith(ALLOWED_MEDIUM_PATHS[0]) || path === ALLOWED_MEDIUM_PATHS[1] || path === ALLOWED_MEDIUM_PATHS[2];
}

// pushPlan.ts
function isAllowedCommitPath(path: string): boolean {
  return (
    path.startsWith(ALLOWED_MEDIUM_PATHS[0]) ||
    path === ALLOWED_MEDIUM_PATHS[1] ||
    path === ALLOWED_MEDIUM_PATHS[2]
  );
}

// ---- Inputs ----

const pieceArb = fc.constantFrom(
  "resurrection", "..", ".", ".git", ".GitHub", ".kiro", "a", "A.js", "", "C:", "d:x", "\\", "\n", "\u007f", "\0",
  "deltas.json", "harness.json", "é", "\u{1F480}",
);
const segmentedArb = fc.array(pieceArb, { maxLength: 6 }).map((parts) => parts.join("/"));
const controlHeavyArb = fc.string({ maxLength: 12 }).chain((s) =>
  fc.constantFrom("", "\n", "\r", "\u0000", "\u001f", "\u007f", "::").map((c) => s + c + s),
);

const pathArb: fc.Arbitrary<string> = fc.oneof(
  goodPathArb,
  badPathArb,
  outsidePathArb,
  nameArb,
  fc.constantFrom("deltas.json", "harness.json", "resurrection/", "resurrection"),
  segmentedArb,
  controlHeavyArb,
  fc.string({ maxLength: 40 }),
  fc.string({ unit: "binary", maxLength: 40 }),
);

describe("Property 4: Moving the path rules keeps every path result", () => {
  it("badPathReason gives the same reason or null", () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        expect(rules.badPathReason(path)).toBe(badPathReason(path));
      }),
      { numRuns: 100 },
    );
  });

  it("isAllowlisted agrees with the validator, fsEntries and gitEntries copies and isAllowedCommitPath", () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        const expected = isAllowlistedValidator(path);
        expect(isAllowlistedEntries(path)).toBe(expected);
        expect(isAllowedCommitPath(path)).toBe(expected);
        expect(rules.isAllowlisted(path)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("escapeControlCharacters equals safePathForLog", () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        expect(rules.escapeControlCharacters(path)).toBe(safePathForLog(path));
      }),
      { numRuns: 100 },
    );
  });

  it("control-character helpers equal the safePath.ts copies", () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        expect(rules.firstControlCharacter(path)).toBe(firstControlCharacter(path));
        const first = firstControlCharacter(path);
        if (first !== null) expect(rules.codePointLabel(first)).toBe(codePointLabel(first));
      }),
      { numRuns: 100 },
    );
  });

  it("constants equal the pre-move values", () => {
    expect([...rules.ALLOWED_MEDIUM_PATHS]).toEqual([...ALLOWED_MEDIUM_PATHS]);
    expect(rules.RESURRECTION_DIR).toBe(RESURRECTION_DIR);
    expect([...rules.CONTROL_FILES]).toEqual([...CONTROL_FILES]);
    expect([...rules.FORBIDDEN_SEGMENTS]).toEqual([...FORBIDDEN_SEGMENTS]);
    expect(rules.CONTROL_CHARACTER_PATTERN.source).toBe(CONTROL_CHARACTER_PATTERN.source);
  });

  it("pathRuleProblem is the bad-path reason, else the allowlist message, else null", () => {
    fc.assert(
      fc.property(pathArb, (path) => {
        const expected =
          badPathReason(path) ??
          (isAllowlistedValidator(path)
            ? null
            : "path is not under resurrection/ and is not deltas.json or harness.json");
        expect(rules.pathRuleProblem(path)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
