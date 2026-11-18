// Requirements: 5.10
// Feature: crypt-ui, Property 13: Copied entry files are byte-identical and complete
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fc, fcParams } from "../../engine/helpers/fc";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteView } from "../../../src/ui/core/viewModel";
import { copyEntryFiles, nodeCopyFs } from "../../../src/ui/shell/copyEntryFiles";

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Relative file paths (forward slashes) under dir, recursively. */
function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out.sort();
}

const fileArb = fc.record({
  stem: fc.stringMatching(/^[a-z]{1,8}$/),
  bytes: fc.oneof(
    fc.constant(new Uint8Array()),
    fc.uint8Array({ minLength: 0, maxLength: 64 }),
  ),
});

const treeArb = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 1, maxLength: 3 })
  .chain((names) =>
    fc.tuple(
      ...names.map((name) =>
        fc
          .uniqueArray(fileArb, { minLength: 1, maxLength: 4, selector: (f) => f.stem })
          .map((files) => ({ name, files: files.map((f) => ({ file: `${f.stem}.bin`, bytes: f.bytes })) })),
      ),
    ),
  );

describe("Property 13: Copied entry files are byte-identical and complete", () => {
  let base = "";
  let runCounter = 0;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "crypt-p13-"));
  });
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("copies exactly the source relative paths with equal sha256 and writes no other file", async () => {
    await fc.assert(
      fc.asyncProperty(treeArb, async (tree) => {
        const runDir = join(base, `run-${runCounter++}`);
        const root = join(runDir, "src");
        const out = join(runDir, "out");
        mkdirSync(root, { recursive: true });
        mkdirSync(out, { recursive: true });
        {
          for (const entry of tree) {
            mkdirSync(join(root, "graveyard", entry.name), { recursive: true });
            for (const f of entry.files) writeFileSync(join(root, "graveyard", entry.name, f.file), f.bytes);
          }
          // Files outside graveyard/ must not be copied.
          writeFileSync(join(root, "ledger.json"), "{}");

          const view = {
            entries: tree.map((e) => ({
              name: e.name,
              downloads: e.files.map((f) => ({ file: f.file, href: `/${e.name}/${f.file}` })),
            })),
            nightlyRun: null,
          } as unknown as SiteView;

          const result = await copyEntryFiles(view, { root, outDir: out, fs: nodeCopyFs });

          const expected = listFiles(join(root, "graveyard")).map((p) => `graveyard/${p}`);
          expect(result).toEqual({ ok: true, value: expected.length });
          expect(listFiles(out)).toEqual(expected);
          for (const rel of expected) {
            const copied = new Uint8Array(readFileSync(join(out, rel)));
            const source = new Uint8Array(readFileSync(join(root, rel)));
            expect(sha256(copied)).toBe(sha256(source));
          }
        }
      }),
      fcParams(),
    );
  });
});
