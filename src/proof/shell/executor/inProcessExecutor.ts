// InProcess_Executor (Requirements 5.1, 5.9, 15.1; design: "InProcess_Executor").
//
// Runs both sides in the SAME process through two SideRuntime instances. It exists for the
// engine-level tests only; the CLI and the default `runProofOfLife` use the Sandbox_Executor.
//
// TRUSTED SYNTHETIC PACKAGES ONLY. There is no sandbox: package code can read files, use the
// network, exit the process or freeze a real prototype. The timeout is best-effort: SideRuntime
// bounds the wait for an async result, but a synchronous hang cannot be interrupted, and code
// that keeps running after a timed-out async call is not stopped. The constructor refuses to
// run without `acknowledgeUnsandboxed: true`.
//
// Module instances: `createSideRuntime` loads through `createRequire(<packageDir>/package.json)`.
// Node's require cache is keyed by absolute file path, so two sides with different package
// directories get two separate module instances, even when the source is identical (each side
// owns its module state). Two sides must therefore not share a directory; `open` refuses a
// directory that is already open. Before a (re)load, cached modules under the side's directory
// are evicted from the require cache so a restart produces a fresh module instance.
//
// Sequential calls: the two sides share one process and one set of prototypes. Every operation
// that runs package code (`open`, `listExports`, `call`, `restart`) goes through one executor-wide
// queue, so the original call, its restoration and verification (done inside SideRuntime.call),
// and only then the resurrection call run strictly one after the other. Prototype snapshots of
// the two sides therefore never overlap. A caller that fires both calls concurrently still gets
// them run one at a time, in call order.
//
// Restart semantics: when a call reports `restoreVerified: false`, the executor counts a
// Restart_Event in the shared RestartBudget and recreates the SideRuntime (a fresh module
// instance). When the budget is used up, the call returns the `too-many-crashes` error. The
// prototypes themselves cannot be repaired in-process (for example after `Object.freeze` of a
// real prototype); tests that exercise this use an injected fake `PrototypeSet`.

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { resolve as resolvePath, sep } from "node:path";
import { createSideRuntime } from "../../child/sideRuntime.ts";
import type { SideRuntime } from "../../child/sideRuntime.ts";
import type { PrototypeSet } from "../../child/prototypes.ts";
import type { Result } from "../../types";
import { restartBudgetError } from "./types";
import type {
  CallRequest,
  CallResult,
  Executor,
  ExecutorError,
  ExecutorFactory,
  ExecutorMechanism,
  ExecutorOptions,
  ExportsInfo,
  PropertyResult,
  SideCounters,
  SideHandle,
  SideSpec,
} from "./types";

export interface InProcessExecutorOptions extends ExecutorOptions {
  /** Must be `true`: the executor runs package code without a sandbox. */
  acknowledgeUnsandboxed: true;
  /** Default: the six real prototypes. Tests inject a fake set. */
  prototypes?: PrototypeSet;
}

function ok<T>(value: T): Result<T, ExecutorError> {
  return { ok: true, value };
}

