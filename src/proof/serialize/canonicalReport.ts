// Canonical JSON of a Proof_Report (Requirement 13.1 to 13.3). One key-order table, every list
// sorted by a documented rule, no wall-clock field. Pure: no clock, no environment, no output.
//
// Reuse decision (design, "Canonical-code reuse"): the generic helpers `compareCodePoints`,
// `sortBy` and `ordered` come from child/codec/order.ts; nothing is imported from
// src/engine/serialize. Encoded nodes are written through the codec's canonical form
// (`canonicalizeNode`, `nodeJson`).

import { nodeJson } from "../child/codec/canonical";
import { compareCodePoints, ordered, sortBy } from "../child/codec/order";
import type { EncodedNode, ProofReport } from "../types";

/**
 * Fixed key order per object kind. The single source of truth for the key order of every
 * serialized report object. Keys absent from an object are skipped. `redactionMaskedDifference`
 * is always the last key of a Divergence (Requirement 13.2).
 */
export const REPORT_KEY_ORDER = {
  report: [
    "schemaVersion",
    "package",
    "original",
    "resurrection",
    "sandbox",
    "functionsTested",
    "casesPerFunction",
    "unencodableValues",
    "excludedFunctions",
    "nonDeterministicFunctions",
    "divergences",
    "deltas",
    "harnessErrors",
    "verdict",
    "seed",
    "toolVersions",
  ],
  package: ["name", "version"],
  original: ["integrity", "verified"],
  resurrection: ["source", "treeHash"],
  sandbox: ["mechanism", "restartEvents", "otherRestarts", "limits"],
  sideCounts: ["original", "resurrection"],
  limits: [
    "callTimeoutMs",
    "heapLimitMb",
    "outputLimitBytes",
    "maxRestarts",
    "casesRequested",
    "shrinkBudget",
  ],
  casesPerFunction: ["function", "cases"],
  unencodableValue: ["function", "cases", "casesWithUnencodable", "total", "reasons"],
  reasons: ["cycle", "depth", "getter", "proxy"],
  excludedFunction: ["function", "reason"],
  nonDeterministicFunction: ["function", "args", "differences"],
  divergence: [
    "function",
    "kind",
    "deltaId",
    "args",
    "replay",
    "differences",
    "original",
    "resurrection",
    "shrink",
    "apiSurface",
    "redactionMaskedDifference",
  ],
  apiSurface: ["export", "original", "resurrection"],
  exportSummary: ["type", "fnName", "arity", "primitive"],
  replay: ["phase", "seed", "path", "index"],
  shrink: ["attempts", "budgetExhausted"],
  difference: ["part", "path"],
  delta: ["id", "function", "status", "predicateCasesChecked", "demonstration"],
  demonstration: ["args", "original", "resurrection"],
  propertyResult: ["ok", "detail"],
  harnessError: ["kind", "function", "message"],
  toolVersions: ["node", "fastCheck", "reportSchema"],
  outcome: ["kind", "async", "value", "args", "prototypeDelta"],
  deltaEntry: ["prototype", "key", "change", "before", "after"],
  deltaKey: ["s", "sym"],
  descriptor: ["value", "get", "set", "writable", "enumerable", "configurable"],
} as const;

/** Fixed order of the `part` of a Difference. */
export const DIFFERENCE_PART_ORDER: readonly string[] = [
  "kind",
  "async",
  "value",
  "args",
  "prototypeDelta",
];

/** Fixed order of the prototype names in a prototypeDelta. */
export const PROTOTYPE_ORDER: readonly string[] = [
  "Object.prototype",
  "Array.prototype",
  "Function.prototype",
  "String.prototype",
  "Number.prototype",
  "Boolean.prototype",
];

type Obj = { [k: string]: unknown };

/** Pre-rendered JSON text (an encoded node in canonical form), written as is. */
class RawJson {
  readonly json: string;
  constructor(json: string) {
    this.json = json;
  }
}

type MapNode = (node: EncodedNode) => unknown;

function asObj(v: unknown): Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {};
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function cmpStr(a: unknown, b: unknown): number {
  return compareCodePoints(String(a ?? ""), String(b ?? ""));
}

function rank(order: readonly string[], v: unknown): number {
  const i = order.indexOf(String(v));
  return i === -1 ? order.length : i;
}

/** Canonical JSON of an argument list as rendered in the report (used as a sort key). */
function argsJson(args: unknown): string {
  return "[" + asArr(args).map((n) => nodeJson(n as EncodedNode)).join(",") + "]";
}

/** Absent sorts first, then code point order. */
function cmpOptional(a: unknown, b: unknown): number {
  if (a === undefined || b === undefined) return a === undefined ? (b === undefined ? 0 : -1) : 1;
  return cmpStr(a, b);
}

