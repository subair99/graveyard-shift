import semver from "semver";
import type { AutopsyError, Result } from "../types";

export type ResolveError = AutopsyError;

/**
 * Resolves a package spec to a concrete version. Pure.
 *
 * Signature extends the design's `resolveVersion(spec, published, latestTag)`
 * with a leading `name` parameter, so errors can name the package (R1.7, R1.11).
 *
 * - `spec === null`: returns `latestTag`; error if the registry reports no version (R1.4, R1.11).
 * - exact semver version: returned unchanged (R1.5).
 * - range: `semver.maxSatisfying(published, range)`; error naming package and range if none (R1.6, R1.7).
 */
export function resolveVersion(
  name: string,
  spec: string | null,
  published: readonly string[],
  latestTag: string | null,
): Result<string, ResolveError> {
  if (spec === null) {
    if (latestTag === null || latestTag === "") {
      return {
        ok: false,
        error: {
          package: name,
          kind: "no-version",
          message: `Package "${name}" has no published version (no dist-tags.latest).`,
        },
      };
    }
    return { ok: true, value: latestTag };
  }

  if (semver.valid(spec) !== null) return { ok: true, value: spec };

  if (semver.validRange(spec) === null) {
    return {
      ok: false,
      error: {
        package: name,
        range: spec,
        kind: "parse",
        message: `Package "${name}": "${spec}" is not a valid semver version or range.`,
      },
    };
  }

  const best = semver.maxSatisfying([...published], spec);
  if (best === null) {
    return {
      ok: false,
      error: {
        package: name,
        range: spec,
        kind: "range-unsatisfied",
        message: `No published version of "${name}" satisfies range "${spec}".`,
      },
    };
  }
  return { ok: true, value: best };
}
