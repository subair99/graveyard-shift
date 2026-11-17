// Path_Rules_File: the one source of the Shared_Path_Rules (medium-agent Requirement 3.11).
// Pure, dependency-free ES module: no imports, no I/O, no clock. The bodies and messages moved here verbatim from
// intake/core/validator.ts, intake/core/safePath.ts, intake/core/limits.ts and common/constants.ts.

export const ALLOWED_MEDIUM_PATHS = Object.freeze(["resurrection/", "deltas.json", "harness.json"]);
export const RESURRECTION_DIR = "resurrection/";
export const CONTROL_FILES = Object.freeze(["deltas.json", "harness.json"]);
export const FORBIDDEN_SEGMENTS = Object.freeze([".git", ".github", ".kiro"]);

/** U+0000 to U+001F and U+007F. */
export const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;

/** "U+000A" for "\n": the code point of a character, four hex digits, upper case. */
export function codePointLabel(character) {
  const code = character.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The first C0 control character or DEL in `path`, or null. */
export function firstControlCharacter(path) {
  const match = CONTROL_CHARACTER_PATTERN.exec(path);
  return match === null ? null : match[0];
}

/**
 * A path as it may be written to a log or a summary: every control character becomes `\u00XX`, so a path never
 * adds a line (for example one that starts with `::`, a workflow command) to the output.
 */
export function escapeControlCharacters(text) {
  return text.replace(CONTROL_CHARACTERS_GLOBAL, (c) => `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`);
}

export function badPathReason(path) {
  if (path.length === 0) return "empty path";
  const control = firstControlCharacter(path);
  if (control !== null) return `control character ${codePointLabel(control)} in path`;
  if (path.includes("\\")) return "backslash in path";
  if (/^[A-Za-z]:/.test(path)) return "drive prefix in path";
  if (path.startsWith("/")) return "absolute path";
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "") return "empty path segment";
    if (segment === "..") return "'..' path segment";
    if (FORBIDDEN_SEGMENTS.includes(segment.toLowerCase())) return `forbidden path segment '${segment}'`;
  }
  return null;
}

export function isAllowlisted(path) {
  return path.startsWith(RESURRECTION_DIR) || CONTROL_FILES.includes(path);
}

/** null when the Shared_Path_Rules accept `path`, otherwise the reason. Used by the Write_Guard. */
export function pathRuleProblem(path) {
  return (
    badPathReason(path) ??
    (isAllowlisted(path) ? null : "path is not under resurrection/ and is not deltas.json or harness.json")
  );
}
