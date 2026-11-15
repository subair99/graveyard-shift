// Public API surface check (Requirements 10.1 to 10.4). Pure: no clock, environment, random
// source or output.

import { compareCodePoints } from "../child/codec/order";
import type { Divergence, EncodedNode, ExportSummary } from "../types";
import { deepEqualNodes } from "./equal";

/** One entry of `listExports`: an export name plus its summary. */
export type ExportEntry = ExportSummary & { name: string };

export type ApiSurfaceDivergence = Extract<Divergence, { kind: "api-surface" }>;

function toSummary(entry: ExportEntry): ExportSummary {
  const summary: ExportSummary = { type: entry.type };
  if (entry.fnName !== undefined) summary.fnName = entry.fnName;
  if (entry.arity !== undefined) summary.arity = entry.arity;
  if (entry.primitive !== undefined) summary.primitive = entry.primitive;
  return summary;
}

function sameNode(a: EncodedNode | undefined, b: EncodedNode | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return deepEqualNodes(a, b);
}

/** Type, function name, arity or primitive value differs. */
function summariesDiffer(a: ExportSummary, b: ExportSummary): boolean {
  return (
    a.type !== b.type ||
    a.fnName !== b.fnName ||
    a.arity !== b.arity ||
    !sameNode(a.primitive, b.primitive)
  );
}

function index(entries: readonly ExportEntry[]): Map<string, ExportEntry> {
  const map = new Map<string, ExportEntry>();
  for (const entry of entries) if (!map.has(entry.name)) map.set(entry.name, entry);
  return map;
}

function divergence(
  name: string,
  original: ExportSummary | null,
  resurrection: ExportSummary | null,
): ApiSurfaceDivergence {
  return {
    function: name,
    kind: "api-surface",
    apiSurface: { export: name, original, resurrection },
    redactionMaskedDifference: false,
  };
}

/**
 * Compares the export tables of the two sides and returns one `api-surface` Divergence per
 * differing export, sorted by export name (Unicode code point). Identical tables give none.
 *
 * Every export of the original and of the resurrection is checked (Requirement 10.1), so a
 * removed, added, retyped, renamed, re-aritied or changed-primitive export is reported whether
 * or not it is in the Haunting Radius. `radius` lists function names to test (default: every
 * exported function of the original). A radius name absent from both sides is also a
 * Divergence, with `null` on both sides; the orchestrator reports the `unknown-function`
 * harness error for it separately.
 */
export function compareApiSurface(
  original: readonly ExportEntry[],
  resurrection: readonly ExportEntry[],
  radius?: readonly string[],
): ApiSurfaceDivergence[] {
  const left = index(original);
  const right = index(resurrection);
  const names = new Set<string>([...left.keys(), ...right.keys()]);

  const named =
    radius ??
    [...left.values()].filter((entry) => entry.type === "function").map((entry) => entry.name);
  for (const name of named) names.add(name);

  const out: ApiSurfaceDivergence[] = [];
  for (const name of [...names].sort(compareCodePoints)) {
    const a = left.get(name);
    const b = right.get(name);
    const sa = a === undefined ? null : toSummary(a);
    const sb = b === undefined ? null : toSummary(b);
    if (sa === null || sb === null ? sa !== sb || named.includes(name) : summariesDiffer(sa, sb)) {
      out.push(divergence(name, sa, sb));
    }
  }
  return out;
}
