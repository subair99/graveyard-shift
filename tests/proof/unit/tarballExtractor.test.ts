import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXTRACT_LIMITS, extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import type { ExtractLimits } from "../../../src/proof/shell/tarball/tarballExtractor";

interface TarEntry {
  name: string;
  type?: string; // typeflag character, default "0" (file)
  body?: string | Buffer;
  linkname?: string;
}

function header(entry: TarEntry, size: number): Buffer {
  const block = Buffer.alloc(512);
  block.write(entry.name, 0, 100, "utf8");
  block.write("0000644\0", 100, "ascii");
  block.write("0000000\0", 108, "ascii");
  block.write("0000000\0", 116, "ascii");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  block.write("00000000000\0", 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write(entry.type ?? "0", 156, "ascii");
  if (entry.linkname !== undefined) block.write(entry.linkname, 157, 100, "utf8");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

function buildTar(entries: TarEntry[], declaredSize?: number): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    parts.push(header(entry, declaredSize ?? body.length));
    if (body.length > 0) {
      parts.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const buildTgz = (entries: TarEntry[]): Buffer => gzipSync(buildTar(entries));

let dest: string;
beforeEach(async () => {
  dest = await mkdtemp(join(tmpdir(), "gs-extract-test-"));
});
afterEach(async () => {
  await rm(dest, { recursive: true, force: true });
});

async function expectUnsafe(entries: TarEntry[], reason: string, entryName?: string): Promise<void> {
  const result = await extractTarball(buildTgz(entries), dest, DEFAULT_EXTRACT_LIMITS);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toMatchObject({ kind: "unsafe-archive", reason });
    if (entryName !== undefined && result.error.kind === "unsafe-archive") {
      expect(result.error.entry).toBe(entryName);
    }
  }
  // Nothing is written when validation fails.
  expect(await readdir(dest)).toEqual([]);
}

describe("extractTarball", () => {
  it("extracts a valid package and strips package/", async () => {
    const result = await extractTarball(
      buildTgz([
        { name: "package/", type: "5" },
        { name: "package/package.json", body: '{"name":"x"}' },
        { name: "package/lib/", type: "5" },
        { name: "package/lib/index.js", body: "module.exports = 1;\n" },
      ]),
      dest,
      DEFAULT_EXTRACT_LIMITS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((f) => f.path).sort()).toEqual(["lib/index.js", "package.json"]);
    expect(await readFile(join(dest, "lib", "index.js"), "utf8")).toBe("module.exports = 1;\n");
  });

  it("refuses to overwrite an existing file (exclusive create)", async () => {
    await extractTarball(buildTgz([{ name: "package/a.js", body: "1" }]), dest, DEFAULT_EXTRACT_LIMITS);
    await expect(
      extractTarball(buildTgz([{ name: "package/a.js", body: "2" }]), dest, DEFAULT_EXTRACT_LIMITS),
    ).rejects.toThrow();
    expect(await readFile(join(dest, "a.js"), "utf8")).toBe("1");
  });

  it("rejects ../ traversal", () => expectUnsafe([{ name: "package/../x", body: "x" }], "parent-segment"));
  it("rejects traversal written with backslashes", () =>
    expectUnsafe([{ name: "package\\..\\..\\x", body: "x" }], "parent-segment"));
  it("rejects an absolute path and redacts it", () =>
    expectUnsafe([{ name: "/etc/passwd", body: "x" }], "absolute-path", "<absolute>/passwd"));
  it("rejects a drive prefix", () =>
    expectUnsafe([{ name: "C:/x", body: "x" }], "drive-prefix", "<absolute>/x"));
  it("rejects a segment containing a colon", () =>
    expectUnsafe([{ name: "package/a:b.js", body: "x" }], "colon"));
  it("rejects a name written with a backslash (POSIX) or maps it to a nested path (Windows)", async () => {
    const result = await extractTarball(
      buildTgz([{ name: "package/back\\slash.txt", body: "x" }]),
      dest,
      DEFAULT_EXTRACT_LIMITS,
    );
    if (process.platform === "win32") {
      // tar converts "\" to "/" on Windows, so the name arrives as package/back/slash.txt.
      expect(result.ok).toBe(true);
    } else {
      expect(result).toMatchObject({ ok: false, error: { kind: "unsafe-archive", reason: "backslash" } });
    }
  });
  it("rejects entries outside package/", () =>
    expectUnsafe([{ name: "other/x.js", body: "x" }], "outside-package", "other/x.js"));
  it("rejects a symbolic link", () =>
    expectUnsafe([{ name: "package/l", type: "2", linkname: "/etc/passwd" }], "entry-type", "package/l"));
  it("rejects a hard link", () =>
    expectUnsafe([{ name: "package/h", type: "1", linkname: "package/a" }], "entry-type"));
  it("rejects a device entry", () => expectUnsafe([{ name: "package/d", type: "3" }], "entry-type"));
  it("rejects a case-only duplicate", () =>
    expectUnsafe(
      [
        { name: "package/Dup.txt", body: "a" },
        { name: "package/dup.txt", body: "b" },
      ],
      "case-duplicate",
      "package/dup.txt",
    ));

  it("reports invalid-archive/not-an-archive for a tar with zero entries", async () => {
    const result = await extractTarball(buildTgz([]), dest, DEFAULT_EXTRACT_LIMITS);
    expect(result).toEqual({ ok: false, error: { kind: "invalid-archive", reason: "not-an-archive" } });
  });
  it("reports invalid-archive/not-an-archive for text and empty input", async () => {
    for (const bytes of [Buffer.from("this is not an archive at all"), Buffer.alloc(0)]) {
      const result = await extractTarball(bytes, dest, DEFAULT_EXTRACT_LIMITS);
      expect(result).toEqual({ ok: false, error: { kind: "invalid-archive", reason: "not-an-archive" } });
    }
  });
  it("reports invalid-archive/corrupt for a truncated gzip", async () => {
    const whole = gzipSync(buildTar([{ name: "package/a.js", body: Buffer.alloc(4000, 7) }]));
    const result = await extractTarball(whole.subarray(0, whole.length - 30), dest, DEFAULT_EXTRACT_LIMITS);
    expect(result).toEqual({ ok: false, error: { kind: "invalid-archive", reason: "corrupt" } });
  });

  const small: ExtractLimits = { maxCompressedBytes: 1024 * 1024, maxUncompressedBytes: 4096, maxEntries: 3 };
  it("reports archive-too-large for too many entries", async () => {
    const entries = [1, 2, 3, 4].map((n) => ({ name: `package/f${n}.js`, body: "x" }));
    const result = await extractTarball(buildTgz(entries), dest, small);
    expect(result).toEqual({ ok: false, error: { kind: "archive-too-large", limit: "entries" } });
  });
  it("reports archive-too-large for an oversized declared size", async () => {
    const tar = buildTar([{ name: "package/big.bin", body: "x" }], 10 * 1024 * 1024);
    const result = await extractTarball(gzipSync(tar), dest, small);
    expect(result).toEqual({ ok: false, error: { kind: "archive-too-large", limit: "uncompressed" } });
  });
  it("reports archive-too-large for an oversized compressed input", async () => {
    const result = await extractTarball(buildTgz([{ name: "package/a.js", body: "x" }]), dest, {
      ...small,
      maxCompressedBytes: 10,
    });
    expect(result).toEqual({ ok: false, error: { kind: "archive-too-large", limit: "compressed" } });
  });
  it("reports archive-too-large for a decompression bomb (ratio above 1000)", async () => {
    // 64 MiB of zeros gzip to about 65 KB, a ratio of about 1000.
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024));
    const result = await extractTarball(bomb, dest, DEFAULT_EXTRACT_LIMITS);
    expect(result).toEqual({ ok: false, error: { kind: "archive-too-large", limit: "uncompressed" } });
  });
});
