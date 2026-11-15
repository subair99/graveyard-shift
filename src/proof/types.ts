import type * as fc from "fast-check";
import { z } from "zod";
import type { Result } from "../engine/types";
import type { EncodedNode } from "./child/codec/nodes";
import type { ExecutorFactory } from "./shell/executor/types";

// The Result helper is shared with the autopsy engine.
export type { Result };
export type { EncodedNode };

// ---------------------------------------------------------------------------
// EncodedNode (recursive, discriminated on `t`; shapes mirror child/codec/nodes.ts)
// ---------------------------------------------------------------------------

const TypedKindSchema = z.enum([
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "DataView",
  "Buffer",
]);

export const ReasonUnencodableSchema = z.enum(["cycle", "depth", "getter", "proxy"]);

export const EncodedNodeSchema: z.ZodType<EncodedNode> = z.lazy(() => {
  const node = EncodedNodeSchema;
  const prop = z.tuple([z.string(), node]);
  return z.discriminatedUnion("t", [
    z.object({ t: z.literal("undefined") }).strict(),
    z.object({ t: z.literal("null") }).strict(),
    z.object({ t: z.literal("bool"), v: z.boolean() }).strict(),
    z.object({ t: z.literal("str"), v: z.string() }).strict(),
    z
      .object({
        t: z.literal("num"),
        v: z.union([z.number(), z.enum(["NaN", "Infinity", "-Infinity", "-0"])]),
      })
      .strict(),
    z.object({ t: z.literal("bigint"), v: z.string() }).strict(),
    z.object({ t: z.literal("symbol"), v: z.string().nullable() }).strict(),
    z.object({ t: z.literal("date"), v: z.union([z.number(), z.literal("invalid")]) }).strict(),
    z.object({ t: z.literal("regexp"), source: z.string(), flags: z.string() }).strict(),
    z.object({ t: z.literal("map"), entries: z.array(z.tuple([node, node])) }).strict(),
    z.object({ t: z.literal("set"), items: z.array(node) }).strict(),
    z.object({ t: z.literal("arraybuffer"), b64: z.string() }).strict(),
    z.object({ t: z.literal("typed"), kind: TypedKindSchema, b64: z.string() }).strict(),
    z
      .object({ t: z.literal("error"), cls: z.string(), message: z.string(), props: z.array(prop) })
      .strict(),
    z
      .object({
        t: z.literal("array"),
        length: z.number().int().nonnegative(),
        items: z.array(z.object({ i: z.number().int().nonnegative(), n: node }).strict()),
        props: z.array(prop),
      })
      .strict(),
    z
      .object({ t: z.literal("object"), ctor: z.string().nullable(), props: z.array(prop) })
      .strict(),
    z
      .object({
        t: z.literal("function"),
        name: z.string(),
        arity: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ t: z.literal("unencodable"), reason: ReasonUnencodableSchema }).strict(),
  ]);
});

// ---------------------------------------------------------------------------
// Outcome and prototype delta entries
// ---------------------------------------------------------------------------

export const ProtoNameSchema = z.enum([
  "Object.prototype",
  "Array.prototype",
  "Function.prototype",
  "String.prototype",
  "Number.prototype",
  "Boolean.prototype",
]);
export type ProtoName = z.infer<typeof ProtoNameSchema>;

export const EncodedDescriptorSchema = z
  .object({
    value: EncodedNodeSchema.optional(),
    get: EncodedNodeSchema.optional(),
    set: EncodedNodeSchema.optional(),
    writable: z.boolean().optional(),
    enumerable: z.boolean(),
    configurable: z.boolean(),
  })
  .strict();
export type EncodedDescriptor = z.infer<typeof EncodedDescriptorSchema>;

export const DeltaEntrySchema = z
  .object({
    prototype: ProtoNameSchema,
    key: z.union([
      z.object({ s: z.string() }).strict(),
      z.object({ sym: z.string().nullable() }).strict(),
    ]),
    change: z.enum(["added", "changed", "removed"]),
    before: EncodedDescriptorSchema.optional(),
    after: EncodedDescriptorSchema.optional(),
  })
  .strict();
