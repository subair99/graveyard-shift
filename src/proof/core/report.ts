// Report builder (Requirements 2.4, 8.6, 8.11, 12.3, 13.2 to 13.5, 13.17, 13.23, 13.25, 13.26, 13.30).
// Pure: no clock, environment, file system, random source or console. Tool versions, identity
// values, roots and the serializer are arguments.
//
// Order of operations (design, "Order inside a run"):
//   1. Root-normalize every outcome and encoded node, per side (idempotent when the caller has
//      already done it).
//   2. Compute `redactionMaskedDifference` from the raw (root-normalized, not identity-redacted) pair.
//   3. Identity-redact every string that enters the report.
//   4. Serialize, then scan the text for a temporary root (13.23) and for an Identity_Value (13.26).
//   5. On a leak, or when redaction makes two keys equal, return the fallback report.
// The Verdict is decided from kinds and names, which redaction does not change (13.30).

import { nodeJson } from "../child/codec/canonical";
import { compareCodePoints, sortBy } from "../child/codec/order";
import type {
  DeltaReport,
  Divergence,
  EncodedNode,
  ExportSummary,
  HarnessError,
  Outcome,
  ProofReport,
  Replay,
  Result,
  UnencodableCount,
} from "../types";
import { findIdentity, redactIdentity, type IdentityValues, type Platform } from "./identity";
import {
  alternationSource,
  buildRootMatcher,
  normalizeNode,
  normalizeOutcomeWith,
  normalizeText,
  rootForms,
  type CollisionWhere,
  type RootForm,
  type RootMatcher,
  type SideRoots,
} from "./normalize";
import { redactIdentityDeep, redactIdentityOutcome, redactionMaskedDifference } from "./redact";
import { computeVerdict } from "./verdict";

/** Text that replaces a string in the fallback report when it still contains a root or an Identity_Value. */
export const WITHHELD = "<withheld>";

/** A Divergence as the driver recorded it: root-normalized outcomes, no identity redaction, no flag. */
export type RawDivergence =
  | Omit<Exclude<Divergence, { kind: "api-surface" }>, "redactionMaskedDifference">
  | Omit<Extract<Divergence, { kind: "api-surface" }>, "redactionMaskedDifference">;

type NonDeterministicEntry = ProofReport["nonDeterministicFunctions"][number];

export interface ReportInput {
  package: { name: string; version: string };
  original: { integrity: string; verified: boolean };
  resurrection: { source: "directory" | "tarball"; treeHash: string | null };
  sandbox: ProofReport["sandbox"];
  functionsTested: readonly string[];
  casesPerFunction: readonly { function: string; cases: number }[];
  unencodableValues: readonly UnencodableCount[];
  excludedFunctions: readonly { function: string; reason: string }[];
  /** Flagged non-deterministic functions that are not excluded (they decide the Verdict). */
  nonDeterministicFunctions: readonly NonDeterministicEntry[];
  divergences: readonly RawDivergence[];
  deltas: readonly DeltaReport[];
  harnessErrors: readonly HarnessError[];
  seed: number;
  /** Tool versions as data; the report schema version is fixed. */
  toolVersions: { node: string; fastCheck: string };
  /** The temporary roots of each side, used by the Root_Normalizer. */
  roots: { original: SideRoots; resurrection: SideRoots };
  /** Further temporary roots (work directory, extraction directories) that must not appear in the report. */
  otherTempRoots: readonly string[];
  identity: IdentityValues;
  platform: Platform;
  /**
   * Canonical JSON writer (canonicalReportJson of serialize/canonicalReport.ts). Injected so this
   * module does not depend on the serializer file.
   */
  serialize: (report: ProofReport) => string;
}

class ReportCollision extends Error {
  readonly where: CollisionWhere;
  readonly fn: string | undefined;

  constructor(where: CollisionWhere, fn: string | undefined) {
    super("normalization-collision");
    this.name = "ReportCollision";
    this.where = where;
    this.fn = fn;
  }
}

function unwrap<T>(
  r: Result<T, { kind: "normalization-collision"; where: CollisionWhere }>,
  fn: string | undefined,
): T {
  if (!r.ok) throw new ReportCollision(r.error.where, fn);
  return r.value;
}

// ---------------------------------------------------------------------------
// Temporary-root check
// ---------------------------------------------------------------------------

/** True when the text contains any form of any given root (native, escaped, `\\?\`, `file://`). */
export function containsTempRoot(
  text: string,
  roots: readonly string[],
  caseInsensitive: boolean,
): boolean {
  const forms: RootForm[] = [];
  for (const r of roots) {
    const own = rootForms(r);
    forms.push(...own);
    // A string that already holds the JSON-escaped form is escaped again by the serializer
    // (back-slashes four times in the text), so check that form too.
    for (const f of own) {
      if (!f.url && f.text.includes("\\\\")) forms.push({ text: f.text.replace(/\\/g, "\\\\"), url: false });
    }
  }
  const source = alternationSource(forms);
  if (source === null) return false;
  return new RegExp(source, caseInsensitive ? "i" : "").test(text);
}

