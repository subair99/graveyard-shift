// Requirements: 4.1, 4.2, 4.3, 10.3
// Feature: medium-agent, Property 3: Guard_Log lines are well formed and round trip through the Local_Runner reader

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { escapeControlCharacters } from "../../../src/pipeline/medium/agent/pathRules.mjs";
import { formatLogLine, type GuardDecision } from "../../../src/pipeline/medium/agent/writeGuard.mjs";
import { summarizeGuardLog } from "../../../src/pipeline/medium/core/guardLog";

const NUM_RUNS = 100;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SENTINEL = "TOOL_INPUT_SENTINEL_7f3a";

/** Strings rich in control characters, spaces, `path=` look-alikes and astral characters. */
const textArb = fc.oneof(
  fc.string({ unit: "binary", maxLength: 40 }),
  fc.array(fc.constantFrom("a", "b", " ", "\n", "\r", "\t", "\u0000", "\u007f", "\u001b", "DENY", "path=", "reason=", "\u{1F480}", "\u2028"), {
    maxLength: 30,
  }).map((parts) => parts.join("")),
  // Longer than 200 code units, to exercise the cut.
  fc.string({ unit: "binary", minLength: 150, maxLength: 400 }),
);

const decisionArb: fc.Arbitrary<GuardDecision> = fc.record({
  exitCode: fc.constantFrom(0 as const, 2 as const),
  stderrLine: fc.constant(null),
  tool: fc.option(textArb, { nil: null }),
  reason: textArb,
  paths: fc.array(textArb, { maxLength: 4 }),
});

const dateArb = fc.date({ min: new Date("1971-01-01T00:00:00.000Z"), max: new Date("2200-01-01T00:00:00.000Z"), noInvalidDate: true });

describe("Property 3: Guard_Log lines are well formed and round trip through the Local_Runner reader", () => {
  it("each line has one trailing line feed, no other control character, the date and the decision word first", () => {
    fc.assert(
      fc.property(decisionArb, dateArb, (decision, at) => {
        const line = formatLogLine(decision, at);
        expect(line.endsWith("\n")).toBe(true);
        const body = line.slice(0, -1);
        expect(CONTROL.test(body)).toBe(false);
        const word = decision.exitCode === 0 ? "ALLOW" : "DENY";
        expect(line.startsWith(`${at.toISOString()} ${word}`)).toBe(true);
        expect(line.charAt(`${at.toISOString()} ${word}`.length)).toMatch(/^[ \n]$/);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("contains each path as the escaped first 200 code units, in order, and no other tool_input value", () => {
    fc.assert(
      fc.property(decisionArb, dateArb, (decision, at) => {
        const withExtra = { ...decision, tool_input: { content: SENTINEL } } as GuardDecision;
        const line = formatLogLine(withExtra, at);
        let from = 0;
        for (const path of decision.paths) {
          const piece = `path=${escapeControlCharacters(path.slice(0, 200))}`;
          const index = line.indexOf(piece, from);
          expect(index).toBeGreaterThanOrEqual(0);
          from = index + piece.length;
        }
        expect(line.includes(SENTINEL)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("summarizeGuardLog of any concatenation counts the lines and returns exactly the DENY lines in order", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(decisionArb, dateArb), { maxLength: 8 }), (items) => {
        const lines = items.map(([decision, at]) => formatLogLine(decision, at));
        const summary = summarizeGuardLog(lines.join(""));
        expect(summary.lineCount).toBe(lines.length);
        const expected = items
          .map(([decision], i) => (decision.exitCode === 2 ? lines[i]!.slice(0, -1) : null))
          .filter((line): line is string => line !== null);
        expect(summary.denyLines).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("an empty log has no lines", () => {
    expect(summarizeGuardLog("")).toEqual({ lineCount: 0, denyLines: [] });
  });
});

