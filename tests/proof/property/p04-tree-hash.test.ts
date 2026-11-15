import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { fc, fcParams } from "../../engine/helpers/fc";
import { buildTarball, looseFilesArb, safeFilesArb } from "../helpers/treeFiles";
import { createWorkDir, type WorkDir } from "../../../src/proof/shell/workDir";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { computeDirectoryTreeHash, computeTreeHash, type TreeFile } from "../../../src/proof/shell/treeHash";

// Feature: proof-of-life-engine, Property 4: Tree_Hash depends only on paths and bytes
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

/**
 * Independent reference of the definition. It sorts by the UTF-8 bytes of the path (which orders
 * like Unicode code points) and builds one buffer, instead of streaming into a hash.
 */
function referenceTreeHash(files: readonly TreeFile[]): string {
  const sorted = files
    .map((f) => ({ name: Buffer.from(f.path, "utf8"), data: Buffer.from(f.bytes) }))
    .sort((a, b) => Buffer.compare(a.name, b.name));
  const chunks: Buffer[] = [];
  for (const { name, data } of sorted) {
    chunks.push(name, Buffer.from([0]), Buffer.from(`${data.length}`, "ascii"), Buffer.from([0]), data, Buffer.from([0]));
  }
  return `sha512-${createHash("sha512").update(Buffer.concat(chunks)).digest("base64")}`;
}

function canonical(files: readonly TreeFile[]): string {
  return JSON.stringify(
    [...files]
      .map((f) => [f.path, Buffer.from(f.bytes).toString("hex")] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)),
  );
}

