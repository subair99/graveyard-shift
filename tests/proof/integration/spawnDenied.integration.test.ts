// Child process and worker thread denial (task 18.4; Requirements 5, 15.6) with a real
// Sandbox_Executor. A spawn that succeeded would run node outside the sandbox and create a marker
// file, so every test asserts that the marker never appears.
// Requirements: 5.2, 15.6
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRunning, readChildPermissions, waitForExit, withExecutor } from "./helpers/sandboxHarness";

interface Probe {
  ok: boolean;
  code: string | null;
}

const DENIED = "ERR_ACCESS_DENIED";

describe("child process and worker denial (real sandbox)", () => {
  it("denies spawnSync, exec, execFile and fork, and creates no process", async () => {
    let pid = 0;
    await withExecutor("spawn-probe", async (ctx) => {
      pid = (await ctx.side.callValue("pid")) as number;
      const marker = join(ctx.scratchDir, "marker.txt");
      for (const fn of ["spawnSync", "exec"]) {
        expect(await ctx.side.callValue(fn), fn).toEqual({ ok: false, code: DENIED });
      }
      for (const fn of ["markerSpawnSync", "markerExec", "markerExecFile", "markerFork"]) {
        const r = (await ctx.side.callValue(fn, [marker])) as Probe;
        expect(r, fn).toEqual({ ok: false, code: DENIED });
      }
      // Give any breaching grandchild time to write.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      expect(existsSync(marker)).toBe(false);
    });
    if (pid > 0) expect(await waitForExit(pid)).toBe(true);
  });

  it("denies creating a worker thread", async () => {
    await withExecutor("spawn-probe", async (ctx) => {
      const marker = join(ctx.scratchDir, "worker-marker.txt");
      expect(await ctx.side.callValue("worker")).toEqual({ ok: false, code: DENIED });
      expect(await ctx.side.callValue("markerWorker", [marker])).toEqual({ ok: false, code: DENIED });
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("reports no child or worker permission", async () => {
    await withExecutor("env-probe", async (ctx) => {
      const p = await readChildPermissions(ctx.side);
      expect(p.enabled).toBe(true);
      expect(p.child).toBe(false);
      expect(p.worker).toBe(false);
    });
  });

  it("leaves no running child after dispose", async () => {
    let pid = 0;
    await withExecutor("exports-only", async (ctx) => {
      pid = (await ctx.side.callValue("pid")) as number;
      expect(isRunning(pid)).toBe(true);
    });
    expect(await waitForExit(pid)).toBe(true);
  });
});
