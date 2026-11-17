// Declarations for writeGuard.mjs (the .mjs body is not type-checked).

export interface GuardFs {
  /** null for ENOENT / ENOTDIR; other errors throw. */
  lstat(p: string): { isSymbolicLink(): boolean } | null;
  /** Throws for a dangling link. */
  realpath(p: string): string;
}

export interface GuardDecision {
  exitCode: 0 | 2;
  /** "write-guard: blocked: <reason>" for exit 2, otherwise null. */
  stderrLine: string | null;
  /** tool_name when it is a string. */
  tool: string | null;
  reason: string;
  /** Raw target paths as given, for the log. */
  paths: readonly string[];
}

export declare const WRITE_TOOLS: readonly string[];
export declare const PATH_KEYS: readonly string[];
export declare function decide(eventText: string, fs: GuardFs): GuardDecision;
export declare function formatLogLine(decision: GuardDecision, at: Date): string;
