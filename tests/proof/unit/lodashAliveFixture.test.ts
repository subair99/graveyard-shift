import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";

type SetFn = (object: unknown, path: unknown, value: unknown) => unknown;

const TARBALL = resolve(__dirname, "../fixtures/lodash.set/lodash.set-4.3.2.tgz");
const ALIVE_DIR = resolve(__dirname, "../fixtures/lodash.set-alive");

let tempDir = "";
let original: SetFn;
let alive: SetFn;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "gs-lodash-alive-"));
  const extracted = await extractTarball(new Uint8Array(readFileSync(TARBALL)), tempDir);
  expect(extracted.ok).toBe(true);
  const load = createRequire(__filename);
  original = load(join(tempDir, "index.js")) as SetFn;
  alive = load(join(ALIVE_DIR, "index.js")) as SetFn;
});

afterAll(() => {
  if (tempDir !== "") rmSync(tempDir, { recursive: true, force: true });
});

// Ordinary paths never touch Object.prototype, so they run in the worker.
const ORDINARY: Array<[string, () => unknown, unknown, unknown]> = [
  ["dotted string", () => ({}), "a.b.c", 1],
  ["bracket string", () => ({}), "a[0].b", 2],
  ["bracket with quotes", () => ({}), "a['b c'].d", 3],
  ["array path", () => ({}), ["a", "b", "c"], 4],
  ["numeric index creates an array", () => ({}), "a[2]", 5],
  ["numeric segment in dots creates an array", () => ({}), "a.0.b", 6],
  ["non-numeric next segment creates an object", () => ({}), "a.b", 7],
  ["array root", () => [], "[1].x", 8],
  ["overwrite a leaf", () => ({ a: { b: 1 } }), "a.b", 9],
  ["overwrite a primitive with a container", () => ({ a: 1 }), "a.b", 10],
  ["keep siblings", () => ({ a: { x: 1 }, y: 2 }), "a.z", 11],
  ["key containing a dot", () => ({ "a.b": 1 }), "a.b", 12],
  ["numeric path", () => ({}), 3, 13],
  ["undefined value", () => ({}), "a.b", undefined],
  ["names that merely contain the dangerous words", () => ({}), "protoX.constructors.prototypes", 14],
  ["null object", () => null, "a.b", 15],
  ["primitive object", () => 5, "a.b", 16],
];

describe("lodash.set-alive: ordinary paths", () => {
  it.each(ORDINARY)("%s gives the same result as the original", (_name, make, path, value) => {
    const o = make();
    const a = make();
    const ro = original(o, path, value);
    const ra = alive(a, path, value);
    expect(a).toEqual(o);
    expect(ra).toEqual(ro);
    expect(ra === a).toBe(ro === o);
  });
});

// Pollution runs in a child process so the vitest worker's Object.prototype is never touched.
const CHILD_SCRIPT = [
  "const set = require(process.argv[1]);",
  "const cases = [",
  "  ['proto dotted', () => ({}), '__proto__.__gs_alive_a', Object.prototype],",
  "  ['constructor.prototype', () => ({}), 'constructor.prototype.__gs_alive_b', Object.prototype],",
  "  ['proto bracket', () => ({}), '__proto__[__gs_alive_c]', Object.prototype],",
  "  ['array path', () => ({}), ['__proto__', '__gs_alive_d'], Object.prototype],",
  "  ['nested after earlier segment', () => ({}), 'a.__proto__.__gs_alive_e', Object.prototype],",
  "  ['function constructor', () => function () {}, 'constructor.prototype.__gs_alive_f', Function.prototype],",
  "];",
  "const out = [];",
  "for (const [name, make, path, proto] of cases) {",
  "  const key = path instanceof Array ? path[1] : String(path).match(/__gs_alive_[a-z]/)[0];",
  "  const target = make();",
  "  let returnedSame = false, polluted = false, snapshot = null;",
  "  try {",
  "    returnedSame = set(target, path, 'yes') === target;",
  "    polluted = Object.prototype.hasOwnProperty.call(proto, key) && proto[key] === 'yes';",
  "    if (typeof target === 'object') snapshot = JSON.parse(JSON.stringify(target));",
  "  } finally {",
  "    delete Object.prototype[key];",
  "    delete Function.prototype[key];",
  "  }",
  "  out.push({ name, returnedSame, polluted, snapshot });",
  "}",
  "process.stdout.write(JSON.stringify(out));",
].join("\n");

interface PollutionResult {
  name: string;
  returnedSame: boolean;
  polluted: boolean;
  snapshot: unknown;
}

function runPollution(dir: string): PollutionResult[] {
  const run = spawnSync(process.execPath, ["-e", CHILD_SCRIPT, join(dir, "index.js")], {
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as PollutionResult[];
}

describe("lodash.set-alive: dangerous path segments", () => {
  it("the original pollutes for every case and the alive version for none", () => {
    const fromOriginal = runPollution(tempDir);
    const fromAlive = runPollution(ALIVE_DIR);
    expect(fromOriginal.length).toBe(6);
    expect(fromOriginal.map((r) => [r.name, r.polluted])).toEqual(fromOriginal.map((r) => [r.name, true]));
    expect(fromAlive.map((r) => [r.name, r.polluted])).toEqual(fromAlive.map((r) => [r.name, false]));
  });

  it("returns the same object, and keeps assignments for earlier segments", () => {
    const fromAlive = runPollution(ALIVE_DIR);
    expect(fromAlive.every((r) => r.returnedSame)).toBe(true);
    const nested = fromAlive.find((r) => r.name === "nested after earlier segment");
    expect(nested?.snapshot).toEqual({ a: {} });
    const proto = fromAlive.find((r) => r.name === "proto dotted");
    expect(proto?.snapshot).toEqual({});
  });
});

describe("lodash.set-alive: API surface and credits", () => {
  it("exports the same single function with the same name and arity", () => {
    expect(typeof alive).toBe(typeof original);
    expect(alive.length).toBe(3);
    expect(alive.length).toBe(original.length);
    expect(alive.name).toBe("set");
    expect(alive.name).toBe(original.name);
    expect(Object.getOwnPropertyNames(alive).sort()).toEqual(Object.getOwnPropertyNames(original).sort());
  });

  it("keeps license text and author credits, changing only the version", () => {
    const o = readJson(join(tempDir, "package.json"));
    const a = readJson(join(ALIVE_DIR, "package.json"));
    expect(a.name).toBe(o.name);
    expect(a.version).toBe("4.3.3");
    expect(a.license).toBe("MIT");
    expect(a.license).toBe(o.license);
    expect(a.author).toEqual(o.author);
    expect(a.contributors).toEqual(o.contributors);
    expect(a.repository).toEqual(o.repository);
    expect(readFileSync(join(ALIVE_DIR, "LICENSE"), "utf8")).toBe(readFileSync(join(tempDir, "LICENSE"), "utf8"));
    expect(readFileSync(join(ALIVE_DIR, "README.md"), "utf8")).toContain("hand-written test fixture, not published");
  });

  it("differs from the original only by the guard block", () => {
    const o = readFileSync(join(tempDir, "index.js"), "utf8");
    const a = readFileSync(join(ALIVE_DIR, "index.js"), "utf8");
    const guardStart = a.indexOf("    // Hand-written resurrection guard");
    const guardEnd = a.indexOf("return object;\n    }\n", guardStart) + "return object;\n    }\n".length;
    expect(guardStart).toBeGreaterThan(0);
    expect(a.slice(0, guardStart - 1) + a.slice(guardEnd)).toBe(o);
  });
});
