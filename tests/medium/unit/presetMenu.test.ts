// Requirements: 5.3, 5.4
// The printed menu built from PRESETS, DeltaSchema and CI_OWNED_KEYS names exactly what the code has.

import { describe, expect, it } from "vitest";
import { CI_OWNED_KEYS } from "../../../src/pipeline/harness/core/compiler";
import { DeltaSchema } from "../../../src/pipeline/harness/core/deltas";
import { PRESETS } from "../../../src/pipeline/harness/core/presets";
import {
  buildPresetMenu,
  deltaKindsOf,
  parsePresetMenu,
  printPresetMenu,
} from "../../../src/pipeline/medium/core/presetMenu";

const printed = printPresetMenu(buildPresetMenu(PRESETS, deltaKindsOf(DeltaSchema), CI_OWNED_KEYS));
const parsed = parsePresetMenu(printed);

function menu() {
  if (!parsed.ok) throw new Error(parsed.error.issues.join("; "));
  return parsed.value;
}

describe("printed preset menu", () => {
  it("ends with one line feed and parses strictly", () => {
    expect(printed.endsWith("}\n")).toBe(true);
    expect(parsed.ok).toBe(true);
  });

  it("names every preset of the code and no other", () => {
    expect(menu().presets.map((p) => p.name)).toEqual(Object.values(PRESETS).map((p) => p.name).sort());
  });

  it("names the package, functions, delta functions and class names of each preset and nothing else", () => {
    for (const entry of menu().presets) {
      const preset = Object.values(PRESETS).find((p) => p.name === entry.name);
      expect(preset).toBeDefined();
      expect(entry.package).toBe(preset!.package);
      expect(entry.functions).toEqual([...preset!.functions]);
      expect(entry.deltaFunctions).toEqual([...preset!.deltaFunctions]);
      expect(entry.inputClasses).toEqual(Object.keys(preset!.inputClasses).sort());
    }
  });

  it("names every delta kind of DeltaSchema in schema order", () => {
    const kinds = DeltaSchema.options.map((o) => o.shape.kind.value);
    expect(kinds.length).toBeGreaterThan(0);
    expect(menu().deltaKinds).toEqual(kinds);
  });

  it("names every CI-owned key in order", () => {
    expect(menu().ciOwnedKeys).toEqual([...CI_OWNED_KEYS]);
  });

  it("has the fixed key order", () => {
    const raw = JSON.parse(printed) as { presets: Record<string, unknown>[] };
    expect(Object.keys(raw)).toEqual(["presets", "deltaKinds", "ciOwnedKeys"]);
    expect(Object.keys(raw.presets[0] ?? {})).toEqual([
      "name",
      "package",
      "functions",
      "deltaFunctions",
      "inputClasses",
    ]);
  });

  it("rejects unknown keys and malformed JSON", () => {
    expect(parsePresetMenu(printed.replace('"presets"', '"extra":1,"presets"')).ok).toBe(false);
    expect(parsePresetMenu("{").ok).toBe(false);
  });
});
