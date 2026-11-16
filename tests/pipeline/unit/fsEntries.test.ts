// Requirements: 9.3, 9.5
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fs-entries-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readFsEntries", () => {
  it("reads an allowlisted regular file with its bytes", async () => {
    await writeFile(join(root, "deltas.json"), "{}");
    const entries = await readFsEntries(root, ["deltas.json"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: "deltas.json", type: "file", size: 2 });
    expect(Array.from(entries[0]?.bytes ?? [])).toEqual([0x7b, 0x7d]);
  });

  it("lists a nested file with a / separated relative path", async () => {
    await mkdir(join(root, "resurrection", "lib"), { recursive: true });
    await writeFile(join(root, "resurrection", "lib", "a.js"), "x");
    const entries = await readFsEntries(root, ["resurrection/"]);
    expect(entries.map((e) => e.path)).toEqual(["resurrection/lib/a.js"]);
    expect(entries[0]?.type).toBe("file");
    expect(entries[0]?.bytes).toBeDefined();
  });

  it("does not read bytes of a file outside the allowlist", async () => {
    await writeFile(join(root, "other.txt"), "x");
    const entries = await readFsEntries(root, ["other.txt"]);
    expect(entries).toEqual([{ path: "other.txt", type: "file", size: 1 }]);
  });

  it("reports a symbolic link as a symlink and does not follow it", async (ctx) => {
    await writeFile(join(root, "target.txt"), "hi");
    try {
      await symlink(join(root, "target.txt"), join(root, "harness.json"), "file");
    } catch {
      ctx.skip(); // symlink creation not permitted on this machine
      return;
    }
    const entries = await readFsEntries(root, ["harness.json"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("symlink");
    expect(entries[0]?.bytes).toBeUndefined();
  });

  it("returns no entry for a missing path (the validator reports it)", async () => {
    const entries = await readFsEntries(root, ["harness.json", "resurrection/"]);
    expect(entries).toEqual([]);
  });
});
