// Eligibility_Record: schema, fixed key order, canonical JSON and deserializer (R2.9, R2.10). Pure.

import { z } from "zod";
import { FactSchema } from "../../../engine/types";
import type { Result } from "../../../engine/types";
import { canonicalJsonText, compareCodePoints, orderKeys } from "../../common/canonical";
import { RULE_IDS } from "./rules";

export const RuleIdSchema = z.enum(RULE_IDS);

export const RuleResultSchema = z
  .object({
    rule: RuleIdSchema,
    holds: z.boolean(),
    observed: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    reason: z.literal("unverified").optional(),
    missingField: z.string().optional(),
  })
  .strict();

export const EligibilityRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.object({ name: z.string(), version: z.string() }).strict(),
    eligible: z.boolean(),
    reason: z.literal("integrity-mismatch").optional(),
    integrity: z
      .object({
        expected: z.string(),
        computed: z.string().nullable(),
        matches: z.boolean(),
      })
      .strict(),
    rules: z.array(RuleResultSchema),
    failedRules: z.array(RuleIdSchema),
    successor: z.string().optional(),
    facts: z.array(FactSchema),
  })
  .strict();

export type EligibilityRecord = z.infer<typeof EligibilityRecordSchema>;

/** Key order of every object kind of the record. The single source for serialization. */
export const ELIGIBILITY_KEY_ORDER = {
  record: [
    "schemaVersion",
    "package",
    "eligible",
    "reason",
    "integrity",
    "rules",
    "failedRules",
    "successor",
    "facts",
  ],
  package: ["name", "version"],
  integrity: ["expected", "computed", "matches"],
  rule: ["rule", "holds", "observed", "reason", "missingField"],
  fact: ["key", "value", "provenance", "stale"],
  provenance: ["sourceUrl", "fetchedAt"],
} as const;

type Obj = { [k: string]: unknown };

const asObj = (v: unknown): Obj => v as Obj;

/** Recursively orders object keys by code point, so any fact value serializes the same way. */
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (typeof v === "object" && v !== null) {
    const o = v as Obj;
    const out: Obj = {};
    for (const k of Object.keys(o).sort(compareCodePoints)) out[k] = sortValue(o[k]);
    return out;
  }
  return v;
}

/** The record as plain data in canonical key order. */
export function canonicalizeRecord(record: EligibilityRecord): unknown {
  const k = ELIGIBILITY_KEY_ORDER;
  return orderKeys(record as unknown as Obj, k.record, {
    package: (p) => orderKeys(asObj(p), k.package),
    integrity: (i) => orderKeys(asObj(i), k.integrity),
    rules: (rs) => (rs as unknown[]).map((r) => orderKeys(asObj(r), k.rule)),
    facts: (fs) =>
      (fs as unknown[]).map((f) =>
        orderKeys(asObj(f), k.fact, {
          value: sortValue,
          provenance: (ps) => (ps as unknown[]).map((p) => orderKeys(asObj(p), k.provenance)),
        }),
      ),
  });
}

/** Canonical JSON: fixed key order, no whitespace. */
export function serializeEligibilityRecord(record: EligibilityRecord): string {
  return canonicalJsonText(canonicalizeRecord(record));
}

export interface EligibilityDeserializeError {
  /** Dotted path of the invalid field, or "(root)" for malformed JSON or a non-object. */
  field: string;
  message: string;
}

/** Parses canonical JSON. Names the invalid field and returns no partial record (R2.10). */
export function deserializeEligibilityRecord(
  text: string,
): Result<EligibilityRecord, EligibilityDeserializeError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: { field: "(root)", message: `malformed JSON: ${(e as Error).message}` },
    };
  }
  const parsed = EligibilityRecordSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0]!;
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") path.push(String(issue.keys[0]));
  return {
    ok: false,
    error: { field: path.length > 0 ? path.join(".") : "(root)", message: issue.message },
  };
}
