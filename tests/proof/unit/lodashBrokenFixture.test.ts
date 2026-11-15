import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";

const TARBALL = resolve(__dirname, "../fixtures/lodash.set/lodash.set-4.3.2.tgz");
const BROKEN_DIR = resolve(__dirname, "../fixtures/lodash.set-broken");

type SetFn = (object: unknown, path: unknown, value: unknown) => unknown;

let tempDir: string;
let originalDir: string;
let original: SetFn;
let broken: SetFn;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "gs-lodash-broken-"));
  const extracted = await extractTarball(new Uint8Array(readFileSync(TARBALL)), tempDir);
  expect(extracted.ok).toBe(true);
  originalDir = tempDir;
  const load = createRequire(__filename);
  original = load(join(originalDir, "index.js")) as SetFn;
  broken = load(join(BROKEN_DIR, "index.js")) as SetFn;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("lodash.set-broken fixture", () => {
  it("behaves like the original for string-key-only paths", () => {
    const cases: Array<[unknown, unknown, unknown]> = [
      [{}, "a", 1],
      [{}, "a.b.c", 2],
      [{ a: { b: 1 } }, "a.c", 3],
      [{}, ["x", "y"], "v"],
      [{ k: 1 }, "k", undefined],
    ];
    for (const [object, path, value] of cases) {
      const expected = original(structuredClone(object), path, value);
      const actual = broken(structuredClone(object), path, value);
      expect(actual).toEqual(expected);
    }
  });

  it("creates an object instead of an array for a numeric next segment", () => {
    const orig = original({}, "a[0]", 1) as { a: unknown };
    const bad = broken({}, "a[0]", 1) as { a: unknown };
    expect(Array.isArray(orig.a)).toBe(true);
    expect(Array.isArray(bad.a)).toBe(false);
    expect(orig).toEqual({ a: [1] });
    expect(bad).toEqual({ a: { "0": 1 } });
    expect(JSON.stringify(orig)).not.toBe(JSON.stringify(bad));
  });

  it("keeps the public API surface", () => {
    expect(typeof broken).toBe("function");
    expect(broken.name).toBe(original.name);
    expect(broken.length).toBe(original.length);
    expect(broken.length).toBe(3);
    expect(Object.getOwnPropertyNames(broken).sort()).toEqual(Object.getOwnPropertyNames(original).sort());
    const requireFn = createRequire(__filename);
    const brokenExports = requireFn(join(BROKEN_DIR, "index.js")) as object;
    const originalExports = requireFn(join(originalDir, "index.js")) as object;
    expect(Object.keys(brokenExports)).toEqual(Object.keys(originalExports));
  });

  it("preserves license and author credits, with only the version changed", () => {
    const o = readJson(join(originalDir, "package.json"));
    const b = readJson(join(BROKEN_DIR, "package.json"));
    expect(b.name).toBe(o.name);
    expect(b.version).toBe("4.3.3");
    expect(b.license).toBe(o.license);
    expect(b.author).toEqual(o.author);
    expect(b.contributors).toEqual(o.contributors);
    expect(readFileSync(join(BROKEN_DIR, "LICENSE"), "utf8")).toBe(readFileSync(join(originalDir, "LICENSE"), "utf8"));
    expect(readFileSync(join(BROKEN_DIR, "README.md"), "utf8")).toContain("DELIBERATELY BROKEN");
  });

  it("blocks prototype pollution while the original does not (spawned child)", () => {
    const script = [
      "const r = {};",
      "for (const [label, dir] of Object.entries(JSON.parse(process.argv[1]))) {",
      "  const set = require(dir + '/index.js');",
      "  set({}, '__proto__.polluted', 'yes');",
      "  r[label] = ({}).polluted === 'yes';",
      "  delete Object.prototype.polluted;",
      "}",
      "process.stdout.write(JSON.stringify(r));",
    ].join("\n");
    const run = spawnSync(
      process.execPath,
      ["-e", script, JSON.stringify({ original: originalDir, broken: BROKEN_DIR })],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ original: true, broken: false });
  });
});
