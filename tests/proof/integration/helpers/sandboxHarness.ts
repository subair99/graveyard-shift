// Helpers for the sandbox integration tests (task 18.1; Requirements 15.1, 15.6).
//
// `withExecutor(pkg, fn)` builds a temp work dir, writes or copies a small CommonJS package into
// it, creates a real Sandbox_Executor with the standard options, opens a side, runs `fn` and
// always cleans up: the executor is disposed (which kills every child) and the temp dir is
// removed, also when `fn` throws.
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { decodeNode } from "../../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../../src/proof/child/codec/encode";
import { createSandboxExecutorFactory } from "../../../../src/proof/shell/executor/sandboxExecutor";
import { createRestartBudget } from "../../../../src/proof/shell/executor/types";
import type {
  CallRequest,
  CallResult,
  Executor,
  ExportsInfo,
  RestartBudget,
  Side,
  SideCounters,
  SideHandle,
  SideLimits,
} from "../../../../src/proof/shell/executor/types";
import type { EncodedNode } from "../../../../src/proof/types";

export const FIXTURES_DIR = join(__dirname, "..", "fixtures");

/** A fixture name under tests/proof/integration/fixtures, or a map of file name to source. */
export type PackageSource = string | Readonly<Record<string, string>>;

export interface HarnessOptions {
  /** Shared restart maximum (Requirement 16.4). Default 10. */
  maxRestarts?: number;
  /** Default 5000 ms; fixtures use shorter timers of their own. */
  limits?: Partial<SideLimits>;
  /** Extra read grants for the sides. Default none. */
  readPaths?: readonly string[];
  /** Entry file inside the package. Default `index.js`. */
  entry?: string;
  /** Hard-kill grace after the call timeout. Default: the executor's. */
  killGraceMs?: number;
}

const STUBS = { date: true, random: true } as const;

export function enc(value: unknown): EncodedNode {
  const r = encodeValue(value, { budget: 100000 });
  if (!r.ok) throw new Error("the test value could not be encoded");
  return r.node;
}

