// Self-test of the integration helpers (task 18.1): a real sandboxed child answers a round trip
// and nothing is left behind afterwards.
// Requirements: 15.1
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRunning, waitForExit, withExecutor } from "./helpers/sandboxHarness";

describe("integration helpers", () => {
  it("runs a real sandboxed child and cleans up", async () => {
    let pid = 0;
    let root = "";
    await withExecutor("exports-only", async (ctx) => {
      root = ctx.root;
      const listed = await ctx.side.exports();
      expect(listed.entries.map((e) => e.name)).toEqual(["add", "answer", "pid"]);
      expect(await ctx.side.callValue("add", [2, 3])).toBe(5);
      pid = (await ctx.side.callValue("pid")) as number;
      expect(pid).not.toBe(process.pid);
      expect(isRunning(pid)).toBe(true);
      expect(existsSync(root)).toBe(true);
    });
    expect(await waitForExit(pid)).toBe(true);
    expect(existsSync(root)).toBe(false);
  });
});
