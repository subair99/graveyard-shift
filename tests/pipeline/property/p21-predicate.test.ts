// Requirements: 13.6, 13.7, 23.9, 23.10
// Feature: resurrection-pipeline, Property 21: Resurrection_Predicate round trip and mode check
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  buildPredicate,
  parsePredicate,
  printPredicate,
  type PredicateInput,
} from "../../../src/pipeline/undertaker/core/predicate";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
const sri = fc
  .array(fc.constantFrom(...B64), { minLength: 86, maxLength: 86 })
  .map((a) => `sha512-${a.join("")}==`);
const hex = (n: number) =>
  fc
    .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: n, maxLength: n })
    .map((a) => a.join(""));
const digits = fc.stringMatching(/^[0-9]{1,10}$/);
const word = fc.stringMatching(/^[a-z0-9.-]{1,12}$/);

const inputArb: fc.Arbitrary<PredicateInput> = fc.record({
  package: fc.record({ name: word, version: word }),
  original: fc.record({ integrity: sri }),
  resurrection: fc.record({ name: word, version: word, treeHash: sri }),
  digests: fc.record({ tarball: hex(64), proofReport: hex(64), certificate: hex(64) }),
  verdict: fc.constant("alive"),
  seed: fc.integer({ min: -2147483648, max: 2147483647 }),
  toolVersions: fc.record({ node: word, fastCheck: word, reportSchema: fc.constant(1 as const) }),
  branchCommit: hex(40),
  run: fc.record({ id: digits, attempt: digits }),
  medium: fc.record({ mode: fc.constantFrom("local", "stub") }),
});

describe("Property 21: Resurrection_Predicate round trip and mode check", () => {
  it("parse(print(p)) equals p and print is stable", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const built = buildPredicate(input);
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const p = built.value.predicate;
        const text = printPredicate(p);
        const parsed = parsePredicate(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value).toEqual(p);
        expect(printPredicate(parsed.value)).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a verdict other than alive, naming verdict", () => {
    fc.assert(
      fc.property(inputArb, fc.string().filter((s) => s !== "alive"), (input, verdict) => {
        const r = buildPredicate({ ...input, verdict });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.field).toBe("verdict");
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a mode other than local or stub, naming medium.mode", () => {
    fc.assert(
      fc.property(
        inputArb,
        fc.string().filter((s) => s !== "local" && s !== "stub"),
        (input, mode) => {
          const r = buildPredicate({ ...input, medium: { mode } });
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.field).toBe("medium.mode");
        },
      ),
      { numRuns: 100 },
    );
  });
});