export type DeltaEntry = z.infer<typeof DeltaEntrySchema>;

const CompletedFields = {
  value: EncodedNodeSchema,
  args: z.array(EncodedNodeSchema),
  prototypeDelta: z.array(DeltaEntrySchema),
};

export const OutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("returned"), async: z.boolean(), ...CompletedFields }).strict(),
  z.object({ kind: z.literal("threw"), async: z.literal(false), ...CompletedFields }).strict(),
  z.object({ kind: z.literal("rejected"), async: z.literal(true), ...CompletedFields }).strict(),
  z
    .object({ kind: z.literal("timeout"), prototypeDelta: z.array(DeltaEntrySchema).optional() })
    .strict(),
  z.object({ kind: z.literal("crash") }).strict(),
  z.object({ kind: z.literal("output-too-large") }).strict(),
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

// ---------------------------------------------------------------------------
// Verdict, harness errors
// ---------------------------------------------------------------------------

export const VerdictSchema = z.enum(["alive", "restless", "inconclusive"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const HarnessErrorKindSchema = z.enum([
  "integrity-mismatch",
  "invalid-integrity",
  "unsafe-archive",
  "archive-too-large",
  "invalid-archive",
  "unloadable-module",
  "sandbox-unavailable",
  "unknown-function",
  "missing-generator",
  "normalization-collision",
  "temp-root-leak",
  "identity-leak",
  "runner-protocol-error",
  "too-many-crashes",
  "harness-config-error",
  "property-error",
  "generator-exhausted",
  "generator-violates-predicate",
  "irreproducible-divergence",
  "no-functions-tested",
]);
export type HarnessErrorKind = z.infer<typeof HarnessErrorKindSchema>;

export const HarnessErrorSchema = z
  .object({
    kind: HarnessErrorKindSchema,
    function: z.string().optional(),
    message: z.string(),
  })
  .strict();
export type HarnessError = z.infer<typeof HarnessErrorSchema>;

// ---------------------------------------------------------------------------
// Report parts
// ---------------------------------------------------------------------------

const CountSchema = z.number().int().nonnegative();
const Int32Schema = z.number().int().min(-2147483648).max(2147483647);

export const DifferenceSchema = z
  .object({
    part: z.enum(["kind", "async", "value", "args", "prototypeDelta"]),
    path: z.string(),
  })
  .strict();
export type Difference = z.infer<typeof DifferenceSchema>;

export const UnencodableCountSchema = z
  .object({
    function: z.string(),
    cases: CountSchema,
    casesWithUnencodable: CountSchema,
    total: CountSchema,
    reasons: z
      .object({ cycle: CountSchema, depth: CountSchema, getter: CountSchema, proxy: CountSchema })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.casesWithUnencodable > v.cases) {
      ctx.addIssue({
        code: "custom",
        path: ["casesWithUnencodable"],
        message: "casesWithUnencodable must not exceed cases",
      });
    }
    const sum = v.reasons.cycle + v.reasons.depth + v.reasons.getter + v.reasons.proxy;
    if (v.total !== sum) {
      ctx.addIssue({
        code: "custom",
        path: ["total"],
        message: "total must equal the sum of reasons",
      });
    }
  });
export type UnencodableCount = z.infer<typeof UnencodableCountSchema>;

export const ReplaySchema = z.union([
  z
    .object({
      phase: z.union([z.literal("generated"), z.templateLiteral(["delta:", z.string()])]),
      seed: Int32Schema,
      path: z.string(),
    })
    .strict(),
  z.object({ phase: z.literal("explicit"), index: CountSchema }).strict(),
]);
export type Replay = z.infer<typeof ReplaySchema>;

export const ExportSummarySchema = z
  .object({
    type: z.string(),
    fnName: z.string().optional(),
    arity: CountSchema.optional(),
    primitive: EncodedNodeSchema.optional(),
  })
  .strict();
export type ExportSummary = z.infer<typeof ExportSummarySchema>;

/**
 * `redactionMaskedDifference` is required on every entry: `false` when the identity
 * redaction did not hide a difference (Requirement 13.6, 13.30). It is the last key.
 */
export const DivergenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      function: z.string(),
      kind: z.enum(["unexplained", "delta-violation"]),
      deltaId: z.string().optional(),
      args: z.array(EncodedNodeSchema),
      replay: ReplaySchema,
      differences: z.array(DifferenceSchema),
      original: OutcomeSchema,
      resurrection: OutcomeSchema,
      shrink: z.object({ attempts: CountSchema, budgetExhausted: z.boolean() }).strict(),
      redactionMaskedDifference: z.boolean(),
    })
    .strict(),
  z
    .object({
      function: z.string(),
      kind: z.literal("api-surface"),
      apiSurface: z
        .object({
          export: z.string(),
          original: ExportSummarySchema.nullable(),
          resurrection: ExportSummarySchema.nullable(),
        })
        .strict(),
      redactionMaskedDifference: z.boolean(),
    })
    .strict(),
]);
export type Divergence = z.infer<typeof DivergenceSchema>;

