// Orchestrator `runProofOfLife` (design: "Orchestrator"; Requirements 1 to 4, 8.1 to 8.4, 10.1, 12,
// 13.25 to 13.30, 16.1, 16.4).
//
// Steps: validate the request (throws RequestValidationError before any I/O); create the work
// directory; verify the Original tarball integrity BEFORE anything is extracted or run; extract the
// Original; prepare the Resurrection (copy or extract) and compute its Tree_Hash; resolve both
// entries; probe and open the executor; list exports and compare the API surface; determine the
// Haunting_Radius; run the driver per function in code point order; build the report. The work
// directory is always removed and the executor always disposed, in `finally`.
//
// Apart from a RequestValidationError, nothing here throws: every failure becomes a HarnessError
// in the returned report. A harness error always gives Verdict `inconclusive` (Requirement 12.4),
// is never hidden and never produces `alive`.
//
// `defaultProofDeps()` is the only place in `src/proof` that reads `process.env` (Requirement
// 13.25). The Identity_Values are derived from `deps.env` once, at the start of a run, and every
// log line and error message goes through the one emitter (Requirement 13.28).

import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as fc from "fast-check";
import { z } from "zod";
import { compareCodePoints } from "../child/codec/order";
import { compareApiSurface, type ExportEntry as ApiEntry } from "../core/apiSurface";
import { identityValuesFromEnv, type IdentityValues, type Platform } from "../core/identity";
import { buildRootMatcher, normalizeText, type SideRoots } from "../core/normalize";
import { redactErrorText, type PathContext } from "../core/redact";
import { buildReport, fallbackReport, type RawDivergence, type ReportInput } from "../core/report";
import { canonicalReportJson } from "../serialize/canonicalReport";
import {
  RequestValidationError,
  type DeltaReport,
  type ExcludedFunction,
  type FunctionHarness,
  type HarnessError,
  type HarnessErrorKind,
  type ProofDeps,
  type ProofReport,
  type ProofRequest,
  type ProofRun,
  type UnencodableCount,
} from "../types";
import { runFunction, type NonDeterministicFinding } from "./driver";
import { createEmitter, stderrSink, type Emitter } from "./emit";
import { resolveEntry } from "./entry";
import { createSandboxExecutorFactory } from "./executor/sandboxExecutor";
import { createRestartBudget } from "./executor/types";
import type { Executor, ExecutorError, Side, SideHandle } from "./executor/types";
import { verifyIntegrity } from "./integrity";
import { extractTarball, type ExtractError } from "./tarball/tarballExtractor";
import { computeDirectoryTreeHash, computeTreeHash } from "./treeHash";
import { copyResurrectionDirectory, createWorkDir, type WorkDir } from "./workDir";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * The I/O seams with their production values. The environment snapshot is taken here, once; this
 * is the only place in `src/proof` that reads `process.env`.
 */
export function defaultProofDeps(): ProofDeps {
  const env: Record<string, string | undefined> = { ...process.env };
  const tmpDir = os.tmpdir();
  return {
    tempRoot: tmpDir,
    toolVersions: { node: process.version, fastCheck: fc.__version },
    platform: process.platform === "win32" ? "win32" : "posix",
    knownPaths: { nodeDir: path.dirname(process.execPath), tmpDir },
    env,
    sink: stderrSink,
  };
}

// ---------------------------------------------------------------------------
// Request validation (Requirement 1.5)
// ---------------------------------------------------------------------------

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const functionValue = z.custom<(...args: never[]) => unknown>(
  (v) => typeof v === "function",
  "must be a function",
);
const arbitraryValue = z.custom<unknown>(
  (v) => typeof v === "object" && v !== null && typeof (v as { generate?: unknown }).generate === "function",
  "must be a fast-check arbitrary",
);
const absolutePath = z
  .string()
  .min(1)
  .refine((p) => path.isAbsolute(p), "must be an absolute path");
const caseTuples = z.array(z.array(z.unknown()));
const positiveInt = z.number().int().min(1);

