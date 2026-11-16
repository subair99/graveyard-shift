// Requirements: 4.4, 4.6, 4.7, 4.12, 3.6
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileHarness,
  EXPECTED_PLACEHOLDER,
  renderReturnsExpectedModule,
  type CompileError,
  type CompileInput,
} from "../../../src/pipeline/harness/core/compiler";
import type { JsonValue } from "../../../src/pipeline/harness/core/deltas";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const TEMPLATE = readFileSync("src/pipeline/harness/sandbox/returnsExpected.cjs", "utf8");
const MODULES_DIR = resolve(tmpdir(), "graveyard-test-modules");
const SOURCE = { url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", fetchedAt: "2026-11-15T10:00:00Z" };

const kase = (input: JsonValue[], expected: JsonValue) => ({ input, expected, source: SOURCE });
const reDelta = (id: string, cases: unknown[]) => ({
  kind: "returns-expected" as const,
  id,
  function: "default",
  advisory: "GHSA-p6mc-m468-83gw",
  cases,
});

function input(deltas: unknown[], withOutput = true): CompileInput {
  return {
    deltas: { schemaVersion: 1, package: "lodash.set", deltas },
    harness: { schemaVersion: 1, package: "lodash.set", functions: { default: { preset: "lodash-set" } } },
    certificate: LODASH_SET_CERT,
    ...(withOutput ? { returnsExpected: { template: TEMPLATE, modulesDir: MODULES_DIR } } : {}),
  } as CompileInput;
}

function errorsOf(i: CompileInput): CompileError[] {
  const r = compileHarness(i);
  if (r.ok) throw new Error("expected a compile failure");
  return r.error;
}

/** Writes a rendered module into a temp dir and loads it as the sandbox child would. */
function load(text: string): { check: (ctx: unknown) => { ok: boolean; detail?: unknown } } {
  const dir = mkdtempSync(join(tmpdir(), "re-module-"));
  try {
    const file = join(dir, "m.cjs");
    writeFileSync(file, text, "utf8");
    return createRequire(import.meta.url)(file) as ReturnType<typeof load>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("returns-expected lowering", () => {
  it("lowers a delta to a predicate, explicit cases and one generated module", () => {
    const r = compileHarness(
      input([reDelta("not-public", [kase(["127.1"], false), kase(["012.1.2.3"], false)])]),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const { config, modules } = r.value;
    const modulePath = join(MODULES_DIR, "returns-expected-not-public.cjs");
    expect(modules.map((m) => m.name)).toEqual(["returns-expected-not-public.cjs"]);
    expect(config.deltas).toHaveLength(1);
    const d = config.deltas[0]!;
    expect(d.propertyModule).toBe(modulePath);
    expect(d.explicitCases).toEqual([["127.1"], ["012.1.2.3"]]);
    expect(d.generator).toBeUndefined();
    expect(d.predicate(["127.1"])).toBe(true);
    expect(d.predicate(["8.8.8.8"])).toBe(false);
    expect(d.predicate(["127.1", "x"])).toBe(false);
    expect(config.readPaths).toEqual([modulePath]);
  });

  it("is deterministic: equal inputs give equal module text", () => {
    const i = input([reDelta("b", [kase(["x"], { a: 1, b: 2 })]), reDelta("a", [kase(["y"], false)])]);
    const a = compileHarness(i);
    const b = compileHarness(i);
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(b.value.modules).toEqual(a.value.modules);
    expect(a.value.modules.map((m) => m.name)).toEqual(["returns-expected-a.cjs", "returns-expected-b.cjs"]);
  });

  it("rejects cases with different expected values, naming the delta and saying to split it", () => {
    const errors = errorsOf(input([reDelta("mixed", [kase(["a"], false), kase(["b"], true)])]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "delta-expected-differs", deltaId: "mixed" });
    expect(errors[0]?.message).toContain('"mixed"');
    expect(errors[0]?.message).toContain("split");
  });

  it("treats expected objects with different key order as the same value", () => {
    const r = compileHarness(
      input([reDelta("same", [kase(["a"], { x: 1, y: 2 }), kase(["b"], { y: 2, x: 1 })])]),
    );
    expect(r.ok).toBe(true);
  });

  it("needs the module template and directory", () => {
    const errors = errorsOf(input([reDelta("r", [kase(["a"], 1)])], false));
    expect(errors.map((e) => e.code)).toEqual(["module-output-required"]);
  });

  it("rejects a case without a source", () => {
    const noSource = { input: ["a"], expected: 1 };
    const errors = errorsOf(input([reDelta("r", [noSource])]));
    expect(errors.map((e) => e.code)).toEqual(["missing-source"]);
  });

  it("no longer reports returns-expected-not-implemented", () => {
    const r = compileHarness(input([reDelta("r", [kase(["a"], 1)])]));
    expect(r.ok).toBe(true);
  });
});

describe("generated property module", () => {
  const render = (expected: JsonValue): string => {
    const text = renderReturnsExpectedModule(TEMPLATE, expected);
    if (text === null) throw new Error("template has no placeholder");
    return text;
  };

  it("template holds the placeholder exactly once", () => {
    expect(TEMPLATE.split(EXPECTED_PLACEHOLDER)).toHaveLength(2);
  });

  it("accepts a returned value equal to the expected value and rejects the rest", () => {
    const m = load(render(false));
    expect(m.check({ functionName: "isPublic", kind: "returned", prototypeDelta: [], result: false }).ok).toBe(true);
    expect(m.check({ functionName: "isPublic", kind: "returned", prototypeDelta: [], result: true }).ok).toBe(false);
    expect(m.check({ functionName: "isPublic", kind: "returned", prototypeDelta: [], result: 0 }).ok).toBe(false);
    expect(m.check({ functionName: "isPublic", kind: "threw", prototypeDelta: [], result: false }).ok).toBe(false);
  });

  it("compares objects and arrays deeply", () => {
    const m = load(render({ a: [1, { b: null }], c: "x" }));
    const ctx = (result: unknown) => ({ functionName: "f", kind: "returned", prototypeDelta: [], result });
    expect(m.check(ctx({ c: "x", a: [1, { b: null }] })).ok).toBe(true);
    expect(m.check(ctx({ c: "x", a: [1, { b: null }], extra: 1 })).ok).toBe(false);
    expect(m.check(ctx({ c: "x", a: [1, { b: 0 }] })).ok).toBe(false);
  });

  it("embeds the expected value as data, never as code", () => {
    const hostile = '"; globalThis.__pwned = true; //' + EXPECTED_PLACEHOLDER + "\\u2028${1}";
    const text = render(hostile);
    const m = load(text);
    expect(m.check({ functionName: "f", kind: "returned", prototypeDelta: [], result: hostile }).ok).toBe(true);
    expect((globalThis as Record<string, unknown>)["__pwned"]).toBeUndefined();
    // The only code change is the replaced literal: the rest of the template is untouched.
    expect(text.startsWith(TEMPLATE.split(EXPECTED_PLACEHOLDER)[0] as string)).toBe(true);
    expect(text.endsWith(TEMPLATE.split(EXPECTED_PLACEHOLDER)[1] as string)).toBe(true);
  });
});
