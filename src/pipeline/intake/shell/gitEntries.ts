// Reads the changed entries of one commit with git plumbing (R9.3, R9.4, R9.12). Nothing is checked out.
// Resolve the branch once (the caller passes the SHA), fetch, verify the tip, merge base, diff, cat-file.

import { spawn } from "node:child_process";
import { INTAKE_LIMITS } from "../../common/constants";
import { isAllowlisted } from "../../medium/agent/pathRules.mjs";
import { err, ok, type Result } from "../../common/result";
import type { EntryType, IntakeEntry } from "../core/types";

export const BRANCH_CHANGED_MESSAGE = "branch changed during intake";

export interface GitEntriesOptions {
  /** Repository directory (the CI checkout). */
  readonly cwd: string;
  /** The SHA resolved once by the caller (for example with `gh api ... --jq .object.sha`). */
  readonly expectedSha: string;
  /** Remote and ref to fetch, for example `origin` and `refs/heads/resurrect/ip`. */
  readonly remote: string;
  readonly branchRef: string;
  /** Ref to compute the merge base with. Default `main`. */
  readonly baseRef?: string;
  /** Environment of every git call. Default: the process environment. */
  readonly env?: NodeJS.ProcessEnv;
}

export function modeToType(mode: string): EntryType {
  if (mode === "100644" || mode === "100755") return "file";
  if (mode === "120000") return "symlink";
  if (mode === "160000") return "submodule";
  return "other";
}

interface GitOut {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

function runGit(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv | undefined, input?: string): Promise<GitOut> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...args], { cwd, env: env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(errChunks).toString("utf8") }),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });
}

async function git(args: readonly string[], o: GitEntriesOptions, input?: string): Promise<Result<Buffer, string>> {
  const r = await runGit(args, o.cwd, o.env, input);
  if (r.code !== 0) return err(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return ok(r.stdout);
}

interface Changed {
  readonly path: string;
  readonly mode: string;
  readonly blob: string;
}

/** Parses `git diff --raw -z --no-renames` output. Deleted paths are not entries of the branch. */
export function parseRawDiff(raw: string): Changed[] {
  const parts = raw.split("\0");
  const changed: Changed[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!.split(" ");
    const path = parts[i + 1]!;
    const newMode = meta[1] ?? "";
    const blob = meta[3] ?? "";
    if (meta[4]?.startsWith("D") || newMode === "000000") continue;
    changed.push({ path, mode: newMode, blob });
  }
  return changed;
}

function parseBatchCheck(text: string, shas: readonly string[]): Map<string, number> {
  const sizes = new Map<string, number>();
  const lines = text.split("\n");
  shas.forEach((sha, i) => {
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(lines[i] ?? "");
    if (m) sizes.set(sha, Number(m[1]));
  });
  return sizes;
}

function parseBatch(buf: Buffer, shas: readonly string[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let pos = 0;
  for (const sha of shas) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(buf.subarray(pos, nl).toString("utf8"));
    if (!m) {
      pos = nl + 1;
      continue;
    }
    const size = Number(m[1]);
    out.set(sha, new Uint8Array(buf.subarray(nl + 1, nl + 1 + size)));
    pos = nl + 1 + size + 1;
  }
  return out;
}

export async function readGitEntries(o: GitEntriesOptions): Promise<Result<IntakeEntry[], string>> {
  const fetched = await git(["fetch", "--no-tags", "--quiet", o.remote, o.branchRef], o);
  if (!fetched.ok) return fetched;
  const tipRes = await git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], o);
  if (!tipRes.ok) return tipRes;
  const tip = tipRes.value.toString("utf8").trim();
  if (tip !== o.expectedSha) return err(BRANCH_CHANGED_MESSAGE);

  const baseRes = await git(["merge-base", o.baseRef ?? "main", tip], o);
  if (!baseRes.ok) return baseRes;
  const base = baseRes.value.toString("utf8").trim();

  const diff = await git(["diff", "--raw", "-z", "--no-renames", base, tip], o);
  if (!diff.ok) return diff;
  const changed = parseRawDiff(diff.value.toString("utf8"));

  const blobs = [...new Set(changed.filter((c) => modeToType(c.mode) === "file").map((c) => c.blob))];
  let sizes = new Map<string, number>();
  if (blobs.length > 0) {
    const check = await git(["cat-file", "--batch-check"], o, blobs.join("\n") + "\n");
    if (!check.ok) return check;
    sizes = parseBatchCheck(check.value.toString("utf8"), blobs);
  }

  const readable = blobs.filter((sha) => {
    const size = sizes.get(sha);
    return size !== undefined && size <= INTAKE_LIMITS.maxFileBytes;
  });
  const wanted = new Set(
    changed.filter((c) => modeToType(c.mode) === "file" && isAllowlisted(c.path)).map((c) => c.blob),
  );
  const toRead = readable.filter((sha) => wanted.has(sha));
  let contents = new Map<string, Uint8Array>();
  if (toRead.length > 0) {
    const batch = await git(["cat-file", "--batch"], o, toRead.join("\n") + "\n");
    if (!batch.ok) return batch;
    contents = parseBatch(batch.value, toRead);
  }

  const entries: IntakeEntry[] = changed.map((c) => {
    const type = modeToType(c.mode);
    if (type !== "file") return { path: c.path, type, size: 0 };
    const size = sizes.get(c.blob) ?? 0;
    const bytes = isAllowlisted(c.path) ? contents.get(c.blob) : undefined;
    return bytes ? { path: c.path, type, size, bytes } : { path: c.path, type, size };
  });
  return ok(entries);
}