function fail<T>(error: ExecutorError): Result<T, ExecutorError> {
  return { ok: false, error };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function underDir(file: string, dirs: readonly string[]): boolean {
  const lower = process.platform === "win32";
  const f = lower ? file.toLowerCase() : file;
  return dirs.some((d) => {
    const dd = lower ? d.toLowerCase() : d;
    return f === dd || f.startsWith(dd.endsWith(sep) ? dd : dd + sep);
  });
}

/** Evicts every cached module under `packageDir` (and the setup module) from the require cache. */
function evictModules(packageDir: string, setupModule: string | undefined): void {
  const dirs = [resolvePath(packageDir)];
  try {
    dirs.push(realpathSync(packageDir));
  } catch {
    // The directory may not exist (yet); the plain path is enough then.
  }
  const req = createRequire(resolvePath(packageDir, "package.json"));
  const cache = req.cache;
  const extra: string[] = [];
  if (setupModule !== undefined) {
    try {
      extra.push(req.resolve(setupModule));
    } catch {
      // Unresolvable setup module: load() reports it.
    }
  }
  for (const key of Object.keys(cache)) {
    if (underDir(key, dirs) || extra.includes(key)) delete cache[key];
  }
}

export class InProcessExecutor implements Executor {
  readonly mechanism: ExecutorMechanism = "in-process";

  private readonly options: InProcessExecutorOptions;
  private readonly open_ = new Map<string, InProcessSide>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(options: InProcessExecutorOptions) {
    // Runtime check as well: the type says `true`, but callers can be untyped.
    if ((options as { acknowledgeUnsandboxed?: unknown }).acknowledgeUnsandboxed !== true) {
      throw new Error("InProcessExecutor runs package code without a sandbox: pass acknowledgeUnsandboxed: true");
    }
    this.options = options;
  }

  /** Runs `task` after every earlier task finished; never rejects the queue itself. */
  enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Nothing to probe: there is no sandbox to start. */
  probe(): Promise<Result<void, ExecutorError>> {
    return Promise.resolve(ok(undefined));
  }

  open(spec: SideSpec): Promise<Result<SideHandle, ExecutorError>> {
    return this.enqueue(() => {
      if (this.disposed) return fail<SideHandle>({ kind: "unloadable-module", message: "the executor is disposed" });
      const key = resolvePath(spec.packageDir).toLowerCase();
      for (const [k, side] of this.open_) {
        if (k === key || side.spec.side === spec.side) {
          return fail<SideHandle>({
            kind: "unloadable-module",
            message:
              k === key
                ? "the package directory is already open: each side needs its own directory to get its own module instance"
                : `the ${spec.side} side is already open`,
          });
        }
      }
      const side = new InProcessSide(this, spec, this.options, () => {
        this.open_.delete(key);
      });
      const loaded = side.load();
      if (!loaded.ok) return fail<SideHandle>(loaded.error);
      this.open_.set(key, side);
      return ok<SideHandle>(side);
    });
  }

  async dispose(): Promise<void> {
    await this.enqueue(() => {
      this.disposed = true;
      for (const side of [...this.open_.values()]) side.closeNow();
      this.open_.clear();
    });
  }
}

class InProcessSide implements SideHandle {
  readonly spec: SideSpec;
  private runtime: SideRuntime | undefined;
  private closed = false;
  private restartEvents = 0;

  constructor(
    private readonly executor: InProcessExecutor,
    spec: SideSpec,
    private readonly options: InProcessExecutorOptions,
    private readonly onClose: () => void,
  ) {
    this.spec = spec;
  }

  /** Creates a fresh SideRuntime (fresh module instance) and loads the package. */
  load(): Result<void, ExecutorError> {
    evictModules(this.spec.packageDir, this.spec.setupModule);
    const runtime = createSideRuntime({
      packageDir: this.spec.packageDir,
      entryFile: this.spec.entryFile,
      ...(this.spec.setupModule === undefined ? {} : { setupModule: this.spec.setupModule }),
      outputLimitBytes: this.spec.limits.outputLimitBytes,
      ...(this.options.prototypes === undefined ? {} : { prototypes: this.options.prototypes }),
      installStubsGlobally: false,
    });
    const loaded = runtime.load();
    if (!loaded.ok) {
      this.runtime = undefined;
      return fail({ kind: "unloadable-module", message: loaded.error.message });
    }
    this.runtime = runtime;
    return ok(undefined);
  }

  private notOpen(): Result<never, ExecutorError> | undefined {
    if (this.closed || this.runtime === undefined) {
      return fail({ kind: "runner-protocol-error", message: `the ${this.spec.side} side is not open` });
    }
    return undefined;
  }

  listExports(): Promise<Result<ExportsInfo, ExecutorError>> {
    return this.executor.enqueue(() => {
      const bad = this.notOpen();
      if (bad !== undefined) return bad;
      return ok(this.runtime!.listExports());
    });
  }

  call(request: CallRequest): Promise<Result<CallResult, ExecutorError>> {
    return this.executor.enqueue(async () => {
      const bad = this.notOpen();
      if (bad !== undefined) return bad;
      const response = await this.runtime!.call({
        fn: request.fn,
        args: request.args,
        caseSeed: request.caseSeed,
        stubs: request.stubs,
        properties: request.properties.map((p) => ({ id: p.id, modulePath: p.modulePath })),
        timeoutMs: this.spec.limits.callTimeoutMs,
      });
      if (response.propertyError !== undefined) {
        return fail<CallResult>({ kind: "property-error", message: response.propertyError });
      }
      const properties: PropertyResult[] = response.result.properties.map((p) =>
        p.detail === undefined ? { id: p.id, ok: p.ok } : { id: p.id, ok: p.ok, detail: p.detail },
      );
      const result: CallResult = {
        outcome: response.result.outcome,
        properties,
        restoreVerified: response.restoreVerified,
      };
      if (!response.restoreVerified) {
        const restarted = this.restartNow();
        if (!restarted.ok) return fail<CallResult>(restarted.error);
      }
      return ok(result);
    });
  }

  restart(): Promise<Result<void, ExecutorError>> {
    return this.executor.enqueue(() => {
      const bad = this.notOpen();
      if (bad !== undefined) return bad;
      return this.restartNow();
    });
  }

  /** Counts a Restart_Event and reloads the package into a fresh SideRuntime. */
  private restartNow(): Result<void, ExecutorError> {
    const budget = this.options.restartBudget;
    if (!budget.consume("restart-event")) return fail(restartBudgetError(budget));
    this.restartEvents += 1;
    try {
      return this.load();
    } catch (e) {
      return fail({ kind: "unloadable-module", message: messageOf(e) });
    }
  }

  counters(): SideCounters {
    return { restartEvents: this.restartEvents, otherRestarts: 0 };
  }

  close(): Promise<void> {
    return this.executor.enqueue(() => {
      this.closeNow();
    });
  }

  closeNow(): void {
    if (this.closed) return;
    this.closed = true;
    this.runtime = undefined;
    evictModules(this.spec.packageDir, this.spec.setupModule);
    this.onClose();
  }
}

export function createInProcessExecutorFactory(
  extra: Pick<InProcessExecutorOptions, "acknowledgeUnsandboxed" | "prototypes">,
): ExecutorFactory {
  return {
    create: (options: ExecutorOptions): Executor => new InProcessExecutor({ ...extra, ...options }),
  };
}
