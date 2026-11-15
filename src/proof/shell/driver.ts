// Fast-check driver (design: "Fast-check driver"; Requirements 8.1 to 8.15, 9.2, 9.3, 9.5).
//
// Per function the driver runs up to three kinds of phases, each its own `fc.check` (the explicit
// phase is a plain loop): `explicit`, `generated` and one `delta:<id>` phase per Declared_Delta
// that has a generator. For every argument tuple it encodes the arguments, derives the case seed,
// calls the Original (with the delta properties), repeats that call for the self-consistency
// check, calls the Resurrection, normalizes and path-redacts the Outcomes, and classifies the
// pair. Calls are strictly sequential.
//
// Counting: attempts are numbered in execution order. fast-check stops at the first failing
// attempt and every later attempt of that phase is a shrink attempt, so only attempts up to and
// including the first failing one are Cases. The repeat call and the confirmation run are never
// counted. A candidate skipped by `fc.pre` is not an attempt.
//
// There is NO wall-clock guard here (a synchronous hang cannot be interrupted from the same
// thread, limitation L13), and the deprecated fast-check options `interruptAfterTimeLimit`,
// `markInterruptAsFailure`, `timeout`, `skipAllAfterTimeLimit`, `reporter` and `asyncReporter`
// are not used. The driver adds no `.filter` of its own. `runFunction` never throws: every
// driver or harness error becomes a typed HarnessError in the result.

import * as fc from "fast-check";
import { nodeJson } from "../child/codec/canonical";
import { decodeNode } from "../child/codec/decode";
import { encodeValue } from "../child/codec/encode";
import {
  accumulateCase,
  classifyCase,
  finalizeDelta,
  newDeltaAccumulator,
  type ApplicableDelta,
  type CaseClassification,
  type DeltaAccumulator,
  type PropertyResult as DeltaPropertyResult,
} from "../core/delta";
import { compareOutcomes } from "../core/equal";
import {
  buildRootMatcher,
  normalizeNode,
  normalizeOutcomeWith,
  type RootMatcher,
  type SideRoots,
} from "../core/normalize";
import { redactErrorNodes, redactErrorText, redactOutcome, type PathContext } from "../core/redact";
import type { RawDivergence } from "../core/report";
import { deriveSeed } from "../core/seeds";
import type {
  DeclaredDelta,
  DeltaEntry,
  DeltaReport,
  Difference,
  EncodedDescriptor,
  EncodedNode,
  FunctionHarness,
  HarnessError,
  HarnessErrorKind,
  Outcome,
  Replay,
  UnencodableCount,
} from "../types";
import type { CallRequest, CallResult, PropertyRef, Side, SideHandle } from "./executor/types";

/** Skip budget passed in every `fc.check` call (Requirement 8.12). fast-check's observed default is 100. */
export const MAX_SKIPS_PER_RUN = 100;

/** Default encoding budget for the arguments of one Case (UTF-16 units plus a constant per node). */
export const DEFAULT_ENCODE_BUDGET = 1_048_576;

/** The message of the Error that fast-check creates when a property returns `false`. */
const RETURNED_FALSE_MESSAGE = "Property failed by returning false";

/** The two opened sides of a run (the result of `Executor.open` for each side). */
export interface DriverExecutor {
  original: SideHandle;
  resurrection: SideHandle;
}

export interface DriverOptions {
  /** int32 run seed. */
  seed: number;
  /** Default Case count per function and phase. */
  caseCount: number;
  /** Maximum shrink attempts per failing phase. */
  shrinkBudget: number;
  /** All Declared_Deltas of the run; the driver uses those of the function under test. */
  deltas: readonly DeclaredDelta[];
  /** Temporary package roots of the two sides, for the Root_Normalizer. Default: none. */
  roots?: { original: SideRoots; resurrection: SideRoots };
  /** Path_Redactor context. Default: no known paths, case-sensitive. */
  pathContext?: PathContext;
  /** Default 1_048_576. */
  encodeBudget?: number;
  /** Repeat the Original call of every Case (Requirement 9.2). Default true. */
  selfConsistency?: boolean;
}

export interface PhaseSummary {
  phase: string;
  /** Cases counted in this phase. */
  cases: number;
  /** Executed shrink attempts after the first failing attempt. */
  shrinkAttempts: number;
  /** The shrunk arguments exactly as fast-check produced them, before any redaction. */
  counterexample: readonly unknown[] | null;
}

