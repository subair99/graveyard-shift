/**
 * Tarball_Extractor: the only module that imports `tar` (Requirement 3.7).
 *
 * It gunzips the input itself under a bounded output size (see toTarStream),
 * parses the tar stream with `tar.Parser`, reads every entry into memory under the limits,
 * validates every path and entry type itself, and only after the whole archive
 * passed does it write regular files with `fs` (exclusive create, never
 * following links). The parser itself does no sanitizing and has no size or
 * count limits (journal, task 1.11), so all checks live here.
 *
 * Errors:
 * - `unsafe-archive`: an entry rejected by the path or type checks. Carries a
 *   reason code and the entry name, with absolute paths redacted.
 * - `archive-too-large`: a limit overrun (compressed, uncompressed, entries).
 * - `invalid-archive`: `corrupt` for a parser error or abort that is not our own
 *   abort; `not-an-archive` for a TAR_BAD_ARCHIVE warning or zero entries.
 * The result is attributed to the first cause observed; the `abort` and `error`
 * events produced by our own `abort` call are not reported again.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { Parser } from "tar";
import type { ReadEntry } from "tar";
import type { Result } from "../../types";

export interface ExtractLimits {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxEntries: number;
}

export interface ExtractedFile {
  /** POSIX relative path with the leading `package/` removed. */
  path: string;
  bytes: Uint8Array;
}

export type UnsafeArchiveReason =
  | "entry-type"
  | "absolute-path"
  | "drive-prefix"
  | "parent-segment"
  | "outside-package"
  | "invalid-segment"
  | "backslash"
  | "colon"
  | "outside-destination"
  | "case-duplicate"
  | "path-conflict";

export type ExtractError =
  | { kind: "unsafe-archive"; reason: UnsafeArchiveReason; entry: string }
  | { kind: "archive-too-large"; limit: "compressed" | "uncompressed" | "entries" }
  | { kind: "invalid-archive"; reason: "corrupt" | "not-an-archive" };

/** Defaults from the design (assumption A4): 5 MiB, 20 MiB, 2000 entries. */
export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxCompressedBytes: 5 * 1024 * 1024,
  maxUncompressedBytes: 20 * 1024 * 1024,
  maxEntries: 2000,
};

const WRITE_CHUNK = 64 * 1024;
const MAX_ENTRY_NAME = 200;

/** Entry name for error messages: absolute paths are reduced to their last segment. */
function redactEntryName(raw: string): string {
  const slashed = raw.replace(/\\/g, "/");
  const printable = Array.from(slashed, (ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? "?" : ch)).join("");
  let shown = printable;
  if (printable.startsWith("/") || /^[A-Za-z]:/.test(printable)) {
    const segments = printable.split("/").filter((s) => s !== "");
    const last = segments.length > 0 ? segments[segments.length - 1] : "";
    shown = `<absolute>/${last ?? ""}`;
  }
  return shown.length > MAX_ENTRY_NAME ? `${shown.slice(0, MAX_ENTRY_NAME)}...` : shown;
}

type PathCheck = { ok: true; rel: string } | { ok: false; reason: UnsafeArchiveReason };

/** Validates an archive path; `rel` is the POSIX path below `package/` ('' for the directory itself). */
function checkPath(raw: string, destDir: string): PathCheck {
  const slashed = raw.replace(/\\/g, "/");
  if (slashed.startsWith("/")) return { ok: false, reason: "absolute-path" };
  if (/^[A-Za-z]:/.test(slashed)) return { ok: false, reason: "drive-prefix" };
  const trimmed = slashed.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  if (segments.includes("..")) return { ok: false, reason: "parent-segment" };
  if (segments[0] !== "package") return { ok: false, reason: "outside-package" };
  if (raw.includes("\\")) return { ok: false, reason: "backslash" };
  if (segments.some((s) => s.includes(":"))) return { ok: false, reason: "colon" };
  if (segments.some((s) => s === "" || s === ".")) return { ok: false, reason: "invalid-segment" };
  const rel = segments.slice(1).join("/");
  const root = path.resolve(destDir);
  const target = path.resolve(root, ...segments.slice(1));
  const back = path.relative(root, target);
  if (back === ".." || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) return { ok: false, reason: "outside-destination" };
  return { ok: true, rel };
}

