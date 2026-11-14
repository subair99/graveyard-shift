import fc from "fast-check";

/** Minimum number of cases every property test runs (Requirement 12.5). */
export const numRuns = 100;

function readSeed(): number | undefined {
  const raw = process.env["FC_SEED"];
  if (raw === undefined || raw.trim() === "") return undefined;
  const seed = Number(raw);
  if (!Number.isInteger(seed)) {
    throw new Error(`FC_SEED must be an integer, got "${raw}"`);
  }
  return seed;
}

/**
 * Shared fast-check parameters. When FC_SEED is unset, fast-check picks a
 * random seed and still reports it on failure. VerbosityLevel.Verbose makes
 * the failure message list the shrunk counterexample, the seed and the path
 * (Requirement 12.6).
 */
export function fcParams(): fc.Parameters<unknown> {
  const seed = readSeed();
  return {
    numRuns,
    verbose: fc.VerbosityLevel.Verbose,
    ...(seed !== undefined ? { seed } : {}),
  };
}

export const fcConfig: fc.Parameters<unknown> = fcParams();

export { fc };
