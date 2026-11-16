// Requirements: 9.2, 12.1
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTarball, packTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import type { PackEntry } from "../../../src/proof/shell/tarball/tarballExtractor";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const field = (block: Buffer, from: number, length: number): string =>
  block.subarray(from, from + length).toString("latin1").replace(/[\0 ]+$/g, "");

function must(entries: readonly PackEntry[]): Uint8Array {
  const r = packTarball(entries);
  if (!r.ok) throw new Error(`pack failed: ${r.error.kind}`);
  return r.value;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gs-pack-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("packTarball", () => {
  const entries: PackEntry[] = [
    { path: "index.js", bytes: enc("module.exports = 1;\n") },
    { path: "package.json", bytes: enc('{"name":"x"}') },
    { path: "lib/a.js", bytes: new Uint8Array(1500).fill(97) },
  ];

  it("round-trips through the extractor with entries under package/", async () => {
    const out = await extractTarball(must(entries), dir);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const byPath = new Map(out.value.map((f) => [f.path, f.bytes]));
    expect([...byPath.keys()].sort()).toEqual(["index.js", "lib/a.js", "package.json"]);
    for (const e of entries) expect(Buffer.from(byPath.get(e.path)!).equals(Buffer.from(e.bytes))).toBe(true);
  });

  it("writes sorted entries with mtime 0, uid 0, gid 0 and a fixed gzip header", () => {
    const gz = must(entries);
    expect([...gz.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(gz[9]).toBe(3);
    const tar = Buffer.from(gunzipSync(gz));
    const names: string[] = [];
    for (let at = 0; tar[at] !== 0 && at < tar.length; ) {
      const block = tar.subarray(at, at + 512);
      names.push(field(block, 0, 100));
      expect(Number.parseInt(field(block, 136, 12), 8)).toBe(0);
      expect(Number.parseInt(field(block, 108, 8), 8)).toBe(0);
      expect(Number.parseInt(field(block, 116, 8), 8)).toBe(0);
      expect(field(block, 265, 32)).toBe("");
      const size = Number.parseInt(field(block, 124, 12), 8);
      at += 512 + Math.ceil(size / 512) * 512;
    }
    expect(names).toEqual(["package/index.js", "package/lib/a.js", "package/package.json"]);
  });

  it("gives the same bytes for any input order", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(entries, { minLength: 3, maxLength: 3 }), (shuffled) => {
        expect(Buffer.from(must(shuffled)).equals(Buffer.from(must(entries)))).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it("refuses a path that would need a pax header", () => {
    const r = packTarball([{ path: `${"d".repeat(300)}/a.js`, bytes: enc("x") }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("path-too-long");
  });
});
