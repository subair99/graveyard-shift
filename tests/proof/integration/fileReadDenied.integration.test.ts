// File system denial under the real Sandbox_Executor (task 18.3; Requirements 5.2, 15.6).
// The child gets read access to the runner directory, the package directory and listed read
// paths only, and no write access. Marker contents are never printed; messages are fixed.
//
// By design the runner directory (src/proof/child) is granted read, so reading it is allowed
// and is deliberately not asserted here.
// Requirements: 5.2, 15.6
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withExecutor } from "./helpers/sandboxHarness";
import type { OpenedSide } from "./helpers/sandboxHarness";

interface Probe {
  ok: boolean;
  code: string | null;
  length?: number;
  count?: number;
}

const DENIED = "ERR_ACCESS_DENIED";
const MARKER = `GS_FILE_MARKER_${Math.random().toString(36).slice(2)}_${Date.now()}`;

async function probe(side: OpenedSide, fn: string, args: readonly unknown[] = []): Promise<Probe> {
  const r = await side.call(fn, args);
  if (r.outcome.kind !== "returned") throw new Error("the probe did not return");
  expect(JSON.stringify(r.outcome)).not.toContain(MARKER);
  return await side.callValue(fn, args) as Probe;
}

function expectDenied(p: Probe): void {
  if (p.ok || p.code !== DENIED) {
    throw new Error(`expected a permission denial, observed ok=${String(p.ok)} code=${String(p.code)}`);
  }
}

describe("sandbox file access (integration)", () => {
  it("reads inside the package, and denies reads, traversal and listings outside it", async () => {
    const tmpMarker = join(tmpdir(), `gs-read-denied-${process.pid}-${Date.now()}.txt`);
    try {
      await withExecutor("fs-probe", async (ctx) => {
        const scratchFile = join(ctx.scratchDir, "marker.txt");
        writeFileSync(scratchFile, MARKER);
        writeFileSync(tmpMarker, MARKER);

        // (1) inside the package
        const inside = await probe(ctx.side, "readInside");
        expect(inside.ok).toBe(true);
        expect(inside.length).toBeGreaterThan(0);

        // (2) a file outside the package, in the scratch dir
        expectDenied(await probe(ctx.side, "readFile", [scratchFile]));

        // (3) a file directly under the OS temp dir
        expectDenied(await probe(ctx.side, "readFile", [tmpMarker]));

        // (3b) the home directory: a path that need not exist; the denial comes before any
        // existence check.
        expectDenied(await probe(ctx.side, "readFile", [join(homedir(), ".npmrc")]));

        // (4) traversal from inside the package
        expectDenied(await probe(ctx.side, "readFile", [join(ctx.side.packageDir, "..", "scratch", "marker.txt")]));

        // (6) listing the package's parent, the scratch dir and the temp dir
        expectDenied(await probe(ctx.side, "listParent"));
        expectDenied(await probe(ctx.side, "listDir", [ctx.scratchDir]));
        expectDenied(await probe(ctx.side, "listDir", [tmpdir()]));
      });
    } finally {
      rmSync(tmpMarker, { force: true });
    }
  }, 60000);

  it("denies writes inside the package and in the scratch dir and creates nothing", async () => {
    await withExecutor("fs-probe", async (ctx) => {
      const inPackage = join(ctx.side.packageDir, "written-by-child.txt");
      const inScratch = join(ctx.scratchDir, "written-by-child.txt");
      mkdirSync(ctx.scratchDir, { recursive: true });
      expectDenied(await probe(ctx.side, "writeFile", [inPackage]));
      expectDenied(await probe(ctx.side, "writeFile", [inScratch]));
      expect(existsSync(inPackage)).toBe(false);
      expect(existsSync(inScratch)).toBe(false);
    });
  }, 60000);
});
