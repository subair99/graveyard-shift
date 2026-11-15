// Sandbox_Executor tests with real child processes (task 17.4; Requirements 5.2 to 5.9, 5.12 to
// 5.14, 16.4). The denial, environment and isolation tests are task 18.
// Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13, 5.14, 16.4
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeNode } from "../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import { SandboxExecutor, createSandboxExecutorFactory } from "../../../src/proof/shell/executor/sandboxExecutor";
import { createRestartBudget } from "../../../src/proof/shell/executor/types";
import type { CallRequest, SideHandle, SideSpec } from "../../../src/proof/shell/executor/types";
import type { EncodedNode } from "../../../src/proof/types";

const PACKAGE_SOURCE = `
exports.add = (a, b) => a + b;
exports.boom = () => { throw new Error('boom'); };
exports.spin = () => { for (;;) {} };
exports.die = () => { process.exit(7); };
exports.big = () => 'x'.repeat(5000);
exports.pid = () => process.pid;
`;

const BROKEN_SOURCE = `throw new Error('cannot load this');`;

let root = "";
let counter = 0;

function enc(value: unknown): EncodedNode {
  const r = encodeValue(value, { budget: 100000 });
  if (!r.ok) throw new Error("encode failed");
  return r.node;
}

function makePackage(source: string): string {
  const dir = join(root, `pkg${counter++}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "synthetic", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(dir, "index.js"), source);
  return dir;
}

function specFor(side: "original" | "resurrection", dir: string, outputLimitBytes = 100000): SideSpec {
  return {
    side,
    packageDir: dir,
    entryFile: join(dir, "index.js"),
    readPaths: [],
    limits: { callTimeoutMs: 500, heapLimitMb: 256, outputLimitBytes },
  };
}

function request(fn: string, args: unknown[] = []): CallRequest {
  return { fn, args: args.map(enc), caseSeed: 1, stubs: { date: true, random: true }, properties: [] };
}

function executor(max: number): SandboxExecutor {
  return new SandboxExecutor({ restartBudget: createRestartBudget(max) });
}

async function openSide(ex: SandboxExecutor, spec: SideSpec): Promise<SideHandle> {
  const opened = await ex.open(spec);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}: ${opened.error.message}`);
  return opened.value;
}

async function valueOf(side: SideHandle, fn: string, args: unknown[] = []): Promise<unknown> {
  const r = await side.call(request(fn, args));
  if (!r.ok) throw new Error(`call failed: ${r.error.kind}`);
  const outcome = r.value.outcome;
  if (outcome.kind !== "returned") throw new Error(`unexpected outcome ${outcome.kind}`);
  return decodeNode(outcome.value);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (!isRunning(pid)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe("Sandbox_Executor (real children)", () => {
  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-sandbox-exec-")));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("probe succeeds and the factory builds a node-permission executor", async () => {
    const ex = createSandboxExecutorFactory().create({ restartBudget: createRestartBudget(1) });
    expect(ex.mechanism).toBe("node-permission");
    const probed = await ex.probe();
    expect(probed.ok).toBe(true);
    await ex.dispose();
  });

  it("probe reports sandbox-unavailable when the node executable cannot start", async () => {
    const ex = new SandboxExecutor({ restartBudget: createRestartBudget(1), execPath: join(root, "no-such-node.exe") });
    const probed = await ex.probe();
    expect(probed.ok).toBe(false);
    if (!probed.ok) expect(probed.error.kind).toBe("sandbox-unavailable");
    await ex.dispose();
  });

  it("opens both sides, lists exports, calls, and handles timeout, crash and output limit", async () => {
    const ex = executor(10);
    const original = await openSide(ex, specFor("original", makePackage(PACKAGE_SOURCE), 1000));
    const resurrection = await openSide(ex, specFor("resurrection", makePackage(PACKAGE_SOURCE), 1000));

    // list and call on both sides
    for (const side of [original, resurrection]) {
      const listed = await side.listExports();
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value.entries.map((e) => e.name)).toEqual(["add", "big", "boom", "die", "pid", "spin"]);
      expect(await valueOf(side, "add", [2, 3])).toBe(5);
    }

    // a thrown error is an outcome, not a restart
    const thrown = await original.call(request("boom"));
    expect(thrown.ok && thrown.value.outcome.kind).toBe("threw");
    expect(original.counters()).toEqual({ restartEvents: 0, otherRestarts: 0 });

    // output limit: the runner answers output-too-large, the child survives
    const big = await original.call(request("big"));
    expect(big.ok && big.value.outcome.kind).toBe("output-too-large");
    expect(original.counters().otherRestarts).toBe(0);

    // timeout: the spinning child is killed and a fresh child answers the next call
    const pidBefore = (await valueOf(resurrection, "pid")) as number;
    expect(isRunning(pidBefore)).toBe(true);
    const timedOut = await resurrection.call(request("spin"));
    expect(timedOut.ok && timedOut.value.outcome.kind).toBe("timeout");
    expect(timedOut.ok && timedOut.value.crash?.reason).toBe("timeout");
    expect(await waitGone(pidBefore)).toBe(true);
    expect(resurrection.counters()).toEqual({ restartEvents: 0, otherRestarts: 1 });
    const pidAfter = (await valueOf(resurrection, "pid")) as number;
    expect(pidAfter).not.toBe(pidBefore);
    expect(await valueOf(resurrection, "add", [1, 1])).toBe(2);

    // crash: the package exits the process during the call
    const crashed = await original.call(request("die"));
    expect(crashed.ok && crashed.value.outcome.kind).toBe("crash");
    expect(crashed.ok && crashed.value.crash).toMatchObject({ reason: "crash", exitCode: 7 });
    expect(original.counters()).toEqual({ restartEvents: 0, otherRestarts: 1 });
    expect(await valueOf(original, "add", [4, 5])).toBe(9);

    // a Restart_Event counts separately and toward the same budget
    const restarted = await original.restart();
    expect(restarted.ok).toBe(true);
    expect(original.counters()).toEqual({ restartEvents: 1, otherRestarts: 1 });
    expect(await valueOf(original, "add", [1, 2])).toBe(3);

    // dispose leaves no child process
    const pids = [(await valueOf(original, "pid")) as number, (await valueOf(resurrection, "pid")) as number];
    await ex.dispose();
    for (const pid of pids) expect(await waitGone(pid)).toBe(true);
  }, 25000);

  it("returns too-many-crashes when the restart budget is used up", async () => {
    const ex = executor(1);
    const side = await openSide(ex, specFor("original", makePackage(PACKAGE_SOURCE)));
    const first = await side.call(request("die"));
    expect(first.ok && first.value.outcome.kind).toBe("crash");
    const second = await side.call(request("die"));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe("too-many-crashes");
    expect(side.counters()).toEqual({ restartEvents: 0, otherRestarts: 1 });
    await ex.dispose();
  }, 15000);

  it("maps a load exception to unloadable-module", async () => {
    const ex = executor(1);
    const opened = await ex.open(specFor("original", makePackage(BROKEN_SOURCE)));
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.kind).toBe("unloadable-module");
      expect(opened.error.message).toContain("cannot load this");
    }
    await ex.dispose();
  }, 15000);
});
