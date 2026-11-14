import semver from "semver";
import type { CauseOfDeath, Maybe } from "../types";

const DAY_MS = 86_400_000;
/** Dormancy_Threshold in whole days. "Exceeds" is strict. */
export const DORMANCY_THRESHOLD_DAYS = 730;

/** Signals for cause detection. Unavailable signals never produce a cause. */
export interface CauseSignals {
  /** npm maintainers list. */
  maintainers: Maybe<readonly string[]>;
  /** GitHub `archived` flag. */
  archived: Maybe<boolean>;
  /** Ids of the Open_Vulnerability list (already filtered). */
  openVulnerabilityIds: Maybe<readonly string[]>;
  /** Time_Of_Death as a UTC timestamp. */
  timeOfDeath: Maybe<string>;
  /** GitHub last push timestamp. `null`/absent means no push date. */
  lastPush: Maybe<string | null | undefined>;
}

/** Whole days from `from` to `to`, or undefined when `from` does not parse. */
function wholeDaysBetween(from: string, to: Date): number | undefined {
  const t = Date.parse(from);
  if (Number.isNaN(t)) return undefined;
  return Math.floor((to.getTime() - t) / DAY_MS);
}

/** Causes in the fixed order, each at most once. */
export function detectCauses(s: CauseSignals, analysisDate: Date): CauseOfDeath[] {
  const causes: CauseOfDeath[] = [];

  if (s.maintainers.available && s.maintainers.value.length === 0) {
    causes.push("maintainer-gone");
  }
  if (s.archived.available && s.archived.value === true) {
    causes.push("repo-archived");
  }
  if (s.openVulnerabilityIds.available && s.openVulnerabilityIds.value.length > 0) {
    causes.push("unpatched-cve");
  }
  if (s.timeOfDeath.available) {
    const sinceRelease = wholeDaysBetween(s.timeOfDeath.value, analysisDate);
    if (sinceRelease !== undefined && sinceRelease > DORMANCY_THRESHOLD_DAYS) {
      // A push date that is absent, null, unavailable or unparseable counts as "no push date".
      const push = s.lastPush.available ? s.lastPush.value : undefined;
      const sincePush = typeof push === "string" ? wholeDaysBetween(push, analysisDate) : undefined;
      if (sincePush === undefined || sincePush > DORMANCY_THRESHOLD_DAYS) {
        causes.push("runtime-rot");
      }
    }
  }
  return causes;
}

/** A vulnerability with the fixed versions OSV lists for it. */
export interface VulnerabilityRecord {
  id: string;
  fixedVersions: readonly string[];
}

function compareCodePoint(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * Ids of open vulnerabilities, ascending by code point, no duplicates.
 * A record is dropped only when one of its fixed versions is greater than the
 * analyzed version and is published on npm. Unparseable versions never drop a record.
 */
export function filterOpenVulnerabilities(
  vulns: readonly VulnerabilityRecord[],
  analyzedVersion: string,
  publishedVersions: Iterable<string>,
): string[] {
  const analyzed = semver.valid(analyzedVersion);
  const published = new Set<string>();
  for (const v of publishedVersions) {
    published.add(v);
    const clean = semver.valid(v);
    if (clean !== null) published.add(clean);
  }

  const patched = (v: VulnerabilityRecord): boolean => {
    if (analyzed === null) return false;
    return v.fixedVersions.some((f) => {
      const fixed = semver.valid(f);
      return fixed !== null && semver.gt(fixed, analyzed) && (published.has(f) || published.has(fixed));
    });
  };

  const ids = new Set<string>();
  for (const v of vulns) {
    if (!patched(v)) ids.add(v.id);
  }
  return [...ids].sort(compareCodePoint);
}
