// Pure helpers for control characters in Medium_Output paths (R9.6). No I/O.

/** U+0000 to U+001F and U+007F. */
export const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;

/** "U+000A" for "\n": the code point of a character, four hex digits, upper case. */
export function codePointLabel(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The first C0 control character or DEL in `path`, or null. */
export function firstControlCharacter(path: string): string | null {
  const match = CONTROL_CHARACTER_PATTERN.exec(path);
  return match === null ? null : match[0];
}

/**
 * A path as it may be written to a log or a summary: every control character becomes `\u00XX`, so a path never
 * adds a line (for example one that starts with `::`, a workflow command) to the output.
 */
export function safePathForLog(path: string): string {
  return path.replace(CONTROL_CHARACTERS_GLOBAL, (c) => `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`);
}
