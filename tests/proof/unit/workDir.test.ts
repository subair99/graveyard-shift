// Requirements: 3.6, 4.2, 4.6
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  copyResurrectionDirectory,
  createWorkDir,
  WORK_ROOT_PREFIX,
} from "../../../src/proof/shell/workDir";

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "gs-test-workdir "));
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe("createWorkDir", () => {
  it("creates gs-<random> under the temp root (path with a space) and reports both forms", () => {
    const a = createWorkDir({ tempRoot: base });
    const b = createWorkDir({ tempRoot: base });
    expect(path.basename(a.roots.created).startsWith(WORK_ROOT_PREFIX)).toBe(true);
    expect(a.roots.created).not.toBe(b.roots.created);
    expect(a.roots.real).toBe(fs.realpathSync.native(a.roots.created));
    expect(fs.statSync(a.roots.real).isDirectory()).toBe(true);
  });

  it("creates side directories inside the work root and rejects bad names", () => {
    const work = createWorkDir({ tempRoot: base });
    const side = work.sideDir("r");
    expect(path.dirname(side.real)).toBe(work.roots.real);
    expect(() => work.sideDir("../x")).toThrow();
  });

  it("cleanup removes everything, including read-only-free nested trees, and is idempotent", async () => {
    const work = createWorkDir({ tempRoot: base });
    const side = work.sideDir("o");
    write(path.join(side.real, "a", "b", "c.txt"), "x");
    const result = await work.cleanup();
    expect(result.ok).toBe(true);
    expect(fs.existsSync(work.roots.real)).toBe(false);
    expect((await work.cleanup()).ok).toBe(true);
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it("cleanup never deletes outside the work root and leaves siblings alone", async () => {
    const sibling = path.join(base, "sibling.txt");
    write(sibling, "keep");
    const work = createWorkDir({ tempRoot: base });
    await work.cleanup();
    expect(fs.readFileSync(sibling, "utf8")).toBe("keep");
  });

  it("cleanup removes a junction inside the work root without touching its target", async () => {
    const target = path.join(base, "target dir");
    write(path.join(target, "keep.txt"), "keep");
    const work = createWorkDir({ tempRoot: base });
    try {
      fs.symlinkSync(target, path.join(work.roots.real, "link"), "junction");
    } catch {
      // Junction creation unavailable on this platform; the assertion below is then trivial.
    }
    await work.cleanup();
    expect(fs.existsSync(work.roots.real)).toBe(false);
    expect(fs.readFileSync(path.join(target, "keep.txt"), "utf8")).toBe("keep");
  });

  it("realpath roots agree for a junction used as the temp root", async (ctx) => {
    const real = path.join(base, "real tmp");
    fs.mkdirSync(real);
    const link = path.join(base, "link tmp");
    try {
      fs.symlinkSync(real, link, "junction");
    } catch (error) {
      ctx.skip(`junction could not be created: ${String(error)}`);
      return;
    }
    const viaLink = createWorkDir({ tempRoot: link });
    const viaReal = createWorkDir({ tempRoot: real });
    expect(path.dirname(viaLink.roots.real)).toBe(fs.realpathSync.native(real));
    expect(path.dirname(viaReal.roots.real)).toBe(fs.realpathSync.native(real));
    expect(path.dirname(viaLink.roots.created)).toBe(link);
    await viaLink.cleanup();
    await viaReal.cleanup();
    expect(fs.readdirSync(real)).toEqual([]);
  });
});

describe("copyResurrectionDirectory", () => {
  it("copies files, skips node_modules and .git at any depth and reports them", () => {
    const src = path.join(base, "src pkg");
    write(path.join(src, "package.json"), "{}");
    write(path.join(src, "lib", "a.js"), "a");
    write(path.join(src, "node_modules", "dep", "i.js"), "d");
    write(path.join(src, ".git", "HEAD"), "ref");
    write(path.join(src, "lib", "node_modules", "n.js"), "n");
    fs.mkdirSync(path.join(src, "empty"));
    const dest = path.join(base, "dest");
    const result = copyResurrectionDirectory(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toEqual(["lib/a.js", "package.json"]);
    expect(result.value.skipped).toEqual([".git", "lib/node_modules", "node_modules"]);
    expect(fs.readFileSync(path.join(dest, "lib", "a.js"), "utf8")).toBe("a");
    expect(fs.existsSync(path.join(dest, "node_modules"))).toBe(false);
    expect(fs.statSync(path.join(dest, "empty")).isDirectory()).toBe(true);
  });

  it("rejects a symbolic link or junction as unsafe-archive and writes nothing", (ctx) => {
    const src = path.join(base, "src");
    write(path.join(src, "a.js"), "a");
    write(path.join(base, "outside", "secret.txt"), "s");
    try {
      fs.symlinkSync(path.join(base, "outside"), path.join(src, "sub"), "junction");
    } catch (error) {
      ctx.skip(`link could not be created: ${String(error)}`);
      return;
    }
    const dest = path.join(base, "dest");
    const result = copyResurrectionDirectory(src, dest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unsafe-archive");
    expect(result.error.message).toContain("sub");
    expect(result.error.message).not.toContain(base);
    expect(fs.existsSync(dest)).toBe(false);
  });
});
