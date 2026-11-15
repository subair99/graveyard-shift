import { gzipSync } from "node:zlib";
import fc from "fast-check";

import type { TreeFile } from "../../../src/proof/shell/treeHash";

const SEGMENT_CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789_-."];
const NON_ASCII_SEGMENTS = ["é", "日本", "ñandú", "😀"];

/**
 * A safe file or directory name for Windows and POSIX: starts with `f` (never a reserved device
 * name, never `node_modules` or `.git`), ends with `z` (no trailing dot or space), contains no
 * `:` or `\`, and is lower case only.
 */
const segmentArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.array(fc.constantFrom(...SEGMENT_CHARS), { maxLength: 4 }).map((c) => `f${c.join("")}z`) },
  { weight: 1, arbitrary: fc.constantFrom(...NON_ASCII_SEGMENTS).map((s) => `f${s}z`) },
);

const safePathArb: fc.Arbitrary<string> = fc
  .array(segmentArb, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("/"));

const bytesArb: fc.Arbitrary<Uint8Array> = fc.uint8Array({ maxLength: 24 });

/**
 * A set of at most `maxFiles` files with paths that are safe to write to a directory and to a
 * tarball: unique after case folding, no file is the parent directory of another, short enough
 * for a ustar name field (`package/` plus the path stays under 100 bytes).
 */
export function safeFilesArb(maxFiles: number): fc.Arbitrary<TreeFile[]> {
  return fc
    .uniqueArray(fc.record({ path: safePathArb, bytes: bytesArb }), {
      maxLength: maxFiles,
      selector: (file) => file.path.toLowerCase(),
    })
    .filter((files) => {
      const paths = files.map((f) => f.path.toLowerCase());
      return !paths.some((p) => paths.some((q) => q.startsWith(`${p}/`)));
    });
}

/** Arbitrary paths (any characters, any shape) for properties that never touch a file system. */
export function looseFilesArb(maxFiles: number): fc.Arbitrary<TreeFile[]> {
  return fc.uniqueArray(
    fc.record({
      path: fc.oneof(fc.string({ unit: "grapheme", maxLength: 8 }), fc.constantFrom("a", "b", "ab", "a/b", "a\u0000b", "1")),
      bytes: fc.oneof(fc.uint8Array({ maxLength: 12 }), fc.constantFrom(Uint8Array.of(0), Uint8Array.of(0x30), Uint8Array.of(0x31, 0, 0x61))),
    }),
    { maxLength: maxFiles, selector: (file) => file.path },
  );
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number): Buffer {
  const block = Buffer.alloc(512);
  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 100) throw new Error("tar name too long for the test builder");
  nameBytes.copy(block, 0);
  block.write(octal(0o644, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(0, 12), 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write("0", 156, "ascii");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  const sum = block.reduce((acc, b) => acc + b, 0);
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

/** Builds a gzip-compressed ustar tarball with every file under `package/`. */
export function buildTarball(files: readonly TreeFile[]): Uint8Array {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(header(`package/${file.path}`, file.bytes.byteLength));
    const data = Buffer.from(file.bytes);
    parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(parts)));
}
