// Run record of the last nightly run (crypt-ui Requirement 12.2). Pure.
// `conclusion` is checked for shape only, so a value GitHub adds later is accepted and shown as written.

import { z } from "zod";
import { UtcTimestampSchema } from "../../engine/types";

export const NightlyRunRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.number().int().positive(),
    runStartedAt: UtcTimestampSchema,
    conclusion: z.string().regex(/^[a-z_]{1,32}$/),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
    buildSha: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict();

export type NightlyRunRecord = z.infer<typeof NightlyRunRecordSchema>;

/**
 * Conclusion values listed for the `status` parameter of "List workflow runs for a repository"
 * (https://docs.github.com/en/rest/actions/workflow-runs, read 2026-11-17). For tests and generators only.
 */
export const DOCUMENTED_CONCLUSIONS = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "stale",
  "timed_out",
  "action_required",
] as const;