/**
 * Sorts a list of objects by the documented primary comparators, then breaks ties by `deltaId`
 * (absent first), `function` (absent first) and the canonical JSON of the whole rendered entry
 * (code point order). The result does not depend on the input order, and equal entries are
 * identical in content, so the original index is never the deciding tie-breaker.
 */
function sortEntries(
  list: unknown,
  render: (o: Obj) => unknown,
  ...primary: Array<(a: Obj, b: Obj) => number>
): unknown[] {
  type Item = { raw: Obj; out: unknown; json: string };
  const items: Item[] = asArr(list)
    .map(asObj)
    .map((raw) => {
      const out = render(raw);
      return { raw, out, json: write(out) };
    });
  return sortBy<Item>(
    items,
    ...primary.map((c) => (a: Item, b: Item) => c(a.raw, b.raw)),
    (a, b) => cmpOptional(a.raw["deltaId"], b.raw["deltaId"]),
    (a, b) => cmpOptional(a.raw["function"], b.raw["function"]),
    (a, b) => compareCodePoints(a.json, b.json),
  ).map((i) => i.out);
}

function descriptor(mapNode: MapNode): (v: unknown) => unknown {
  const node = (n: unknown): unknown => mapNode(n as EncodedNode);
  return (v) =>
    ordered(asObj(v), REPORT_KEY_ORDER.descriptor, { value: node, get: node, set: node });
}

function deltaKeyRank(key: unknown): number {
  return "s" in asObj(key) ? 0 : 1;
}

function deltaKeyText(key: unknown): string {
  const k = asObj(key);
  if ("s" in k) return String(k["s"]);
  const d = k["sym"];
  return typeof d === "string" ? d : "";
}

function prototypeDelta(mapNode: MapNode): (v: unknown) => unknown {
  const desc = descriptor(mapNode);
  return (v) =>
    sortEntries(
      v,
      (e) =>
        ordered(e, REPORT_KEY_ORDER.deltaEntry, {
          key: (k) => ordered(asObj(k), REPORT_KEY_ORDER.deltaKey),
          before: desc,
          after: desc,
        }),
      (a, b) => rank(PROTOTYPE_ORDER, a["prototype"]) - rank(PROTOTYPE_ORDER, b["prototype"]),
      (a, b) => deltaKeyRank(a["key"]) - deltaKeyRank(b["key"]),
      (a, b) => compareCodePoints(deltaKeyText(a["key"]), deltaKeyText(b["key"])),
    );
}

function nodes(mapNode: MapNode): (v: unknown) => unknown {
  return (v) => asArr(v).map((n) => mapNode(n as EncodedNode));
}

function outcome(mapNode: MapNode): (v: unknown) => unknown {
  return (v) =>
    ordered(asObj(v), REPORT_KEY_ORDER.outcome, {
      value: (n) => mapNode(n as EncodedNode),
      args: nodes(mapNode),
      prototypeDelta: prototypeDelta(mapNode),
    });
}

function differences(v: unknown): unknown[] {
  return sortEntries(
    v,
    (d) => ordered(d, REPORT_KEY_ORDER.difference),
    (a, b) => rank(DIFFERENCE_PART_ORDER, a["part"]) - rank(DIFFERENCE_PART_ORDER, b["part"]),
    (a, b) => cmpStr(a["path"], b["path"]),
  );
}

function exportSummary(mapNode: MapNode): (v: unknown) => unknown {
  return (v) =>
    v === null
      ? null
      : ordered(asObj(v), REPORT_KEY_ORDER.exportSummary, {
          primitive: (n) => mapNode(n as EncodedNode),
        });
}

function divergence(mapNode: MapNode): (v: unknown) => Obj {
  const summary = exportSummary(mapNode);
  return (v) =>
    ordered(asObj(v), REPORT_KEY_ORDER.divergence, {
      args: nodes(mapNode),
      replay: (r) => ordered(asObj(r), REPORT_KEY_ORDER.replay),
      differences,
      original: outcome(mapNode),
      resurrection: outcome(mapNode),
      shrink: (s) => ordered(asObj(s), REPORT_KEY_ORDER.shrink),
      apiSurface: (a) =>
        ordered(asObj(a), REPORT_KEY_ORDER.apiSurface, {
          original: summary,
          resurrection: summary,
        }),
    });
}

/** Sort key of a Divergence: the rendered (already redacted) counterexample. */
function counterexampleKey(d: Obj): string {
  if (d["kind"] === "api-surface") return JSON.stringify(sortedApiSurface(d["apiSurface"]));
  return argsJson(d["args"]);
}

