// Declarations for pathRules.mjs (the .mjs body is not type-checked).

export declare const ALLOWED_MEDIUM_PATHS: readonly ["resurrection/", "deltas.json", "harness.json"];
export declare const RESURRECTION_DIR: "resurrection/";
export declare const CONTROL_FILES: readonly string[];
export declare const FORBIDDEN_SEGMENTS: readonly string[];
export declare const CONTROL_CHARACTER_PATTERN: RegExp;
export declare function codePointLabel(character: string): string;
export declare function firstControlCharacter(path: string): string | null;
export declare function escapeControlCharacters(text: string): string;
export declare function badPathReason(path: string): string | null;
export declare function isAllowlisted(path: string): boolean;
export declare function pathRuleProblem(path: string): string | null;
