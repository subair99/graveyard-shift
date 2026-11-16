// Resurrection_Predicate: strict schema, fixed key order, canonical JSON, parse and print,
// and the builder (R13.1, R13.6, R13.7, R13.11, R23.9, R23.10). Pure.

import { z } from "zod";

import type { Result } from "../../../engine/types";
import { canonicalJsonText, orderKeys } from "../../common/canonical";
import { PREDICATE_TYPE } from "../../common/constants";

const Sri512 = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/, "must be a sha512 SRI string");
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");

export const ResurrectionPredicateSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.object({ name: z.string(), version: z.string() }).strict(),
    original: z.object({ integrity: Sri512 }).strict(),
    resurrection: z.object({ name: z.string(), version: z.string(), treeHash: Sri512 }).strict(),
    digests: z
      .object({ tarball: Sha256Hex, proofReport: Sha256Hex, certificate: Sha256Hex })
      .strict(),
    verdict: z.literal("alive"),
    seed: z.number().int().min(-2147483648).max(2147483647),
    toolVersions: z
      .object({ node: z.string(), fastCheck: z.string(), reportSchema: z.literal(1) })
      .strict(),
    branchCommit: z.string().regex(/^[0-9a-f]{40}$/),
    run: z
      .object({ id: z.string().regex(/^[0-9]+$/), attempt: z.string().regex(/^[0-9]+$/) })
      .strict(),
    medium: z.object({ mode: z.enum(["local", "stub"]) }).strict(),
  })
  .strict();

export type ResurrectionPredicate = z.infer<typeof ResurrectionPredicateSchema>;

export const PREDICATE_KEY_ORDER = {
  predicate: [
    "schemaVersion",
    "package",
    "original",
    "resurrection",
    "digests",
    "verdict",
    "seed",
    "toolVersions",
    "branchCommit",
    "run",
    "medium",
  ],
  package: ["name", "version"],
  original: ["integrity"],
  resurrection: ["name", "version", "treeHash"],
  digests: ["tarball", "proofReport", "certificate"],
  toolVersions: ["node", "fastCheck", "reportSchema"],
  run: ["id", "attempt"],
  medium: ["mode"],
} as const;

type Obj = { [k: string]: unknown };
const asObj = (v: unknown): Obj => v as Obj;

/** The predicate as plain data in canonical key order. */
export function canonicalizePredicate(predicate: ResurrectionPredicate): unknown {
  const k = PREDICATE_KEY_ORDER;
  return orderKeys(predicate as unknown as Obj, k.predicate, {
    package: (v) => orderKeys(asObj(v), k.package),
    original: (v) => orderKeys(asObj(v), k.original),
    resurrection: (v) => orderKeys(asObj(v), k.resurrection),
    digests: (v) => orderKeys(asObj(v), k.digests),
    toolVersions: (v) => orderKeys(asObj(v), k.toolVersions),
    run: (v) => orderKeys(asObj(v), k.run),
    medium: (v) => orderKeys(asObj(v), k.medium),
  });
}

/** Canonical JSON: fixed key order, no whitespace. */
export function printPredicate(predicate: ResurrectionPredicate): string {
  return canonicalJsonText(canonicalizePredicate(predicate));
}

export interface PredicateError {
  /** Dotted path of the invalid field, or "(root)" for malformed JSON or a non-object. */
  field: string;
  message: string;
}

function parseValue(raw: unknown): Result<ResurrectionPredicate, PredicateError> {
  const parsed = ResurrectionPredicateSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0]!;
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") path.push(String(issue.keys[0]));
  return {
    ok: false,
    error: { field: path.length > 0 ? path.join(".") : "(root)", message: issue.message },
  };
}

/** Parses predicate JSON text. Names the invalid field (a non-alive verdict, an unknown mode). */
export function parsePredicate(text: string): Result<ResurrectionPredicate, PredicateError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: { field: "(root)", message: `malformed JSON: ${(e as Error).message}` },
    };
  }
  return parseValue(raw);
}

/** Everything the predicate holds except the two fixed fields. `verdict` is checked, not typed away. */
export type PredicateInput = Omit<ResurrectionPredicate, "schemaVersion" | "verdict" | "medium"> & {
  readonly verdict: string;
  readonly medium: { readonly mode: string };
};

/** Builds a validated predicate; a verdict other than `alive` or a mode other than local/stub fails naming the field. */
export function buildPredicate(
  input: PredicateInput,
): Result<{ predicateType: string; predicate: ResurrectionPredicate }, PredicateError> {
  const r = parseValue({ schemaVersion: 1, ...input });
  if (!r.ok) return r;
  return { ok: true, value: { predicateType: PREDICATE_TYPE, predicate: r.value } };
}
