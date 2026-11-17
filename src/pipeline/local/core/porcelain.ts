// Reads of `git status --porcelain -z` (medium-agent R10.1, R10.2, R10.5). Pure: no I/O.
import { err, ok, type Result } from "../../common/result";
import { safePathForLog } from "../../intake/core/safePath";

export const GIT_STATUS_ARGV = ["status", "--porcelain", "-z", "--untracked-files=all"] as const;
export const LEDGER_FIRST_MESSAGE = "commit ledger.json first";

const LEDGER_FILE = "ledger.json";
const RESURRECTION_PREFIX = "resurrection/";
const EXPECTED_FILES: ReadonlySet<string> = new Set(["deltas.json", "harness.json", LEDGER_FILE]);

/**
 * Paths of `git status --porcelain -z` output, in order. Each record is `XY PATH` ended by NUL.
 * A rename or copy record (X or Y is `R` or `C`) is followed by a second NUL-ended record with
 * the original path; both paths are returned.
 */
export function parsePorcelainZ(text: string): Result<string[], string> {
  if (text === "") return ok([]);
  if (!text.endsWith("\0")) return err("porcelain output does not end with a NUL");
  const records = text.slice(0, -1).split("\0");
  const paths: string[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i] as string;
    if (record.length < 4 || record[2] !== " ") {
      return err(`malformed porcelain record at index ${i}`);
    }
    paths.push(record.slice(3));
    const x = record[0];
    const y = record[1];
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      i += 1;
      const original = records[i];
      if (original === undefined || original === "") {
        return err(`missing original path for the record at index ${i - 1}`);
      }
      paths.push(original);
    }
  }
  return ok(paths);
}

/** Changed paths that are not under resurrection/ and are not deltas.json, harness.json or ledger.json. */
export function unexpectedChangedPaths(paths: readonly string[]): string[] {
  return paths.filter((path) => !path.startsWith(RESURRECTION_PREFIX) && !EXPECTED_FILES.has(path));
}

/** Lines for a dirty tree before the run: each path escaped, plus LEDGER_FIRST_MESSAGE when ledger.json is the only path. */
export function dirtyTreeLines(paths: readonly string[]): string[] {
  const lines = paths.map((path) => safePathForLog(path));
  if (paths.length > 0 && paths.every((path) => path === LEDGER_FILE)) {
    lines.push(LEDGER_FIRST_MESSAGE);
  }
  return lines;
}