interface Collected {
  rel: string;
  chunks: Buffer[];
}

function toBuffer(chunk: Buffer | string): Buffer {
  return typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk;
}

interface ParseOutcome {
  failure: ExtractError | null;
  files: Collected[];
  directories: string[];
}

/** Parses an uncompressed tar stream into memory, validating every entry. */
function parseArchive(tarBytes: Buffer, destDir: string, limits: ExtractLimits): Promise<ParseOutcome> {
  return new Promise<ParseOutcome>((resolve) => {
    // Compression sniffing is disabled: the stream is already uncompressed.
    const parser = new Parser({ zstd: false, brotli: false });
    const files: Collected[] = [];
    const directories: string[] = [];
    const seen = new Set<string>();
    let failure: ExtractError | null = null;
    let badArchive = false;
    let entryCount = 0;
    let uncompressed = 0; // sum of declared header sizes
    let actual = 0; // bytes actually read
    let settled = false;

    const settle = (): void => {
      if (settled) return;
      settled = true;
      let outcome = failure;
      if (outcome === null && (badArchive || entryCount === 0)) {
        outcome = { kind: "invalid-archive", reason: "not-an-archive" };
      }
      resolve({ failure: outcome, files, directories });
    };

    const fail = (error: ExtractError): void => {
      if (failure !== null) return;
      failure = error;
      parser.abort(new Error(`graveyard-shift extractor stopped: ${error.kind}`));
    };

    const onParserError = (err: Error): void => {
      if (failure === null) {
        failure = { kind: "invalid-archive", reason: "corrupt" };
      }
      settle();
    };

    parser.on("error", onParserError);
    parser.on("abort", onParserError);
    parser.on("warn", (code: string) => {
      if (code === "TAR_BAD_ARCHIVE") badArchive = true;
    });
    parser.on("finish", settle);
    parser.on("close", settle);

    parser.on("entry", (entry: ReadEntry) => {
      entry.resume();
      if (failure !== null) return;
      try {
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          fail({ kind: "archive-too-large", limit: "entries" });
          return;
        }
        uncompressed += entry.size;
        if (uncompressed > limits.maxUncompressedBytes) {
          fail({ kind: "archive-too-large", limit: "uncompressed" });
          return;
        }
        const unsafe = (reason: UnsafeArchiveReason): void =>
          fail({ kind: "unsafe-archive", reason, entry: redactEntryName(entry.path) });

        const isFile = entry.type === "File" || entry.type === "OldFile";
        if (!isFile && entry.type !== "Directory") {
          unsafe("entry-type");
          return;
        }
        const checked = checkPath(entry.path, destDir);
        if (!checked.ok) {
          unsafe(checked.reason);
          return;
        }
        if (checked.rel === "") {
          if (isFile) unsafe("outside-package");
          return;
        }
        const folded = checked.rel.normalize("NFC").toLowerCase();
        if (seen.has(folded)) {
          unsafe("case-duplicate");
          return;
        }
        seen.add(folded);
        if (!isFile) {
          directories.push(checked.rel);
          return;
        }
        const collected: Collected = { rel: checked.rel, chunks: [] };
        files.push(collected);
        entry.on("data", (chunk: Buffer | string) => {
          const buf = toBuffer(chunk);
          actual += buf.length;
          if (actual > limits.maxUncompressedBytes) {
            fail({ kind: "archive-too-large", limit: "uncompressed" });
            return;
          }
          collected.chunks.push(buf);
        });
      } catch {
        fail({ kind: "invalid-archive", reason: "corrupt" });
      }
    });

    try {
      for (let offset = 0; offset < tarBytes.length && failure === null; offset += WRITE_CHUNK) {
        parser.write(tarBytes.subarray(offset, Math.min(offset + WRITE_CHUNK, tarBytes.length)));
      }
      if (failure === null) parser.end();
    } catch {
      if (failure === null) failure = { kind: "invalid-archive", reason: "corrupt" };
      settle();
    }
  });
}

