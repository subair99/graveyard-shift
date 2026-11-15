// Sandbox_Executor (Requirements 5.2 to 5.9, 5.12 to 5.14, 16.4; design: "Sandbox_Executor").
//
// One child process per side: `node --permission --allow-fs-read=... runner.ts`, started with
// `shell: false`, piped stdio, `cwd` equal to the package directory and the environment of
// `buildSandboxEnv` (`TZ=UTC` only). The parent talks NDJSON with the runner (child/protocol.ts):
// wait for `ready`, send `load`, wait for `loaded`, then one `call` at a time.
//
// Paths: the package directory is resolved once with `fs.realpathSync.native`; that string is the
// `cwd`, the grant and the base of the entry file. The created form goes into the extra grants when
// it differs (Requirement 5.17).
//
// Timeouts: the child enforces the per-call timeout for async code (`timeoutMs` in the call
// message). The parent adds a hard kill after `callTimeoutMs + killGraceMs`, which is the only way
// to stop a synchronous infinite loop. A killed child is replaced by a fresh one.
//
// Restarts: a call that reports `restoreVerified: false` counts a Restart_Event; a timeout kill, a
// crash, an output-limit kill or a runner-side crash outcome counts an "other" restart. Both kinds
// draw on the shared RestartBudget; when it is used up the call returns `too-many-crashes`
// (Requirement 16.4). The replacement child is started right after the call, so a following call
// finds a fresh child.
//
// Sequential calls: every operation that touches a child goes through one executor-wide queue, as
// in the InProcess_Executor. Children are always killed on `close`, `dispose` and before a respawn,
// so no process outlives its executor. The executor never runs a package without the permission
// model: when the flags cannot start, the result is `sandbox-unavailable`.
//
// Logging: the executor has no log output. Diagnostics travel in ExecutorError messages, which the
// orchestrator redacts and sends through `emit`. The child's stderr is read only to keep the pipe
// drained and to explain a failed start (a short, bounded excerpt).

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LINE_SLACK_BYTES,
  ProtocolReader,
  frameMessage,
  isChildMessage,
} from "../../child/protocol";
import type {
  ChildMessage,
  JsonValue,
  ParentMessage,
  ResultMessage,
} from "../../child/protocol";
import { EncodedNodeSchema, OutcomeSchema } from "../../types";
import type { Outcome, Result } from "../../types";
import { buildSandboxArgv, buildSandboxEnv } from "./sandboxCommand";
import { restartBudgetError } from "./types";
import type {
  CallRequest,
  CallResult,
  CrashInfo,
  Executor,
  ExecutorError,
  ExportEntry,
  ExecutorFactory,
  ExecutorMechanism,
  ExecutorOptions,
  ExportsInfo,
  PropertyResult,
  RestartBudget,
  RestartKind,
  SideCounters,
  SideHandle,
  SideSpec,
} from "./types";

export interface SandboxExecutorOptions extends ExecutorOptions {
  /** Node executable. Default: the parent's `process.execPath`. */
  execPath?: string;
  /** Runner directory (`src/proof/child`). Default: derived from this file's location. */
  runnerDir?: string;
  /** Time between the child-side timeout and the parent's hard kill. Default 250 ms. */
  killGraceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 250;
const START_TIMEOUT_MS = 30_000;
const MIN_LOAD_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 20_000;
const SHUTDOWN_WAIT_MS = 1_000;
const CLOSE_WAIT_MS = 5_000;
const MAX_QUEUED_MESSAGES = 1_000;
const STDERR_KEEP_CHARS = 2_000;
const STDERR_EXCERPT_CHARS = 200;
const PROPERTY_ERROR_PREFIX = "property-error: ";

function ok<T>(value: T): Result<T, ExecutorError> {
  return { ok: true, value };
}

function fail<T>(kind: ExecutorError["kind"], message: string): Result<T, ExecutorError> {
  return { ok: false, error: { kind, message } };
}

function defaultRunnerDir(): string {
  return fileURLToPath(new URL("../../child", import.meta.url));
}

// ---------------------------------------------------------------------------
// One child process and its protocol reader
// ---------------------------------------------------------------------------

type WaitResult =
  | { kind: "message"; message: ChildMessage }
  | { kind: "closed" }
  | { kind: "overflow" }
  | { kind: "timeout" };

class Conn {
  readonly queue: ChildMessage[] = [];
  closed = false;
  exitCode: number | null = null;
  signal: string | null = null;
  /** A line longer than `outputLimitBytes + LINE_SLACK_BYTES` arrived. */
  overflow = false;
  spawnError: string | undefined;
  stderrText = "";
  /** The first bytes of stdout as text; the probe reads its answer from here. */
  stdoutText = "";

