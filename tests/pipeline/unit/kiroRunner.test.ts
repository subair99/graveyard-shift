// Requirements: 6.6, 6.7, 6.12, 6.13

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { buildKiroArgs } from "../../../src/pipeline/medium/core/kiroArgs";
import { buildMediumPrompt } from "../../../src/pipeline/medium/core/prompt";
import {
  createKiroRunner,
  describeKiroFailure,
  type SpawnFn,
  type SpawnOptions,
} from "../../../src/pipeline/medium/shell/kiroRunner";

interface Call {
  command: string;
  args: string[];
  options: SpawnOptions;
}

function fakeSpawn(script: (child: FakeChild) => void): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    setImmediate(() => script(child));
    return child as never;
  };
  return { spawn, calls };
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

const CWD = "/repo";
const ADDED = { GRAVEYARD_CERTIFICATE_PATH: "/repo/.graveyard-work/certificate.json", GUARD_LOG_FILE: "/repo/.graveyard-work/guard.log" };

function harness(script: (child: FakeChild) => void, env: Record<string, string | undefined>) {
  const { spawn, calls } = fakeSpawn(script);
  const out: string[] = [];
  const err: string[] = [];
  const runner = createKiroRunner({ spawn, env, cwd: CWD, added: ADDED, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { runner, calls, out, err };
}

describe("Medium launcher", () => {
  it("builds the fixed argument list from the package name only", () => {
    const args = buildKiroArgs("ip");
    expect(args.slice(0, 6)).toEqual(["chat", "--v3", "--no-interactive", "--require-mcp-startup", "--agent", "medium"]);
    expect(args).toHaveLength(7);
    expect(args[6]).toBe(buildMediumPrompt("ip"));
    expect(args[6]).toContain("ip");
  });

  it("rejects an invalid package name for the prompt", () => {
    expect(() => buildMediumPrompt("@scope/x")).toThrow();
    expect(() => buildMediumPrompt("a b; rm -rf")).toThrow();
  });

  it("keeps only Medium_Env_Keys", async () => {
    const { runner, calls, err } = harness((c) => c.emit("close", 0, null), {
      GITHUB_TOKEN: "secret-value",
      github_token: "t2",
      PATH: "/bin",
      HOME: "/home/u",
      OTHER: "other-value",
      GONE: undefined,
    });
    await runner.run("ip");
    expect(calls[0]?.options.env).toEqual({ PATH: "/bin", HOME: "/home/u", ...ADDED });
    expect(err[0]).toBe("Medium environment keys: GRAVEYARD_CERTIFICATE_PATH, GUARD_LOG_FILE, HOME, PATH\n");
    expect(err.join("")).not.toMatch(/secret-value|other-value|\/bin/);
  });

  it("spawns kiro-cli once without a shell, with the added paths and the working directory", async () => {
    const { runner, calls } = harness((c) => c.emit("close", 0, null), {
      GITHUB_TOKEN: "secret-value",
    });
    const outcome = await runner.run("ip");
    expect(outcome).toEqual({ kind: "exited", exitCode: 0, usageLimit: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("kiro-cli");
    expect(calls[0]?.args).toEqual(buildKiroArgs("ip"));
    expect(calls[0]?.options.shell).toBe(false);
    expect(calls[0]?.options.cwd).toBe(CWD);
    expect(calls[0]?.options.env).toEqual(ADDED);
    expect(calls[0]?.options.env["GRAVEYARD_CERTIFICATE_PATH"]).toBe(ADDED.GRAVEYARD_CERTIFICATE_PATH);
    expect(calls[0]?.options.env["GUARD_LOG_FILE"]).toBe(ADDED.GUARD_LOG_FILE);
  });

  it("forwards child output and prints no environment value", async () => {
    const { runner, out, err } = harness(
      (c) => {
        c.stdout.emit("data", Buffer.from("hello"));
        c.stderr.emit("data", "warn");
        c.emit("close", 3, null);
      },
      { GITHUB_TOKEN: "secret-value", OTHER: "other-value" },
    );
    const outcome = await runner.run("ip");
    expect(outcome).toEqual({ kind: "exited", exitCode: 3, usageLimit: false });
    expect(out).toEqual(["hello"]);
    expect(err.slice(1)).toEqual(["warn"]);
    expect([...out, ...err].join("")).not.toMatch(/secret-value|other-value/);
  });

  it("reports a non-zero code for a signal exit", async () => {
    const { runner } = harness((c) => c.emit("close", null, "SIGTERM"), {});
    expect(await runner.run("ip")).toEqual({ kind: "exited", exitCode: 1, usageLimit: false });
  });

  it("detects a usage limit, even split across two chunks, and points to the setup note", async () => {
    const { runner } = harness(
      (c) => {
        c.stderr.emit("data", "Error: UsageLimitRea");
        c.stderr.emit("data", "chedError");
        c.emit("close", 1, null);
      },
      {},
    );
    const outcome = await runner.run("ip");
    expect(outcome).toEqual({ kind: "exited", exitCode: 1, usageLimit: true });
    const text = describeKiroFailure(outcome);
    expect(text).toContain("usage limit");
    expect(text).toContain("spikes/kiro-agent/README.md");
  });

  it("names a missing kiro-cli and points to the setup note", async () => {
    const { runner } = harness((c) => c.emit("error", Object.assign(new Error("spawn kiro-cli ENOENT"), { code: "ENOENT" })), {});
    const outcome = await runner.run("ip");
    expect(outcome).toEqual({ kind: "not-found" });
    const text = describeKiroFailure(outcome);
    expect(text).toContain("kiro-cli was not found");
    expect(text).toContain("spikes/kiro-agent/README.md");
  });

  it("gives no failure text for a plain exit", () => {
    expect(describeKiroFailure({ kind: "exited", exitCode: 2, usageLimit: false })).toBeNull();
  });

  it("maps a throwing spawn to failed-to-start", async () => {
    const runner = createKiroRunner({
      spawn: () => {
        throw new Error("boom");
      },
      env: {},
      cwd: CWD,
      added: ADDED,
      out: () => {},
      err: () => {},
    });
    expect(await runner.run("ip")).toEqual({ kind: "failed-to-start", message: "boom" });
  });
});
