import { describe, expect, it } from "vitest";
import { parseInput } from "../../../src/engine/parse/inputParser";
import { isValidPackageName } from "../../../src/engine/parse/packageName";

const json = (v: unknown): string => JSON.stringify(v);

describe("package name validation", () => {
  it("accepts plain and scoped names", () => {
    expect(isValidPackageName("lodash.set")).toBe(true);
    expect(isValidPackageName("@graveyard-shift/ip")).toBe(true);
    expect(isValidPackageName("a".repeat(214))).toBe(true);
  });
  it("rejects bad names", () => {
    for (const n of ["", "a".repeat(215), "Upper", ".dot", "_under", "@scope", "@/x", "@s/", "a b", "a/b"]) {
      expect(isValidPackageName(n), n).toBe(false);
    }
  });
});

describe("parseInput: package name", () => {
  it("returns a ref with exact version or range", () => {
    expect(parseInput({ kind: "name", name: "inflight", version: "1.0.6" })).toEqual({
      ok: true,
      value: { refs: [{ name: "inflight", spec: "1.0.6" }] },
    });
    expect(parseInput({ kind: "name", name: "ip", version: "^1.1.0" })).toMatchObject({ ok: true });
  });
  it("uses null spec when no version is given", () => {
    expect(parseInput({ kind: "name", name: "ip" })).toEqual({
      ok: true,
      value: { refs: [{ name: "ip", spec: null }] },
    });
  });
  it("rejects invalid name and invalid version, naming the input type", () => {
    const a = parseInput({ kind: "name", name: "Bad Name" });
    expect(a).toMatchObject({ ok: false, error: { inputType: "package name" } });
    const b = parseInput({ kind: "name", name: "ip", version: "not a version" });
    expect(b).toMatchObject({ ok: false, error: { inputType: "package name" } });
  });
});

describe("parseInput: package.json", () => {
  it("collects all three dependency sections, sorted and deduped", () => {
    const r = parseInput({
      kind: "package.json",
      text: json({
        dependencies: { zed: "1.0.0", ip: "^1.1.0" },
        devDependencies: { ip: "^1.1.0", alpha: "~2.0.0" },
        optionalDependencies: { ip: "1.0.0" },
      }),
    });
    expect(r).toEqual({
      ok: true,
      value: {
        refs: [
          { name: "alpha", spec: "~2.0.0" },
          { name: "ip", spec: "1.0.0" },
          { name: "ip", spec: "^1.1.0" },
          { name: "zed", spec: "1.0.0" },
        ],
      },
    });
  });
  it("returns an empty list with a note for empty manifests", () => {
    expect(parseInput({ kind: "package.json", text: "{}" })).toEqual({
      ok: true,
      value: { refs: [], note: "no packages found" },
    });
  });
  it("rejects invalid JSON, non-objects, and oversize input", () => {
    expect(parseInput({ kind: "package.json", text: "{nope" })).toMatchObject({
      ok: false,
      error: { inputType: "package.json" },
    });
    expect(parseInput({ kind: "package.json", text: "[]" })).toMatchObject({ ok: false });
    const big = json({ pad: "x".repeat(5 * 1024 * 1024) });
    expect(parseInput({ kind: "package.json", text: big })).toMatchObject({
      ok: false,
      error: { inputType: "package.json" },
    });
  });
  it("rejects non-string specifiers", () => {
    expect(
      parseInput({ kind: "package.json", text: json({ dependencies: { a: 1 } }) }),
    ).toMatchObject({ ok: false });
  });
});

describe("parseInput: package-lock.json", () => {
  it("reads v3 packages map, skips root, workspaces and links, uses path suffix names", () => {
    const r = parseInput({
      kind: "package-lock.json",
      text: json({
        lockfileVersion: 3,
        packages: {
          "": { name: "app", version: "1.0.0" },
          "packages/local": { version: "0.0.1" },
          "node_modules/b": { version: "2.0.0" },
          "node_modules/a": { version: "1.10.0" },
          "node_modules/a/node_modules/b": { version: "1.0.0" },
          "node_modules/@s/c": { version: "3.0.0" },
          "node_modules/linked": { link: true, resolved: "../x" },
        },
      }),
    });
    expect(r).toEqual({
      ok: true,
      value: {
        refs: [
          { name: "@s/c", spec: "3.0.0" },
          { name: "a", spec: "1.10.0" },
          { name: "b", spec: "1.0.0" },
          { name: "b", spec: "2.0.0" },
        ],
      },
    });
  });
  it("orders versions by semver precedence, not string order", () => {
    const r = parseInput({
      kind: "package-lock.json",
      text: json({
        lockfileVersion: 3,
        packages: {
          "node_modules/x": { version: "1.10.0" },
          "node_modules/a/node_modules/x": { version: "1.9.0" },
        },
      }),
    });
    expect(r.ok && r.value.refs.map((x) => x.spec)).toEqual(["1.9.0", "1.10.0"]);
  });
  it("falls back to the v1 dependencies tree including nested entries", () => {
    const r = parseInput({
      kind: "package-lock.json",
      text: json({
        lockfileVersion: 1,
        dependencies: {
          a: { version: "1.0.0", dependencies: { b: { version: "2.0.0" } } },
          b: { version: "2.0.0" },
        },
      }),
    });
    expect(r).toEqual({
      ok: true,
      value: {
        refs: [
          { name: "a", spec: "1.0.0" },
          { name: "b", spec: "2.0.0" },
        ],
      },
    });
  });
  it("returns an empty list with a note when only the root entry exists", () => {
    const r = parseInput({
      kind: "package-lock.json",
      text: json({ lockfileVersion: 3, packages: { "": { name: "app" } } }),
    });
    expect(r).toEqual({ ok: true, value: { refs: [], note: "no packages found" } });
  });
  it("rejects unsupported lockfileVersion and invalid JSON", () => {
    expect(
      parseInput({ kind: "package-lock.json", text: json({ lockfileVersion: 4, packages: {} }) }),
    ).toMatchObject({ ok: false, error: { inputType: "package-lock.json" } });
    expect(parseInput({ kind: "package-lock.json", text: "oops" })).toMatchObject({
      ok: false,
      error: { inputType: "package-lock.json" },
    });
  });
});

describe("parseInput: unsupported input", () => {
  it("names yarn.lock and pnpm-lock.yaml", () => {
    for (const f of ["yarn.lock", "pnpm-lock.yaml"]) {
      const r = parseInput({ kind: "other", filename: f, text: "x" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.inputType).toBe(f);
        expect(r.error.reason.length).toBeGreaterThan(0);
      }
    }
  });
  it("rejects other file types", () => {
    expect(parseInput({ kind: "other", filename: "notes.txt", text: "" })).toMatchObject({
      ok: false,
      error: { inputType: "notes.txt" },
    });
  });
});

describe("code-point name ordering", () => {
  it("sorts uppercase-free names by code point (hyphen before letters, scope first)", () => {
    const r = parseInput({
      kind: "package.json",
      text: json({ dependencies: { "a-b": "1.0.0", a1: "1.0.0", ab: "1.0.0", "@z/q": "1.0.0" } }),
    });
    expect(r.ok && r.value.refs.map((x) => x.name)).toEqual(["@z/q", "a-b", "a1", "ab"]);
  });
});