function writeFiles(root: string, files: readonly TreeFile[]): void {
  for (const file of files) {
    const target = join(root, ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
}

const workDirs: WorkDir[] = [];
afterAll(async () => {
  for (const work of workDirs) await work.cleanup();
});

/** Runs `body` with a fresh work directory and always removes it. */
async function withWorkDir<T>(body: (work: WorkDir) => Promise<T>): Promise<T> {
  const work = createWorkDir();
  workDirs.push(work);
  try {
    return await body(work);
  } finally {
    const removed = await work.cleanup();
    if (removed.ok) workDirs.splice(workDirs.indexOf(work), 1);
  }
}

describe("Feature: proof-of-life-engine, Property 4: Tree_Hash depends only on paths and bytes", () => {
  it("equals the independent reference, has the sha512-base64 format and ignores the order", () => {
    fc.assert(
      fc.property(looseFilesArb(8), fc.infiniteStream(fc.nat()), (files, rolls) => {
        const hash = computeTreeHash(files);
        expect(hash).toBe(referenceTreeHash(files));
        expect(hash).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
        expect(Buffer.from(hash.slice("sha512-".length), "base64")).toHaveLength(64);

        const shuffled = [...files];
        const it2 = rolls[Symbol.iterator]();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (it2.next().value as number) % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j] as TreeFile, shuffled[i] as TreeFile];
        }
        expect(computeTreeHash(shuffled)).toBe(hash);
        expect(computeTreeHash([...files].reverse())).toBe(hash);
      }),
      fcParams(),
    );
  });

  it("changes when one byte changes, a file is renamed, added or removed", () => {
    fc.assert(
      fc.property(safeFilesArb(6), fc.nat(), fc.integer({ min: 1, max: 255 }), fc.nat(), (files, pick, xor, bytePick) => {
        const base = computeTreeHash(files);
        const added: TreeFile[] = [...files, { path: "~added", bytes: new Uint8Array() }];
        expect(computeTreeHash(added)).not.toBe(base);
        if (files.length === 0) return;
        const index = pick % files.length;
        const target = files[index] as TreeFile;

        expect(computeTreeHash(files.filter((_, i) => i !== index))).not.toBe(base);

        const renamed = files.map((f, i) => (i === index ? { ...f, path: `${f.path}~` } : f));
        expect(computeTreeHash(renamed)).not.toBe(base);

        if (target.bytes.length > 0) {
          const changedBytes = Uint8Array.from(target.bytes);
          const at = bytePick % changedBytes.length;
          changedBytes[at] = (changedBytes[at] as number) ^ xor;
          const changed = files.map((f, i) => (i === index ? { ...f, bytes: changedBytes } : f));
          expect(computeTreeHash(changed)).not.toBe(base);
        }
        // Appending a byte or an empty-to-one-byte change also changes the hash.
        const longer = files.map((f, i) => (i === index ? { ...f, bytes: Uint8Array.from([...f.bytes, 0]) } : f));
        expect(computeTreeHash(longer)).not.toBe(base);
      }),
      fcParams(),
    );
  });

  it("never collides for distinct lists, including moved path/content and file boundaries", () => {
    fc.assert(
      fc.property(
        looseFilesArb(4),
        looseFilesArb(4),
        fc.string({ unit: "grapheme", minLength: 2, maxLength: 8 }),
        fc.uint8Array({ maxLength: 12 }),
        fc.nat(),
        (a, b, path, bytes, cut) => {
          if (canonical(a) !== canonical(b)) {
            expect(computeTreeHash(a)).not.toBe(computeTreeHash(b));
          }

          // Move the boundary between the path and the content of one file.
          const chars = Array.from(path);
          const k = 1 + (cut % (chars.length - 1));
          const head = chars.slice(0, k).join("");
          const tail = chars.slice(k).join("");
          const whole: TreeFile[] = [{ path, bytes }];
          const moved: TreeFile[] = [{ path: head, bytes: Uint8Array.from([...Buffer.from(tail, "utf8"), ...bytes]) }];
          const nul: TreeFile[] = [{ path: head, bytes: Uint8Array.from([0, ...Buffer.from(tail, "utf8"), ...bytes]) }];
          expect(computeTreeHash(whole)).not.toBe(computeTreeHash(moved));
          expect(computeTreeHash(whole)).not.toBe(computeTreeHash(nul));

          // Merge two files into one and split one file into two.
          const two: TreeFile[] = [
            { path: "a", bytes },
            { path: "b", bytes: Uint8Array.of(1) },
          ];
          const merged: TreeFile[] = [{ path: "a", bytes: Uint8Array.from([...bytes, 0, 0x62, 0, 0x31, 0, 1]) }];
          expect(computeTreeHash(two)).not.toBe(computeTreeHash(merged));
        },
      ),
      fcParams(),
    );
  });

  it("gives the same hash for a directory, a tarball extraction and the in-memory list, ignoring node_modules and .git", async () => {
    const started = Date.now();
    await fc.assert(
      fc.asyncProperty(safeFilesArb(5), async (files) => {
        await withWorkDir(async (work) => {
          const expected = computeTreeHash(files);

          const dir = work.sideDir("d").real;
          writeFiles(dir, files);
          const direct = await computeDirectoryTreeHash(dir);
          expect(direct).toEqual({ ok: true, value: expected });

          // Files under node_modules and .git (any depth) do not change the hash.
          writeFiles(dir, [
            { path: "node_modules/pkg/index.js", bytes: Uint8Array.of(1, 2, 3) },
            { path: ".git/HEAD", bytes: Uint8Array.of(4) },
            { path: "holder/node_modules/x.js", bytes: Uint8Array.of(5) },
          ]);
          const polluted = await computeDirectoryTreeHash(dir);
          expect(polluted).toEqual({ ok: true, value: expected });

          const out = work.sideDir("x").real;
          // An archive without any `package/` entry is not an npm tarball (the extractor rejects it).
          if (files.length === 0) return;
          const extracted = await extractTarball(buildTarball(files), out);
          expect(extracted.ok).toBe(true);
          expect(await computeDirectoryTreeHash(out)).toEqual({ ok: true, value: expected });
          if (extracted.ok) expect(computeTreeHash(extracted.value)).toBe(expected);
        });
      }),
      fcParams(),
    );
    console.log(`p04 temp-dir property elapsed: ${Date.now() - started} ms`);
    expect(workDirs).toHaveLength(0);
  }, 120_000);
});
