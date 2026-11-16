// Usage text of `npm run resurrect`. Pure data.

export const USAGE_EXIT_CODE = 64;

export const USAGE_TEXT = [
  "Usage: npm run resurrect -- <package> [--stub <fixture-dir>]",
  "",
  "  <package>            exactly one unscoped npm package name",
  "  --stub <fixture-dir> relative directory under tests/pipeline/fixtures/ or tests/proof/fixtures/",
  "                       (no absolute path, no '..'); runs the stub copy instead of the Medium",
].join("\n");

/** The text written to standard error for a usage error: the reason, then the usage. */
export function formatUsageError(message: string): string {
  return `${message}\n\n${USAGE_TEXT}\n`;
}
