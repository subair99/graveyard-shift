// Requirements: 5.10
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiteView } from "../../../src/ui/core/viewModel";
import { copyEntryFiles, nodeCopyFs } from "../../../src/ui/shell/copyEntryFiles";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "crypt-copy-"));
  dirs.push(d);
  return d;
}

function viewOf(entries: Record<string, string[]>): SiteView {
  return {
    entries: Object.entries(entries).map(([name, files]) => ({
      name,
      downloads: files.map((file) => ({ file, href: `/graveyard-shift/graveyard/${name}/${file}` })),
    })),
    nightlyRun: null,
  } as unknown as SiteView;
}

describe("copyEntryFiles", () => {
  it("copies listed files byte for byte and nothing else", async () => {
    const root = temp();
    const out = temp();
    mkdirSync(join(root, "graveyard", "a"), { recursive: true });
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 0xc3]);
    writeFileSync(join(root, "graveyard", "a", "x.bin"), bytes);
    writeFileSync(join(root, "graveyard", "a", "empty.json"), new Uint8Array());
    writeFileSync(join(root, "graveyard", "a", "unlisted.txt"), "no");
    writeFileSync(join(root, "ledger.json"), "{}");

    const result = await copyEntryFiles(viewOf({ a: ["x.bin", "empty.json"] }), { root, outDir: out, fs: nodeCopyFs });

    expect(result).toEqual({ ok: true, value: 2 });
    expect(readdirSync(join(out, "graveyard", "a")).sort()).toEqual(["empty.json", "x.bin"]);
    expect(readdirSync(out)).toEqual(["graveyard"]);
    expect(new Uint8Array(readFileSync(join(out, "graveyard", "a", "x.bin")))).toEqual(bytes);
  });

  it("fails naming the file when the target exists, and keeps the existing bytes", async () => {
    const root = temp();
    const out = temp();
    mkdirSync(join(root, "graveyard", "a"), { recursive: true });
    mkdirSync(join(out, "graveyard", "a"), { recursive: true });
    writeFileSync(join(root, "graveyard", "a", "x.json"), "new");
    writeFileSync(join(out, "graveyard", "a", "x.json"), "old");

    const result = await copyEntryFiles(viewOf({ a: ["x.json"] }), { root, outDir: out, fs: nodeCopyFs });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("graveyard/a/x.json");
    expect(readFileSync(join(out, "graveyard", "a", "x.json"), "utf8")).toBe("old");
  });

  it("fails naming the file when the source cannot be read", async () => {
    const root = temp();
    const out = temp();
    const result = await copyEntryFiles(viewOf({ a: ["missing.json"] }), { root, outDir: out, fs: nodeCopyFs });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("graveyard/a/missing.json");
  });
});
