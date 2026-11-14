import { z } from "zod";

// ---------------------------------------------------------------------------
// Result helper
// ---------------------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface SchemaFailure {
  /** Human-readable issues, each as "path: message". */
  issues: string[];
}

/** Parses `data` with `schema`; returns a typed failure instead of throwing. */
export function safeParseResult<S extends z.ZodType>(
  schema: S,
  data: unknown,
): Result<z.infer<S>, SchemaFailure> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: {
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    },
  };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const SECOND_PRECISION_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** True for `YYYY-MM-DDTHH:mm:ssZ` that is a real calendar instant. */
export function isSecondPrecisionUtc(value: string): boolean {
  if (!SECOND_PRECISION_UTC.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value.replace("Z", ".000Z");
}

export const UtcTimestampSchema = z
  .string()
  .refine(isSecondPrecisionUtc, { message: "must be UTC ISO 8601 YYYY-MM-DDTHH:mm:ssZ" });

function isAbsoluteUrl(value: string): boolean {
  if (value.trim().length === 0) return false;
  try {
    new URL(value);
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  } catch {
    return false;
  }
}

export const SourceUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isAbsoluteUrl, { message: "must be an absolute URL" });

export const StatusSchema = z.enum(["alive", "dying", "dead", "retired-with-successor"]);
export type Status = z.infer<typeof StatusSchema>;

export const CauseOfDeathSchema = z.enum([
  "maintainer-gone",
  "repo-archived",
  "unpatched-cve",
  "runtime-rot",
]);
export type CauseOfDeath = z.infer<typeof CauseOfDeathSchema>;

export const SourceNameSchema = z.enum(["npm", "osv", "deps.dev", "github"]);
export type SourceName = z.infer<typeof SourceNameSchema>;

const NonNegativeInt = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Death Certificate schemas
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.object({
  sourceUrl: SourceUrlSchema,
  fetchedAt: UtcTimestampSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const FactSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  provenance: z.array(ProvenanceSchema).min(1).max(20),
  stale: z.boolean().optional(),
});
export type Fact<T = unknown> = Omit<z.infer<typeof FactSchema>, "value"> & { value: T };

export type Maybe<T> =
  | { available: true; value: T }
  | {
      available: false;
      source: SourceName;
      attemptedUrl: string;
      attemptedAt: string;
      reason: string;
      rateLimitResetAt?: string;
    };

function maybeSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("available", [
    z.object({ available: z.literal(true), value }),
    z.object({
      available: z.literal(false),
      source: SourceNameSchema,
      attemptedUrl: z.string(),
      attemptedAt: UtcTimestampSchema,
      reason: z.string(),
      rateLimitResetAt: z.string().optional(),
    }),
  ]);
}

export const VulnerabilitySchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string()),
  summary: z.string(),
  severity: z.string().optional(),
});
export type Vulnerability = z.infer<typeof VulnerabilitySchema>;

export const VitalSignsSchema = z.object({
  maintainers: maybeSchema(z.array(z.string())),
  openVulnerabilities: maybeSchema(z.array(VulnerabilitySchema)),
  // null: deps.dev holds no Scorecard for the project.
  scorecard: maybeSchema(z.number().min(0).max(10).nullable()),
  dependents: maybeSchema(NonNegativeInt),
  weeklyDownloads: maybeSchema(NonNegativeInt),
});
export type VitalSigns = z.infer<typeof VitalSignsSchema>;

export const RiskBreakdownSchema = z.object({
  contributions: z.array(z.object({ component: z.string(), points: NonNegativeInt })),
  rawScore: NonNegativeInt,
  formula: z.object({
    weights: z.record(z.string(), z.number()),
    thresholds: z.record(z.string(), z.number()),
  }),
  unavailable: z.array(z.string()),
  note: z.string().optional(),
});
export type RiskBreakdown = z.infer<typeof RiskBreakdownSchema>;

export const DeathCertificateSchema = z
  .object({
    schemaVersion: z.literal(1),
    package: z.object({ name: z.string().min(1), version: z.string().min(1) }),
    analysisDate: UtcTimestampSchema,
    status: StatusSchema.optional(),
    statusError: z.string().optional(),
    causes: z.array(CauseOfDeathSchema),
    openVulnerabilityIds: z.array(z.string()),
    timeOfDeath: maybeSchema(UtcTimestampSchema),
    daysSinceDeath: NonNegativeInt.optional(),
    vitalSigns: VitalSignsSchema,
    successor: z.string().optional(),
    riskScore: z.number().int().min(0).max(100),
    risk: RiskBreakdownSchema,
    facts: z.array(FactSchema),
    notes: z.object({
      githubTokenUsed: z.boolean(),
      githubSkippedReason: z.string().optional(),
      omittedFacts: z.array(
        z.object({ key: z.string(), reason: z.literal("missing-provenance") }),
      ),
    }),
  })
  .refine((c) => c.status !== undefined || c.statusError !== undefined, {
    message: "status may be absent only when statusError is present",
    path: ["status"],
  });
