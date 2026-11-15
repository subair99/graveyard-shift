// Smoke test of src/proof/child/runner.ts as a real child under `node --permission`
// (task 17.3; Requirements 5.7, 5.8, 5.10 to 5.12). The full sandbox denial and isolation tests
// are task 18.
// Requirements: 5.7, 5.8, 5.10, 5.11, 5.12
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeNode } from "../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import { parseProtocolLine, type ExportsResponse, type ProtocolMessage } from "../../../src/proof/child/protocol";
import { buildSandboxArgv, buildSandboxEnv } from "../../../src/proof/shell/executor/sandboxCommand";

const runnerDir = resolve(__dirname, "../../../src/proof/child");
const runnerEntry = join(runnerDir, "runner.ts");

const PACKAGE_SOURCE = `
exports.add = (a, b) => a + b;
exports.boom = () => { throw new Error('boom'); };
exports.noisy = () => {
  console.log('noise one');
  console.error('noise two');
  process.stdout.write('not a protocol line\\n');
  process.stderr.write('stderr noise\\n');
  return 'quiet';
};
exports.setPath = (obj, path, value) => {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
  return 'done';
};
exports.probe = () => ({}).polluted === undefined ? 'clean' : 'dirty';
`;

const STUBS = { date: true, random: true };

function enc(value: unknown) {
  const r = encodeValue(value, { budget: 100000 });
  if (!r.ok) throw new Error("encode failed");
  return r.node;
}

class Session {
  readonly lines: string[] = [];
  readonly messages: ProtocolMessage[] = [];
  private buffer = "";
  private waiters: Array<() => void> = [];
  exitCode: number | null | undefined;

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl = this.buffer.indexOf("\n");
      while (nl !== -1) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.lines.push(line);
        const m = parseProtocolLine(line);
        if (m !== undefined) this.messages.push(m);
        nl = this.buffer.indexOf("\n");
      }
      this.wake();
    });
    child.on("exit", (code) => {
      this.exitCode = code;
      this.wake();
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  async waitFor<T extends ProtocolMessage>(test: (m: ProtocolMessage) => m is T): Promise<T> {
    const deadline = Date.now() + 15000;
    for (;;) {
      const found = this.messages.find(test);
      if (found !== undefined) return found;
      if (this.exitCode !== undefined) throw new Error("child exited with " + String(this.exitCode));
      if (Date.now() > deadline) throw new Error("timed out waiting for a message");
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 200);
      });
    }
  }

  send(message: object): void {
    this.child.stdin.write(JSON.stringify({ gs: 1, ...message }) + "\n");
  }

  async waitExit(): Promise<number | null> {
    const deadline = Date.now() + 15000;
    while (this.exitCode === undefined) {
      if (Date.now() > deadline) throw new Error("child did not exit");
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 100);
      });
    }
    return this.exitCode;
  }
}

describe("child runner (real child under --permission)", () => {
  let tempRoot = "";
  let packageDir = "";
  let session: Session | undefined;

  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "gs-runner-"));
    packageDir = realpathSync.native(tempRoot);
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "synthetic", version: "1.0.0", main: "index.js" }));
    writeFileSync(join(packageDir, "index.js"), PACKAGE_SOURCE);
  });

  afterAll(() => {
    session?.child.kill();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("handshakes, loads, lists exports, calls, isolates prototypes and shuts down", async () => {
    const built = buildSandboxArgv({
      execPath: process.execPath,
      runnerDir,
      runnerEntry,
      packageDir,
      extraReadPaths: [],
      maxOldSpaceMb: 256,
    });
    if (!built.ok) throw new Error("argv build failed");
    const child: ChildProcessWithoutNullStreams = spawn(built.value.command, built.value.args, {
      cwd: built.value.cwd,
      env: { ...buildSandboxEnv("win32", {}) } as unknown as NodeJS.ProcessEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const s = new Session(child);
    session = s;
    child.stderr.resume();

    try {
      const ready = await s.waitFor((m): m is Extract<ProtocolMessage, { t: "ready" }> => m.t === "ready");
      expect(ready.node).toBe(process.version);

      s.send({ t: "load", id: 1, entryFile: "index.js", outputLimitBytes: 100000, stubs: STUBS });
      const loaded = await s.waitFor((m): m is Extract<ProtocolMessage, { t: "loaded" }> => m.t === "loaded");
      expect(loaded.ok).toBe(true);

      s.send({ t: "exports", id: 2 });
      const exp = await s.waitFor((m): m is ExportsResponse => m.t === "exports" && "entries" in m);
      expect(exp.entries.map((e) => e.name)).toEqual(["add", "boom", "noisy", "probe", "setPath"]);

      let id = 10;
      const call = async (fn: string, args: unknown[]) => {
        const callId = ++id;
        s.send({ t: "call", id: callId, fn, args: args.map(enc), caseSeed: 1, stubs: STUBS, properties: [], timeoutMs: 2000 });
        return s.waitFor((m): m is Extract<ProtocolMessage, { t: "result" }> => m.t === "result" && m.id === callId);
      };

      const add = await call("add", [2, 3]);
      expect(add.outcome.kind).toBe("returned");
      expect(add.restoreVerified).toBe(true);
      expect(decodeNode((add.outcome as unknown as { value: Parameters<typeof decodeNode>[0] }).value)).toBe(5);

      const boom = await call("boom", []);
      expect(boom.outcome.kind).toBe("threw");

      const noisy = await call("noisy", []);
      expect(noisy.outcome.kind).toBe("returned");

      const polluted = await call("setPath", [{}, "__proto__.polluted", "yes"]);
      expect(polluted.outcome.kind).toBe("returned");
      expect(polluted.restoreVerified).toBe(true);
      const delta = (polluted.outcome as unknown as { prototypeDelta: Array<{ key: { s: string }; change: string }> })
        .prototypeDelta;
      expect(delta.some((d) => d.key.s === "polluted" && d.change === "added")).toBe(true);

      const next = await call("probe", []);
      expect(next.restoreVerified).toBe(true);
      expect((next.outcome as unknown as { prototypeDelta: unknown[] }).prototypeDelta).toEqual([]);
      expect(decodeNode((next.outcome as unknown as { value: Parameters<typeof decodeNode>[0] }).value)).toBe("clean");

      const missing = await call("nope", []);
      expect(missing.outcome).toEqual({ kind: "crash", reason: "function-not-found" });

      // Package output never reaches the stream: every stdout line is a protocol message.
      expect(s.lines.length).toBeGreaterThan(0);
      for (const line of s.lines) expect(parseProtocolLine(line)).toBeDefined();

      s.send({ t: "shutdown" });
      expect(await s.waitExit()).toBe(0);
    } finally {
      child.kill();
    }
  }, 25000);
});