function allRoots(input: ReportInput): string[] {
  const out: string[] = [];
  for (const side of [input.roots.original, input.roots.resurrection]) {
    out.push(side.created);
    if (side.real !== undefined) out.push(side.real);
  }
  out.push(...input.otherTempRoots);
  return out.filter((r) => r !== "");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function byFunction<T extends { function: string }>(items: readonly T[]): T[] {
  return sortBy(items, (a, b) => compareCodePoints(a.function, b.function));
}

function sortedNames(names: readonly string[]): string[] {
  return [...names].sort(compareCodePoints);
}

function compareErrors(a: HarnessError, b: HarnessError): number {
  return (
    compareCodePoints(a.kind, b.kind) ||
    compareCodePoints(a.function ?? "", b.function ?? "") ||
    compareCodePoints(a.message, b.message)
  );
}

interface Renderer {
  rs: (s: string) => string;
  args: (nodes: readonly EncodedNode[], fn: string) => EncodedNode[];
  outcome: (o: Outcome, side: "original" | "resurrection", fn: string) => { raw: Outcome; shown: Outcome };
  detail: (n: EncodedNode, side: "original" | "resurrection", fn: string) => EncodedNode;
  summary: (
    s: ExportSummary | null,
    side: "original" | "resurrection",
    fn: string,
  ) => { raw: ExportSummary | null; shown: ExportSummary | null };
}

function makeRenderer(input: ReportInput): Renderer {
  const ci = input.platform === "win32";
  const matchers: Record<"original" | "resurrection", RootMatcher> = {
    original: buildRootMatcher(input.roots.original, ci),
    resurrection: buildRootMatcher(input.roots.resurrection, ci),
  };
  const { identity, platform } = input;
  const rs = (s: string): string => redactIdentity(s, identity, platform);
  const node = (n: EncodedNode, where: CollisionWhere, fn: string): EncodedNode =>
    unwrap(redactIdentityDeep(n, identity, platform, where), fn);

  return {
    rs,
    args: (nodes, fn) =>
      nodes.map((n) => {
        const a = unwrap(normalizeNode(n, matchers.original, "args"), fn);
        const b = unwrap(normalizeNode(a, matchers.resurrection, "args"), fn);
        return node(b, "args", fn);
      }),
    outcome: (o, side, fn) => {
      const raw = unwrap(normalizeOutcomeWith(o, matchers[side]), fn);
      return { raw, shown: unwrap(redactIdentityOutcome(raw, identity, platform), fn) };
    },
    detail: (n, side, fn) => {
      const raw = unwrap(normalizeNode(n, matchers[side], "property"), fn);
      return node(raw, "property", fn);
    },
    summary: (s, side, fn) => {
      if (s === null) return { raw: null, shown: null };
      const m = matchers[side];
      const primitive =
        s.primitive === undefined ? undefined : unwrap(normalizeNode(s.primitive, m, "value"), fn);
      const raw: ExportSummary = {
        type: normalizeText(s.type, m),
        ...(s.fnName !== undefined ? { fnName: normalizeText(s.fnName, m) } : {}),
        ...(s.arity !== undefined ? { arity: s.arity } : {}),
        ...(primitive !== undefined ? { primitive } : {}),
      };
      const shown: ExportSummary = {
        type: rs(raw.type),
        ...(raw.fnName !== undefined ? { fnName: rs(raw.fnName) } : {}),
        ...(raw.arity !== undefined ? { arity: raw.arity } : {}),
        ...(raw.primitive !== undefined ? { primitive: node(raw.primitive, "value", fn) } : {}),
      };
      return { raw, shown };
    },
  };
}

function renderReplay(replay: Replay, rs: (s: string) => string): Replay {
  if (replay.phase === "explicit" || replay.phase === "generated") return replay;
  return { phase: `delta:${rs(replay.phase.slice("delta:".length))}`, seed: replay.seed, path: replay.path };
}

interface Rendered {
  divergence: Divergence;
  sortKey: string;
}

function renderDivergence(d: RawDivergence, r: Renderer, input: ReportInput): Rendered {
  const fn = d.function;
  if (d.kind === "api-surface") {
    const o = r.summary(d.apiSurface.original, "original", fn);
    const q = r.summary(d.apiSurface.resurrection, "resurrection", fn);
    const masked = redactionMaskedDifference(
      { kind: "api-surface", original: o.raw, resurrection: q.raw },
      input.identity,
      input.platform,
    );
    const apiSurface = { export: r.rs(d.apiSurface.export), original: o.shown, resurrection: q.shown };
    return {
      divergence: { function: r.rs(fn), kind: "api-surface", apiSurface, redactionMaskedDifference: masked },
      sortKey: JSON.stringify(apiSurface),
    };
  }
  const o = r.outcome(d.original, "original", fn);
  const q = r.outcome(d.resurrection, "resurrection", fn);
  const masked = redactionMaskedDifference(
    { kind: "outcome", original: o.raw, resurrection: q.raw },
    input.identity,
    input.platform,
  );
  const args = r.args(d.args, fn);
  return {
    divergence: {
      function: r.rs(fn),
      kind: d.kind,
      ...(d.deltaId !== undefined ? { deltaId: r.rs(d.deltaId) } : {}),
      args,
      replay: renderReplay(d.replay, r.rs),
      differences: d.differences.map((x) => ({ part: x.part, path: x.path })),
      original: o.shown,
      resurrection: q.shown,
      shrink: { attempts: d.shrink.attempts, budgetExhausted: d.shrink.budgetExhausted },
      redactionMaskedDifference: masked,
    },
    sortKey: "[" + args.map((a) => nodeJson(a)).join(",") + "]",
  };
}

function renderDelta(d: DeltaReport, r: Renderer): DeltaReport {
  return {
    id: r.rs(d.id),
    function: r.rs(d.function),
    status: d.status,
    predicateCasesChecked: d.predicateCasesChecked,
    demonstration:
      d.demonstration === null
        ? null
        : {
            args: r.args(d.demonstration.args, d.function),
            original: renderProperty(d.demonstration.original, "original", d.function, r),
            resurrection: renderProperty(d.demonstration.resurrection, "resurrection", d.function, r),
          },
  };
}

function renderProperty(
  p: { ok: boolean; detail?: EncodedNode },
  side: "original" | "resurrection",
  fn: string,
  r: Renderer,
): { ok: boolean; detail?: EncodedNode } {
  return p.detail === undefined
    ? { ok: p.ok }
    : { ok: p.ok, detail: r.detail(p.detail, side, fn) };
}

function renderError(e: HarnessError, rs: (s: string) => string): HarnessError {
  return { kind: e.kind, ...(e.function !== undefined ? { function: rs(e.function) } : {}), message: rs(e.message) };
}

function renderUnencodable(u: UnencodableCount, rs: (s: string) => string): UnencodableCount {
  return { ...u, function: rs(u.function), reasons: { ...u.reasons } };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface Parts {
  divergences: Divergence[];
  deltas: DeltaReport[];
  nonDeterministicFunctions: NonDeterministicEntry[];
  harnessErrors: HarnessError[];
  functionsTested: string[];
  casesPerFunction: { function: string; cases: number }[];
  unencodableValues: UnencodableCount[];
  excludedFunctions: { function: string; reason: string }[];
  package: { name: string; version: string };
  original: { integrity: string; verified: boolean };
  treeHash: string | null;
  toolVersions: { node: string; fastCheck: string };
}

function assemble(input: ReportInput, p: Parts, nonDeterministicNames: readonly string[]): ProofReport {
  const { verdict } = computeVerdict({
    harnessErrors: p.harnessErrors,
    divergences: p.divergences,
    deltas: p.deltas,
    nonDeterministic: nonDeterministicNames,
    functionsTested: p.functionsTested,
    unencodable: p.unencodableValues,
  });
  return {
    schemaVersion: 1,
    package: p.package,
    original: p.original,
    resurrection: { source: input.resurrection.source, treeHash: p.treeHash },
    sandbox: input.sandbox,
    functionsTested: p.functionsTested,
    casesPerFunction: p.casesPerFunction,
    unencodableValues: p.unencodableValues,
    excludedFunctions: p.excludedFunctions,
    nonDeterministicFunctions: p.nonDeterministicFunctions,
    divergences: p.divergences,
    deltas: p.deltas,
    harnessErrors: p.harnessErrors,
    verdict,
    seed: input.seed,
    toolVersions: {
      node: p.toolVersions.node,
      fastCheck: p.toolVersions.fastCheck,
      reportSchema: 1,
    },
  };
}

/**
 * The fallback report (Requirements 13.23, 13.26): no Divergence, no Declared_Delta result, and no
 * recorded cases for non-deterministic functions. Every free-text string is identity-redacted, and
 * replaced by `WITHHELD` when it still holds a temporary root or an Identity_Value. The added
 * harness error carries no path. The Verdict is `inconclusive` because of that error.
 */
export function fallbackReport(input: ReportInput, error: HarnessError): ProofReport {
  const ci = input.platform === "win32";
  const roots = allRoots(input);
  const safe = (s: string): string => {
    const t = redactIdentity(s, input.identity, input.platform);
    return containsTempRoot(t, roots, ci) || findIdentity(t, input.identity, input.platform).found ? WITHHELD : t;
  };
  const errors = [...input.harnessErrors.map((e) => renderError(e, safe)), error].sort(compareErrors);
  const names = sortedNames(input.nonDeterministicFunctions.map((n) => safe(n.function)));
  return assemble(
    input,
    {
      divergences: [],
      deltas: [],
      nonDeterministicFunctions: byFunction(
        input.nonDeterministicFunctions.map((n) => ({ function: safe(n.function), args: [], differences: [] })),
      ),
      harnessErrors: errors,
      functionsTested: sortedNames(input.functionsTested.map(safe)),
      casesPerFunction: byFunction(input.casesPerFunction.map((c) => ({ function: safe(c.function), cases: c.cases }))),
      unencodableValues: byFunction(input.unencodableValues.map((u) => renderUnencodable(u, safe))),
      excludedFunctions: byFunction(input.excludedFunctions.map((e) => ({ function: safe(e.function), reason: safe(e.reason) }))),
      package: { name: safe(input.package.name), version: safe(input.package.version) },
      original: { integrity: safe(input.original.integrity), verified: input.original.verified },
      treeHash: input.resurrection.treeHash === null ? null : safe(input.resurrection.treeHash),
      toolVersions: { node: safe(input.toolVersions.node), fastCheck: safe(input.toolVersions.fastCheck) },
    },
    names,
  );
}

/** Builds the Proof_Report. Returns the fallback report on a collision or a leak. */
export function buildReport(input: ReportInput): ProofReport {
  const r = makeRenderer(input);
  let report: ProofReport;
  try {
    const rendered = input.divergences.map((d, index) => ({ ...renderDivergence(d, r, input), index }));
    const divergences = sortBy(
      rendered,
      (a, b) => compareCodePoints(a.divergence.function, b.divergence.function),
      (a, b) => compareCodePoints(a.divergence.kind, b.divergence.kind),
      (a, b) => compareCodePoints(a.sortKey, b.sortKey),
      (a, b) => a.index - b.index,
    ).map((x) => x.divergence);
    const nonDeterministicFunctions = byFunction(
      input.nonDeterministicFunctions.map((n) => ({
        function: r.rs(n.function),
        args: r.args(n.args, n.function),
        differences: n.differences.map((x) => ({ part: x.part, path: x.path })),
      })),
    );
    report = assemble(
      input,
      {
        divergences,
        deltas: sortBy(
          input.deltas.map((d) => renderDelta(d, r)),
          (a, b) => compareCodePoints(a.id, b.id),
          (a, b) => compareCodePoints(a.function, b.function),
        ),
        nonDeterministicFunctions,
        harnessErrors: input.harnessErrors.map((e) => renderError(e, r.rs)).sort(compareErrors),
        functionsTested: sortedNames(input.functionsTested.map(r.rs)),
        casesPerFunction: byFunction(input.casesPerFunction.map((c) => ({ function: r.rs(c.function), cases: c.cases }))),
        unencodableValues: byFunction(input.unencodableValues.map((u) => renderUnencodable(u, r.rs))),
        excludedFunctions: byFunction(input.excludedFunctions.map((e) => ({ function: r.rs(e.function), reason: r.rs(e.reason) }))),
        package: { name: r.rs(input.package.name), version: r.rs(input.package.version) },
        original: { integrity: r.rs(input.original.integrity), verified: input.original.verified },
        treeHash: input.resurrection.treeHash === null ? null : r.rs(input.resurrection.treeHash),
        toolVersions: input.toolVersions,
      },
      input.nonDeterministicFunctions.map((n) => r.rs(n.function)),
    );
  } catch (e) {
    if (e instanceof ReportCollision) {
      return fallbackReport(input, {
        kind: "normalization-collision",
        ...(e.fn !== undefined ? { function: r.rs(e.fn) } : {}),
        message: `Two keys of one encoded object became identical in ${e.where}; the report omits the Divergences.`,
      });
    }
    throw e;
  }

  const json = input.serialize(report);
  if (containsTempRoot(json, allRoots(input), input.platform === "win32")) {
    return fallbackReport(input, {
      kind: "temp-root-leak",
      message: "The report text contained a temporary directory path; the report omits Divergences and Declared_Delta results.",
    });
  }
  if (findIdentity(json, input.identity, input.platform).found) {
    return fallbackReport(input, {
      kind: "identity-leak",
      message: "The report text contained an Identity_Value after redaction; the report omits Divergences and Declared_Delta results.",
    });
  }
  return report;
}
