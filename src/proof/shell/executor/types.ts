// Executor interface shared by the Sandbox_Executor and the InProcess_Executor (design:
// "Executor interface"). Types and two tiny pure helpers (createRestartBudget, restartBudgetError).
// No node imports, no clock, no I/O.
//
// "Run a delta property" (Requirement 5.1) is realized as `CallRequest.properties`: the property
// modules run inside the call, on the Prototype_Delta of that call (Requirement 11.7).

import type { EncodedNode, HarnessError, Outcome, Result } from "../../types";

export type Side = "original" | "resurrection";
export type ExecutorMechanism = "node-permission" | "in-process";

// ---------------------------------------------------------------------------
// Restart budget (Requirements 5.13, 5.14, 16.4)
// ---------------------------------------------------------------------------

/** Why a child was restarted. Both kinds count toward the shared maximum (Requirement 16.4). */
export type RestartKind = "restart-event" | "other";

/** Per-side restart counters reported in the Proof_Report `sandbox` entry. */
export interface SideCounters {
  /** Restarts because a prototype restoration could not be verified (Requirement 5.12). */
  restartEvents: number;
  /** Restarts after a timeout kill or a crash. */
  otherRestarts: number;
}

/**
 * Budget shared by both sides of one run. `consume` counts one restart and returns `false`,
 * without counting, when the maximum is already used up. A Restart_Event counts toward the
 * maximum like any other restart (Requirement 5.14); the two counters are kept apart for the
 * report (Requirement 5.13).
 */
export interface RestartBudget {
  readonly max: number;
  /** restartEvents() + otherRestarts(). Never exceeds `max`. */
  used(): number;
  restartEvents(): number;
  otherRestarts(): number;
  consume(kind: RestartKind): boolean;
}

/** `max` must be a non-negative integer; anything else is a caller bug. */
export function createRestartBudget(max: number): RestartBudget {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new RangeError("restart budget maximum must be a non-negative integer");
  }
  let events = 0;
  let others = 0;
  return {
    max,
    used: () => events + others,
    restartEvents: () => events,
    otherRestarts: () => others,
    consume(kind: RestartKind): boolean {
      if (events + others >= max) return false;
      if (kind === "restart-event") events += 1;
      else others += 1;
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ExecutorErrorKind =
  | "sandbox-unavailable"
  | "unloadable-module"
  | "too-many-crashes"
  | "runner-protocol-error"
  | "property-error";

export interface ExecutorError {
  kind: ExecutorErrorKind;
  message: string;
}

/** Error returned when `RestartBudget.consume` is refused (Requirement 16.4). */
export function restartBudgetError(budget: RestartBudget): ExecutorError {
  return {
    kind: "too-many-crashes",
    message: `the maximum of ${budget.max} child process restarts was exceeded`,
  };
}

/** An ExecutorError is a HarnessError without a function name. */
export function toHarnessError(error: ExecutorError, fn?: string): HarnessError {
  return fn === undefined
    ? { kind: error.kind, message: error.message }
    : { kind: error.kind, function: fn, message: error.message };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ExecutorOptions {
  /** Shared by both sides; counts restarts toward Requirement 16.4. */
  restartBudget: RestartBudget;
}

export interface ExecutorFactory {
  create(options: ExecutorOptions): Executor;
}

export interface Executor {
  readonly mechanism: ExecutorMechanism;
  /** `sandbox-unavailable` when the sandbox flags cannot start. */
  probe(): Promise<Result<void, ExecutorError>>;
  /** Spawns or loads the module of one side. */
  open(spec: SideSpec): Promise<Result<SideHandle, ExecutorError>>;
  /** Closes every open side. */
  dispose(): Promise<void>;
}

export interface SideLimits {
  callTimeoutMs: number;
  heapLimitMb: number;
  outputLimitBytes: number;
}

export interface SideSpec {
  side: Side;
  /** The copy under the work root (Requirement 4.6); the only package-readable directory. */
  packageDir: string;
  /** Absolute, resolved by entry.ts. */
  entryFile: string;
  setupModule?: string;
  /** Sandbox-side module files or directories to grant read access to. */
  readPaths: readonly string[];
  limits: SideLimits;
}

export interface LoadResult {
  /** True once the module loaded and, if given, the setup module ran. */
  loaded: true;
}

export interface ExportEntry {
  name: string;
  type: string;
  fnName?: string;
  arity?: number;
  primitive?: EncodedNode;
}

/** Entries are sorted by name (code point). */
export interface ExportsInfo {
  entries: readonly ExportEntry[];
}

export interface PropertyRef {
  id: string;
  modulePath: string;
}

export interface PropertyResult {
  id: string;
  ok: boolean;
  detail?: EncodedNode;
}

export interface CallRequest {
  /** Export name, or `default`. */
  fn: string;
  args: readonly EncodedNode[];
  /** int32, seeds Math.random for this call. */
  caseSeed: number;
  stubs: { date: boolean; random: boolean };
  /** Delta properties that run inside this call, after restoration of the prototypes. */
  properties: readonly PropertyRef[];
}

/** Information about a child that died during the call; absent when the child survived. */
export interface CrashInfo {
  /** `timeout` is a parent kill after the grace period; `crash` is any other exit. */
  reason: "timeout" | "crash";
  exitCode?: number;
  signal?: string;
}

export interface CallResult {
  outcome: Outcome;
  properties: readonly PropertyResult[];
  /** False when the second Prototype_Snapshot differed (Requirement 5.12); a Restart_Event follows. */
  restoreVerified: boolean;
  crash?: CrashInfo;
}

export interface SideHandle {
  listExports(): Promise<Result<ExportsInfo, ExecutorError>>;
  call(request: CallRequest): Promise<Result<CallResult, ExecutorError>>;
  /** Explicit restart, counted as a Restart_Event. */
  restart(): Promise<Result<void, ExecutorError>>;
  counters(): SideCounters;
  close(): Promise<void>;
}
