// ip measurement (Requirement 3, design "ip measurement and delta derivation"). Pure: no clock,
// no environment, no output. The measurement records what the Original ip@2.0.1 returned (or
// threw) for each Advisory_Address; `deriveIpDeltas` turns it into the addresses that may carry
// a `returns-expected` delta (decision A10).

import { z } from "zod";
import { safeParseResult, SourceUrlSchema, UtcTimestampSchema } from "../../../engine/types";
import type { Result, SchemaFailure } from "../../../engine/types";
import { compareCodePoints, ordered } from "../../../proof/child/codec/order";

/** The five Advisory_Addresses of GHSA-2p57-rm9w-gvfp and CVE-2024-29415, in fixed order. */
export const ADVISORY_ADDRESSES = [
  "127.1",
  "01200034567",
  "012.1.2.3",
  "000:0:0000::01",
  "::fFFf:127.0.0.1",
] as const;

/** Informational inputs (Requirement 3.11): recorded, never used to derive a delta. */
export const INFORMATIONAL_ADDRESSES = ["0", "017700000001"] as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const Sri512 = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/, "must be a sha512 SRI string");

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

const IsoDateSchema = z.string().refine(isIsoDate, { message: "must be a calendar date YYYY-MM-DD" });

const OutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("returned"), value: JsonValueSchema }).strict(),
  z.object({ kind: z.literal("threw"), error: z.string() }).strict(),
]);

const MeasuredInputSchema = z.object({ input: z.string(), outcome: OutcomeSchema }).strict();
export type MeasuredInput = z.infer<typeof MeasuredInputSchema>;

function fixedInputs(expected: readonly string[]) {
  return (list: MeasuredInput[], ctx: z.RefinementCtx): void => {
    list.forEach((entry, i) => {
      if (entry.input !== expected[i]) {
        ctx.addIssue({
          code: "custom",
          path: [i, "input"],
          message: `must be ${JSON.stringify(expected[i])} (fixed order)`,
        });
      }
    });
  };
}

export const IpMeasurementSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.literal("ip"),
    version: z.literal("2.0.1"),
    integrity: Sri512,
    node: z.string(),
    measuredAt: UtcTimestampSchema,
    advisory: z
      .object({
        id: z.literal("GHSA-2p57-rm9w-gvfp"),
        aliases: z.tuple([z.literal("CVE-2024-29415")]),
        sources: z
          .array(z.object({ url: SourceUrlSchema, checkedOn: IsoDateSchema }).strict()),
      })
      .strict(),
    results: z
      .array(MeasuredInputSchema)
      .length(ADVISORY_ADDRESSES.length)
      .superRefine(fixedInputs(ADVISORY_ADDRESSES)),
    informational: z
      .array(MeasuredInputSchema)
      .length(INFORMATIONAL_ADDRESSES.length)
      .superRefine(fixedInputs(INFORMATIONAL_ADDRESSES)),
  })
  .strict();
export type IpMeasurement = z.infer<typeof IpMeasurementSchema>;

/** Fixed key order per object kind; the single source of truth for the serialized form. */
export const IP_MEASUREMENT_KEY_ORDER = {
  measurement: [
    "schemaVersion",
    "package",
    "version",
    "integrity",
    "node",
    "measuredAt",
    "advisory",
    "results",
    "informational",
  ],
  advisory: ["id", "aliases", "sources"],
  source: ["url", "checkedOn"],
  measuredInput: ["input", "outcome"],
  returned: ["kind", "value"],
  threw: ["kind", "error"],
} as const;

type Obj = { [k: string]: unknown };

function asObj(v: unknown): Obj {
  return v as Obj;
}

/** Sorts the keys of every object inside a JSON value by code point. */
function sortJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortJson);
  if (typeof v === "object" && v !== null) {
    const o = v as Obj;
    const out: Obj = {};
    for (const k of Object.keys(o).sort(compareCodePoints)) out[k] = sortJson(o[k]);
    return out;
  }
  return v;
}

function measuredInput(v: unknown): unknown {
  return ordered(asObj(v), IP_MEASUREMENT_KEY_ORDER.measuredInput, {
    outcome: (o) =>
      ordered(
        asObj(o),
        asObj(o)["kind"] === "returned"
          ? IP_MEASUREMENT_KEY_ORDER.returned
          : IP_MEASUREMENT_KEY_ORDER.threw,
        { value: sortJson },
      ),
  });
}

function ordering(m: IpMeasurement): Obj {
  const list = (v: unknown): unknown => (v as unknown[]).map(measuredInput);
  return ordered(m as unknown as Obj, IP_MEASUREMENT_KEY_ORDER.measurement, {
    advisory: (a) =>
      ordered(asObj(a), IP_MEASUREMENT_KEY_ORDER.advisory, {
        sources: (s) =>
          (s as unknown[]).map((x) => ordered(asObj(x), IP_MEASUREMENT_KEY_ORDER.source)),
      }),
    results: list,
    informational: list,
  });
}

/** Canonical JSON: fixed key order, no whitespace. */
export function canonicalIpMeasurementJson(m: IpMeasurement): string {
  return JSON.stringify(ordering(m));
}

/** Printed form for `docs/measurements/ip-2.0.1.json`: canonical key order, 2-space indent, final newline. */
export function printIpMeasurement(m: IpMeasurement): string {
  return JSON.stringify(ordering(m), null, 2) + "\n";
}

/** Parses and validates measurement JSON text. A failure lists issues as "path: message". */
export function parseIpMeasurement(text: string): Result<IpMeasurement, SchemaFailure> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { issues: [`(root): malformed JSON: ${detail}`] } };
  }
  return safeParseResult(IpMeasurementSchema, data);
}

/**
 * Addresses that may carry a delta: exactly the `results` whose outcome is `returned` with the
 * value `true`. A thrown error or any other value gives none (R3.8). `informational` is never
 * read (R3.11). `ipInDemo` is true when at least one address remains (R3.5, R3.6).
 */
export function deriveIpDeltas(m: IpMeasurement): { addresses: string[]; ipInDemo: boolean } {
  const addresses = m.results
    .filter((r) => r.outcome.kind === "returned" && r.outcome.value === true)
    .map((r) => r.input);
  return { addresses, ipInDemo: addresses.length > 0 };
}
