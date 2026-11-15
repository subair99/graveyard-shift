// Timeout and hard kill under the real Sandbox_Executor (task 18.6; Requirements 5, 15.6, 16).
// `spin()` is a synchronous infinite loop that only the parent can stop; `hang()` is a promise that
// never settles, which the child answers itself. The wall-clock bound is a correctness check, not a
// benchmark.
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, isRunning, waitForExit } from "./helpers/sandboxHarness";
import type { SandboxHarness } from "./helpers/sandboxHarness";

const CALL_TIMEOUT_MS = 500;
const KILL_GRACE_MS = 250;
const MARGIN_MS = 2000;

const harnesses: SandboxHarness[] = [];

function make(): SandboxHarness {
  const h = createHarness({
    limits: { callTimeoutMs: CALL_TIMEOUT_MS },
    killGraceMs: KILL_GRACE_MS,
  });
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
});

describe("timeout and hard kill (real sandbox)", () => {
  it("kills a synchronous infinite loop, reports timeout and serves the next call on a new child", async () => {
    const h = make();
    const side = await h.open("spin", "original");
    const oldPid = (await side.callValue("pid")) as number;
    expect(isRunning(oldPid)).toBe(true);

    const started = performance.now();
    const result = await side.call("spin");
    const elapsed = performance.now() - started;

    expect(result.outcome.kind).toBe("timeout");
    expect(elapsed).toBeLessThan(CALL_TIMEOUT_MS + KILL_GRACE_MS + MARGIN_MS);

    // The hung child was killed, not left running.
    expect(await waitForExit(oldPid)).toBe(true);

    const newPid = (await side.callValue("pid")) as number;
    expect(newPid).not.toBe(oldPid);
    expect(await side.callValue("ok")).toBe("ok");

    expect(side.counters()).toEqual({ restartEvents: 0, otherRestarts: 1 });

    await h.cleanup();
    expect(await waitForExit(newPid)).toBe(true);
    expect(isRunning(oldPid)).toBe(false);
  });

  it("answers a never-settling promise with timeout from the child and keeps working", async () => {
    const h = make();
    const side = await h.open("spin", "original");
    const pid = (await side.callValue("pid")) as number;

    const started = performance.now();
    const result = await side.call("hang");
    const elapsed = performance.now() - started;

    expect(result.outcome.kind).toBe("timeout");
    expect(elapsed).toBeLessThan(CALL_TIMEOUT_MS + KILL_GRACE_MS + MARGIN_MS);

    // Observed behavior: the next call works, whichever child serves it.
    expect(await side.callValue("ok")).toBe("ok");
    const pidAfter = (await side.callValue("pid")) as number;
    if (pidAfter !== pid) expect(await waitForExit(pid)).toBe(true);

    await h.cleanup();
    expect(await waitForExit(pidAfter)).toBe(true);
    expect(await waitForExit(pid)).toBe(true);
  });

  it("a timeout on the resurrection side leaves the original side untouched", async () => {
    const h = make();
    const original = await h.open("spin", "original");
    const resurrection = await h.open("spin", "resurrection");
    const originalPid = (await original.callValue("pid")) as number;
    const resurrectionPid = (await resurrection.callValue("pid")) as number;
    expect(originalPid).not.toBe(resurrectionPid);

    const result = await resurrection.call("spin");
    expect(result.outcome.kind).toBe("timeout");
    expect(await waitForExit(resurrectionPid)).toBe(true);

    expect(isRunning(originalPid)).toBe(true);
    expect(await original.callValue("pid")).toBe(originalPid);
    expect(await original.callValue("ok")).toBe("ok");
    expect(original.counters()).toEqual({ restartEvents: 0, otherRestarts: 0 });
    expect(resurrection.counters().otherRestarts).toBe(1);

    const newResurrectionPid = (await resurrection.callValue("pid")) as number;
    expect(newResurrectionPid).not.toBe(resurrectionPid);

    await h.cleanup();
    for (const pid of [originalPid, resurrectionPid, newResurrectionPid]) {
      expect(await waitForExit(pid)).toBe(true);
    }
  });
});
