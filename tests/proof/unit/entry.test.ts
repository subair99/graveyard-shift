// Requirements: 3.4, 3.5
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveEntry } from "../../../src/proof/shell/entry";

let base: string;
let pkg: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "gs-test-entry "));
  pkg = path.join(base, "my pkg");
  fs.mkdirSync(pkg);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function write(rel: string, text: string): void {
  const file = path.join(pkg, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function manifest(fields: Record<string, unknown>): void {
  write("package.json", JSON.stringify(fields));
}

function expectEntry(rel: string): void {
  const result = resolveEntry(pkg);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.entryFile).toBe(
    path.join(fs.realpathSync.native(pkg), ...rel.split("/")),
  );
}

function expectRejected(): string {
  const result = resolveEntry(pkg);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected rejection");
  expect(result.error.kind).toBe("unloadable-module");
  return result.error.message;
}

describe("resolveEntry: main", () => {
  it.each([
    ["entry", "entry.js"],
    ["entry.js", "entry.js"],
    ["./entry.js", "entry.js"],
    ["lib", "lib/index.js"],
    ["./lib/", "lib/index.js"],
    ["lib/index", "lib/index.js"],
  ])("main %s resolves", (main, expected) => {
    manifest({ name: "p", version: "1.2.3", main });
    write("entry.js", "");
    write("lib/index.js", "");
    expectEntry(expected);
  });

  it("returns name and version from package.json (path with a space)", () => {
    manifest({ name: "p", version: "1.2.3" });
    write("index.js", "");
    const result = resolveEntry(pkg);
    expect(result.ok && result.value.name).toBe("p");
    expect(result.ok && result.value.version).toBe("1.2.3");
  });

  it("defaults to index.js and falls back to it when main is missing", () => {
    manifest({ name: "p", main: "nope.js" });
    write("index.js", "");
    expectEntry("index.js");
  });

  it("rejects when neither main nor index.js exists", () => {
    manifest({ name: "p", main: "nope.js" });
    expect(expectRejected()).toContain("no entry file");
  });

  it("rejects a main that escapes with ../ even when the file exists", () => {
    fs.writeFileSync(path.join(base, "outside.js"), "");
    manifest({ name: "p", main: "../outside.js" });
    write("index.js", "");
    expect(expectRejected()).toContain("outside");
  });

  it("rejects a missing or invalid package.json", () => {
    expect(expectRejected()).toContain("missing");
    write("package.json", "{nope");
    expect(expectRejected()).toContain("JSON");
  });

  it("reads a package.json with a byte order mark", () => {
    write("package.json", "\uFEFF" + JSON.stringify({ main: "a.js" }));
    write("a.js", "");
    expectEntry("a.js");
  });
});

describe("resolveEntry: type module", () => {
  it('rejects "type": "module" as unloadable-module', () => {
    manifest({ name: "esm", type: "module", main: "a.js" });
    write("a.js", "export const x = 1;");
    expect(expectRejected()).toContain("module");
  });

  it('accepts "type": "commonjs" and a missing type', () => {
    manifest({ type: "commonjs" });
    write("index.js", "");
    expectEntry("index.js");
  });
});

describe("resolveEntry: exports", () => {
  it("uses a string exports and prefers it over main", () => {
    manifest({ main: "a.js", exports: "./b.js" });
    write("a.js", "");
    write("b.js", "");
    expectEntry("b.js");
  });

  it("uses the require condition before default, in key order", () => {
    manifest({ exports: { import: "./esm.mjs", require: "./cjs.js", default: "./d.js" } });
    write("cjs.js", "");
    write("d.js", "");
    expectEntry("cjs.js");
  });

  it('reads the "." entry, nested conditions and arrays', () => {
    manifest({ exports: { ".": { node: { default: ["./x.mjs-less", "./n.js"] } } } });
    write("n.js", "");
    // The first array element is a string target, so it wins even if the file is absent.
    expect(expectRejected()).toContain("does not exist");
    manifest({ exports: { ".": { node: { default: [{ import: "./i.js" }, "./n.js"] } } } });
    expectEntry("n.js");
  });

  it("rejects unsupported forms instead of falling back to main", () => {
    write("a.js", "");
    manifest({ main: "a.js", exports: { "./sub": "./a.js" } });
    expect(expectRejected()).toContain('"."');
    manifest({ main: "a.js", exports: { ".": "./*.js" } });
    expect(expectRejected()).toContain("pattern");
    manifest({ main: "a.js", exports: { import: "./a.js" } });
    expect(expectRejected()).toContain("conditions");
    manifest({ main: "a.js", exports: { ".": null } });
    expectRejected();
    manifest({ main: "a.js", exports: { ".": "./a.js", require: "./a.js" } });
    expect(expectRejected()).toContain("mixes");
    manifest({ main: "a.js", exports: { ".": "a.js" } });
    expectRejected();
  });

  it("rejects an exports target that escapes with ../ and a .mjs target", () => {
    fs.writeFileSync(path.join(base, "outside.js"), "");
    manifest({ exports: "./../outside.js" });
    expect(expectRejected()).toContain("outside");
    write("m.mjs", "");
    manifest({ exports: "./m.mjs" });
    expect(expectRejected()).toContain(".mjs");
  });

  it("ignores exports: null", () => {
    manifest({ exports: null, main: "a.js" });
    write("a.js", "");
    expectEntry("a.js");
  });
});

describe("resolveEntry: containment through links", () => {
  it("rejects an entry whose real path leaves the package", (ctx) => {
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "x.js"), "");
    try {
      fs.symlinkSync(outside, path.join(pkg, "lib"), "junction");
    } catch (error) {
      ctx.skip(`junction could not be created: ${String(error)}`);
      return;
    }
    manifest({ main: "lib/x.js" });
    expect(expectRejected()).toContain("outside");
  });
});
