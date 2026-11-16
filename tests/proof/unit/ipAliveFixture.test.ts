// Requirements: resurrection-pipeline 23.23
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";

const TARBALL = resolve(__dirname, "../fixtures/ip/ip-2.0.1.tgz");
const ALIVE_DIR = resolve(__dirname, "../fixtures/ip-alive");
const IS_PUBLIC_FILE = "lib/ip.js";
/** The one allowed addition in file names; its bytes are not compared with the Original. */
const README = "README.md";

const CLASS_BLOCK_START = "// Hand-written fix for GHSA-2p57-rm9w-gvfp. inNonPublicAddressClass is a plain-JS copy";
const CLASS_BLOCK_END = "}());";
const ORIGINAL_IS_PUBLIC = "ip.isPublic = function (addr) {\n  return !ip.isPrivate(addr);\n};";
const NEW_IS_PUBLIC =
  "ip.isPublic = function (addr) {\n  if (inNonPublicAddressClass(addr)) {\n    return false;\n  }\n  return !ip.isPrivate(addr);\n};";

const ADVISORY_ADDRESSES = ["127.1", "01200034567", "012.1.2.3", "000:0:0000::01", "::fFFf:127.0.0.1"];

let tempDir = "";

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function readRecord(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function withoutVersion(file: string): Record<string, unknown> {
  const { version: _version, ...rest } = readRecord(file);
  return rest;
}

/** Lines that differ: trim the common prefix and suffix, then compare the middles as multisets. */
function lineDiff(original: string, changed: string): { removed: string[]; added: string[] } {
  const a = original.split("\n");
  const b = changed.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const minus = (from: string[], other: string[]): string[] => {
    const rest = [...other];
    return from.filter((line) => {
      const at = rest.indexOf(line);
      if (at < 0) return true;
      rest.splice(at, 1);
      return false;
    });
  };
  return { removed: minus(midA, midB), added: minus(midB, midA) };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "gs-ip-alive-"));
  const extracted = await extractTarball(new Uint8Array(readFileSync(TARBALL)), tempDir);
  expect(extracted.ok).toBe(true);
});

afterAll(() => {
  if (tempDir !== "") rmSync(tempDir, { recursive: true, force: true });
});

describe("ip-alive: only the isPublic fix", () => {
  it("has the same file list as the Original, plus the fixture README", () => {
    const original = listFiles(tempDir);
    const alive = listFiles(ALIVE_DIR);
    expect(original).toContain(IS_PUBLIC_FILE);
    expect(alive.filter((f) => f !== README)).toEqual(original.filter((f) => f !== README));
    expect(alive).toContain(README);
  });

  it("has equal bytes for every file except package.json, README.md and the isPublic file", () => {
    const others = listFiles(tempDir).filter((f) => f !== "package.json" && f !== README && f !== IS_PUBLIC_FILE);
    for (const rel of others) {
      expect(readFileSync(join(ALIVE_DIR, rel)).equals(readFileSync(join(tempDir, rel))), `bytes of ${rel}`).toBe(true);
    }
  });

  it("changes only version in package.json, to 2.0.2, and keeps license and credits", () => {
    expect(withoutVersion(join(ALIVE_DIR, "package.json"))).toEqual(withoutVersion(join(tempDir, "package.json")));
    const original = readRecord(join(tempDir, "package.json"));
    const alive = readRecord(join(ALIVE_DIR, "package.json"));
    expect(original["version"]).toBe("2.0.1");
    expect(alive["version"]).toBe("2.0.2");
    expect(alive["license"]).toBe("MIT");
    expect(alive["author"]).toBe(original["author"]);
    expect(alive["contributors"]).toEqual(original["contributors"]);
  });

  it("says in README.md that it is a hand-written development fixture, not Medium output, not a demo entry", () => {
    const text = readFileSync(join(ALIVE_DIR, README), "utf8");
    expect(text).toContain("hand-written development fixture");
    expect(text).toContain("not Medium output and not a demo entry");
  });

  it("differs from the Original in lib/ip.js only by the added class block and the changed isPublic body", () => {
    const original = readFileSync(join(tempDir, IS_PUBLIC_FILE), "utf8");
    const alive = readFileSync(join(ALIVE_DIR, IS_PUBLIC_FILE), "utf8");
    const diff = lineDiff(original, alive);
    // Nothing of the Original is removed or changed: the fixture only adds lines.
    expect(diff.removed).toEqual([]);

    // The class block, from its first comment line to the end of the function expression.
    const blockStart = alive.indexOf(CLASS_BLOCK_START);
    const blockEnd = alive.indexOf(CLASS_BLOCK_END);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = alive.slice(blockStart, blockEnd + CLASS_BLOCK_END.length);
    expect(block.startsWith(CLASS_BLOCK_START)).toBe(true);
    expect(alive.slice(blockEnd + CLASS_BLOCK_END.length).startsWith("\n\nip.isPublic = function (addr) {")).toBe(true);

    // The changed isPublic body: the guard lines are inserted, the Original's return line stays.
    expect(alive).toContain(NEW_IS_PUBLIC);
    expect(original).toContain(ORIGINAL_IS_PUBLIC);

    // Remove the two additions: the Original comes back byte for byte.
    const restored = alive.replace(block + "\n\n", "").replace(NEW_IS_PUBLIC, ORIGINAL_IS_PUBLIC);
    expect(restored).toBe(original);
  });
});
// isPublic runs in a spawned child, as for lodash.set-alive.
const CHILD_SCRIPT = [
  "const ip = require(process.argv[1]);",
  "const out = {};",
  "for (const a of JSON.parse(process.argv[2])) out[a] = ip.isPublic(a);",
  "process.stdout.write(JSON.stringify(out));",
].join("\n");

function runIsPublic(dir: string, addresses: string[]): Record<string, boolean> {
  const run = spawnSync(process.execPath, ["-e", CHILD_SCRIPT, join(dir, "lib", "ip.js"), JSON.stringify(addresses)], {
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Record<string, boolean>;
}

describe("ip-alive: isPublic on the Advisory_Addresses", () => {
  it("is true for every advisory address in the Original and false in ip-alive", () => {
    const original = runIsPublic(tempDir, ADVISORY_ADDRESSES);
    const alive = runIsPublic(ALIVE_DIR, ADVISORY_ADDRESSES);
    expect(ADVISORY_ADDRESSES.map((a) => [a, original[a]])).toEqual(ADVISORY_ADDRESSES.map((a) => [a, true]));
    expect(ADVISORY_ADDRESSES.map((a) => [a, alive[a]])).toEqual(ADVISORY_ADDRESSES.map((a) => [a, false]));
  });

  it("keeps the canonical answers of the Original", () => {
    const canonical = ["8.8.8.8", "10.0.0.1", "127.0.0.1", "::1", "2001:db8::1"];
    expect(runIsPublic(ALIVE_DIR, canonical)).toEqual(runIsPublic(tempDir, canonical));
  });

  it("answers like the Original for \":::\" (not in the class, so the Original code path runs; true)", () => {
    const addresses = [":::"];
    const original = runIsPublic(tempDir, addresses);
    expect(original[":::"]).toBe(true);
    expect(runIsPublic(ALIVE_DIR, addresses)).toEqual(original);
  });
});
