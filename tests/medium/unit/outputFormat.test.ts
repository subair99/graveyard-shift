// Requirements: 5.3, 5.4, 6.2
// The outputFormat key of the preset menu: examples parse, committed fixtures validate against the
// emitted schemas (small in-test structural checker, no dependency), and the menu is deterministic.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CI_OWNED_KEYS } from "../../../src/pipeline/harness/core/compiler";
import { DeltaSchema, parseDeltasFile } from "../../../src/pipeline/harness/core/deltas";
import { parseHarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import { PRESETS } from "../../../src/pipeline/harness/core/presets";
import {
  buildOutputFormat,
  buildPresetMenu,
  deltaKindsOf,
  parsePresetMenu,
  printPresetMenu,
} from "../../../src/pipeline/medium/core/presetMenu";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };

function jsonType(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Returns the list of violations of `value` against `schema`; empty means valid. Only the keywords zod emits here. */
function check(schema: Schema, value: Json, path = "$"): string[] {
  const errors: string[] = [];
  const t = schema.type;
  if (t !== undefined) {
    const types = Array.isArray(t) ? t : [t];
    const actual = jsonType(value);
    const ok = types.some((x) => x === actual || (x === "integer" && Number.isInteger(value)));
    if (!ok) return [`${path}: expected type ${types.join("|")}, got ${actual}`];
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: const mismatch`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: not in enum`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as Schema[]).filter((s) => check(s, value, path).length === 0).length;
    if (matches !== 1) errors.push(`${path}: matches ${matches} of oneOf, expected 1`);
  }
  if (Array.isArray(schema.anyOf)) {
    if (!(schema.anyOf as Schema[]).some((s) => check(s, value, path).length === 0)) errors.push(`${path}: matches no anyOf`);
  }
  if (typeof value === "string") {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: pattern`);
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) errors.push(`${path}: minLength`);
    if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) errors.push(`${path}: maxLength`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path}: minItems`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    if (schema.items !== undefined && typeof schema.items === "object") {
      value.forEach((item, i) => errors.push(...check(schema.items as Schema, item, `${path}[${i}]`)));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const props = (schema.properties ?? {}) as { [k: string]: Schema };
    for (const req of (schema.required ?? []) as string[]) {
      if (!(req in value)) errors.push(`${path}: missing ${req}`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames) errors.push(...check(schema.propertyNames as Schema, k, `${path}.<name ${k}>`));
      if (k in props) errors.push(...check(props[k] as Schema, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${k}`);
      else if (typeof schema.additionalProperties === "object") {
        errors.push(...check(schema.additionalProperties as Schema, v, `${path}.${k}`));
      }
    }
  }
  return errors;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "deltas.json" || name === "harness.json") out.push(p);
  }
  return out;
}

const format = buildOutputFormat();
const fixtures = walk(join(__dirname, "..", "..", "pipeline", "fixtures"));
const kindOf = (p: string): "deltas" | "harness" => (p.endsWith("deltas.json") ? "deltas" : "harness");

describe("outputFormat examples", () => {
  it("pass parseDeltasFile and parseHarnessFile", () => {
    expect(parseDeltasFile(JSON.stringify(format.deltas.example)).ok).toBe(true);
    expect(parseHarnessFile(JSON.stringify(format.harness.example)).ok).toBe(true);
  });

  it("validate against their own schemas", () => {
    expect(check(format.deltas.schema as Schema, format.deltas.example as Json)).toEqual([]);
    expect(check(format.harness.schema as Schema, format.harness.example as Json)).toEqual([]);
  });
});

describe("committed fixtures against the emitted schemas", () => {
  it("finds stub and real fixtures of both kinds", () => {
    expect(fixtures.filter((p) => kindOf(p) === "deltas").length).toBeGreaterThanOrEqual(3);
    expect(fixtures.filter((p) => kindOf(p) === "harness").length).toBeGreaterThanOrEqual(3);
  });

  it.each(fixtures.map((p) => [p]))("validates %s", (p) => {
    const doc = JSON.parse(readFileSync(p, "utf8")) as Json;
    const kind = kindOf(p);
    expect(check(format[kind].schema as Schema, doc)).toEqual([]);
  });

  it("the checker rejects a mutated invalid document of each kind", () => {
    for (const kind of ["deltas", "harness"] as const) {
      const files = fixtures.filter((p) => kindOf(p) === kind);
      expect(files.length).toBeGreaterThan(0);
      for (const p of files) {
        const schema = format[kind].schema as Schema;
        const good = JSON.parse(readFileSync(p, "utf8")) as { [k: string]: Json };
        expect(check(schema, good)).toEqual([]);
        const noPackage = { ...good };
        delete noPackage.package;
        expect(check(schema, noPackage).length).toBeGreaterThan(0);
        expect(check(schema, { ...good, schemaVersion: 2 }).length).toBeGreaterThan(0);
        expect(check(schema, { ...good, extra: 1 }).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("menu determinism", () => {
  const build = () => printPresetMenu(buildPresetMenu(PRESETS, deltaKindsOf(DeltaSchema), CI_OWNED_KEYS));

  it("prints the same bytes twice", () => {
    expect(build()).toBe(build());
  });

  it("round trips through parsePresetMenu with outputFormat intact", () => {
    const text = build();
    const parsed = parsePresetMenu(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(printPresetMenu(parsed.value)).toBe(text);
  });
});
