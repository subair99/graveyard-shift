import { DeathCertificateSchema } from "../types";
import type { DeathCertificate, Result } from "../types";

export interface DeserializeIssue {
  /** Dotted field path, "(root)" for the document itself. */
  path: string;
  message: string;
}

export interface DeserializeError {
  kind: "malformed-json" | "invalid-certificate";
  /** Message that names the offending field(s). */
  message: string;
  issues: DeserializeIssue[];
}

/** Parses and validates a Death_Certificate. Never returns a partial certificate (R10.7). */
export function deserialize(json: string): Result<DeathCertificate, DeserializeError> {
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
  const parsed = DeathCertificateSchema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.map(String).join(".") || "(root)",
    message: i.message,
  }));
  return {
    ok: false,
    error: {
      kind: "invalid-certificate",
      message: issues.map((i) => `${i.path}: ${i.message}`).join("; "),
      issues,
    },
  };
}
