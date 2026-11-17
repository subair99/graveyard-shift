// Pure helpers for control characters in Medium_Output paths (R9.6). No I/O.
// The rules live in the Path_Rules_File (medium/agent/pathRules.mjs); this module re-exports them.

import { escapeControlCharacters } from "../../medium/agent/pathRules.mjs";

export { CONTROL_CHARACTER_PATTERN, codePointLabel, firstControlCharacter } from "../../medium/agent/pathRules.mjs";

/**
 * A path as it may be written to a log or a summary: every control character becomes `\u00XX`, so a path never
 * adds a line (for example one that starts with `::`, a workflow command) to the output.
 */
export const safePathForLog: (path: string) => string = escapeControlCharacters;