  private readonly reader: ProtocolReader;
  private waiters: Array<() => void> = [];
  private readonly child: ChildProcessWithoutNullStreams;

  private constructor(child: ChildProcessWithoutNullStreams, maxLineBytes: number) {
    this.child = child;
    this.reader = new ProtocolReader({ maxLineBytes });
    child.stdout.on("data", (chunk: Uint8Array) => {
      if (this.stdoutText.length < STDERR_EXCERPT_CHARS) this.stdoutText += Buffer.from(chunk).toString("utf8");
      for (const r of this.reader.feed(chunk)) {
        if (r.kind === "message") {
          if (isChildMessage(r.message) && this.queue.length < MAX_QUEUED_MESSAGES) this.queue.push(r.message);
        } else if (r.reason === "line-too-long" || r.reason === "buffer-overflow") {
          this.overflow = true;
        }
        // Any other malformed line is discarded (Requirement 5.8).
      }
      this.wake();
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      if (this.stderrText.length < STDERR_KEEP_CHARS) this.stderrText += text;
    });
    child.stdin.on("error", () => {
      // The child is gone; the close event reports it.
    });
    child.on("error", (e: Error) => {
      this.spawnError = e.message;
      if (child.pid === undefined) this.closed = true;
      this.wake();
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      this.closed = true;
      this.exitCode = code;
      this.signal = signal;
      this.wake();
    });
  }

