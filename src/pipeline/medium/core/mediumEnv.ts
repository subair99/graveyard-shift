/** Medium_Env_Keys. Keys are added only from the Journal records of medium-agent R11.8 and R11.7. */
export const MEDIUM_ENV_KEYS: readonly string[] = ["PATH", "HOME", "USER", "LANG", "TERM"];

export const SECRET_KEY_PATTERN = /_(TOKEN|KEY|SECRET)$/i;

export const MEDIUM_ADDED_KEYS = ["GRAVEYARD_CERTIFICATE_PATH", "GUARD_LOG_FILE"] as const;

/**
 * Builds the environment of the Medium process: the caller keys in
 * MEDIUM_ENV_KEYS (exact name) that have a value, minus any key matching
 * SECRET_KEY_PATTERN, plus the two added keys (absolute paths given by the caller).
 */
export function buildMediumEnv(
  caller: Readonly<Record<string, string | undefined>>,
  added: Readonly<Record<(typeof MEDIUM_ADDED_KEYS)[number], string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MEDIUM_ENV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(caller, key)) continue;
    const value = caller[key];
    if (value === undefined) continue;
    if (SECRET_KEY_PATTERN.test(key)) continue;
    env[key] = value;
  }
  for (const key of MEDIUM_ADDED_KEYS) {
    env[key] = added[key];
  }
  return env;
}
