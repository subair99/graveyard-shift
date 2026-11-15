import { ProofReportSchema } from "../types";
import type { ProofReport, Result } from "../types";

export interface DeserializeIssue {
  /** Dotted field path, "(root)" for the document itself. */
  path: string;
  message: string;
}

export interface DeserializeError {
  kind: "malformed-json" | "invalid-report";
  /** Message that names the offending field path(s). */
  message: string;
  issues: DeserializeIssue[];
}

/** Parses and validates a Proof_Report. Never returns a partial report (Requirement 13.7). */
export function deserializeReport(json: string): Result<ProofReport, DeserializeError> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "invalid JSON";
    return {
      ok: false,
      error: {
        kind: "malformed-json",
        message: `(root): malformed JSON: ${detail}`,
        issues: [{ path: "(root)", message: `malformed JSON: ${detail}` }],
      },
    };
  }
  const parsed = ProofReportSchema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.map(String).join(".") || "(root)",
    message: i.message,
  }));
  return {
    ok: false,
    error: {
      kind: "invalid-report",
      message: issues.map((i) => `${i.path}: ${i.message}`).join("; "),
      issues,
    },
  };
}