  /** Spawns the child; a synchronous spawn failure is returned as text. */
  static start(
    command: string,
    args: readonly string[],
    cwd: string,
    maxLineBytes: number,
  ): Conn | string {
    try {
      const env = { ...buildSandboxEnv() } as unknown as NodeJS.ProcessEnv;
      const child = spawn(command, [...args], {
        cwd,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      return new Conn(child, maxLineBytes);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }

  /** Waits for a matching message (which is removed from the queue), exit, overflow or timeout. */
  async wait(
    match: (m: ChildMessage) => boolean,
    timeoutMs: number,
    watchOverflow: boolean,
  ): Promise<WaitResult> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.wake();
    }, timeoutMs);
    try {
      for (;;) {
        const at = this.queue.findIndex(match);
        if (at >= 0) {
          const [message] = this.queue.splice(at, 1);
          if (message !== undefined) return { kind: "message", message };
        }
        if (watchOverflow && this.overflow) return { kind: "overflow" };
        if (this.closed) return { kind: "closed" };
        if (timedOut) return { kind: "timeout" };
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Writes one message; false when it could not be written. */
  send(message: ParentMessage): boolean {
    if (this.closed) return false;
    try {
      this.child.stdin.write(frameMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  private async untilClosed(timeoutMs: number): Promise<boolean> {
    const r = await this.wait(() => false, timeoutMs, false);
    return r.kind === "closed";
  }

  /** Asks the runner to exit, then kills it when it does not. Resolves once the child is gone. */
  async shutdown(): Promise<void> {
    if (!this.closed) {
      this.send({ gs: 1, t: "shutdown" });
      try {
        this.child.stdin.end();
      } catch {
        // Already closed.
      }
      if (!(await this.untilClosed(SHUTDOWN_WAIT_MS))) await this.kill();
    }
  }

  /** Kills the child and waits for it to be gone. */
  async kill(): Promise<void> {
    if (!this.closed) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      await this.untilClosed(CLOSE_WAIT_MS);
    }
  }
}

function describeExit(conn: Conn): string {
  const parts: string[] = [];
  if (conn.exitCode !== null) parts.push(`exit code ${conn.exitCode}`);
  if (conn.signal !== null) parts.push(`signal ${conn.signal}`);
  if (conn.spawnError !== undefined) parts.push(`spawn error: ${conn.spawnError}`);
  const stderr = conn.stderrText.trim().split(/\r?\n/)[0] ?? "";
  if (stderr.length > 0) parts.push(`stderr: ${stderr.slice(0, STDERR_EXCERPT_CHARS)}`);
  return parts.length === 0 ? "no exit information" : parts.join(", ");
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class SandboxExecutor implements Executor {
  readonly mechanism: ExecutorMechanism = "node-permission";
  readonly budget: RestartBudget;
  readonly killGraceMs: number;

  private readonly execPath: string;
  private readonly runnerDirOption: string | undefined;
  private readonly sides = new Set<SandboxSide>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private probed: Promise<Result<void, ExecutorError>> | undefined;

  constructor(options: SandboxExecutorOptions) {
    this.budget = options.restartBudget;
    this.execPath = options.execPath ?? process.execPath;
    this.runnerDirOption = options.runnerDir;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  /** Runs `task` after every earlier task finished; the queue itself never rejects. */
  enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The real path of the runner directory, or an error. */
  private runnerDir(): Result<string, ExecutorError> {
    try {
      return ok(realpathSync.native(this.runnerDirOption ?? defaultRunnerDir()));
    } catch {
      return fail("sandbox-unavailable", "the sandbox runner directory could not be resolved");
    }
  }

  /**
   * Starts a trivial child with the real flag set and checks, from inside, that the permission
   * model is active. Anything else is `sandbox-unavailable`; nothing runs unsandboxed.
   */
  probe(): Promise<Result<void, ExecutorError>> {
    if (this.probed === undefined) this.probed = this.runProbe();
    return this.probed;
  }

  private async runProbe(): Promise<Result<void, ExecutorError>> {
    const dir = this.runnerDir();
    if (!dir.ok) return dir;
    const built = buildSandboxArgv({
      execPath: this.execPath,
      runnerDir: dir.value,
      runnerEntry: resolvePath(dir.value, "runner.ts"),
      packageDir: dir.value,
      extraReadPaths: [],
      maxOldSpaceMb: 64,
      realpath: realpathSync.native,
    });
    if (!built.ok) return built;
    const script =
      "try{const p=process.permission;" +
      "const sealed=typeof p==='object'&&p!==null&&p.has('fs.write')===false&&p.has('child')===false&&p.has('worker')===false;" +
      "process.stdout.write(sealed?'sandboxed':'open')}catch(e){process.stdout.write('error')}";
    // Same flags as a real child, with the runner script replaced by the probe script.
    const args = [...built.value.args.slice(0, -1), "--eval", script];
    const conn = Conn.start(built.value.command, args, built.value.cwd, 1024);
    if (typeof conn === "string") {
      return fail("sandbox-unavailable", `the sandbox probe could not be started: ${conn}`);
    }
    const waited = await conn.wait(() => false, PROBE_TIMEOUT_MS, false);
    if (waited.kind !== "closed") {
      await conn.kill();
      return fail("sandbox-unavailable", "the sandbox probe did not finish in time");
    }
    return conn.exitCode === 0 && conn.stdoutText.trim() === "sandboxed"
      ? ok(undefined)
      : fail("sandbox-unavailable", `the permission model is not usable (${describeExit(conn)})`);
  }

  open(spec: SideSpec): Promise<Result<SideHandle, ExecutorError>> {
    return this.enqueue(async () => {
      if (this.disposed) return fail<SideHandle>("sandbox-unavailable", "the executor is disposed");
      for (const s of this.sides) {
        if (s.spec.side === spec.side) {
          return fail<SideHandle>("unloadable-module", `the ${spec.side} side is already open`);
        }
      }
      const runner = this.runnerDir();
      if (!runner.ok) return fail<SideHandle>(runner.error.kind, runner.error.message);

      let real: string;
      try {
        real = realpathSync.native(spec.packageDir);
      } catch {
        return fail<SideHandle>("unloadable-module", `the ${spec.side} package directory could not be resolved`);
      }
      const created = resolvePath(spec.packageDir);
      const extra: string[] = [];
      if (created !== real) extra.push(created);
      for (const p of spec.readPaths) extra.push(p);
      if (spec.setupModule !== undefined) extra.push(spec.setupModule);

      const built = buildSandboxArgv({
        execPath: this.execPath,
        runnerDir: runner.value,
        runnerEntry: resolvePath(runner.value, "runner.ts"),
        packageDir: real,
        extraReadPaths: extra,
        maxOldSpaceMb: Math.max(1, Math.floor(spec.limits.heapLimitMb)),
        realpath: realpathSync.native,
      });
      if (!built.ok) return fail<SideHandle>(built.error.kind, built.error.message);

      // The entry file in the same path form as the grant.
      let entryFile = spec.entryFile;
      if (created !== real && entryFile.startsWith(created + sep)) entryFile = real + entryFile.slice(created.length);

      const side = new SandboxSide(this, spec, {
        command: built.value.command,
        args: built.value.args,
        cwd: built.value.cwd,
        entryFile,
        maxLineBytes: spec.limits.outputLimitBytes + LINE_SLACK_BYTES,
      });
      const started = await side.start();
      if (!started.ok) return fail<SideHandle>(started.error.kind, started.error.message);
      this.sides.add(side);
      return ok<SideHandle>(side);
    });
  }

  /** @internal Called by a side when it closes. */
  forget(side: SandboxSide): void {
    this.sides.delete(side);
  }

  async dispose(): Promise<void> {
    await this.enqueue(async () => {
      this.disposed = true;
      for (const side of [...this.sides]) await side.closeNow();
      this.sides.clear();
    });
  }
}

interface SidePlan {
  command: string;
  args: readonly string[];
  cwd: string;
  entryFile: string;
  maxLineBytes: number;
}

type CallEnd =
  | { kind: "result"; message: ResultMessage }
  | { kind: "property-error"; message: string }
  | { kind: "died"; crash: CrashInfo }
  | { kind: "timeout" }
  | { kind: "overflow" };

class SandboxSide implements SideHandle {
  readonly spec: SideSpec;
  private conn: Conn | undefined;
  private nextId = 1;
  private closed = false;
  private restartEvents = 0;
  private otherRestarts = 0;

  constructor(
    private readonly executor: SandboxExecutor,
    spec: SideSpec,
    private readonly plan: SidePlan,
  ) {
    this.spec = spec;
  }

  /** Spawns a child, waits for `ready`, sends `load` and waits for `loaded`. */
  async start(): Promise<Result<void, ExecutorError>> {
    const conn = Conn.start(this.plan.command, this.plan.args, this.plan.cwd, this.plan.maxLineBytes);
    if (typeof conn === "string") {
      return fail("sandbox-unavailable", `the sandbox child could not be started: ${conn}`);
    }
    const ready = await conn.wait((m) => m.t === "ready", START_TIMEOUT_MS, false);
    if (ready.kind !== "message") {
      const why = ready.kind === "closed" ? describeExit(conn) : "no ready message in time";
      await conn.kill();
      return fail("sandbox-unavailable", `the sandbox child did not start (${why})`);
    }
    const id = this.nextId++;
    const { limits } = this.spec;
    const sent = conn.send({
      gs: 1,
      t: "load",
      id,
      entryFile: this.plan.entryFile,
      ...(this.spec.setupModule === undefined ? {} : { setupModule: this.spec.setupModule }),
      outputLimitBytes: limits.outputLimitBytes,
      stubs: { date: true, random: true },
    });
    if (!sent) {
      await conn.kill();
      return fail("sandbox-unavailable", "the load message could not be sent to the sandbox child");
    }
    const loadWait = Math.max(MIN_LOAD_TIMEOUT_MS, limits.callTimeoutMs);
    const loaded = await conn.wait((m) => m.t === "loaded" && m.id === id, loadWait, true);
    if (loaded.kind === "message" && loaded.message.t === "loaded" && loaded.message.ok) {
      this.conn = conn;
      return ok(undefined);
    }
    let reason: string;
    if (loaded.kind === "message" && loaded.message.t === "loaded") {
      reason = loaded.message.error ?? "the module could not be loaded";
    } else if (loaded.kind === "closed") {
      reason = `the sandbox child exited while loading the module (${describeExit(conn)})`;
    } else if (loaded.kind === "timeout") {
      reason = "the module did not finish loading in time";
    } else {
      reason = "the sandbox child sent an oversized line while loading the module";
    }
    await conn.kill();
    return fail("unloadable-module", reason);
  }

  private notOpen(): Result<never, ExecutorError> | undefined {
    if (this.closed || this.conn === undefined) {
      return fail("runner-protocol-error", `the ${this.spec.side} side is not open`);
    }
    return undefined;
  }

  listExports(): Promise<Result<ExportsInfo, ExecutorError>> {
    return this.executor.enqueue(async (): Promise<Result<ExportsInfo, ExecutorError>> => {
      const bad = this.notOpen();
      if (bad !== undefined) return bad;
      const conn = this.conn;
      if (conn === undefined) return fail("runner-protocol-error", "the side is not open");
      conn.queue.length = 0;
      const id = this.nextId++;
      if (!conn.send({ gs: 1, t: "exports", id })) {
        return fail("runner-protocol-error", "the exports request could not be sent to the sandbox child");
      }
      const waited = await conn.wait(
        (m) => m.t === "exports" && m.id === id,
        Math.max(MIN_LOAD_TIMEOUT_MS, this.spec.limits.callTimeoutMs),
        true,
      );
      if (waited.kind !== "message" || waited.message.t !== "exports") {
        const why = waited.kind === "closed" ? describeExit(conn) : waited.kind;
        return fail("runner-protocol-error", `the sandbox child did not answer the exports request (${why})`);
      }
      const entries: ExportEntry[] = [];
      for (const e of waited.message.entries) {
        const entry: ExportEntry = { name: e.name, type: e.type };
        if (e.fnName !== undefined) entry.fnName = e.fnName;
        if (e.arity !== undefined) entry.arity = e.arity;
        if (e.primitive !== undefined) {
          const parsed = EncodedNodeSchema.safeParse(e.primitive);
          if (!parsed.success) {
            return fail("runner-protocol-error", "the sandbox child sent an export entry of an unknown shape");
          }
          entry.primitive = parsed.data;
        }
        entries.push(entry);
      }
      return ok({ entries });
    });
  }

  call(request: CallRequest): Promise<Result<CallResult, ExecutorError>> {
    return this.executor.enqueue(async (): Promise<Result<CallResult, ExecutorError>> => {
      const bad = this.notOpen();
      if (bad !== undefined) return bad;
      const conn = this.conn;
      if (conn === undefined) return fail("runner-protocol-error", "the side is not open");

      const end = await this.runCall(conn, request);
      switch (end.kind) {
        case "property-error":
          return fail("property-error", end.message);
        case "result":
          return this.finishResult(end.message);
        case "died": {
          const restarted = await this.respawn("other");
          if (!restarted.ok) return restarted;
          return ok({ outcome: { kind: "crash" }, properties: [], restoreVerified: true, crash: end.crash });
        }
        case "timeout": {
          const restarted = await this.respawn("other");
          if (!restarted.ok) return restarted;
          return ok({
            outcome: { kind: "timeout" },
            properties: [],
            restoreVerified: true,
            crash: { reason: "timeout" },
          });
        }
        case "overflow": {
          const restarted = await this.respawn("other");
          if (!restarted.ok) return restarted;
          return ok({ outcome: { kind: "output-too-large" }, properties: [], restoreVerified: true });
        }
      }
    });
  }

  /** Sends the call and waits for its end. Kills the child on timeout, overflow or a fatal. */
  private async runCall(conn: Conn, request: CallRequest): Promise<CallEnd> {
    conn.queue.length = 0;
    const id = this.nextId++;
    const sent = conn.send({
      gs: 1,
      t: "call",
      id,
      fn: request.fn,
      args: request.args as unknown as JsonValue[],
      caseSeed: request.caseSeed,
      stubs: request.stubs,
      properties: request.properties.map((p) => ({ id: p.id, modulePath: p.modulePath })),
      timeoutMs: this.spec.limits.callTimeoutMs,
    });
    if (!sent) {
      await conn.kill();
      return { kind: "died", crash: crashInfo(conn) };
    }
    const waited = await conn.wait(
      (m) => (m.t === "result" && m.id === id) || (m.t === "fatal" && (m.id === id || m.id === undefined)),
      this.spec.limits.callTimeoutMs + this.executor.killGraceMs,
      true,
    );
    switch (waited.kind) {
      case "timeout":
        await conn.kill();
        return { kind: "timeout" };
      case "overflow":
        await conn.kill();
        return { kind: "overflow" };
      case "closed":
        return { kind: "died", crash: crashInfo(conn) };
      case "message": {
        const m = waited.message;
        if (m.t === "result") return { kind: "result", message: m };
        if (m.t === "fatal" && m.message.startsWith(PROPERTY_ERROR_PREFIX)) {
          return { kind: "property-error", message: m.message.slice(PROPERTY_ERROR_PREFIX.length) };
        }
        // Any other fatal: the runner is about to exit with code 3, 4 or 5.
        await conn.kill();
        return { kind: "died", crash: crashInfo(conn) };
      }
    }
  }

  private async finishResult(message: ResultMessage): Promise<Result<CallResult, ExecutorError>> {
    let outcome: Outcome;
    if (message.outcome.kind === "crash") {
      // The runner's reason string is a diagnostic; the Outcome shape has no reason field.
      outcome = { kind: "crash" };
    } else {
      const parsed = OutcomeSchema.safeParse(message.outcome);
      if (!parsed.success) {
        return fail("runner-protocol-error", "the sandbox child sent an outcome of an unknown shape");
      }
      outcome = parsed.data;
    }
    const properties: PropertyResult[] = [];
    for (const p of message.properties) {
      if (p.detail === undefined) {
        properties.push({ id: p.id, ok: p.ok });
        continue;
      }
      const detail = EncodedNodeSchema.safeParse(p.detail);
      if (!detail.success) {
        return fail("runner-protocol-error", "the sandbox child sent a property detail of an unknown shape");
      }
      properties.push({ id: p.id, ok: p.ok, detail: detail.data });
    }
    const result: CallResult = { outcome, properties, restoreVerified: message.restoreVerified };
    if (!message.restoreVerified) {
      const restarted = await this.respawn("restart-event");
      if (!restarted.ok) return restarted;
    } else if (outcome.kind === "crash") {
      // A crash outcome from inside the runner (for example an unknown function): start fresh.
      const restarted = await this.respawn("other");
      if (!restarted.ok) return restarted;
    }
    return ok(result);
  }

  /**
   * Kills the current child, counts one restart and starts a fresh child. The old child is gone
   * before the budget is consulted, so a refused restart leaves no process behind.
   */
  private async respawn(kind: RestartKind): Promise<Result<void, ExecutorError>> {
    const old = this.conn;
    this.conn = undefined;
    if (old !== undefined) await old.kill();
    if (this.closed) return fail("runner-protocol-error", `the ${this.spec.side} side is not open`);
    const budget = this.executor.budget;
    if (!budget.consume(kind)) return fail("too-many-crashes", restartBudgetError(budget).message);
    if (kind === "restart-event") this.restartEvents += 1;
    else this.otherRestarts += 1;
    return this.start();
  }

  restart(): Promise<Result<void, ExecutorError>> {
    return this.executor.enqueue(async (): Promise<Result<void, ExecutorError>> => {
      const bad = this.notOpen();
      if (bad !== undefined) return bad;
      return this.respawn("restart-event");
    });
  }

  counters(): SideCounters {
    return { restartEvents: this.restartEvents, otherRestarts: this.otherRestarts };
  }

  close(): Promise<void> {
    return this.executor.enqueue(() => this.closeNow());
  }

  async closeNow(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const conn = this.conn;
    this.conn = undefined;
    this.executor.forget(this);
    if (conn !== undefined) await conn.shutdown();
  }
}

function crashInfo(conn: Conn): CrashInfo {
  const info: CrashInfo = { reason: "crash" };
  if (conn.exitCode !== null) info.exitCode = conn.exitCode;
  if (conn.signal !== null) info.signal = conn.signal;
  return info;
}

export function createSandboxExecutorFactory(
  extra: Pick<SandboxExecutorOptions, "execPath" | "runnerDir" | "killGraceMs"> = {},
): ExecutorFactory {
  return {
    create: (options: ExecutorOptions): Executor => new SandboxExecutor({ ...extra, ...options }),
  };
}