export const PropertyResultReportSchema = z
  .object({ ok: z.boolean(), detail: EncodedNodeSchema.optional() })
  .strict();
export type PropertyResultReport = z.infer<typeof PropertyResultReportSchema>;

export const DeltaReportSchema = z
  .object({
    id: z.string(),
    function: z.string(),
    status: z.enum(["demonstrated", "not-demonstrated"]),
    predicateCasesChecked: CountSchema,
    demonstration: z
      .object({
        args: z.array(EncodedNodeSchema),
        original: PropertyResultReportSchema,
        resurrection: PropertyResultReportSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type DeltaReport = z.infer<typeof DeltaReportSchema>;

const SideCountsSchema = z.object({ original: CountSchema, resurrection: CountSchema }).strict();

export const ProofReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.object({ name: z.string(), version: z.string() }).strict(),
    original: z.object({ integrity: z.string(), verified: z.boolean() }).strict(),
    resurrection: z
      .object({ source: z.enum(["directory", "tarball"]), treeHash: z.string().nullable() })
      .strict(),
    sandbox: z
      .object({
        mechanism: z.enum(["node-permission", "in-process"]),
        restartEvents: SideCountsSchema,
        otherRestarts: SideCountsSchema,
        limits: z
          .object({
            callTimeoutMs: CountSchema,
            heapLimitMb: CountSchema,
            outputLimitBytes: CountSchema,
            maxRestarts: CountSchema,
            casesRequested: CountSchema,
            shrinkBudget: CountSchema,
          })
          .strict(),
      })
      .strict(),
    functionsTested: z.array(z.string()),
    casesPerFunction: z.array(z.object({ function: z.string(), cases: CountSchema }).strict()),
    unencodableValues: z.array(UnencodableCountSchema),
    excludedFunctions: z.array(z.object({ function: z.string(), reason: z.string() }).strict()),
    nonDeterministicFunctions: z.array(
      z
        .object({
          function: z.string(),
          args: z.array(EncodedNodeSchema),
          differences: z.array(DifferenceSchema),
        })
        .strict(),
    ),
    divergences: z.array(DivergenceSchema),
    deltas: z.array(DeltaReportSchema),
    harnessErrors: z.array(HarnessErrorSchema),
    verdict: VerdictSchema,
    seed: Int32Schema,
    toolVersions: z
      .object({ node: z.string(), fastCheck: z.string(), reportSchema: z.literal(1) })
      .strict(),
  })
  .strict();
export type ProofReport = z.infer<typeof ProofReportSchema>;

// ---------------------------------------------------------------------------
// Harness_Config (parent-side closures and sandbox-side module paths)
// ---------------------------------------------------------------------------

/**
 * RULE (Requirement 8.14, limitation L13): an arbitrary, an `accept` predicate or an
 * explicit-case generator must not use an unbounded `.filter(...)`, a rejection chain or a
 * retry loop. An arbitrary whose filter never accepts does not terminate in fast-check and
 * does not raise the skip counter. Reach a region of the input space by construction (build
 * the arbitrary so every value is in the region), or through the bounded `accept` predicate.
 * `validateRequest` cannot detect such a filter (Requirement 8.15), so this rule is carried
 * by the type definitions and by the Harness_Config documentation.
 */
export interface FunctionHarness {
  /**
   * Arbitrary of the argument tuple. No function-typed values (A7).
   * No unbounded `.filter(...)`, rejection chain or retry loop (Requirement 8.14): build the
   * values by construction, or use `accept`.
   */
  args: fc.Arbitrary<readonly unknown[]>;
  /**
   * Bounded rejection through `fc.pre`. Use it only with high-acceptance predicates. It is the
   * sanctioned way to restrict generated arguments; an unbounded `.filter(...)`, rejection
   * chain or retry loop is forbidden (Requirement 8.14).
   */
  accept?: (args: readonly unknown[]) => boolean;
  /**
   * Explicit cases, run before generated ones. Produce them directly; no `.filter`, rejection
   * chain or retry loop (Requirement 8.14).
   */
  explicitCases?: readonly (readonly unknown[])[];
  caseCount?: number;
  stubs?: { date?: boolean; random?: boolean };
}

export interface ExcludedFunction {
  excluded: true;
  reason: string;
}

export interface DeclaredDelta {
  id: string;
  function: string;
  /** Parent side, called on decoded copies only (Requirement 11.9). */
  predicate: (args: readonly unknown[]) => boolean;
  /** Absolute path, sandbox side. */
  propertyModule: string;
  /** Explicit in-predicate cases. No `.filter`, rejection chain or retry loop (Requirement 8.14). */
  explicitCases: readonly (readonly unknown[])[];
  /**
   * Constrained arbitrary of in-predicate arguments. Build it by construction. No unbounded
   * `.filter(...)`, rejection chain or retry loop (Requirement 8.14); the engine cannot detect
   * one (Requirement 8.15, L13).
   */
  generator?: fc.Arbitrary<readonly unknown[]>;
  caseCount?: number;
}

/** The Harness_Config. The no-unbounded-filter rule of Requirement 8.14 applies to every generator in it. */
export interface HarnessConfig {
  /** For the report only. */
  package: string;
  /** int32. */
  seed: number;
  /** Default 100, per function and phase. */
  caseCount: number;
  /** Default 1000. */
  perCallTimeoutMs: number;
  /** Default 256. */
  heapLimitMb: number;
  /** Default 1_048_576. */
  outputLimitBytes: number;
  /** Default 20, shared by both sides. */
  maxRestarts: number;
  /** Default 500 attempts per failing phase. */
  shrinkBudget: number;
  functions: Readonly<Record<string, FunctionHarness | ExcludedFunction>>;
  deltas: readonly DeclaredDelta[];
  /** Absolute path, sandbox side, applied to both sides. */
  setupModule?: string;
  setupModules?: { original?: string; resurrection?: string };
  /** Extra sandbox-side files or directories the modules above may require. */
  readPaths?: readonly string[];
}

// ---------------------------------------------------------------------------
// Request, dependencies, run
// ---------------------------------------------------------------------------

// Type-only import (erased at compile time): the pure core gains no runtime dependency on the shell.
export type { ExecutorFactory };

export interface ProofRequest {
  original: { name: string; version: string; tarballPath: string; integrity: string };
  resurrection: { kind: "directory" | "tarball"; path: string };
  /** Default: every exported function of the Original. */
  haunting?: readonly string[];
  harness: HarnessConfig;
  /** Default: the Sandbox_Executor. */
  executorFactory?: ExecutorFactory;
}

export interface ProofDeps {
  /** Default `os.tmpdir()`. */
  tempRoot: string;
  toolVersions: { node: string; fastCheck: string };
  /** Selects case-insensitive path matching. */
  platform: "win32" | "posix";
  /**
   * For the Path_Redactor. There is no home directory here: it is an Identity_Value, handled by
   * the Identity_Redactor.
   */
  knownPaths: { nodeDir: string; tmpDir: string };
  /** Snapshot of the parent environment, taken once in `defaultProofDeps()`. */
  env: Readonly<Record<string, string | undefined>>;
  /** Where `emit` writes. Tests inject a collector. */
  sink: (line: string) => void;
}

export interface ProofRun {
  report: ProofReport;
  json: string;
}

export class RequestValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "RequestValidationError";
    this.field = field;
  }
}
