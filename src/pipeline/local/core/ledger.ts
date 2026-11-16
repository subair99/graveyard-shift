// Ledger: one entry per Medium attempt (R7, R23.4). Pure: no I/O, no clock.
// Credit readings are kept as typed text and never parsed or computed (R7.4, R7.5).

import { z } from "zod";
import { safeParseResult, UtcTimestampSchema } from "../../../engine/types";
import type { SchemaFailure } from "../../../engine/types";
import { canonicalJsonText, orderKeys } from "../../common/canonical";
import type { Result } from "../../common/result";

export const NOT_PROVIDED = "not provided";
export const LEDGER_FILE_NAME = "ledger.json";

/** Fixed key order per object kind; the single source of truth for the serialized form. */
export const LEDGER_KEY_ORDER = {
  ledger: ["schemaVersion", "entries"],
  local: [
    "mode",
    "package",
    "version",
    "date",
    "creditBefore",
    "creditAfter",
    "exitCode",
    "kiroCliVersion",
    "cliUsage",
  ],
  stub: ["mode", "package", "version", "date", "fixture"],
} as const;

/** A path relative to the repository root: no absolute path, no drive prefix, no `..` segment (R7.10). */
export const RelativePathSchema = z.string().refine(isRelativePath, {
  message: "must be a relative path without drive prefix or `..` segment",
});

export function isRelativePath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]/).includes("..");
}

const LocalEntrySchema = z
  .object({
    mode: z.literal("local"),
    package: z.string(),
    version: z.string(),
    date: UtcTimestampSchema,
    creditBefore: z.string(),
    creditAfter: z.string(),
    exitCode: z.number().int(),
    kiroCliVersion: z.string(),
    cliUsage: z.string().optional(),
  })
  .strict();

const StubEntrySchema = z
  .object({
    mode: z.literal("stub"),
    package: z.string(),
    version: z.string(),
    date: UtcTimestampSchema,
    fixture: RelativePathSchema,
  })
  .strict();

export const LedgerEntrySchema = z.discriminatedUnion("mode", [LocalEntrySchema, StubEntrySchema]);
export const LedgerSchema = z
  .object({ schemaVersion: z.literal(1), entries: z.array(LedgerEntrySchema) })
  .strict();

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type LocalLedgerEntry = z.infer<typeof LocalEntrySchema>;
export type StubLedgerEntry = z.infer<typeof StubEntrySchema>;
export type Ledger = z.infer<typeof LedgerSchema>;

export interface LedgerFailure extends SchemaFailure {
  /** The file that failed to parse, as given by the caller (a repository-relative name). */
  file: string;
}

export function emptyLedger(): Ledger {
  return { schemaVersion: 1, entries: [] };
}

/** A reading is copied verbatim; an empty or whitespace-only reading becomes `not provided`. */
function reading(text: string): string {
  return text.trim() === "" ? NOT_PROVIDED : text;
}

export interface LocalEntryInput {
  package: string;
  version: string;
  date: string;
  creditBefore: string;
  creditAfter: string;
  exitCode: number;
  kiroCliVersion: string;
  cliUsage?: string | undefined;
}

export function buildLocalEntry(input: LocalEntryInput): LocalLedgerEntry {
  const entry: LocalLedgerEntry = {
    mode: "local",
    package: input.package,
    version: input.version,
    date: input.date,
    creditBefore: reading(input.creditBefore),
    creditAfter: reading(input.creditAfter),
    exitCode: input.exitCode,
    kiroCliVersion: input.kiroCliVersion,
  };
  if (input.cliUsage !== undefined && input.cliUsage !== "") entry.cliUsage = input.cliUsage;
  return entry;
}

export interface StubEntryInput {
  package: string;
  version: string;
  date: string;
  fixture: string;
}

/** A stub entry has no reading, no exit code and no kiro-cli version (R23.4). */
export function buildStubEntry(input: StubEntryInput): StubLedgerEntry {
  return {
    mode: "stub",
    package: input.package,
    version: input.version,
    date: input.date,
    fixture: input.fixture,
  };
}

/** Returns a new ledger whose first `n` entries equal the old ones (R7.8). */
export function appendEntry(ledger: Ledger, entry: LedgerEntry): Ledger {
  return { schemaVersion: ledger.schemaVersion, entries: [...ledger.entries, entry] };
}

function ordering(ledger: Ledger): { [k: string]: unknown } {
  return orderKeys(ledger as unknown as { [k: string]: unknown }, LEDGER_KEY_ORDER.ledger, {
    entries: (list) =>
      (list as LedgerEntry[]).map((e) =>
        orderKeys(
          e as unknown as { [k: string]: unknown },
          e.mode === "local" ? LEDGER_KEY_ORDER.local : LEDGER_KEY_ORDER.stub,
        ),
      ),
  });
}

/** Canonical JSON: fixed key order, no whitespace. */
export function canonicalLedgerJson(ledger: Ledger): string {
  return canonicalJsonText(ordering(ledger));
}

/** File form of `ledger.json`: canonical key order, 2-space indent, final newline. */
export function printLedger(ledger: Ledger): string {
  return JSON.stringify(ordering(ledger), null, 2) + "\n";
}

/**
 * Parses and validates ledger text. A failure names `file` (never an absolute path unless the
 * caller passes one) and lists each issue as "path: message" (R7.9).
 */
export function parseLedger(text: string, file: string = LEDGER_FILE_NAME): Result<Ledger, LedgerFailure> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { file, issues: [`(root): malformed JSON: ${detail}`] } };
  }
  const r = safeParseResult(LedgerSchema, data);
  if (r.ok) return r;
  return { ok: false, error: { file, issues: r.error.issues } };
}

/** One-line message for a parse failure: names the file and the failing paths. */
export function describeLedgerFailure(f: LedgerFailure): string {
  return `${f.file} is malformed: ${f.issues.join("; ")}`;
}
