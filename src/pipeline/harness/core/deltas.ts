// Deltas_File (Requirement 4, design "Harness: Deltas_File, Harness_File, presets and compiler").
// Pure: strict schema, parser that names the failing path, canonical JSON with a fixed key order.

import { z } from "zod";
import { safeParseResult, SourceUrlSchema, UtcTimestampSchema } from "../../../engine/types";
import type { Result, SchemaFailure } from "../../../engine/types";
import { compareCodePoints, ordered } from "../../../proof/child/codec/order";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JSON_VALUE_MAX_DEPTH = 4;
export const JSON_VALUE_MAX_NODES = 1000;

/** True when `v` is JSON data within the depth and node limits (scalars count as depth 1). */
function isBoundedJson(v: unknown): boolean {
  let nodes = 0;
  const walk = (x: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > JSON_VALUE_MAX_NODES || depth > JSON_VALUE_MAX_DEPTH) return false;
    if (x === null || typeof x === "string" || typeof x === "boolean") return true;
    if (typeof x === "number") return Number.isFinite(x);
    if (Array.isArray(x)) return x.every((e) => walk(e, depth + 1));
    if (typeof x === "object") {
      const proto = Object.getPrototypeOf(x) as unknown;
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(x as object).every((e) => walk(e, depth + 1));
    }
    return false;
  };
  return walk(v, 1);
}

/** Bounded JSON value: depth at most 4, at most 1,000 nodes. */
export const JsonValueSchema: z.ZodType<JsonValue> = z
  .unknown()
  .refine(isBoundedJson, {
    message: `must be JSON of depth at most ${JSON_VALUE_MAX_DEPTH} and at most ${JSON_VALUE_MAX_NODES} nodes`,
  }) as unknown as z.ZodType<JsonValue>;

export const DELTA_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ADVISORY_ID_PATTERN = /^(GHSA(-[a-z0-9]{4}){3}|CVE-[0-9]{4}-[0-9]{4,})$/;

export const DeltaIdSchema = z.string().regex(DELTA_ID_PATTERN, "must match ^[a-z0-9][a-z0-9-]{0,63}$");
export const AdvisoryIdSchema = z
  .string()
  .regex(ADVISORY_ID_PATTERN, "must be a GHSA-xxxx-xxxx-xxxx (lower-case) or CVE-YYYY-NNNN identifier");
export type DeltaId = z.infer<typeof DeltaIdSchema>;
export type AdvisoryId = z.infer<typeof AdvisoryIdSchema>;

const DeltaCaseSchema = z
  .object({
    input: z.array(JsonValueSchema).max(8),
    expected: JsonValueSchema,
    source: z.object({ url: SourceUrlSchema, fetchedAt: UtcTimestampSchema }).strict(),
  })
  .strict();
export type DeltaCase = z.infer<typeof DeltaCaseSchema>;

/** A name from a preset's class menu (R4.14); never code, a predicate or a pattern. */
export const CLASS_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ClassNameSchema = z.string().regex(CLASS_NAME_PATTERN, "must match ^[a-z0-9][a-z0-9-]{0,63}$");

/** An explicit demonstration input of a class delta: no per-case expected value (one per delta). */
const ClassCaseSchema = z
  .object({
    input: z.array(JsonValueSchema).max(8),
    source: z.object({ url: SourceUrlSchema, fetchedAt: UtcTimestampSchema }).strict(),
  })
  .strict();
export type ClassCase = z.infer<typeof ClassCaseSchema>;

export const DeltaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("prototype-unchanged"),
      id: DeltaIdSchema,
      function: z.string().min(1),
      advisory: AdvisoryIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("returns-expected"),
      id: DeltaIdSchema,
      function: z.string().min(1),
      advisory: AdvisoryIdSchema,
      cases: z.array(DeltaCaseSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("returns-expected-class"),
      id: DeltaIdSchema,
      function: z.string().min(1),
      advisory: AdvisoryIdSchema,
      class: ClassNameSchema,
      expected: JsonValueSchema,
      cases: z.array(ClassCaseSchema).min(1),
    })
    .strict(),
]);
export type Delta = z.infer<typeof DeltaSchema>;

export const DeltasFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.string().min(1),
    deltas: z.array(DeltaSchema).min(1),
  })
  .strict();
export type DeltasFile = z.infer<typeof DeltasFileSchema>;

/** Fixed key order per object kind; the single source of truth for the serialized form. */
export const DELTAS_KEY_ORDER = {
  file: ["schemaVersion", "package", "deltas"],
  prototypeUnchanged: ["kind", "id", "function", "advisory"],
  returnsExpected: ["kind", "id", "function", "advisory", "cases"],
  returnsExpectedClass: ["kind", "id", "function", "advisory", "class", "expected", "cases"],
  case: ["input", "expected", "source"],
  source: ["url", "fetchedAt"],
} as const;

type Obj = { [k: string]: unknown };

/** Sorts the keys of every object inside a JSON value by code point. */
export function sortJsonKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortJsonKeys);
  if (typeof v === "object" && v !== null) {
    const o = v as Obj;
    const out: Obj = {};
    for (const k of Object.keys(o).sort(compareCodePoints)) {
      Object.defineProperty(out, k, {
        value: sortJsonKeys(o[k]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return v;
}

function orderDelta(d: unknown): unknown {
  const o = d as Obj;
  if (o["kind"] === "returns-expected-class") {
    return ordered(o, DELTAS_KEY_ORDER.returnsExpectedClass, {
      expected: sortJsonKeys,
      cases: (cs) =>
        (cs as unknown[]).map((c) =>
          ordered(c as Obj, DELTAS_KEY_ORDER.case, {
            input: sortJsonKeys,
            source: (s) => ordered(s as Obj, DELTAS_KEY_ORDER.source),
          }),
        ),
    });
  }
  if (o["kind"] === "returns-expected") {
    return ordered(o, DELTAS_KEY_ORDER.returnsExpected, {
      cases: (cs) =>
        (cs as unknown[]).map((c) =>
          ordered(c as Obj, DELTAS_KEY_ORDER.case, {
            input: sortJsonKeys,
            expected: sortJsonKeys,
            source: (s) => ordered(s as Obj, DELTAS_KEY_ORDER.source),
          }),
        ),
    });
  }
  return ordered(o, DELTAS_KEY_ORDER.prototypeUnchanged);
}

/** Canonical JSON: fixed key order, no whitespace. Delta order is kept as given. */
export function canonicalDeltasJson(f: DeltasFile): string {
  return JSON.stringify(
    ordered(f as unknown as Obj, DELTAS_KEY_ORDER.file, {
      deltas: (ds) => (ds as unknown[]).map(orderDelta),
    }),
  );
}

/** Parses JSON text into a Deltas_File. A failure lists issues as "path: message". */
export function parseDeltasFile(json: string): Result<DeltasFile, SchemaFailure> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { issues: [`(root): malformed JSON: ${detail}`] } };
  }
  return safeParseResult(DeltasFileSchema, data);
}
