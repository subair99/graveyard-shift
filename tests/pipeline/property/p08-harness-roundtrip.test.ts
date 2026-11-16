// Requirements: 5.9, 5.10
// Feature: resurrection-pipeline, Property 8: Harness_File round trip

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  canonicalHarnessJson,
  parseHarnessFile,
} from "../../../src/pipeline/harness/core/harnessFile";
import type { HarnessFile } from "../../../src/pipeline/harness/core/harnessFile";

const RUNS = 150;

const primitive = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
  fc.boolean(),
  fc.constant(null),
);

const entry = fc.oneof(
  fc.record({ preset: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/) }),
  fc.record({
    preset: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
    options: fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), primitive, { maxKeys: 4 }),
  }),
);

const harnessFile: fc.Arbitrary<HarnessFile> = fc.record({
  schemaVersion: fc.constant(1 as const),
  package: fc.string({ minLength: 1, maxLength: 20 }),
  functions: fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), entry, { maxKeys: 5 }),
});

describe("Property 8: Harness_File round trip", () => {
  it("parse, print and parse again produces an equal document", () => {
    fc.assert(
      fc.property(harnessFile, (file) => {
        const printed = canonicalHarnessJson(file);
        const first = parseHarnessFile(printed);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value).toEqual(file);
        const reprinted = canonicalHarnessJson(first.value);
        expect(reprinted).toBe(printed);
        const second = parseHarnessFile(reprinted);
        expect(second.ok).toBe(true);
        if (second.ok) expect(second.value).toEqual(first.value);
      }),
      { numRuns: RUNS },
    );
  });

  it("malformed JSON returns an error naming the root", () => {
    fc.assert(
      fc.property(harnessFile, fc.nat({ max: 1000 }), (file, cut) => {
        const printed = canonicalHarnessJson(file);
        // A strict prefix of an object's JSON text is never valid JSON.
        const truncated = printed.slice(0, cut % printed.length);
        const r = parseHarnessFile(truncated);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.issues.length).toBeGreaterThan(0);
          expect(r.error.issues[0]).toMatch(/^\(root\): /);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("a schema failure names the failing path", () => {
    fc.assert(
      fc.property(harnessFile, fc.constantFrom(0, 1.5, true, null, []), (file, bad) => {
        const r = parseHarnessFile(JSON.stringify({ ...file, package: bad }));
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.issues.some((i) => i.startsWith("package:"))).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
