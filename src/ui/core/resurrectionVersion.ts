// Version of a resurrection read from its package.json bytes (crypt-ui Requirement 2.10). Pure.

import * as semver from "semver";
import { err, ok, type Result } from "../../pipeline/common/result";

export function versionFromPackageJson(bytes: Uint8Array): Result<string, string> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err("package.json is not valid UTF-8");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("package.json is not valid JSON");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return err("package.json is not a JSON object");
  }
  const version = (json as Record<string, unknown>).version;
  if (typeof version !== "string") return err("package.json has no string version");
  if (semver.valid(version) !== version) return err(`package.json version is not a valid semver: ${version}`);
  return ok(version);
}
