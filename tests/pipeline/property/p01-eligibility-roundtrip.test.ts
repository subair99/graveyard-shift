// Requirements: 2.9, 2.10
// Feature: resurrection-pipeline, Property 1: Eligibility record round trip

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  deserializeEligibilityRecord,
  serializeEligibilityRecord,
} from "../../../src/pipeline/gravedigger/core/eligibility";
import type { EligibilityRecord } from "../../../src/pipeline/gravedigger/core/eligibility";
import { RULE_IDS } from "../../../src/pipeline/gravedigger/core/rules";

const RUNS = 150;

const jsonLeaf = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);
const key = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,6}$/);
const jsonValue = fc.oneof(
  jsonLeaf,
  fc.array(jsonLeaf, { maxLength: 4 }),
  fc.dictionary(key, jsonLeaf, { maxKeys: 4 }),
);

const timestamp = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .map((d) => d.toISOString().replace(/\.\d{3}Z$/, "Z"));

const provenance = fc.record({
  sourceUrl: fc.webUrl(),
  fetchedAt: timestamp,
});

const fact = fc.record(
  {
    key: fc.string({ minLength: 1, maxLength: 10 }),
    value: jsonValue,
    provenance: fc.array(provenance, { minLength: 1, maxLength: 3 }),
    stale: fc.boolean(),
  },
  { requiredKeys: ["key", "value", "provenance"] },
);

const ruleId = fc.constantFrom(...RULE_IDS);

const ruleResult = fc.record(
  {
    rule: ruleId,
    holds: fc.boolean(),
    observed: jsonLeaf,
    reason: fc.constant("unverified" as const),
    missingField: fc.string({ minLength: 1, maxLength: 10 }),
  },
  { requiredKeys: ["rule", "holds", "observed"] },
);

const record: fc.Arbitrary<EligibilityRecord> = fc.record(
  {
    schemaVersion: fc.constant(1 as const),
    package: fc.record({
      name: fc.string({ minLength: 1, maxLength: 12 }),
      version: fc.string({ minLength: 1, maxLength: 10 }),
    }),
    eligible: fc.boolean(),
    reason: fc.constant("integrity-mismatch" as const),
    integrity: fc.record({
      expected: fc.string({ maxLength: 20 }),
      computed: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
      matches: fc.boolean(),
    }),
    rules: fc.array(ruleResult, { maxLength: 7 }),
    failedRules: fc.array(ruleId, { maxLength: 7 }),
    successor: fc.string({ minLength: 1, maxLength: 12 }),
    facts: fc.array(fact, { maxLength: 4 }),
  },
  {
    requiredKeys: [
      "schemaVersion",
      "package",
      "eligible",
      "integrity",
      "rules",
      "failedRules",
      "facts",
    ],
  },
);

const REQUIRED = [
  "schemaVersion",
  "package",
  "eligible",
  "integrity",
  "rules",
  "failedRules",
  "facts",
] as const;

describe("Property 1: Eligibility record round trip", () => {
  it("serialize, deserialize, serialize gives the identical string", () => {
    fc.assert(
      fc.property(record, (r) => {
        const first = serializeEligibilityRecord(r);
        const back = deserializeEligibilityRecord(first);
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(serializeEligibilityRecord(back.value)).toBe(first);
      }),
      { numRuns: RUNS },
    );
  });

  it("truncated JSON text returns an error and no record", () => {
    fc.assert(
      fc.property(record, fc.nat(), (r, n) => {
        const text = serializeEligibilityRecord(r);
        const cut = text.slice(0, n % text.length);
        const res = deserializeEligibilityRecord(cut);
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.field.length).toBeGreaterThan(0);
        expect("value" in res).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it("a missing required field is named in the error and no record is returned", () => {
    fc.assert(
      fc.property(record, fc.constantFrom(...REQUIRED), (r, field) => {
        const obj = JSON.parse(serializeEligibilityRecord(r)) as Record<string, unknown>;
        delete obj[field];
        const res = deserializeEligibilityRecord(JSON.stringify(obj));
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.field).toBe(field);
        expect("value" in res).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it("a wrongly typed field is named in the error", () => {
    fc.assert(
      fc.property(record, fc.constantFrom("eligible", "failedRules", "facts"), (r, field) => {
        const obj = JSON.parse(serializeEligibilityRecord(r)) as Record<string, unknown>;
        obj[field] = 42;
        const res = deserializeEligibilityRecord(JSON.stringify(obj));
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.field).toBe(field);
      }),
      { numRuns: RUNS },
    );
  });
});
