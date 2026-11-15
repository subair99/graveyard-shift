// Requirements: 4.2, 4.3, 4.4
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeDirectoryTreeHash,
  computeTreeHash,
  type TreeFile,
} from "../../../src/proof/shell/treeHash";

const bytes = (s: string): Uint8Array => Buffer.from(s, "utf8");
const file = (path: string, content: string): TreeFile => ({ path, bytes: bytes(content) });

// Known-answer vector, computed outside the implementation by hashing this byte stream
// with sha512 and base64-encoding it:
//   "a.txt" 00 "2" 00 "hi" 00  "b/c.txt" 00 "3" 00 "x\r\n" 00
const KNOWN_ANSWER =
  "sha512-W6AJSpql/c4SDR5ovXPCkb5o/N6vO6b+CAlZ6b1i3uq6LjdilE4EMWfZXoexTmGF4kHbWXbhRym2KoQUL2J6aw==";
// sha512 of the empty byte stream (a tree with no files).
const EMPTY_TREE =
  "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==";

describe("computeTreeHash", () => {
  it("matches the documented known-answer vector, in either input order", () => {
    const a = file("a.txt", "hi");
    const b = file("b/c.txt", "x\r\n");
    expect(computeTreeHash([a, b])).toBe(KNOWN_ANSWER);
    expect(computeTreeHash([b, a])).toBe(KNOWN_ANSWER);
  });

  it("hashes an empty tree to the sha512 of nothing", () => {
    expect(computeTreeHash([])).toBe(EMPTY_TREE);
  });

  it("changes when one byte or one path changes", () => {
    const base = computeTreeHash([file("a.js", "abc")]);
    expect(computeTreeHash([file("a.js", "abd")])).not.toBe(base);
    expect(computeTreeHash([file("b.js", "abc")])).not.toBe(base);
  });

  it("does not collide when bytes move between path and content", () => {
    expect(computeTreeHash([file("a", "bc")])).not.toBe(computeTreeHash([file("ab", "c")]));
    expect(computeTreeHash([file("a", "")])).not.toBe(computeTreeHash([file("a\u0000", "")]));
  });

  it("does not collide when bytes move between files", () => {
    expect(computeTreeHash([file("a", "x"), file("b", "y")])).not.toBe(
      computeTreeHash([file("a", "x\u0000"), file("b", "y")]),
    );
    expect(computeTreeHash([file("a", "1\u0000b\u00001\u0000y")])).not.toBe(
      computeTreeHash([file("a", "1"), file("b", "y")]),
    );
  });

  it("keeps line endings as they are", () => {
    expect(computeTreeHash([file("a", "x\r\n")])).not.toBe(computeTreeHash([file("a", "x\n")]));
  });

  it("orders paths by code point, not by UTF-16 unit", () => {
    // U+FF5E (BMP) sorts before U+1F600 (surrogate pair) by code point, after it by UTF-16 unit.
    const files = [file("\u{1F600}", "1"), file("\uFF5E", "2")];
    const expected = computeTreeHash([file("\uFF5E", "2"), file("\u{1F600}", "1")]);
    expect(computeTreeHash(files)).toBe(expected);
    expect(computeTreeHash([...files].reverse())).toBe(expected);
  });

  it("rejects duplicate paths", () => {
    expect(() => computeTreeHash([file("a", "1"), file("a", "2")])).toThrow(RangeError);
  });
});

describe("computeDirectoryTreeHash", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gs-treehash-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function put(dir: string, path: string, content: string): Promise<void> {
    const full = join(dir, ...path.split("/"));
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }

  async function hash(dir: string): Promise<string> {
    const r = await computeDirectoryTreeHash(dir);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }

  it("equals the in-memory hash and ignores creation order and nested layout", async () => {
    const other = await mkdtemp(join(tmpdir(), "gs-treehash-"));
    try {
      await put(root, "a.txt", "hi");
      await put(root, "b/c.txt", "x\r\n");
      await put(other, "b/c.txt", "x\r\n");
      await put(other, "a.txt", "hi");
      expect(await hash(root)).toBe(KNOWN_ANSWER);
      expect(await hash(other)).toBe(KNOWN_ANSWER);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("detects a renamed file and a changed byte", async () => {
    await put(root, "dir/a.js", "abc");
    const base = await hash(root);
    await rm(join(root, "dir", "a.js"));
    await put(root, "dir/b.js", "abc");
    expect(await hash(root)).not.toBe(base);
    await put(root, "dir/b.js", "abd");
    expect(await hash(root)).not.toBe(base);
  });

  it("does not see empty directories", async () => {
    await put(root, "a.txt", "hi");
    const base = await hash(root);
    await mkdir(join(root, "empty", "deeper"), { recursive: true });
    expect(await hash(root)).toBe(base);
  });

  it("ignores node_modules and .git at any depth", async () => {
    await put(root, "a.txt", "hi");
    const base = await hash(root);
    await put(root, "node_modules/x/index.js", "1");
    await put(root, ".git/HEAD", "ref");
    await put(root, "sub/node_modules/y.js", "2");
    expect(await hash(root)).toBe(base);
  });

  it("handles non-ASCII file names the same as the in-memory hash", async () => {
    await put(root, "dé/日本語.js", "ok");
    await put(root, "😀.txt", "smile");
    expect(await hash(root)).toBe(
      computeTreeHash([file("dé/日本語.js", "ok"), file("😀.txt", "smile")]),
    );
  });

  it("rejects a symbolic link with unsafe-archive", async (ctx) => {
    await put(root, "a.txt", "hi");
    try {
      await symlink(join(root, "a.txt"), join(root, "link.txt"), "file");
    } catch {
      ctx.skip(); // symlink creation not permitted on this machine
      return;
    }
    const r = await computeDirectoryTreeHash(root);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("unsafe-archive");
      expect(r.error.message).toContain("link.txt");
    }
  });
});
