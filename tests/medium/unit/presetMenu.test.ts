// Requirements: 5.3, 5.4
// The printed menu built from PRESETS, DeltaSchema and CI_OWNED_KEYS names exactly what the code has.

import { describe, expect, it } from "vitest";
import { CI_OWNED_KEYS } from "../../../src/pipeline/harness/core/compiler";
import { compareCodePoints } from "../../../src/pipeline/common/canonical";
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
      expect(entry.inputClasses.map((c) => c.name)).toEqual(Object.keys(preset!.inputClasses).sort(compareCodePoints));
    }
  });

  it("lists every class of PRESETS with its definition and an appliesTo inside deltaFunctions", () => {
    let classCount = 0;
    for (const entry of menu().presets) {
      const preset = Object.values(PRESETS).find((p) => p.name === entry.name)!;
      expect(Object.keys(preset.inputClassDocs).sort()).toEqual(Object.keys(preset.inputClasses).sort());
      for (const cls of entry.inputClasses) {
        classCount += 1;
        const doc = preset.inputClassDocs[cls.name]!;
        expect(cls.definition.trim().length).toBeGreaterThan(0);
        expect(cls.definition).toBe(doc.definition);
        expect(cls.appliesTo.length).toBeGreaterThan(0);
        expect(cls.appliesTo).toEqual([...doc.appliesTo]);
        for (const fn of cls.appliesTo) expect(preset.deltaFunctions).toContain(fn);
        const positions = cls.appliesTo.map((fn) => preset.deltaFunctions.indexOf(fn));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      }
    }
    expect(classCount).toBeGreaterThan(0);
  });

  it("gives the ip-address class definition its grammar and the rule that a parse failure is not in the class", () => {
    const ip = menu().presets.find((p) => p.name === "ip-address")!;
    expect(ip.inputClasses.map((c) => c.name)).toEqual(["non-public-address"]);
    const text = ip.inputClasses[0]!.definition;
    expect(text).toContain("parse failure means not in the class");
    expect(text).toContain("172.16.0.0/12");
  });

  it("is deterministic and round-trips", () => {
    const again = printPresetMenu(buildPresetMenu(PRESETS, deltaKindsOf(DeltaSchema), CI_OWNED_KEYS));
    expect(again).toBe(printed);
    expect(printPresetMenu(menu())).toBe(printed);
  });

  it("refuses a class without a definition", () => {
    const base = Object.values(PRESETS).find((p) => Object.keys(p.inputClasses).length > 0)!;
    const broken = { ...base, inputClassDocs: {} };
    expect(() => buildPresetMenu({ [broken.name]: broken }, [], [])).toThrow(/no definition/);
  });

  it("names every delta kind of DeltaSchema in schema order", () => {
    const kinds = DeltaSchema.options.map((o) => o.shape.kind.value);
    expect(kinds.length).toBeGreaterThan(0);
    expect(menu().deltaKinds).toEqual(kinds);
  });

  it("names the schema and example of both output files and nothing else", () => {
    const of = menu().outputFormat;
    expect(Object.keys(of).sort()).toEqual(["deltas", "harness"]);
    for (const entry of [of.deltas, of.harness]) {
      expect(Object.keys(entry).sort()).toEqual(["example", "schema"]);
    }
  });

  it("names every CI-owned key in order", () => {
    expect(menu().ciOwnedKeys).toEqual([...CI_OWNED_KEYS]);
  });

  it("has the fixed key order", () => {
    const raw = JSON.parse(printed) as { presets: Record<string, unknown>[] };
    expect(Object.keys(raw)).toEqual(["presets", "deltaKinds", "ciOwnedKeys", "outputFormat"]);
    const of = (raw as unknown as { outputFormat: Record<string, Record<string, unknown>> }).outputFormat;
    expect(Object.keys(of)).toEqual(["deltas", "harness"]);
    expect(Object.keys(of.deltas ?? {})).toEqual(["schema", "example"]);
    expect(Object.keys(of.harness ?? {})).toEqual(["schema", "example"]);
    expect(Object.keys(raw.presets[0] ?? {})).toEqual([
      "name",
      "package",
      "functions",
      "deltaFunctions",
      "inputClasses",
    ]);
    const withClass = raw.presets.find((p) => (p["inputClasses"] as unknown[]).length > 0);
    expect(Object.keys((withClass!["inputClasses"] as Record<string, unknown>[])[0]!)).toEqual([
      "name",
      "definition",
      "appliesTo",
    ]);
  });

  it("rejects unknown keys and malformed JSON", () => {
    expect(parsePresetMenu(printed.replace('"presets"', '"extra":1,"presets"')).ok).toBe(false);
    expect(parsePresetMenu("{").ok).toBe(false);
  });
});