export function makeRequest(fn: string, args: readonly unknown[] = [], caseSeed = 1): CallRequest {
  return { fn, args: args.map(enc), caseSeed, stubs: { ...STUBS }, properties: [] };
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForExit(pid: number, attempts = 60): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (!isRunning(pid)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return !isRunning(pid);
}

function removeDir(dir: string): void {
  // Windows can hold a handle for a moment after a child exits.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** One opened side with convenience wrappers. */
export interface OpenedSide {
  readonly side: Side;
  readonly handle: SideHandle;
  /** The package directory (real path) inside the temp root. */
  readonly packageDir: string;
  /** The raw call result; throws on an executor error. */
  call(fn: string, args?: readonly unknown[], caseSeed?: number): Promise<CallResult>;
  /** The decoded return value; throws unless the outcome is `returned`. */
  callValue(fn: string, args?: readonly unknown[]): Promise<unknown>;
  exports(): Promise<ExportsInfo>;
  counters(): SideCounters;
}

export interface SandboxContext {
  /** Real path of the temp root; removed on cleanup. */
  readonly root: string;
  /** A directory under the root, outside every package directory (for write and read probes). */
  readonly scratchDir: string;
  readonly executor: Executor;
  readonly budget: RestartBudget;
  /** The first side, opened as `original`. */
  readonly side: OpenedSide;
  /** Opens a further side (default `resurrection`) from another package. */
  open(pkg: PackageSource, side?: Side): Promise<OpenedSide>;
}

export interface SandboxHarness {
  readonly root: string;
  readonly scratchDir: string;
  readonly executor: Executor;
  readonly budget: RestartBudget;
  open(pkg: PackageSource, side?: Side): Promise<OpenedSide>;
  /** Disposes the executor (kills every child) and removes the temp root. Safe to call twice. */
  cleanup(): Promise<void>;
}

/** Creates the temp root and the executor. The caller must call `cleanup` (use `withExecutor`). */
export function createHarness(options: HarnessOptions = {}): SandboxHarness {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-int-")));
  const scratchDir = join(root, "scratch");
  mkdirSync(scratchDir);
  const budget = createRestartBudget(options.maxRestarts ?? 10);
  const factory = createSandboxExecutorFactory(
    options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs },
  );
  const executor = factory.create({ restartBudget: budget });
  const limits: SideLimits = { callTimeoutMs: 5000, heapLimitMb: 256, outputLimitBytes: 100000, ...options.limits };
  const entry = options.entry ?? "index.js";
  let counter = 0;
  let cleaned = false;

  function placePackage(pkg: PackageSource): string {
    const dir = join(root, `pkg${counter++}`);
    if (typeof pkg === "string") {
      const from = join(FIXTURES_DIR, pkg);
      if (!existsSync(from)) throw new Error(`unknown fixture package: ${pkg}`);
      cpSync(from, dir, { recursive: true });
    } else {
      mkdirSync(dir);
      for (const [name, source] of Object.entries(pkg)) {
        const file = join(dir, name);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, source);
      }
      if (!(name_in(pkg, "package.json"))) {
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ name: "gs-synthetic", version: "1.0.0", main: entry }),
        );
      }
    }
    return realpathSync.native(dir);
  }

  async function open(pkg: PackageSource, side: Side = "resurrection"): Promise<OpenedSide> {
    const packageDir = placePackage(pkg);
    const opened = await executor.open({
      side,
      packageDir,
      entryFile: join(packageDir, entry),
      readPaths: options.readPaths ?? [],
      limits,
    });
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}: ${opened.error.message}`);
    const handle = opened.value;
    const call = async (fn: string, args: readonly unknown[] = [], caseSeed = 1): Promise<CallResult> => {
      const r = await handle.call(makeRequest(fn, args, caseSeed));
      if (!r.ok) throw new Error(`call failed: ${r.error.kind}: ${r.error.message}`);
      return r.value;
    };
    return {
      side,
      handle,
      packageDir,
      call,
      async callValue(fn, args = []) {
        const r = await call(fn, args);
        if (r.outcome.kind !== "returned") throw new Error(`unexpected outcome: ${r.outcome.kind}`);
        return decodeNode(r.outcome.value);
      },
      async exports() {
        const r = await handle.listExports();
        if (!r.ok) throw new Error(`exports failed: ${r.error.kind}: ${r.error.message}`);
        return r.value;
      },
      counters: () => handle.counters(),
    };
  }

  return {
    root,
    scratchDir,
    executor,
    budget,
    open,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        await executor.dispose();
      } finally {
        removeDir(root);
      }
    },
  };
}

function name_in(files: Readonly<Record<string, string>>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, name);
}

/**
 * Opens `pkg` as the original side of a real Sandbox_Executor, runs `fn`, and always cleans up
 * (children killed, temp dir removed) in `finally`.
 */
export async function withExecutor<T>(
  pkg: PackageSource,
  fn: (ctx: SandboxContext) => Promise<T>,
  options: HarnessOptions = {},
): Promise<T> {
  const harness = createHarness(options);
  try {
    const side = await harness.open(pkg, "original");
    return await fn({
      root: harness.root,
      scratchDir: harness.scratchDir,
      executor: harness.executor,
      budget: harness.budget,
      side,
      open: harness.open,
    });
  } finally {
    await harness.cleanup();
  }
}

/** Environment variable names the child sees (needs the `env-probe` fixture). */
export async function readChildEnvKeys(side: OpenedSide): Promise<string[]> {
  return (await side.callValue("envKeys")) as string[];
}

export interface ChildPermissions {
  enabled: boolean;
  write: boolean | string;
  net: boolean | string;
  child: boolean | string;
  worker: boolean | string;
}

/** What `process.permission.has` reports inside the child (needs the `env-probe` fixture). */
export async function readChildPermissions(side: OpenedSide): Promise<ChildPermissions> {
  return (await side.callValue("permissions")) as ChildPermissions;
}
