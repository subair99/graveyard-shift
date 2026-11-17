// Preset_Menu_File: the preset menu the Medium reads through get_preset_menu. Pure.

import { z } from "zod";
import { safeParseResult } from "../../../engine/types";
import type { Result, SchemaFailure } from "../../../engine/types";
import { canonicalJsonText, compareCodePoints, orderKeys } from "../../common/canonical";
import type { DeltaSchema } from "../../harness/core/deltas";
import type { PresetMenu } from "../../harness/core/presets";

export interface PresetMenuEntry {
  name: string;
  package: string;
  functions: string[];
  deltaFunctions: string[];
  inputClasses: string[];
}

export interface PresetMenuFile {
  presets: PresetMenuEntry[];
  deltaKinds: string[];
  ciOwnedKeys: string[];
}

const FILE_KEY_ORDER = ["presets", "deltaKinds", "ciOwnedKeys"] as const;
const ENTRY_KEY_ORDER = ["name", "package", "functions", "deltaFunctions", "inputClasses"] as const;

const PresetMenuEntrySchema = z
  .object({
    name: z.string(),
    package: z.string(),
    functions: z.array(z.string()),
    deltaFunctions: z.array(z.string()),
    inputClasses: z.array(z.string()),
  })
  .strict();

const PresetMenuFileSchema = z
  .object({
    presets: z.array(PresetMenuEntrySchema),
    deltaKinds: z.array(z.string()),
    ciOwnedKeys: z.array(z.string()),
  })
  .strict();

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
    inputClasses: Object.keys(p.inputClasses).sort(compareCodePoints),
  }));
  entries.sort((a, b) => compareCodePoints(a.name, b.name));
  return { presets: entries, deltaKinds: [...deltaKinds], ciOwnedKeys: [...ciOwnedKeys] };
}

/** The `kind` literals of DeltaSchema, in schema order. */
export function deltaKindsOf(schema: typeof DeltaSchema): string[] {
  return schema.options.map((option) => option.shape.kind.value);
}

/** Canonical JSON in the fixed key order, plus a final line feed. */
export function printPresetMenu(menu: PresetMenuFile): string {
  const ordered = orderKeys(menu as unknown as Record<string, unknown>, FILE_KEY_ORDER, {
    presets: (list) =>
      (list as PresetMenuEntry[]).map((e) =>
        orderKeys(e as unknown as Record<string, unknown>, ENTRY_KEY_ORDER),
      ),
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
