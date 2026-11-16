// Copy plan of a Stub_Run (R23.2). Pure: the shell lists the fixture directory recursively and
// executes the plan. The plan is a plain recursive copy: no rename, no filter.

import { err, ok, type Result } from "../../common/result";
import { ALLOWED_MEDIUM_PATHS } from "../../common/constants";
import type { UsageError } from "./cliArgs";

export interface StubListEntry {
  /** Path relative to the fixture directory; `/` or `\` separators. */
  path: string;
  type: "file" | "directory" | "other";
}

export interface StubPathFns {
  join(...parts: string[]): string;
}

export interface StubCopyItem {
  /** Relative path with `/` separators; the same under the fixture and the repository root. */
  relative: string;
  from: string;
  to: string;
  type: "file" | "directory";
}

const REQUIRED: ReadonlyMap<string, "file" | "directory"> = new Map([
  ["resurrection", "directory"],
  ["deltas.json", "file"],
  ["harness.json", "file"],
]);

function usage(message: string): Result<never, UsageError> {
  return err({ kind: "usage", message });
}

/**
 * Checks that the fixture holds exactly `resurrection/`, `deltas.json` and `harness.json`, then
 * plans one copy per listed entry, sorted by relative path.
 */
export function planStubCopy(
  fixtureDir: string,
  repoRoot: string,
  entries: readonly StubListEntry[],
  pathFns: StubPathFns,
): Result<StubCopyItem[], UsageError> {
  const items: StubCopyItem[] = [];
  const topLevel = new Map<string, "file" | "directory" | "other">();
  for (const entry of entries) {
    const segments = entry.path.split(/[\\/]+/).filter((s) => s !== "");
    if (segments.length === 0) continue;
    const first = segments[0] as string;
    if (!REQUIRED.has(first)) {
      return usage(`the stub fixture ${fixtureDir} holds an unexpected entry: ${first} (expected exactly ${ALLOWED_MEDIUM_PATHS.join(", ")})`);
    }
    if (entry.type === "other") return usage(`the stub fixture entry ${segments.join("/")} is not a file or directory`);
    if (segments.length === 1) topLevel.set(first, entry.type);
    else if (REQUIRED.get(first) !== "directory") return usage(`the stub fixture entry ${first} must be a file`);
    const relative = segments.join("/");
    items.push({
      relative,
      from: pathFns.join(fixtureDir, ...segments),
      to: pathFns.join(repoRoot, ...segments),
      type: entry.type,
    });
  }
  for (const [name, type] of REQUIRED) {
    const found = topLevel.get(name);
    if (found === undefined) return usage(`the stub fixture ${fixtureDir} is missing ${name}`);
    if (found !== type) return usage(`the stub fixture entry ${name} must be a ${type}`);
  }
  items.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  return ok(items);
}
