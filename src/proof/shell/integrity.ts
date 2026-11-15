// Integrity verification of the Original tarball (Requirement 2).
// Only `sha512-<base64>` SRI strings are valid. One or more space-separated
// sha512 entries are accepted (the tarball must match at least one). Any other
// algorithm (sha1, md5, sha256, sha384) or malformed entry makes the whole
// string invalid, so a weak hash can never pin a tarball.

import { createHash } from "node:crypto";

import type { Result } from "../types";

const PREFIX = "sha512-";
const DIGEST_BYTES = 64;

export type IntegrityError =
  | { kind: "invalid-integrity"; message: string }
  | { kind: "integrity-mismatch"; message: string; expected: string; actual: string };

/** Computes the `sha512-<base64>` SRI string of the given bytes. */
export function computeSri(bytes: Uint8Array): string {
  return PREFIX + createHash("sha512").update(bytes).digest("base64");
}

function invalid(expected: string, why: string): Result<never, IntegrityError> {
  return {
    ok: false,
    error: {
      kind: "invalid-integrity",
      message: `Invalid integrity string ${JSON.stringify(expected)}: ${why}`,
    },
  };
}

/** Parses an SRI string into decoded sha512 digests. */
export function parseSri(sri: string): Result<Buffer[], IntegrityError> {
  const tokens = sri.split(/[ \t\r\n]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return invalid(sri, "empty");
  const digests: Buffer[] = [];
  for (const token of tokens) {
    if (!token.startsWith(PREFIX)) return invalid(sri, "only sha512 is supported");
    const b64 = token.slice(PREFIX.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return invalid(sri, "not valid base64");
    const digest = Buffer.from(b64, "base64");
    if (digest.length !== DIGEST_BYTES || digest.toString("base64") !== b64) {
      return invalid(sri, "not a canonical base64 sha512 digest");
    }
    digests.push(digest);
  }
  return { ok: true, value: digests };
}

/**
 * Verifies the tarball bytes against the expected SRI string. Returns the
 * matching SRI string (`sha512-<base64>`) on success.
 */
export function verifyIntegrity(bytes: Uint8Array, expected: string): Result<string, IntegrityError> {
  const parsed = parseSri(expected);
  if (!parsed.ok) return parsed;
  const actualDigest = createHash("sha512").update(bytes).digest();
  const actual = PREFIX + actualDigest.toString("base64");
  if (parsed.value.some((d) => d.equals(actualDigest))) return { ok: true, value: actual };
  return {
    ok: false,
    error: {
      kind: "integrity-mismatch",
      message: `Integrity mismatch: expected ${expected}, computed ${actual}`,
      expected,
      actual,
    },
  };
}
