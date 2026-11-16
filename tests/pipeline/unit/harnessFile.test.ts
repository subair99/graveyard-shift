// Requirements: 5.1, 5.2, 5.10
import { describe, expect, it } from "vitest";
import { canonicalHarnessJson, parseHarnessFile } from "../../../src/pipeline/harness/core/harnessFile";

const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    package: "lodash.set",
    functions: { default: { preset: "lodash-set" } },
    ...over,
  });

function issues(text: string): string[] {
  const r = parseHarnessFile(text);
  if (r.ok) throw new Error("expected a parse failure");
  return r.error.issues;
}

describe("parseHarnessFile", () => {
  it("accepts a preset per function with primitive options", () => {
    const r = parseHarnessFile(
      file({ functions: { default: { preset: "lodash-set", options: { depth: 2, flag: true, s: "x", n: null } } } }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects malformed JSON at the root", () => {
    expect(issues("[")[0]).toMatch(/^\(root\): malformed JSON/);
  });

  it("names the failing path", () => {
    expect(issues(file({ functions: { default: { preset: "Bad Name" } } })).join("\n")).toContain(
      "functions.default.preset",
    );
    expect(issues(file({ schemaVersion: 2 })).join("\n")).toContain("schemaVersion");
  });

  it("rejects fields outside the schema (generator, setupModule, radius, seed)", () => {
    for (const key of ["generator", "setupModule", "radius", "seed", "excluded"]) {
      const text = file({ functions: { default: { preset: "lodash-set", [key]: "x" } } });
      expect(issues(text).join("\n")).toContain(key);
    }
    expect(issues(file({ radius: 1 })).join("\n")).toContain("radius");
  });

  it("rejects non-primitive option values (code strings as objects or arrays)", () => {
    expect(parseHarnessFile(file({ functions: { default: { preset: "p", options: { f: { a: 1 } } } } })).ok).toBe(false);
    expect(parseHarnessFile(file({ functions: { default: { preset: "p", options: { f: [1] } } } })).ok).toBe(false);
  });
});

describe("canonicalHarnessJson", () => {
  it("writes the fixed key order and sorts functions and options", () => {
    const r = parseHarnessFile(
      JSON.stringify({
        functions: { b: { options: { z: 1, a: 2 }, preset: "p" }, a: { preset: "q" } },
        package: "x",
        schemaVersion: 1,
      }),
    );
    if (!r.ok) throw new Error("parse failed");
    const text = canonicalHarnessJson(r.value);
    expect(text).toBe(
      '{"schemaVersion":1,"package":"x","functions":{"a":{"preset":"q"},"b":{"preset":"p","options":{"a":2,"z":1}}}}',
    );
    const again = parseHarnessFile(text);
    expect(again.ok && again.value).toEqual(r.value);
    expect(again.ok && canonicalHarnessJson(again.value)).toBe(text);
  });
});
