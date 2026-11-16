// Canonical JSON helpers and text redaction shared by the pipeline. Pure.

import { findIdentity, redactIdentity } from "../../proof/core/identity";
import type { IdentityValues, Platform } from "../../proof/core/identity";
import { compareCodePoints, ordered } from "../../proof/child/codec/order";

export { compareCodePoints };
export type { IdentityValues, Platform };

type Obj = { [k: string]: unknown };

/** Fixed key order for one object kind; keys that are absent or undefined are skipped. */
export function orderKeys(
  obj: Obj,
  keys: readonly string[],
  map: Readonly<Record<string, (v: unknown) => unknown>> = {},
): Obj {
  return ordered(obj, keys, map);
}

/** Canonical JSON: the value as given (already in key order), no whitespace. */
export function canonicalJsonText(value: unknown): string {
  return JSON.stringify(value);
}

export const CREDENTIAL_PLACEHOLDER = "<redacted-credential>";
export const PATH_PLACEHOLDER = "<path>";

// Order matters: Authorization swallows the rest of its line, so it runs first.
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /Authorization(?:[ \t]*[:=][^\r\n]*)?/gi,
  /Bearer(?:[ \t]+[^\s"']+)?/g,
  /github_pat_[A-Za-z0-9_]*/g,
  /gh[pousr]_[A-Za-z0-9_]*/g,
];

const ABSOLUTE_PATH_PATTERNS: readonly RegExp[] = [
  /[A-Za-z]:\\[^\s"'<>|]*/g,
  /(?<![A-Za-z0-9._~-])\/(?:home|Users|mnt)\/[^\s"'<>|]*/g,
];

function replaceAll(text: string, patterns: readonly RegExp[], placeholder: string): string {
  let out = text;
  for (const p of patterns) out = out.replace(p, placeholder);
  return out;
}

/** True when `text` holds a credential-shaped string or an absolute local path. */
export function hasCredentialOrPath(text: string): boolean {
  return [...CREDENTIAL_PATTERNS, ...ABSOLUTE_PATH_PATTERNS].some((p) => {
    p.lastIndex = 0;
    const found = p.test(text);
    p.lastIndex = 0;
    return found;
  });
}

/**
 * Redacts identity values (user-home and user name), credential-shaped strings (`ghp_`,
 * `github_pat_`, `Bearer `, `Authorization`) and absolute paths (`C:\`, `/home/`, `/Users/`,
 * `/mnt/`). Idempotent. `platform` is passed in because pure code reads no environment.
 */
export function redactText(text: string, identity: IdentityValues, platform: Platform): string {
  let out = redactIdentity(text, identity, platform);
  out = replaceAll(out, CREDENTIAL_PATTERNS, CREDENTIAL_PLACEHOLDER);
  out = replaceAll(out, ABSOLUTE_PATH_PATTERNS, PATH_PLACEHOLDER);
  return out;
}

/** True when the redaction scan finds an identity value, a credential or an absolute path. */
export function redactionScanFindsAnything(
  text: string,
  identity: IdentityValues,
  platform: Platform,
): boolean {
  return findIdentity(text, identity, platform).found || hasCredentialOrPath(text);
}