export interface NonDeterministicFinding {
  function: string;
  args: EncodedNode[];
  differences: Difference[];
}

export interface FunctionRunResult {
  function: string;
  /** Cases for which both sides returned an Outcome, summed over the phases. */
  cases: number;
  unencodable: UnencodableCount;
  /** At most one per phase; empty when the function is flagged non-deterministic. */
  divergences: RawDivergence[];
  nonDeterministic: NonDeterministicFinding | null;
  deltas: DeltaReport[];
  /** The first harness error that stopped the function, or an empty list. */
  harnessErrors: HarnessError[];
  phases: PhaseSummary[];
}

export interface ReplayResult {
  /** The Case at the replay parameters diverged. */
  diverged: boolean;
  /** The arguments fast-check regenerated, before any redaction; null when nothing failed. */
  counterexample: readonly unknown[] | null;
  harnessErrors: HarnessError[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type Reason = "cycle" | "depth" | "getter" | "proxy";
type ReasonCounts = Record<Reason, number>;

function zeroCounts(): ReasonCounts {
  return { cycle: 0, depth: 0, getter: 0, proxy: 0 };
}

type CaseStatus = "pass" | "diverged" | "flaky" | "aborted";

interface Attempt {
  status: CaseStatus;
  args: readonly unknown[];
  argNodes: EncodedNode[];
  original?: Outcome;
  resurrection?: Outcome;
  classification?: CaseClassification;
  unencodable: ReasonCounts;
  applicable: ApplicableDelta[];
}

interface Prepared {
  args: readonly unknown[];
  nodes: EncodedNode[];
}

interface PhaseState {
  name: string;
  attempts: Attempt[];
  /** Index of the first attempt with status `diverged`. */
  firstFail: number | undefined;
  budgetExhausted: boolean;
  /** Delta whose predicate every Case of this phase must satisfy (R8.14). */
  deltaId: string | undefined;
}

interface Ctx {
  fn: string;
  harness: FunctionHarness;
  sides: DriverExecutor;
  options: DriverOptions;
  deltas: readonly DeclaredDelta[];
  matchers: Record<Side, RootMatcher>;
  pathContext: PathContext;
  stubs: { date: boolean; random: boolean };
  stopped: boolean;
  harnessError: HarnessError | undefined;
  flaky: NonDeterministicFinding | undefined;
}

function defaultPathContext(): PathContext {
  return {
    caseInsensitive: false,
    knownPaths: { work: "", nodeDir: "", tmpDir: "", tempNames: [] },
    identityPaths: [],
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fail(ctx: Ctx, kind: HarnessErrorKind, message: string): void {
  ctx.stopped = true;
  ctx.harnessError ??= {
    kind,
    function: ctx.fn,
    message: redactErrorText(message, ctx.pathContext),
  };
}

function freshArgs(nodes: readonly EncodedNode[]): unknown[] {
  return nodes.map((n) => decodeNode(n));
}

// ---------------------------------------------------------------------------
// Unencodable counting
// ---------------------------------------------------------------------------

function countNode(node: EncodedNode, c: ReasonCounts): void {
  switch (node.t) {
    case "unencodable":
      c[node.reason] += 1;
      return;
    case "map":
      for (const [k, v] of node.entries) {
        countNode(k, c);
        countNode(v, c);
      }
      return;
    case "set":
      for (const n of node.items) countNode(n, c);
      return;
    case "error":
    case "object":
      for (const [, v] of node.props) countNode(v, c);
      return;
    case "array":
      for (const e of node.items) countNode(e.n, c);
      for (const [, v] of node.props) countNode(v, c);
      return;
    default:
      return;
  }
}

function countDescriptor(d: EncodedDescriptor | undefined, c: ReasonCounts): void {
  if (d === undefined) return;
  for (const n of [d.value, d.get, d.set]) if (n !== undefined) countNode(n, c);
}

function countDelta(entries: readonly DeltaEntry[] | undefined, c: ReasonCounts): void {
  for (const e of entries ?? []) {
    countDescriptor(e.before, c);
    countDescriptor(e.after, c);
  }
}

function countOutcome(outcome: Outcome, c: ReasonCounts): void {
  if (outcome.kind === "crash" || outcome.kind === "output-too-large") return;
  if (outcome.kind === "timeout") {
    countDelta(outcome.prototypeDelta, c);
    return;
  }
  countNode(outcome.value, c);
  for (const a of outcome.args) countNode(a, c);
  countDelta(outcome.prototypeDelta, c);
}

function sum(c: ReasonCounts): number {
  return c.cycle + c.depth + c.getter + c.proxy;
}

// ---------------------------------------------------------------------------
// One Case
// ---------------------------------------------------------------------------

/** Encodes the arguments. A harness error (stops the function) when an argument cannot be encoded. */
function prepare(args: readonly unknown[], ctx: Ctx): Prepared | undefined {
  const budget = ctx.options.encodeBudget ?? DEFAULT_ENCODE_BUDGET;
  const nodes: EncodedNode[] = [];
  for (let i = 0; i < args.length; i++) {
    let encoded;
    try {
      encoded = encodeValue(args[i], { budget });
    } catch (e) {
      fail(ctx, "harness-config-error", `argument ${i} of "${ctx.fn}" could not be encoded: ${messageOf(e)}`);
      return undefined;
    }
    if (!encoded.ok) {
      fail(ctx, "harness-config-error", `argument ${i} of "${ctx.fn}" is too large to encode`);
      return undefined;
    }
    const c = zeroCounts();
    countNode(encoded.node, c);
    if (sum(c) > 0) {
      fail(ctx, "harness-config-error", `argument ${i} of "${ctx.fn}" is not encodable`);
      return undefined;
    }
    nodes.push(encoded.node);
  }
  return { args, nodes };
}

interface SideCall {
  outcome: Outcome;
  properties: Map<string, DeltaPropertyResult>;
}

async function callSide(side: Side, request: CallRequest, ctx: Ctx): Promise<SideCall | undefined> {
  let result: Awaited<ReturnType<SideHandle["call"]>>;
  try {
    result = await ctx.sides[side].call(request);
  } catch (e) {
    fail(ctx, "runner-protocol-error", `the ${side} call threw: ${messageOf(e)}`);
    return undefined;
  }
  if (!result.ok) {
    fail(ctx, result.error.kind, result.error.message);
    return undefined;
  }
  const value: CallResult = result.value;
  const normalized = normalizeOutcomeWith(value.outcome, ctx.matchers[side]);
  if (!normalized.ok) {
    fail(
      ctx,
      "normalization-collision",
      `two object keys became identical after root normalization (${normalized.error.where}, ${side} side)`,
    );
    return undefined;
  }
  const properties = new Map<string, DeltaPropertyResult>();
  for (const p of value.properties) {
    if (p.detail === undefined) {
      properties.set(p.id, { passed: p.ok });
      continue;
    }
    const detail = normalizeNode(p.detail, ctx.matchers[side], "property");
    if (!detail.ok) {
      fail(ctx, "normalization-collision", `two keys became identical in a property detail (${side} side)`);
      return undefined;
    }
    properties.set(p.id, { passed: p.ok, detail: redactErrorNodes(detail.value, ctx.pathContext) });
  }
  return { outcome: redactOutcome(normalized.value, ctx.pathContext), properties };
}

/** Runs one prepared Case. Never throws. */
async function executeCase(p: Prepared, ctx: Ctx, deltaCheck: string | undefined): Promise<Attempt> {
  const attempt: Attempt = {
    status: "aborted",
    args: p.args,
    argNodes: p.nodes,
    unencodable: zeroCounts(),
    applicable: [],
  };
  try {
    const applicable: DeclaredDelta[] = [];
    for (const d of ctx.deltas) {
      let holds: boolean;
      try {
        holds = d.predicate(freshArgs(p.nodes)) === true;
      } catch (e) {
        fail(ctx, "harness-config-error", `the predicate of delta "${d.id}" threw: ${messageOf(e)}`);
        return attempt;
      }
      if (holds) applicable.push(d);
    }
    if (deltaCheck !== undefined && !applicable.some((d) => d.id === deltaCheck)) {
      fail(
        ctx,
        "generator-violates-predicate",
        `a Case for delta "${deltaCheck}" of function "${ctx.fn}" is outside the predicate of that delta`,
      );
      return attempt;
    }

    const refs: PropertyRef[] = applicable.map((d) => ({ id: d.id, modulePath: d.propertyModule }));
    const caseSeed = deriveSeed(
      ctx.options.seed,
      ctx.fn,
      nodeJson({ t: "array", length: p.nodes.length, items: p.nodes.map((n, i) => ({ i, n })), props: [] }),
    );
    const request = (properties: readonly PropertyRef[]): CallRequest => ({
      fn: ctx.fn,
      args: p.nodes,
      caseSeed,
      stubs: ctx.stubs,
      properties,
    });

    const first = await callSide("original", request(refs), ctx);
    if (first === undefined) return attempt;
    if (ctx.options.selfConsistency !== false) {
      const repeat = await callSide("original", request([]), ctx);
      if (repeat === undefined) return attempt;
      const differences = compareOutcomes(first.outcome, repeat.outcome);
      if (differences.length > 0) {
        ctx.flaky ??= { function: ctx.fn, args: p.nodes, differences };
        ctx.stopped = true;
        attempt.status = "flaky";
        return attempt;
      }
    }
    const second = await callSide("resurrection", request(refs), ctx);
    if (second === undefined) return attempt;

    const observed: ApplicableDelta[] = applicable.map((d) => ({
      id: d.id,
      original: first.properties.get(d.id),
      resurrection: second.properties.get(d.id),
    }));
    const classification = classifyCase({
      args: p.nodes,
      original: first.outcome,
      resurrection: second.outcome,
      applicable: observed,
    });
    countOutcome(first.outcome, attempt.unencodable);
    countOutcome(second.outcome, attempt.unencodable);
    attempt.original = first.outcome;
    attempt.resurrection = second.outcome;
    attempt.classification = classification;
    attempt.applicable = observed;
    attempt.status = classification.divergences.length > 0 ? "diverged" : "pass";
    return attempt;
  } catch (e) {
    fail(ctx, "harness-config-error", `the driver failed on a Case of "${ctx.fn}": ${messageOf(e)}`);
    return attempt;
  }
}

/** Encodes and runs one Case. Never throws. Used for explicit Cases and for the confirmation run. */
async function runCase(args: readonly unknown[], ctx: Ctx, deltaCheck?: string): Promise<Attempt> {
  const prepared = prepare(args, ctx);
  if (prepared === undefined) {
    return { status: "aborted", args, argNodes: [], unencodable: zeroCounts(), applicable: [] };
  }
  return executeCase(prepared, ctx, deltaCheck);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

function newPhase(name: string, deltaId?: string): PhaseState {
  return { name, attempts: [], firstFail: undefined, budgetExhausted: false, deltaId };
}

function record(phase: PhaseState, attempt: Attempt): void {
  const index = phase.attempts.length;
  phase.attempts.push(attempt);
  if (attempt.status === "diverged" && phase.firstFail === undefined) phase.firstFail = index;
}

/** The fast-check property of one phase. It never throws except through `fc.pre`. */
function makeProperty(
  phase: PhaseState,
  arbitrary: fc.Arbitrary<readonly unknown[]>,
  accept: FunctionHarness["accept"],
  ctx: Ctx,
): fc.IAsyncPropertyWithHooks<[readonly unknown[]]> {
  return fc.asyncProperty(arbitrary, async (args) => {
    if (ctx.stopped || phase.budgetExhausted) return true;
    const prepared = prepare(args, ctx);
    if (prepared === undefined) return true;
    if (accept !== undefined) {
      let accepted: boolean;
      try {
        accepted = accept(freshArgs(prepared.nodes)) === true;
      } catch (e) {
        fail(ctx, "harness-config-error", `the accept predicate of "${ctx.fn}" threw: ${messageOf(e)}`);
        return true;
      }
      fc.pre(accepted);
    }
    if (phase.firstFail !== undefined && phase.attempts.length - phase.firstFail - 1 >= ctx.options.shrinkBudget) {
      phase.budgetExhausted = true;
      return true;
    }
    const attempt = await executeCase(prepared, ctx, phase.deltaId);
    record(phase, attempt);
    return attempt.status !== "diverged";
  });
}

function checkParams(seed: number, numRuns: number | undefined): fc.Parameters<[readonly unknown[]]> {
  return {
    seed,
    ...(numRuns === undefined ? {} : { numRuns }),
    maxSkipsPerRun: MAX_SKIPS_PER_RUN,
    verbose: fc.VerbosityLevel.None,
  };
}

interface GeneratedPhaseSpec {
  name: string;
  seed: number;
  deltaId: string | undefined;
  arbitrary: fc.Arbitrary<readonly unknown[]>;
  accept: FunctionHarness["accept"];
  caseCount: number;
}

function generatedSpecs(ctx: Ctx): GeneratedPhaseSpec[] {
  const specs: GeneratedPhaseSpec[] = [
    {
      name: "generated",
      seed: deriveSeed(ctx.options.seed, ctx.fn, "generated"),
      deltaId: undefined,
      arbitrary: ctx.harness.args,
      accept: ctx.harness.accept,
      caseCount: ctx.harness.caseCount ?? ctx.options.caseCount,
    },
  ];
  for (const d of ctx.deltas) {
    if (d.generator === undefined) continue;
    specs.push({
      name: `delta:${d.id}`,
      seed: deriveSeed(ctx.options.seed, ctx.fn, `delta:${d.id}`),
      deltaId: d.id,
      arbitrary: d.generator,
      accept: undefined,
      caseCount: d.caseCount ?? ctx.options.caseCount,
    });
  }
  return specs;
}

interface ExplicitCase {
  args: readonly unknown[];
  deltaId: string | undefined;
}

function explicitCases(ctx: Ctx): ExplicitCase[] {
  return [
    ...(ctx.harness.explicitCases ?? []).map((args) => ({ args, deltaId: undefined })),
    ...ctx.deltas.flatMap((d) => d.explicitCases.map((args) => ({ args, deltaId: d.id }))),
  ];
}

// ---------------------------------------------------------------------------
// Function run
// ---------------------------------------------------------------------------

interface FunctionState {
  ctx: Ctx;
  cases: number;
  casesWithUnencodable: number;
  reasons: ReasonCounts;
  divergences: RawDivergence[];
  phases: PhaseSummary[];
  accumulators: Map<string, DeltaAccumulator>;
}

function counted(phase: PhaseState): Attempt[] {
  const end = phase.firstFail === undefined ? phase.attempts.length : phase.firstFail + 1;
  return phase.attempts.slice(0, end).filter((a) => a.status === "pass" || a.status === "diverged");
}

function shrinkAttempts(phase: PhaseState): number {
  return phase.firstFail === undefined ? 0 : phase.attempts.length - phase.firstFail - 1;
}

/** Adds the counted Cases of a finished phase to the function totals, in execution order. */
function tally(state: FunctionState, phase: PhaseState): number {
  const cases = counted(phase);
  for (const a of cases) {
    state.cases += 1;
    const total = sum(a.unencodable);
    if (total > 0) state.casesWithUnencodable += 1;
    for (const r of ["cycle", "depth", "getter", "proxy"] as const) state.reasons[r] += a.unencodable[r];
    for (const o of a.applicable) {
      const acc = state.accumulators.get(o.id);
      if (acc !== undefined) state.accumulators.set(o.id, accumulateCase(acc, a.argNodes, o.original, o.resurrection));
    }
  }
  return cases.length;
}

/** Re-runs the counterexample once and records the confirmed Divergence (or a harness error). */
async function collect(
  state: FunctionState,
  phase: PhaseState,
  counterexample: readonly unknown[],
  replay: Replay,
  budgetExhausted: boolean,
  deltaCheck: string | undefined,
): Promise<void> {
  const ctx = state.ctx;
  if (ctx.stopped) return;
  const confirm = await runCase(counterexample, ctx, deltaCheck);
  if (ctx.stopped) return;
  const first = confirm.classification?.divergences[0];
  if (
    confirm.status !== "diverged" ||
    first === undefined ||
    confirm.original === undefined ||
    confirm.resurrection === undefined
  ) {
    fail(
      ctx,
      "irreproducible-divergence",
      `the divergence of "${ctx.fn}" in phase "${phase.name}" did not reproduce on a second run of the shrunk arguments`,
    );
    return;
  }
  state.divergences.push({
    function: ctx.fn,
    kind: first.kind,
    ...(first.deltaId === undefined ? {} : { deltaId: first.deltaId }),
    args: confirm.argNodes,
    replay,
    differences: first.differences,
    original: confirm.original,
    resurrection: confirm.resurrection,
    shrink: { attempts: shrinkAttempts(phase), budgetExhausted },
  });
}

async function runExplicitPhase(state: FunctionState): Promise<void> {
  const ctx = state.ctx;
  const list = explicitCases(ctx);
  if (list.length === 0) return;
  const phase = newPhase("explicit");
  let counterexample: readonly unknown[] | null = null;
  for (let index = 0; index < list.length && !ctx.stopped; index++) {
    const item = list[index];
    if (item === undefined) continue;
    const attempt = await runCase(item.args, ctx, item.deltaId);
    record(phase, attempt);
    if (attempt.status === "diverged") {
      counterexample = item.args;
      const deltaCheck = item.deltaId;
      tally(state, phase);
      state.phases.push({ phase: phase.name, cases: counted(phase).length, shrinkAttempts: 0, counterexample });
      await collect(state, phase, item.args, { phase: "explicit", index }, false, deltaCheck);
      return;
    }
  }
  const cases = tally(state, phase);
  state.phases.push({ phase: phase.name, cases, shrinkAttempts: 0, counterexample });
}

async function runGeneratedPhase(state: FunctionState, spec: GeneratedPhaseSpec): Promise<void> {
  const ctx = state.ctx;
  const phase = newPhase(spec.name, spec.deltaId);
  let details;
  try {
    details = await fc.check(
      makeProperty(phase, spec.arbitrary, spec.accept, ctx),
      checkParams(spec.seed, spec.caseCount),
    );
  } catch (e) {
    fail(ctx, "harness-config-error", `the generator of "${ctx.fn}" in phase "${spec.name}" threw: ${messageOf(e)}`);
    tally(state, phase);
    state.phases.push({ phase: spec.name, cases: counted(phase).length, shrinkAttempts: 0, counterexample: null });
    return;
  }
  const cases = tally(state, phase);
  const summary: PhaseSummary = {
    phase: spec.name,
    cases,
    shrinkAttempts: shrinkAttempts(phase),
    counterexample: null,
  };
  state.phases.push(summary);
  if (!details.failed || ctx.stopped) return;

  if (details.counterexample !== null) {
    const thrown: unknown = details.errorInstance;
    if (thrown instanceof Error && thrown.message !== RETURNED_FALSE_MESSAGE) {
      fail(ctx, "harness-config-error", `the property of "${ctx.fn}" threw: ${thrown.message}`);
      return;
    }
    const counterexample = details.counterexample[0];
    const path = details.counterexamplePath;
    summary.counterexample = counterexample;
    if (path === null) {
      fail(ctx, "harness-config-error", `fast-check reported no path for the counterexample of "${ctx.fn}"`);
      return;
    }
    const replay: Replay =
      spec.deltaId === undefined
        ? { phase: "generated", seed: spec.seed, path }
        : { phase: `delta:${spec.deltaId}`, seed: spec.seed, path };
    await collect(state, phase, counterexample, replay, phase.budgetExhausted, spec.deltaId);
    return;
  }
  if (details.interrupted) {
    fail(ctx, "harness-config-error", `the fast-check run of "${ctx.fn}" in phase "${spec.name}" was interrupted`);
    return;
  }
  fail(
    ctx,
    "generator-exhausted",
    `the accept predicate of function "${ctx.fn}" rejected too many candidates in phase "${spec.name}" ` +
      `(${details.numSkips} skipped candidates, budget ${MAX_SKIPS_PER_RUN} per run); no Cases were run past this point`,
  );
}

function makeCtx(
  fn: string,
  harness: FunctionHarness,
  sides: DriverExecutor,
  options: DriverOptions,
): Ctx {
  const none: SideRoots = { created: "" };
  const pathContext = options.pathContext ?? defaultPathContext();
  const insensitive = pathContext.caseInsensitive;
  return {
    fn,
    harness,
    sides,
    options,
    deltas: options.deltas.filter((d) => d.function === fn),
    matchers: {
      original: buildRootMatcher(options.roots?.original ?? none, insensitive),
      resurrection: buildRootMatcher(options.roots?.resurrection ?? none, insensitive),
    },
    pathContext,
    stubs: { date: harness.stubs?.date !== false, random: harness.stubs?.random !== false },
    stopped: false,
    harnessError: undefined,
    flaky: undefined,
  };
}

/**
 * Runs every phase of one function (explicit, generated, delta phases) and returns the evidence.
 * Never throws: a driver or harness error is returned as a HarnessError.
 */
export async function runFunction(
  fn: string,
  harness: FunctionHarness,
  executor: DriverExecutor,
  options: DriverOptions,
): Promise<FunctionRunResult> {
  let state: FunctionState;
  try {
    const ctx = makeCtx(fn, harness, executor, options);
    state = {
      ctx,
      cases: 0,
      casesWithUnencodable: 0,
      reasons: zeroCounts(),
      divergences: [],
      phases: [],
      accumulators: new Map(ctx.deltas.map((d) => [d.id, newDeltaAccumulator(d.id, fn)])),
    };
  } catch (e) {
    return emptyResult(fn, {
      kind: "harness-config-error",
      function: fn,
      message: `the driver could not be set up for "${fn}": ${messageOf(e)}`,
    });
  }
  try {
    await runExplicitPhase(state);
    if (!state.ctx.stopped) {
      for (const spec of generatedSpecs(state.ctx)) {
        if (state.ctx.stopped) break;
        await runGeneratedPhase(state, spec);
      }
    }
  } catch (e) {
    fail(state.ctx, "harness-config-error", `the driver failed for "${fn}": ${messageOf(e)}`);
  }
  return assemble(state);
}

function emptyResult(fn: string, error: HarnessError): FunctionRunResult {
  return {
    function: fn,
    cases: 0,
    unencodable: { function: fn, cases: 0, casesWithUnencodable: 0, total: 0, reasons: zeroCounts() },
    divergences: [],
    nonDeterministic: null,
    deltas: [],
    harnessErrors: [error],
    phases: [],
  };
}

function assemble(state: FunctionState): FunctionRunResult {
  const { ctx } = state;
  const flaky = ctx.flaky ?? null;
  return {
    function: ctx.fn,
    cases: state.cases,
    unencodable: {
      function: ctx.fn,
      cases: state.cases,
      casesWithUnencodable: state.casesWithUnencodable,
      total: sum(state.reasons),
      reasons: { ...state.reasons },
    },
    // A function flagged non-deterministic records no Divergences (Requirement 9.3).
    divergences: flaky === null ? state.divergences : [],
    nonDeterministic: flaky,
    deltas: [...state.accumulators.values()].map((a) => finalizeDelta(a).report),
    harnessErrors: ctx.harnessError === undefined ? [] : [ctx.harnessError],
    phases: state.phases,
  };
}

// ---------------------------------------------------------------------------
// Replay (Requirement 8.8)
// ---------------------------------------------------------------------------

/**
 * Re-runs only the Case at the Replay_Parameters of a recorded Divergence, with the same
 * arbitrary and the same property: `fc.check(property, { seed, path })` for generated phases,
 * the recorded index for the explicit phase. Never throws.
 */
export async function replayPhase(
  fn: string,
  harness: FunctionHarness,
  executor: DriverExecutor,
  options: DriverOptions,
  replay: Replay,
): Promise<ReplayResult> {
  try {
    const ctx = makeCtx(fn, harness, executor, options);
    const done = (diverged: boolean, counterexample: readonly unknown[] | null): ReplayResult => ({
      diverged,
      counterexample,
      harnessErrors: ctx.harnessError === undefined ? [] : [ctx.harnessError],
    });
    if (replay.phase === "explicit") {
      const item = explicitCases(ctx)[replay.index];
      if (item === undefined) {
        fail(ctx, "harness-config-error", `no explicit Case at index ${replay.index} for "${fn}"`);
        return done(false, null);
      }
      const attempt = await runCase(item.args, ctx, item.deltaId);
      return done(attempt.status === "diverged", attempt.status === "diverged" ? item.args : null);
    }
    const spec = generatedSpecs(ctx).find((s) => s.name === replay.phase);
    if (spec === undefined) {
      fail(ctx, "harness-config-error", `no phase "${replay.phase}" for "${fn}"`);
      return done(false, null);
    }
    const phase = newPhase(spec.name, spec.deltaId);
    const details = await fc.check(makeProperty(phase, spec.arbitrary, spec.accept, ctx), {
      ...checkParams(replay.seed, undefined),
      path: replay.path,
    });
    if (details.failed && details.counterexample !== null && !ctx.stopped) {
      return done(true, details.counterexample[0]);
    }
    return done(false, null);
  } catch (e) {
    return {
      diverged: false,
      counterexample: null,
      harnessErrors: [
        {
          kind: "harness-config-error",
          function: fn,
          message: `the replay of "${fn}" failed: ${messageOf(e)}`,
        },
      ],
    };
  }
}
