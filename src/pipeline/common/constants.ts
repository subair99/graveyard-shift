// Shared constants of the resurrection pipeline. Pure data; no imports.

/** The only place with this string (R13.8). */
export const PREDICATE_TYPE =
  "https://github.com/subair99/graveyard-shift/attestation/resurrection/v1";

export const REPO = "subair99/graveyard-shift";

/** Workflow path without a ref (spike 4). A working name (A3). */
export const SIGNER_WORKFLOW = "subair99/graveyard-shift/.github/workflows/resurrect.yml";

export const PINNED_NODE_VERSION = "26.13.1";

export const GH_MIN_VERSION = "2.67.0";

/** A documented rule, not enforced by the Local_Runner (R7.6). */
export const CREDIT_CEILING = 150;

/** Chosen upper bounds, not measurements (decision A2). */
export const INTAKE_LIMITS = {
  maxFiles: 200,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 5_242_880,
  maxDepth: 8,
  maxControlFileBytes: 65_536,
} as const;

export const ALLOWED_MEDIUM_PATHS = ["resurrection/", "deltas.json", "harness.json"] as const;