const functionHarnessSchema = z
  .object({
    args: arbitraryValue,
    accept: functionValue.optional(),
    explicitCases: caseTuples.optional(),
    caseCount: positiveInt.optional(),
    stubs: z.object({ date: z.boolean().optional(), random: z.boolean().optional() }).strict().optional(),
  })
  .strict();

const excludedSchema = z.object({ excluded: z.literal(true), reason: z.string() }).strict();

const deltaSchema = z
  .object({
    id: z.string().min(1),
    function: z.string().min(1),
    predicate: functionValue,
    propertyModule: absolutePath,
    explicitCases: caseTuples,
    generator: arbitraryValue.optional(),
    caseCount: positiveInt.optional(),
  })
  .strict();

const harnessSchema = z
  .object({
    package: z.string(),
    seed: z.number().int().min(INT32_MIN).max(INT32_MAX),
    caseCount: positiveInt,
    perCallTimeoutMs: z.number().min(1),
    heapLimitMb: z.number().min(1),
    outputLimitBytes: z.number().min(1),
    maxRestarts: z.number().int().min(0),
    shrinkBudget: z.number().int().min(0),
    functions: z.record(z.string(), z.union([excludedSchema, functionHarnessSchema])),
    deltas: z.array(deltaSchema),
    setupModule: absolutePath.optional(),
    setupModules: z.object({ original: absolutePath.optional(), resurrection: absolutePath.optional() }).strict().optional(),
    readPaths: z.array(absolutePath).optional(),
  })
  .strict();

const requestSchema = z
  .object({
    original: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        tarballPath: z.string().min(1),
        integrity: z.string(),
      })
      .strict(),
    resurrection: z.object({ kind: z.enum(["directory", "tarball"]), path: z.string().min(1) }).strict(),
    haunting: z.array(z.string()).optional(),
    harness: harnessSchema,
    executorFactory: z
      .custom<unknown>(
        (v) => typeof v === "object" && v !== null && typeof (v as { create?: unknown }).create === "function",
        "must be an ExecutorFactory",
      )
      .optional(),
  })
  .strict();

/**
 * Validates the request without any I/O. Throws `RequestValidationError` naming the first invalid
 * field. The message goes through `emit` when one is given, so it is identity-redacted.
 */
export function validateRequest(request: unknown, emit: (text: string) => string = (t) => t): ProofRequest {
  const parsed = requestSchema.safeParse(request);
  if (parsed.success) return request as ProofRequest;
  const issue = parsed.error.issues[0];
  const field = issue === undefined || issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
  throw new RequestValidationError(field, emit(`invalid request, field ${field}: ${issue?.message ?? "invalid"}`));
}

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

interface SideCounts {
  original: number;
  resurrection: number;
}

