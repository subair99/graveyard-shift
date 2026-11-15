// Prototype isolation under the real Sandbox_Executor (task 18.7; Requirements 5.10, 5.11, 5.12,
// 5.13, 5.15). Pollution made by one call is reported in the Prototype_Delta of that call, removed
// before the next call, and never reaches the other side or the test process.
//
// Restart fixture: `restart-probe.freezeArray()` (and `freezeObject()`) freeze a built-in prototype.
// The runner cannot restore a frozen prototype (`isRestorable` is false), so the call reports
// `restoreVerified: false` and the executor restarts the child (a Restart_Event).
// Requirements: 5.10, 5.11, 5.12, 5.13, 5.15
import { afterEach, describe, expect, it } from "vitest";
import { decodeNode } from "../../../src/proof/child/codec/decode";
import type { CallResult } from "../../../src/proof/shell/executor/types";
import { createHarness, isRunning, waitForExit } from "./helpers/sandboxHarness";
import type { SandboxHarness } from "./helpers/sandboxHarness";

const harnesses: SandboxHarness[] = [];

function make(): SandboxHarness {
  const h = createHarness();
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
});

function deltaOf(result: CallResult) {
  const o = result.outcome;
  if (o.kind !== "returned" && o.kind !== "threw" && o.kind !== "rejected") {
    throw new Error(`unexpected outcome: ${o.kind}`);
  }
  return o.prototypeDelta;
}

describe("prototype isolation (real sandbox)", () => {
  it("reports Object.prototype pollution in that call and restores it before the next call", async () => {
    const objectProtoKeysBefore = Reflect.ownKeys(Object.prototype).length;
    const h = make();
    const side = await h.open("proto-pollute", "original");
    const pid = (await side.callValue("pid")) as number;

    const polluted = await side.call("set", [{}, "__proto__.gsPolluted", "yes"]);
    expect(polluted.restoreVerified).toBe(true);
    const delta = deltaOf(polluted);
    expect(delta).toHaveLength(1);
    expect(delta[0]!.prototype).toBe("Object.prototype");
    expect(delta[0]!.key).toEqual({ s: "gsPolluted" });
    expect(delta[0]!.change).toBe("added");
    expect(delta[0]!.before).toBeUndefined();
    expect(decodeNode(delta[0]!.after!.value!)).toBe("yes");

    // Next call, same child: clean prototype, empty delta.
    const next = await side.call("probe", ["gsPolluted"]);
    expect(next.restoreVerified).toBe(true);
    expect(deltaOf(next)).toEqual([]);
    if (next.outcome.kind !== "returned") throw new Error("probe did not return");
    expect(decodeNode(next.outcome.value)).toBe("clean");
    expect(await side.callValue("pid")).toBe(pid);

    expect(side.counters()).toEqual({ restartEvents: 0, otherRestarts: 0 });
    // The test process itself is untouched.
    expect(Reflect.ownKeys(Object.prototype).length).toBe(objectProtoKeysBefore);
    expect(({} as Record<string, unknown>).gsPolluted).toBeUndefined();
  });

  it("does not leak pollution to the other side (different process)", async () => {
    const h = make();
    const original = await h.open("proto-pollute", "original");
    const resurrection = await h.open("proto-pollute", "resurrection");
    const pidA = (await original.callValue("pid")) as number;
    const pidB = (await resurrection.callValue("pid")) as number;
    expect(pidA).not.toBe(pidB);

    const polluted = await original.call("set", [{}, "__proto__.gsPolluted", "yes"]);
    expect(deltaOf(polluted)).toHaveLength(1);

    const other = await resurrection.call("probe", ["gsPolluted"]);
    expect(deltaOf(other)).toEqual([]);
    if (other.outcome.kind !== "returned") throw new Error("probe did not return");
    expect(decodeNode(other.outcome.value)).toBe("clean");
  });

  it("reports and restores Object, Array and Function prototype pollution per call", async () => {
    const h = make();
    const side = await h.open("proto-pollute", "original");
    const cases: Array<{ args: unknown[]; prototype: string; key: string }> = [
      { args: [{}, "constructor.prototype.gsViaCtor", 1], prototype: "Object.prototype", key: "gsViaCtor" },
      { args: [[], "__proto__.gsArr", 1], prototype: "Array.prototype", key: "gsArr" },
      // Object.__proto__ is Function.prototype.
      { args: [{}, "constructor.__proto__.gsFn", 1], prototype: "Function.prototype", key: "gsFn" },
    ];
    for (const c of cases) {
      const r = await side.call("set", c.args);
      expect(r.restoreVerified).toBe(true);
      const delta = deltaOf(r);
      expect(delta).toHaveLength(1);
      expect(delta[0]!.prototype).toBe(c.prototype);
      expect(delta[0]!.key).toEqual({ s: c.key });
      expect(delta[0]!.change).toBe("added");
    }
    // After all three, nothing is left: a call that changes nothing has an empty delta.
    const clean = await side.call("probe", ["gsViaCtor"]);
    expect(deltaOf(clean)).toEqual([]);
    expect(await side.callValue("probe", ["gsFn"])).toBe("clean");
    expect(await side.callValue("probe", ["gsArr"])).toBe("clean");
    expect(side.counters()).toEqual({ restartEvents: 0, otherRestarts: 0 });
  });

  it("counts a Restart_Event when restoration is impossible and serves the next call on a new, unfrozen child", async () => {
    const h = make();
    const side = await h.open("restart-probe", "original");
    const oldPid = (await side.callValue("pid")) as number;
    expect(h.budget.used()).toBe(0);

    // freezeArray() freezes Array.prototype, which cannot be restored: restoreVerified is false.
    const frozen = await side.call("freezeArray");
    expect(frozen.restoreVerified).toBe(false);
    expect(side.counters()).toEqual({ restartEvents: 1, otherRestarts: 0 });
    expect(h.budget.restartEvents()).toBe(1);
    expect(h.budget.otherRestarts()).toBe(0);
    expect(h.budget.used()).toBe(1);

    expect(await waitForExit(oldPid)).toBe(true);
    const newPid = (await side.callValue("pid")) as number;
    expect(newPid).not.toBe(oldPid);
    expect(await side.callValue("frozenState")).toEqual({ array: false, object: false });
    expect(await side.callValue("ok")).toBe("ok");

    // freezeObject() behaves the same way.
    const frozenObject = await side.call("freezeObject");
    expect(frozenObject.restoreVerified).toBe(false);
    expect(side.counters()).toEqual({ restartEvents: 2, otherRestarts: 0 });
    expect(h.budget.used()).toBe(2);
    expect(await side.callValue("frozenState")).toEqual({ array: false, object: false });
  });

  it("leaves no child process after dispose", async () => {
    const h = make();
    const original = await h.open("proto-pollute", "original");
    const resurrection = await h.open("restart-probe", "resurrection");
    const pids = [(await original.callValue("pid")) as number, (await resurrection.callValue("pid")) as number];
    await resurrection.call("freezeArray");
    pids.push((await resurrection.callValue("pid")) as number);
    expect(new Set(pids).size).toBe(3);

    await h.cleanup();
    for (const pid of pids) {
      expect(await waitForExit(pid)).toBe(true);
      expect(isRunning(pid)).toBe(false);
    }
  });
});