function sortedApiSurface(v: unknown): string {
  const a = asObj(v);
  const side = (s: unknown): unknown => {
    if (s === null || s === undefined) return null;
    const o = asObj(s);
    const prim = o["primitive"];
    return ordered(o, REPORT_KEY_ORDER.exportSummary, {
      primitive: () => (prim === undefined ? undefined : nodeJson(prim as EncodedNode)),
    });
  };
  return JSON.stringify(
    ordered(
      { export: a["export"], original: side(a["original"]), resurrection: side(a["resurrection"]) },
      REPORT_KEY_ORDER.apiSurface,
    ),
  );
}

function propertyResult(mapNode: MapNode): (v: unknown) => unknown {
  return (v) =>
    ordered(asObj(v), REPORT_KEY_ORDER.propertyResult, {
      detail: (n) => mapNode(n as EncodedNode),
    });
}

function buildReport(report: ProofReport, mapNode: MapNode): Obj {
  const byFunction = (a: Obj, b: Obj): number => cmpStr(a["function"], b["function"]);
  const sideCounts = (v: unknown): unknown => ordered(asObj(v), REPORT_KEY_ORDER.sideCounts);
  const divergenceOf = divergence(mapNode);
  const prop = propertyResult(mapNode);

  return ordered(report as unknown as Obj, REPORT_KEY_ORDER.report, {
    package: (v) => ordered(asObj(v), REPORT_KEY_ORDER.package),
    original: (v) => ordered(asObj(v), REPORT_KEY_ORDER.original),
    resurrection: (v) => ordered(asObj(v), REPORT_KEY_ORDER.resurrection),
    sandbox: (v) =>
      ordered(asObj(v), REPORT_KEY_ORDER.sandbox, {
        restartEvents: sideCounts,
        otherRestarts: sideCounts,
        limits: (l) => ordered(asObj(l), REPORT_KEY_ORDER.limits),
      }),
    functionsTested: (v) => asArr(v).map(String).sort(compareCodePoints),
    casesPerFunction: (v) =>
      sortEntries(v, (e) => ordered(e, REPORT_KEY_ORDER.casesPerFunction), byFunction),
    unencodableValues: (v) =>
      sortEntries(
        v,
        (e) =>
          ordered(e, REPORT_KEY_ORDER.unencodableValue, {
            reasons: (r) => ordered(asObj(r), REPORT_KEY_ORDER.reasons),
          }),
        byFunction,
      ),
    excludedFunctions: (v) =>
      sortEntries(v, (e) => ordered(e, REPORT_KEY_ORDER.excludedFunction), byFunction),
    nonDeterministicFunctions: (v) =>
      sortEntries(
        v,
        (e) =>
          ordered(e, REPORT_KEY_ORDER.nonDeterministicFunction, {
            args: nodes(mapNode),
            differences,
          }),
        byFunction,
      ),
    divergences: (v) =>
      sortEntries(
        v,
        divergenceOf,
        byFunction,
        (a, b) => cmpStr(a["kind"], b["kind"]),
        (a, b) => compareCodePoints(counterexampleKey(a), counterexampleKey(b)),
      ),
    deltas: (v) =>
      sortEntries(
        v,
        (e) =>
          ordered(e, REPORT_KEY_ORDER.delta, {
            demonstration: (d) =>
              d === null
                ? null
                : ordered(asObj(d), REPORT_KEY_ORDER.demonstration, {
                    args: nodes(mapNode),
                    original: prop,
                    resurrection: prop,
                  }),
          }),
        (a, b) => cmpStr(a["id"], b["id"]),
      ),
    harnessErrors: (v) =>
      sortEntries(
        v,
        (e) => ordered(e, REPORT_KEY_ORDER.harnessError),
        (a, b) => cmpStr(a["kind"], b["kind"]),
        (a, b) => cmpStr(a["message"], b["message"]),
      ),
    toolVersions: (v) => ordered(asObj(v), REPORT_KEY_ORDER.toolVersions),
  });
}

function write(v: unknown): string {
  if (v instanceof RawJson) return v.json;
  if (Array.isArray(v)) return "[" + v.map(write).join(",") + "]";
  if (typeof v === "object" && v !== null) {
    const o = v as Obj;
    const parts: string[] = [];
    for (const k of Object.keys(o)) {
      if (o[k] === undefined) continue;
      parts.push(JSON.stringify(k) + ":" + write(o[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Returns the report as plain data in canonical order: fixed key order, sorted lists,
 * canonical encoded nodes. Idempotent; the input is not modified.
 */
export function canonicalizeReport(report: ProofReport): ProofReport {
  return JSON.parse(canonicalReport(report)) as ProofReport;
}

/**
 * Canonical JSON of a report: fixed key order, sorted lists, no whitespace. Byte-identical for
 * reports that differ only in construction order. Encoded nodes are written in the codec's
 * canonical form.
 */
export function canonicalReport(report: ProofReport): string {
  return write(buildReport(report, (n) => new RawJson(nodeJson(n))));
}

/** Same as `canonicalReport` (name used in the design). */
export const canonicalReportJson = canonicalReport;
