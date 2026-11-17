// Preset_Menu_File: the preset menu the Medium reads through get_preset_menu. Pure.

import { z } from "zod";
import { safeParseResult } from "../../../engine/types";
import type { Result, SchemaFailure } from "../../../engine/types";
import { canonicalJsonText, compareCodePoints, orderKeys } from "../../common/canonical";
import { canonicalDeltasJson, DeltasFileSchema } from "../../harness/core/deltas";
import type { DeltaSchema } from "../../harness/core/deltas";
import { canonicalHarnessJson, HarnessFileSchema } from "../../harness/core/harnessFile";
import type { PresetMenu } from "../../harness/core/presets";

export interface PresetMenuEntry {
  name: string;
  package: string;
  functions: string[];
  deltaFunctions: string[];
  inputClasses: PresetMenuInputClass[];
}

export interface PresetMenuInputClass {
  name: string;
  definition: string;
  appliesTo: string[];
}

type JsonObject = { [key: string]: unknown };

/** The format of one output file: its JSON Schema (draft 2020-12) and one valid example. */
export interface OutputFormatEntry {
  schema: JsonObject;
  example: JsonObject;
}

export interface OutputFormat {
  deltas: OutputFormatEntry;
  harness: OutputFormatEntry;
}

export interface PresetMenuFile {
  presets: PresetMenuEntry[];
  deltaKinds: string[];
  ciOwnedKeys: string[];
  outputFormat: OutputFormat;
}

const FILE_KEY_ORDER = ["presets", "deltaKinds", "ciOwnedKeys", "outputFormat"] as const;
const OUTPUT_FORMAT_KEY_ORDER = ["deltas", "harness"] as const;
const OUTPUT_FORMAT_ENTRY_KEY_ORDER = ["schema", "example"] as const;
const ENTRY_KEY_ORDER = ["name", "package", "functions", "deltaFunctions", "inputClasses"] as const;
const INPUT_CLASS_KEY_ORDER = ["name", "definition", "appliesTo"] as const;

const PresetMenuInputClassSchema = z
  .object({
    name: z.string(),
    definition: z.string(),
    appliesTo: z.array(z.string()),
  })
  .strict();

const PresetMenuEntrySchema = z
  .object({
    name: z.string(),
    package: z.string(),
    functions: z.array(z.string()),
    deltaFunctions: z.array(z.string()),
    inputClasses: z.array(PresetMenuInputClassSchema),
  })
  .strict();

const OutputFormatEntrySchema = z
  .object({
    schema: z.record(z.string(), z.unknown()),
    example: z.record(z.string(), z.unknown()),
  })
  .strict();

const PresetMenuFileSchema = z
  .object({
    presets: z.array(PresetMenuEntrySchema),
    deltaKinds: z.array(z.string()),
    ciOwnedKeys: z.array(z.string()),
    outputFormat: z
      .object({ deltas: OutputFormatEntrySchema, harness: OutputFormatEntrySchema })
      .strict(),
  })
  .strict();

const EXAMPLE_SOURCE = { url: "https://example.com/advisories/example-package", fetchedAt: "2026-01-01T00:00:00Z" };

/** Sorts the keys of every object in a JSON value by code point (idempotent). */
function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (typeof v === "object" && v !== null) {
    const o = v as JsonObject;
    const out: JsonObject = {};
    for (const k of Object.keys(o).sort(compareCodePoints)) out[k] = sortKeysDeep(o[k]);
    return out;
  }
  return v;
}

/**
 * The output format shown to the Medium: JSON Schemas from zod's toJSONSchema over the schemas
 * that parseDeltasFile and parseHarnessFile use, and one minimal example of each file. Pure and
 * deterministic.
 */
export function buildOutputFormat(): OutputFormat {
  const deltasExample = JSON.parse(
    canonicalDeltasJson({
      schemaVersion: 1,
      package: "example-package",
      deltas: [
        {
          kind: "returns-expected",
          id: "example-delta",
          function: "exampleFunction",
          advisory: "GHSA-aaaa-bbbb-cccc",
          cases: [{ input: ["example"], expected: "expected", source: { ...EXAMPLE_SOURCE } }],
        },
      ],
    }),
  ) as JsonObject;
  const harnessExample = JSON.parse(
    canonicalHarnessJson({
      schemaVersion: 1,
      package: "example-package",
      functions: { exampleFunction: { preset: "example-preset" } },
    }),
  ) as JsonObject;
  return {
    deltas: {
      schema: sortKeysDeep(z.toJSONSchema(DeltasFileSchema)) as JsonObject,
      example: deltasExample,
    },
    harness: {
      schema: sortKeysDeep(z.toJSONSchema(HarnessFileSchema)) as JsonObject,
      example: harnessExample,
    },
  };
}

/**
 * Builds the menu. Presets are sorted by name and class names by code point;
 * functions, deltaFunctions, deltaKinds and ciOwnedKeys keep the given order.
 */
export function buildPresetMenu(
  presets: PresetMenu,
  deltaKinds: readonly string[],
  ciOwnedKeys: readonly string[],
): PresetMenuFile {
  const entries: PresetMenuEntry[] = Object.values(presets).map((p) => ({
    name: p.name,
    package: p.package,
    functions: [...p.functions],
    deltaFunctions: [...p.deltaFunctions],
    inputClasses: Object.keys(p.inputClasses)
      .sort(compareCodePoints)
      .map((className) => {
        const doc = Object.hasOwn(p.inputClassDocs, className) ? p.inputClassDocs[className] : undefined;
        if (doc === undefined) {
          throw new Error(`preset ${p.name}: input class "${className}" has no definition in inputClassDocs`);
        }
        return { name: className, definition: doc.definition, appliesTo: [...doc.appliesTo] };
      }),
  }));
  entries.sort((a, b) => compareCodePoints(a.name, b.name));
  return {
    presets: entries,
    deltaKinds: [...deltaKinds],
    ciOwnedKeys: [...ciOwnedKeys],
    outputFormat: buildOutputFormat(),
  };
}

/** The `kind` literals of DeltaSchema, in schema order. */
export function deltaKindsOf(schema: typeof DeltaSchema): string[] {
  return schema.options.map((option) => option.shape.kind.value);
}

function printOutputFormatEntry(entry: unknown): unknown {
  return orderKeys(entry as JsonObject, OUTPUT_FORMAT_ENTRY_KEY_ORDER, { schema: sortKeysDeep });
}

/** Canonical JSON in the fixed key order, plus a final line feed. */
export function printPresetMenu(menu: PresetMenuFile): string {
  const ordered = orderKeys(menu as unknown as Record<string, unknown>, FILE_KEY_ORDER, {
    presets: (list) =>
      (list as PresetMenuEntry[]).map((e) =>
        orderKeys(e as unknown as Record<string, unknown>, ENTRY_KEY_ORDER, {
          inputClasses: (classes) =>
            (classes as PresetMenuInputClass[]).map((c) =>
              orderKeys(c as unknown as Record<string, unknown>, INPUT_CLASS_KEY_ORDER),
            ),
        }),
      ),
    outputFormat: (of) =>
      orderKeys(of as JsonObject, OUTPUT_FORMAT_KEY_ORDER, {
        deltas: printOutputFormatEntry,
        harness: printOutputFormatEntry,
      }),
  });
  return canonicalJsonText(ordered) + "\n";
}

/** Parses Preset_Menu_File text. A failure lists issues as "path: message". */
export function parsePresetMenu(text: string): Result<PresetMenuFile, SchemaFailure> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { issues: [`(root): malformed JSON: ${detail}`] } };
  }
  return safeParseResult(PresetMenuFileSchema, data);
}