interface Ctx {
  request: ProofRequest;
  deps: ProofDeps;
  identity: IdentityValues;
  emit: Emitter;
  errors: HarnessError[];
  verified: boolean;
  treeHash: string | null;
  executor: Executor | undefined;
  handles: Partial<Record<Side, SideHandle>>;
  work: WorkDir | undefined;
  roots: { original: SideRoots; resurrection: SideRoots };
  pathContext: PathContext;
  restartEvents: SideCounts;
  otherRestarts: SideCounts;
  tested: string[];
  cases: { function: string; cases: number }[];
  unencodable: UnencodableCount[];
  excluded: { function: string; reason: string }[];
  nonDeterministic: NonDeterministicFinding[];
  divergences: RawDivergence[];
  deltas: DeltaReport[];
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptyPathContext(deps: ProofDeps, identity: IdentityValues): PathContext {
  return {
    caseInsensitive: deps.platform === "win32",
    knownPaths: { work: "", nodeDir: deps.knownPaths.nodeDir, tmpDir: deps.knownPaths.tmpDir, tempNames: [] },
    identityPaths: identity.pathValues,
  };
}

/** Records a harness error. The message goes through `emit`; `redactPaths` adds the Path_Redactor. */
function addError(
  ctx: Ctx,
  kind: HarnessErrorKind,
  message: string,
  options: { fn?: string; redactPaths?: boolean; side?: Side } = {},
): void {
  let text = message;
  if (options.side !== undefined) {
    text = normalizeText(text, buildRootMatcher(ctx.roots[options.side], ctx.deps.platform === "win32"));
  }
  if (options.redactPaths === true) text = redactErrorText(text, ctx.pathContext);
  const error: HarnessError =
    options.fn === undefined
      ? { kind, message: ctx.emit(text) }
      : { kind, function: options.fn, message: ctx.emit(text) };
  ctx.errors.push(error);
}

function addExecutorError(ctx: Ctx, error: ExecutorError, side?: Side, fn?: string): void {
  addError(ctx, error.kind, error.message, {
    redactPaths: true,
    ...(side === undefined ? {} : { side }),
    ...(fn === undefined ? {} : { fn }),
  });
}

function addExtractError(ctx: Ctx, which: string, error: ExtractError): void {
  if (error.kind === "unsafe-archive") {
    addError(ctx, "unsafe-archive", `the ${which} archive has an unsafe entry (${error.reason}): ${error.entry}`);
  } else if (error.kind === "archive-too-large") {
    addError(ctx, "archive-too-large", `the ${which} archive exceeds the ${error.limit} size limit`);
  } else {
    addError(ctx, "invalid-archive", `the ${which} archive is not valid (${error.reason})`);
  }
}

function isExcluded(h: FunctionHarness | ExcludedFunction): h is ExcludedFunction {
  return "excluded" in h;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function prepareSides(ctx: Ctx): Promise<{ original: string; resurrection: string } | undefined> {
  const { request, deps } = ctx;

  let work: WorkDir;
  try {
    work = createWorkDir({ tempRoot: deps.tempRoot });
  } catch (e) {
    addError(ctx, "harness-config-error", `the temporary work directory could not be created: ${messageOf(e)}`, {
      redactPaths: true,
    });
    return undefined;
  }
  ctx.work = work;
  ctx.pathContext = {
    caseInsensitive: deps.platform === "win32",
    knownPaths: {
      work: work.roots.real,
      nodeDir: deps.knownPaths.nodeDir,
      tmpDir: deps.knownPaths.tmpDir,
      tempNames: [path.basename(work.roots.created)],
    },
    identityPaths: ctx.identity.pathValues,
  };

  // Integrity of the Original, before anything is extracted or run (Requirements 2.1 to 2.3).
  let originalBytes: Uint8Array;
  try {
    originalBytes = await readFile(request.original.tarballPath);
  } catch {
    addError(ctx, "harness-config-error", "the Original tarball could not be read");
    return undefined;
  }
  const verified = verifyIntegrity(originalBytes, request.original.integrity);
  if (!verified.ok) {
    addError(ctx, verified.error.kind, verified.error.message);
    return undefined;
  }
  ctx.verified = true;

  // Extract the Original (Requirement 3.1).
  const originalDir = work.sideDir("o");
  ctx.roots.original = { created: originalDir.created, real: originalDir.real };
  const extractedOriginal = await extractTarball(originalBytes, originalDir.real);
  if (!extractedOriginal.ok) {
    addExtractError(ctx, "Original", extractedOriginal.error);
    return undefined;
  }

  // Prepare the Resurrection (Requirements 4.1 to 4.6).
  const resurrectionDir = work.sideDir("r");
  ctx.roots.resurrection = { created: resurrectionDir.created, real: resurrectionDir.real };
  if (request.resurrection.kind === "tarball") {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(request.resurrection.path);
    } catch {
      addError(ctx, "harness-config-error", "the Resurrection tarball could not be read");
      return undefined;
    }
    const extracted = await extractTarball(bytes, resurrectionDir.real);
    if (!extracted.ok) {
      addExtractError(ctx, "Resurrection", extracted.error);
      return undefined;
    }
    ctx.treeHash = computeTreeHash(extracted.value.map((f) => ({ path: f.path, bytes: f.bytes })));
  } else {
    try {
      const copied = copyResurrectionDirectory(request.resurrection.path, resurrectionDir.real);
      if (!copied.ok) {
        addError(ctx, copied.error.kind, copied.error.message);
        return undefined;
      }
    } catch {
      addError(ctx, "harness-config-error", "the Resurrection directory could not be read");
      return undefined;
    }
    const hashed = await computeDirectoryTreeHash(resurrectionDir.real);
    if (!hashed.ok) {
      addError(ctx, hashed.error.kind, hashed.error.message);
      return undefined;
    }
    ctx.treeHash = hashed.value;
  }

  // Resolve both entries before any child starts (Requirements 3.4, 3.5).
  const entries: Record<Side, string> = { original: "", resurrection: "" };
  let failed = false;
  for (const [side, dir] of [
    ["original", originalDir.real],
    ["resurrection", resurrectionDir.real],
  ] as const) {
    const resolved = resolveEntry(dir);
    if (!resolved.ok) {
      addError(ctx, resolved.error.kind, `${side}: ${resolved.error.message}`);
      failed = true;
    } else {
      entries[side] = resolved.value.entryFile;
    }
  }
  if (failed) return undefined;
  return { original: entries.original, resurrection: entries.resurrection };
}

async function openSides(
  ctx: Ctx,
  executor: Executor,
  entries: { original: string; resurrection: string },
): Promise<boolean> {
  const { harness } = ctx.request;
  const probed = await executor.probe();
  if (!probed.ok) {
    addExecutorError(ctx, probed.error);
    return false;
  }
  for (const side of ["original", "resurrection"] as const) {
    const setup = harness.setupModules?.[side] ?? harness.setupModule;
    const roots = ctx.roots[side];
    const opened = await executor.open({
      side,
      packageDir: roots.real ?? roots.created,
      entryFile: entries[side],
      ...(setup === undefined ? {} : { setupModule: setup }),
      readPaths: harness.readPaths ?? [],
      limits: {
        callTimeoutMs: harness.perCallTimeoutMs,
        heapLimitMb: harness.heapLimitMb,
        outputLimitBytes: harness.outputLimitBytes,
      },
    });
    if (!opened.ok) {
      addExecutorError(ctx, opened.error, side);
      return false;
    }
    ctx.handles[side] = opened.value;
  }
  return true;
}

async function listEntries(ctx: Ctx, side: Side): Promise<ApiEntry[] | undefined> {
  const handle = ctx.handles[side];
  if (handle === undefined) return undefined;
  const listed = await handle.listExports();
  if (!listed.ok) {
    addExecutorError(ctx, listed.error, side);
    return undefined;
  }
  return listed.value.entries.map((e): ApiEntry => ({ ...e }));
}

const FATAL_KINDS: ReadonlySet<HarnessErrorKind> = new Set<HarnessErrorKind>([
  "too-many-crashes",
  "runner-protocol-error",
  "sandbox-unavailable",
]);

async function execute(ctx: Ctx): Promise<void> {
  const { request } = ctx;
  const { harness } = request;

  // The executor object is created first so the report names its mechanism; creating it starts
  // nothing. Nothing is opened before the integrity check passed.
  // Default: the Sandbox_Executor. Tests inject another factory.
  const factory = request.executorFactory ?? createSandboxExecutorFactory();
  try {
    ctx.executor = factory.create({ restartBudget: createRestartBudget(harness.maxRestarts) });
  } catch (e) {
    addError(ctx, "sandbox-unavailable", `the executor could not be created: ${messageOf(e)}`, { redactPaths: true });
    return;
  }

  const entries = await prepareSides(ctx);
  if (entries === undefined) return;

  const executor = ctx.executor;
  if (executor === undefined) return;
  if (!(await openSides(ctx, executor, entries))) return;

  const originalEntries = await listEntries(ctx, "original");
  const resurrectionEntries = await listEntries(ctx, "resurrection");
  if (originalEntries === undefined || resurrectionEntries === undefined) return;

  // Haunting_Radius (Requirements 8.1 to 8.3).
  const originalFunctions = new Set(originalEntries.filter((e) => e.type === "function").map((e) => e.name));
  const radius = [...new Set(request.haunting ?? [...originalFunctions])].sort(compareCodePoints);

  // API surface (Requirement 10.1): every difference is a Divergence, whatever the radius.
  for (const d of compareApiSurface(
    originalEntries,
    resurrectionEntries,
    request.haunting === undefined ? undefined : radius,
  )) {
    ctx.divergences.push({ function: d.function, kind: "api-surface", apiSurface: d.apiSurface });
  }

  for (const [name, h] of Object.entries(harness.functions)) {
    if (isExcluded(h)) ctx.excluded.push({ function: name, reason: h.reason });
  }
  ctx.excluded.sort((a, b) => compareCodePoints(a.function, b.function));

  let preRunFailed = false;
  for (const fn of radius) {
    if (!originalFunctions.has(fn)) {
      addError(ctx, "unknown-function", `"${fn}" is not an exported function of the Original`, { fn });
      preRunFailed = true;
    }
  }
  const testable: string[] = [];
  for (const fn of radius) {
    if (!originalFunctions.has(fn)) continue;
    const h = Object.hasOwn(harness.functions, fn) ? harness.functions[fn] : undefined;
    if (h === undefined) {
      addError(ctx, "missing-generator", `no generator is defined for "${fn}" and it is not excluded`, { fn });
      preRunFailed = true;
    } else if (!isExcluded(h)) {
      testable.push(fn);
    }
  }
  for (const d of harness.deltas) {
    // A delta for a function that is not run could never be demonstrated; say so instead of dropping it.
    if (!testable.includes(d.function)) {
      addError(ctx, "harness-config-error", `delta "${d.id}" names function "${d.function}", which is not tested`, {
        fn: d.function,
      });
      preRunFailed = true;
    }
  }
  if (preRunFailed) return;
  if (testable.length === 0) {
    addError(ctx, "no-functions-tested", "no function was tested: the Haunting_Radius is empty or every function is excluded");
    return;
  }

  const original = ctx.handles.original;
  const resurrection = ctx.handles.resurrection;
  if (original === undefined || resurrection === undefined) return;

  for (const fn of testable) {
    const h = harness.functions[fn];
    if (h === undefined || isExcluded(h)) continue;
    const result = await runFunction(
      fn,
      h,
      { original, resurrection },
      {
        seed: harness.seed,
        caseCount: harness.caseCount,
        shrinkBudget: harness.shrinkBudget,
        deltas: harness.deltas,
        roots: ctx.roots,
        pathContext: ctx.pathContext,
      },
    );
    ctx.tested.push(fn);
    ctx.cases.push({ function: fn, cases: result.cases });
    ctx.unencodable.push(result.unencodable);
    if (result.nonDeterministic !== null) ctx.nonDeterministic.push(result.nonDeterministic);
    ctx.divergences.push(...result.divergences);
    ctx.deltas.push(...result.deltas);
    for (const e of result.harnessErrors) {
      addError(ctx, e.kind, e.message, { fn: e.function ?? fn });
    }
    if (result.harnessErrors.some((e) => FATAL_KINDS.has(e.kind))) break;
  }
}

/** Reads the counters, then disposes the executor and removes the work directory. Never throws. */
async function teardown(ctx: Ctx): Promise<void> {
  for (const side of ["original", "resurrection"] as const) {
    try {
      const counters = ctx.handles[side]?.counters();
      if (counters !== undefined) {
        ctx.restartEvents[side] = counters.restartEvents;
        ctx.otherRestarts[side] = counters.otherRestarts;
      }
    } catch {
      // Counters are best effort; the run result does not depend on them.
    }
  }
  try {
    await ctx.executor?.dispose();
  } catch (e) {
    addError(ctx, "harness-config-error", `the executor could not be disposed: ${messageOf(e)}`, {
      redactPaths: true,
    });
  }
  if (ctx.work !== undefined) {
    const cleaned = await ctx.work.cleanup();
    if (!cleaned.ok) {
      addError(ctx, "harness-config-error", cleaned.error, { redactPaths: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function reportInput(ctx: Ctx, extraErrors: readonly HarnessError[]): ReportInput {
  const { request, deps } = ctx;
  const { harness } = request;
  const platform: Platform = deps.platform;
  return {
    package: { name: request.original.name, version: request.original.version },
    original: { integrity: request.original.integrity, verified: ctx.verified },
    resurrection: { source: request.resurrection.kind, treeHash: ctx.treeHash },
    sandbox: {
      mechanism: ctx.executor?.mechanism ?? "node-permission",
      restartEvents: { ...ctx.restartEvents },
      otherRestarts: { ...ctx.otherRestarts },
      limits: {
        callTimeoutMs: harness.perCallTimeoutMs,
        heapLimitMb: harness.heapLimitMb,
        outputLimitBytes: harness.outputLimitBytes,
        maxRestarts: harness.maxRestarts,
        casesRequested: harness.caseCount,
        shrinkBudget: harness.shrinkBudget,
      },
    },
    functionsTested: ctx.tested,
    casesPerFunction: ctx.cases,
    unencodableValues: ctx.unencodable,
    excludedFunctions: ctx.excluded,
    nonDeterministicFunctions: ctx.nonDeterministic.map((n) => ({
      function: n.function,
      args: n.args,
      differences: n.differences,
    })),
    divergences: ctx.divergences,
    deltas: ctx.deltas,
    harnessErrors: [...ctx.errors, ...extraErrors],
    seed: harness.seed,
    toolVersions: { node: deps.toolVersions.node, fastCheck: deps.toolVersions.fastCheck },
    roots: ctx.roots,
    otherTempRoots: ctx.work === undefined ? [] : [ctx.work.roots.created, ctx.work.roots.real],
    identity: ctx.identity,
    platform,
    serialize: canonicalReportJson,
  };
}

function build(input: ReportInput): ProofReport {
  try {
    return buildReport(input);
  } catch (e) {
    return fallbackReport(input, {
      kind: "harness-config-error",
      message: `the report could not be built: ${messageOf(e)}`,
    });
  }
}

function finish(ctx: Ctx): ProofRun {
  let report = build(reportInput(ctx, []));
  // The backstop of `emit` found an Identity_Value in a log line or error message (Requirement 13.28).
  if (ctx.emit.leaks() > 0 && !report.harnessErrors.some((e) => e.kind === "identity-leak")) {
    report = build(
      reportInput(ctx, [
        {
          kind: "identity-leak",
          message: "a log line or error message contained an Identity_Value after redaction",
        },
      ]),
    );
  }
  return { report, json: canonicalReportJson(report) };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Runs the Proof of Life. Rejects with `RequestValidationError` for a malformed request, before any
 * file is touched. Every other failure is a harness error inside the returned report.
 */
export async function runProofOfLife(request: ProofRequest, deps?: Partial<ProofDeps>): Promise<ProofRun> {
  const resolved: ProofDeps = { ...defaultProofDeps(), ...deps };
  const identity = identityValuesFromEnv(resolved.env, resolved.platform);
  const emit = createEmitter(identity, resolved.platform, resolved.sink);
  const valid = validateRequest(request, emit);

  const ctx: Ctx = {
    request: valid,
    deps: resolved,
    identity,
    emit,
    errors: [],
    verified: false,
    treeHash: null,
    executor: undefined,
    handles: {},
    work: undefined,
    roots: { original: { created: "" }, resurrection: { created: "" } },
    pathContext: emptyPathContext(resolved, identity),
    restartEvents: { original: 0, resurrection: 0 },
    otherRestarts: { original: 0, resurrection: 0 },
    tested: [],
    cases: [],
    unencodable: [],
    excluded: [],
    nonDeterministic: [],
    divergences: [],
    deltas: [],
  };

  try {
    await execute(ctx);
  } catch (e) {
    addError(ctx, "harness-config-error", `the run failed unexpectedly: ${messageOf(e)}`, { redactPaths: true });
  } finally {
    await teardown(ctx);
  }
  return finish(ctx);
}
