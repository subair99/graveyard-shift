// Requirements: 7.7
// Feature: resurrection-pipeline, Property 11: Ledger round trip

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildLocalEntry,
  buildStubEntry,
  canonicalLedgerJson,
  parseLedger,
  printLedger,
} from "../../../src/pipeline/local/core/ledger";
import type { Ledger, LedgerEntry } from "../../../src/pipeline/local/core/ledger";

const RUNS = 150;

const timestamp = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .map((d) => d.toISOString().replace(/\.\d{3}Z$/, "Z"));

const pkg = fc.stringMatching(/^[a-z][a-z0-9.-]{0,12}$/);
const version = fc.tuple(fc.nat(20), fc.nat(20), fc.nat(20)).map(([a, b, c]) => `${a}.${b}.${c}`);
// Readings are free text: empty, whitespace-only and arbitrary strings all occur.
const readingText = fc.oneof(fc.constant(""), fc.constant("  "), fc.string({ maxLength: 20 }));

const localEntry = fc
  .record({
    package: pkg,
    version,
    date: timestamp,
    creditBefore: readingText,
    creditAfter: readingText,
    exitCode: fc.integer({ min: -1000, max: 1000 }),
    kiroCliVersion: fc.string({ maxLength: 12 }),
    cliUsage: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
  })
  .map((i) => buildLocalEntry(i));

const relSegment = fc.stringMatching(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,8}$/).filter((s) => s !== "..");
const fixturePath = fc.array(relSegment, { minLength: 1, maxLength: 4 }).map((p) => p.join("/"));

const stubEntry = fc
  .record({ package: pkg, version, date: timestamp, fixture: fixturePath })
  .map((i) => buildStubEntry(i));

const entry: fc.Arbitrary<LedgerEntry> = fc.oneof(localEntry, stubEntry);
const ledger: fc.Arbitrary<Ledger> = fc.record({
  schemaVersion: fc.constant(1 as const),
  entries: fc.array(entry, { maxLength: 6 }),
});

function parseOk(text: string): Ledger {
  const r = parseLedger(text);
  if (!r.ok) throw new Error(`parse failed: ${r.error.issues.join("; ")}`);
  return r.value;
}

describe("Property 11: Ledger round trip", () => {
  it("parse, print and parse again gives an equal ledger; printing is canonical", () => {
    fc.assert(
      fc.property(ledger, (l) => {
        const printed = printLedger(l);
        const parsed = parseOk(printed);
        expect(parsed).toEqual(l);
        expect(printLedger(parsed)).toBe(printed);
        expect(canonicalLedgerJson(parsed)).toBe(canonicalLedgerJson(l));
        expect(printed.endsWith("\n")).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it("the canonical text parses back to an equal ledger", () => {
    fc.assert(
      fc.property(ledger, (l) => {
        const text = canonicalLedgerJson(l);
        expect(parseOk(text)).toEqual(l);
        expect(canonicalLedgerJson(parseOk(text))).toBe(text);
      }),
      { numRuns: RUNS },
    );
  });

  it("the printed text does not depend on the key order of the input text", () => {
    fc.assert(
      fc.property(ledger, (l) => {
        const reversed = JSON.stringify(l, (_k, v: unknown) =>
          v !== null && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        );
        expect(printLedger(parseOk(reversed))).toBe(printLedger(l));
      }),
      { numRuns: RUNS },
    );
  });

  it("a truncated file is a failure that names the file and the root path", () => {
    fc.assert(
      fc.property(ledger, fc.integer({ min: 2, max: 30 }), (l, cut) => {
        const printed = printLedger(l);
        const r = parseLedger(printed.slice(0, Math.max(1, printed.length - cut)), "ledger.json");
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.file).toBe("ledger.json");
          expect(r.error.issues[0]).toMatch(/^\(root\): malformed JSON/);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
