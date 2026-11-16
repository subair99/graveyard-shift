// Harness_File (Requirement 5, design "Harness: Deltas_File, Harness_File, presets and compiler").
// Pure: strict schema, parser that names the failing path, canonical JSON with a fixed key order.
// Whether a preset name is in the reviewed menu is decided by the compiler, not by this schema.

import { z } from "zod";
import { safeParseResult } from "../../../engine/types";
import type { Result, SchemaFailure } from "../../../engine/types";
import { compareCodePoints, ordered } from "../../../proof/child/codec/order";

export const PRESET_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export const PresetNameSchema = z
  .string()
  .regex(PRESET_NAME_PATTERN, "must match ^[a-z][a-z0-9-]{0,63}$");

export const JsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>;

const FunctionEntrySchema = z
  .object({
    preset: PresetNameSchema,
    options: z.record(z.string(), JsonPrimitiveSchema).optional(),
  })
  .strict();
export type HarnessFunctionEntry = z.infer<typeof FunctionEntrySchema>;

export const HarnessFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.string().min(1),
    functions: z.record(z.string(), FunctionEntrySchema),
  })
  .strict();
export type HarnessFile = z.infer<typeof HarnessFileSchema>;

/** Fixed key order per object kind; function names and option names sort by code point. */
export const HARNESS_KEY_ORDER = {
  file: ["schemaVersion", "package", "functions"],
  entry: ["preset", "options"],
} as const;

type Obj = { [k: string]: unknown };

function sortedRecord(o: Obj, map: (v: unknown) => unknown = (v) => v): Obj {
  const out: Obj = {};
  for (const k of Object.keys(o).sort(compareCodePoints)) {
    Object.defineProperty(out, k, {
      value: map(o[k]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Canonical JSON: fixed key order, no whitespace. */
export function canonicalHarnessJson(f: HarnessFile): string {
  return JSON.stringify(
    ordered(f as unknown as Obj, HARNESS_KEY_ORDER.file, {
      functions: (fns) =>
        sortedRecord(fns as Obj, (e) =>
          ordered(e as Obj, HARNESS_KEY_ORDER.entry, {
            options: (opts) => sortedRecord(opts as Obj),
          }),
        ),
    }),
  );
}

/** Parses JSON text into a Harness_File. A failure lists issues as "path: message". */
export function parseHarnessFile(json: string): Result<HarnessFile, SchemaFailure> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { issues: [`(root): malformed JSON: ${detail}`] } };
  }
  return safeParseResult(HarnessFileSchema, data);
}
