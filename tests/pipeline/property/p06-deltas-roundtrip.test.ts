// Requirements: 4.9, 4.10
// Feature: resurrection-pipeline, Property 6: Deltas_File round trip

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { canonicalDeltasJson, parseDeltasFile } from "../../../src/pipeline/harness/core/deltas";
import type { DeltasFile } from "../../../src/pipeline/harness/core/deltas";

const RUNS = 150;

const jsonLeaf = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);
const key = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,6}$/);
// Depth 3 at most, well inside the schema limit of 4.
const jsonValue = fc.oneof(
  jsonLeaf,
  fc.array(jsonLeaf, { maxLength: 4 }),
  fc.dictionary(key, fc.oneof(jsonLeaf, fc.array(jsonLeaf, { maxLength: 3 })), { maxKeys: 4 }),
);

const timestamp = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .map((d) => d.toISOString().replace(/\.\d{3}Z$/, "Z"));

const deltaId = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,15}$/);
const advisory = fc.oneof(
  fc
    .tuple(...[0, 1, 2].map(() => fc.stringMatching(/^[a-z0-9]{4}$/)))
    .map(([a, b, c]) => `GHSA-${a}-${b}-${c}`),
  fc
    .tuple(fc.stringMatching(/^[0-9]{4}$/), fc.stringMatching(/^[0-9]{4,7}$/))
    .map(([y, n]) => `CVE-${y}-${n}`),
);
const fn = fc.string({ minLength: 1, maxLength: 10 });

const deltaCase = fc.record({
  input: fc.array(jsonValue, { maxLength: 3 }),
  expected: jsonValue,
  source: fc.record({ url: fc.webUrl(), fetchedAt: timestamp }),
});

const prototypeUnchanged = fc.record({
  kind: fc.constant("prototype-unchanged" as const),
  id: deltaId,
  function: fn,
  advisory,
});
const returnsExpected = fc.record({
  kind: fc.constant("returns-expected" as const),
  id: deltaId,
  function: fn,
  advisory,
  cases: fc.array(deltaCase, { minLength: 1, maxLength: 3 }),
});

const deltasFile: fc.Arbitrary<DeltasFile> = fc.record({
  schemaVersion: fc.constant(1 as const),
  package: fc.string({ minLength: 1, maxLength: 12 }),
  deltas: fc.array(fc.oneof(prototypeUnchanged, returnsExpected), { minLength: 1, maxLength: 4 }),
}) as fc.Arbitrary<DeltasFile>;

function parseOk(text: string): DeltasFile {
  const r = parseDeltasFile(text);
  if (!r.ok) throw new Error(`parse failed: ${r.error.issues.join("; ")}`);
  return r.value;
}

describe("Property 6: Deltas_File round trip", () => {
  it("parse, print and parse again gives an equal document; printing is canonical", () => {
    fc.assert(
      fc.property(deltasFile, (file) => {
        const printed = canonicalDeltasJson(file);
        const parsed = parseOk(printed);
        expect(parsed).toEqual(file);
        expect(canonicalDeltasJson(parsed)).toBe(printed);
        // Canonical: the text does not depend on the key order of the input text.
        const reversed = JSON.stringify(file, (_k, v: unknown) =>
          v !== null && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        );
        expect(canonicalDeltasJson(parseOk(reversed))).toBe(printed);
      }),
      { numRuns: RUNS },
    );
  });

  it("malformed JSON returns an error naming the root path", () => {
    fc.assert(
      fc.property(deltasFile, fc.integer({ min: 1, max: 40 }), (file, cut) => {
        const printed = canonicalDeltasJson(file);
        const truncated = printed.slice(0, Math.max(1, printed.length - cut));
        const r = parseDeltasFile(truncated);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.issues.length).toBeGreaterThan(0);
          expect(r.error.issues[0]).toMatch(/^\(root\): malformed JSON/);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("a schema failure returns an error naming the failing path", () => {
    fc.assert(
      fc.property(deltasFile, fc.nat(), (file, n) => {
        const idx = n % file.deltas.length;
        const bad = JSON.parse(canonicalDeltasJson(file)) as {
          schemaVersion: number;
          deltas: Array<{ id: string }>;
        };
        const target = bad.deltas[idx];
        if (target === undefined) throw new Error("no delta");
        target.id = "Bad Id!";
        const r1 = parseDeltasFile(JSON.stringify(bad));
        expect(r1.ok).toBe(false);
        if (!r1.ok) expect(r1.error.issues.some((i) => i.startsWith(`deltas.${idx}.id:`))).toBe(true);

        bad.deltas[idx] = target;
        bad.schemaVersion = 2;
        const r2 = parseDeltasFile(JSON.stringify(bad));
        expect(r2.ok).toBe(false);
        if (!r2.ok) expect(r2.error.issues.some((i) => i.startsWith("schemaVersion:"))).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});