export type DeathCertificate = z.infer<typeof DeathCertificateSchema>;

// ---------------------------------------------------------------------------
// Upstream response schemas: tolerant of extra fields (zod objects strip
// unknown keys by default), strict on the fields the engine uses.
// ---------------------------------------------------------------------------

export const NpmPackumentSchema = z.object({
  name: z.string().optional(),
  maintainers: z.array(z.object({ name: z.string() })).optional(),
  time: z.record(z.string(), z.string()).optional(),
  "dist-tags": z.object({ latest: z.string().optional() }).optional(),
  versions: z
    .record(z.string(), z.object({ deprecated: z.string().optional() }))
    .optional(),
  repository: z.union([z.string(), z.object({ url: z.string() })]).optional(),
});
export type NpmPackument = z.infer<typeof NpmPackumentSchema>;

export const NpmDownloadsSchema = z.object({ downloads: NonNegativeInt });
export type NpmDownloads = z.infer<typeof NpmDownloadsSchema>;

export const OsvResponseSchema = z.object({
  vulns: z
    .array(
      z.object({
        id: z.string().min(1),
        aliases: z.array(z.string()).optional(),
        summary: z.string().optional(),
        severity: z.array(z.object({ type: z.string(), score: z.string() })).optional(),
        affected: z
          .array(
            z.object({
              ranges: z
                .array(
                  z.object({
                    events: z.array(
                      z.object({ fixed: z.string().optional() }),
                    ),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
export type OsvResponse = z.infer<typeof OsvResponseSchema>;

/** deps.dev v3 GetProject. `scorecard` is present only when one exists. */
export const DepsDevProjectSchema = z.object({
  scorecard: z.object({ overallScore: z.number().min(0).max(10) }).optional(),
});
export type DepsDevProject = z.infer<typeof DepsDevProjectSchema>;

/** deps.dev v3alpha `:dependents`. */
export const DepsDevDependentsSchema = z.object({ dependentCount: NonNegativeInt });
export type DepsDevDependents = z.infer<typeof DepsDevDependentsSchema>;

export const GitHubRepoSchema = z.object({
  archived: z.boolean(),
  pushed_at: z.string().nullable().optional(),
});
export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;

// ---------------------------------------------------------------------------
// Errors, runs, inputs, configuration, injected dependencies
// ---------------------------------------------------------------------------

export interface AutopsyError {
  package?: string;
  range?: string;
  kind:
    | "not-found"
    | "range-unsatisfied"
    | "no-version"
    | "parse"
    | "fixture-missing"
    | "fixture-unparseable";
  message: string;
}

export interface AutopsyRun {
  certificates: DeathCertificate[];
  errors: AutopsyError[];
  notes: string[];
}

/** spec: exact version, range, or null (latest). */
export interface PackageRef {
  name: string;
  spec: string | null;
}

export type EngineInput =
  | { kind: "name"; name: string; version?: string }
  | { kind: "package.json"; text: string }
  | { kind: "package-lock.json"; text: string }
  | { kind: "other"; filename: string; text: string };

export interface Clock {
  now(): Date;
}

export interface EngineConfig {
  cacheTtlMs?: number;
  githubToken?: string;
  requestTimeoutMs: 10_000;
  concurrency: number;
}

export interface CacheEntry {
  body: string;
  status: number;
  fetchedAt: string;
}

export interface Cache {
  get(key: string): Promise<CacheEntry | undefined>;
  put(key: string, entry: CacheEntry): Promise<void>;
}

export interface EngineDeps {
  fetch: typeof fetch;
  clock: Clock;
  cache: Cache;
}

export type SourceResult<T> =
  | { status: "ok"; value: T; provenance: Provenance[]; stale?: boolean }
  | {
      status: "unavailable";
      source: SourceName;
      attemptedUrl: string;
      attemptedAt: string;
      reason: string;
      rateLimitResetAt?: string;
    }
  | { status: "not-found"; source: SourceName; url: string };
