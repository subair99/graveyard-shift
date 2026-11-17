// Requirements: 3.4, 3.6
// Feature: medium-agent, Property 2: The Write_Guard is total and fails closed on malformed events
// In-process `decide` with fake GuardFs values (one of them throws from every method).

import fc from "fast-check";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decide, PATH_KEYS, WRITE_TOOLS, type GuardDecision, type GuardFs } from "../../../src/pipeline/medium/agent/writeGuard.mjs";

const NUM_RUNS = 100;

/** A fake file system where nothing exists and every real path is the resolved path itself. */
const emptyFs: GuardFs = {
  lstat: () => null,
  realpath: (p) => resolve(p),
};

/** A fake file system whose methods always throw. */
const throwingFs: GuardFs = {
  lstat: () => {
    throw Object.assign(new Error("boom"), { code: "EIO" });
  },
  realpath: () => {
    throw Object.assign(new Error("boom"), { code: "EIO" });
  },
};

/** A fake file system where the working directory does not exist (realpath throws, lstat finds nothing). */
const missingCwdFs: GuardFs = {
  lstat: () => null,
  realpath: () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  },
};

const fsArb = fc.constantFrom(emptyFs, throwingFs, missingCwdFs);

function expectBlocked(decision: GuardDecision): void {
  expect(decision.exitCode).toBe(2);
  expect(decision.stderrLine).not.toBeNull();
  expect(decision.stderrLine?.startsWith("write-guard: blocked: ")).toBe(true);
}

const jsonValueArb = fc.jsonValue();
const writeToolArb = fc.constantFrom(...WRITE_TOOLS);
const pathKeyArb = fc.constantFrom(...PATH_KEYS);
const nonEmptyPathArb = fc.string({ minLength: 1, maxLength: 20 });
const cwdArb = fc.constantFrom("/work", "work", ".", "/");

const notJsonArb = fc
  .string({ maxLength: 40 })
  .filter((text) => {
    try {
      JSON.parse(text);
      return false;
    } catch {
      return true;
    }
  });

const nonObjectArb = fc.oneof(
  fc.array(jsonValueArb, { maxLength: 4 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.string({ maxLength: 20 }),
  fc.boolean(),
  fc.constant(null),
);

const nonStringArb = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string({ maxLength: 5 }), { maxLength: 3 }),
  fc.dictionary(fc.string({ maxLength: 5 }), fc.integer(), { maxKeys: 3 }),
);

describe("Property 2: The Write_Guard is total and fails closed on malformed events", () => {
  it("never throws and returns a well-formed decision for any text and any fake file system", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), jsonValueArb.map((v) => JSON.stringify(v))), fsArb, (text, fs) => {
        const decision = decide(text, fs);
        expect([0, 2]).toContain(decision.exitCode);
        if (decision.exitCode === 2) expectBlocked(decision);
        else expect(decision.stderrLine).toBeNull();
        expect(typeof decision.reason).toBe("string");
        expect(Array.isArray(decision.paths)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks text that is not valid JSON", () => {
    fc.assert(
      fc.property(notJsonArb, fsArb, (text, fs) => {
        expectBlocked(decide(text, fs));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks JSON that is not an object", () => {
    fc.assert(
      fc.property(nonObjectArb, fsArb, (value, fs) => {
        expectBlocked(decide(JSON.stringify(value), fs));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks an event whose tool_name is missing or not a string", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(undefined), nonStringArb),
        fc.dictionary(fc.string({ maxLength: 6 }).filter((k) => k !== "tool_name"), jsonValueArb, { maxKeys: 3 }),
        fsArb,
        (toolName, rest, fs) => {
          const event: Record<string, unknown> = { ...rest };
          if (toolName !== undefined) event.tool_name = toolName;
          expectBlocked(decide(JSON.stringify(event), fs));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks a write tool call with no target path", () => {
    fc.assert(
      fc.property(
        writeToolArb,
        fc.oneof(
          fc.constant(undefined),
          nonStringArb,
          fc.constant({}),
          fc.constant({ paths: [] }),
          fc.constant({ paths: "x" }),
          fc.constant({ text: "content" }),
        ),
        cwdArb,
        fsArb,
        (tool, toolInput, cwd, fs) => {
          const event: Record<string, unknown> = { tool_name: tool, cwd };
          if (toolInput !== undefined) event.tool_input = toolInput;
          expectBlocked(decide(JSON.stringify(event), fs));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks a write tool call with an empty or non-string target path", () => {
    fc.assert(
      fc.property(
        writeToolArb,
        pathKeyArb,
        fc.oneof(fc.constant(""), nonStringArb),
        fc.option(nonEmptyPathArb, { nil: undefined }),
        cwdArb,
        fsArb,
        (tool, key, badValue, otherPath, cwd, fs) => {
          const toolInput: Record<string, unknown> = { [key]: badValue };
          if (otherPath !== undefined) toolInput.paths = [otherPath];
          expectBlocked(decide(JSON.stringify({ tool_name: tool, cwd, tool_input: toolInput }), fs));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks a write tool call whose cwd is missing, empty, not a string or does not exist", () => {
    fc.assert(
      fc.property(
        writeToolArb,
        pathKeyArb,
        nonEmptyPathArb,
        fc.oneof(
          fc.record({ kind: fc.constant("absent" as const) }),
          fc.record({ kind: fc.constant("value" as const), value: fc.oneof(fc.constant(""), nonStringArb) }),
          fc.record({ kind: fc.constant("missing" as const), value: nonEmptyPathArb }),
        ),
        (tool, key, path, cwdCase) => {
          const event: Record<string, unknown> = { tool_name: tool, tool_input: { [key]: path } };
          if (cwdCase.kind !== "absent") event.cwd = cwdCase.value;
          expectBlocked(decide(JSON.stringify(event), missingCwdFs));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("blocks every write tool call when the file system throws", () => {
    fc.assert(
      fc.property(writeToolArb, pathKeyArb, nonEmptyPathArb, cwdArb, (tool, key, path, cwd) => {
        const decision = decide(JSON.stringify({ tool_name: tool, cwd, tool_input: { [key]: path } }), throwingFs);
        expectBlocked(decision);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