const GZIP_MAGIC = [0x1f, 0x8b] as const;
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
}

function gunzipBounded(bytes: Buffer, maxOutputLength: number): Promise<Result<Buffer, ExtractError>> {
  return new Promise((resolve) => {
    gunzip(bytes, { maxOutputLength }, (err, out) => {
      if (err === null) {
        resolve({ ok: true, value: out });
      } else if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        resolve({ ok: false, error: { kind: "archive-too-large", limit: "uncompressed" } });
      } else {
        resolve({ ok: false, error: { kind: "invalid-archive", reason: "corrupt" } });
      }
    });
  });
}

/**
 * Turns the input into an uncompressed tar stream under the limits. The gzip
 * layer is decompressed here, with `maxOutputLength`, instead of inside the
 * parser: the parser's only guard is a 1000x ratio, which a zero-filled bomb
 * reaches slowly (journal 1.11; 8 MiB of zeros took about 2.4 s to abort here).
 * The cap on the tar stream is the uncompressed limit plus a fixed allowance
 * of 1536 bytes (header, pax header and padding) per allowed entry; the
 * uncompressed limit itself is enforced on file sizes in the parser.
 * Nested gzip or zstd data is not an npm tarball and is rejected, so the parser
 * never decompresses anything itself.
 */
async function toTarStream(bytes: Uint8Array, limits: ExtractLimits): Promise<Result<Buffer, ExtractError>> {
  if (bytes.length > limits.maxCompressedBytes) {
    return { ok: false, error: { kind: "archive-too-large", limit: "compressed" } };
  }
  let tarBytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(tarBytes, GZIP_MAGIC)) {
    const cap = limits.maxUncompressedBytes + (limits.maxEntries + 2) * 1536;
    const unzipped = await gunzipBounded(tarBytes, cap);
    if (!unzipped.ok) return unzipped;
    tarBytes = unzipped.value;
  }
  if (startsWith(tarBytes, GZIP_MAGIC) || startsWith(tarBytes, ZSTD_MAGIC)) {
    return { ok: false, error: { kind: "invalid-archive", reason: "not-an-archive" } };
  }
  return { ok: true, value: tarBytes };
}

/** Detects a file that is also used as a directory prefix of another entry. */
function findConflict(files: Collected[], directories: string[]): string | null {
  const filePaths = new Set(files.map((f) => f.rel));
  const all = [...files.map((f) => f.rel), ...directories];
  for (const rel of all) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const prefix = parts.slice(0, i).join("/");
      if (filePaths.has(prefix)) return `package/${rel}`;
    }
  }
  for (const dir of directories) if (filePaths.has(dir)) return `package/${dir}`;
  return null;
}

/**
 * Extracts `package/` from a gzip tarball into `destDir`, which the caller
 * created and which must be empty. Nothing is written unless the whole archive
 * validated. Files are created with the exclusive flag `wx`.
 */
export async function extractTarball(
  bytes: Uint8Array,
  destDir: string,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<Result<ExtractedFile[], ExtractError>> {
  const stream = await toTarStream(bytes, limits);
  if (!stream.ok) return stream;
  const parsed = await parseArchive(stream.value, destDir, limits);
  if (parsed.failure !== null) return { ok: false, error: parsed.failure };

  const conflict = findConflict(parsed.files, parsed.directories);
  if (conflict !== null) {
    return { ok: false, error: { kind: "unsafe-archive", reason: "path-conflict", entry: redactEntryName(conflict) } };
  }

  const root = path.resolve(destDir);
  for (const dir of parsed.directories) {
    await mkdir(path.join(root, ...dir.split("/")), { recursive: true });
  }
  const out: ExtractedFile[] = [];
  for (const file of parsed.files) {
    const data = Buffer.concat(file.chunks);
    const target = path.join(root, ...file.rel.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
    out.push({ path: file.rel, bytes: new Uint8Array(data) });
  }
  return { ok: true, value: out };
}
