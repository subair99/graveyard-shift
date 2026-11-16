// Requirements: 9.3, 9.4, 9.5, 9.6, 9.12
// Git plumbing against a throwaway local repository. No network. Commits are built with plumbing
// (hash-object, update-index --cacheinfo, write-tree, commit-tree), so a symlink entry, a submodule
// entry and a case collision exist in the tree without touching the platform file system.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import { BRANCH_CHANGED_MESSAGE, readGitEntries } from "../../../src/pipeline/intake/shell/gitEntries";

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
};
const IDENT = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.ignorecase=false"];

function git(cwd: string, args: string[], input?: string, env: NodeJS.ProcessEnv = ENV): string {
  const r = spawnSync("git", [...IDENT, ...args], { cwd, env, input, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

interface Item {
  path: string;
  mode: string;
  content?: string;
  sha?: string;
}

let n = 0;
/** Builds a commit from `parent`'s tree plus `items`, with no working tree. */
function commit(repo: string, parent: string | null, items: Item[], ref: string): string {
  const env = { ...ENV, GIT_INDEX_FILE: join(repo, ".git", `idx-${n++}`) };
  if (parent) git(repo, ["read-tree", parent], undefined, env);
  for (const it of items) {
    const sha = it.sha ?? git(repo, ["hash-object", "-w", "--stdin"], it.content ?? "");
    git(repo, ["update-index", "--add", "--cacheinfo", `${it.mode},${sha},${it.path}`], undefined, env);
  }
  const tree = git(repo, ["write-tree"], undefined, env);
  const sha = git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "c"], undefined, env);
  git(repo, ["update-ref", ref, sha]);
  return sha;
}

let src: string;
let work: string;

beforeEach(async () => {
  src = await mkdtemp(join(tmpdir(), "gs-git-src-"));
  work = await mkdtemp(join(tmpdir(), "gs-git-work-"));
  git(src, ["init", "-q"]);
  git(work, ["init", "-q"]);
});
afterEach(async () => {
  await rm(src, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

const BRANCH = "refs/heads/resurrect/demo";
const read = (expectedSha: string) =>
  readGitEntries({ cwd: work, env: ENV, expectedSha, remote: src, branchRef: BRANCH });

function seedMain(): string {
  const main = commit(src, null, [{ path: "README.md", mode: "100644", content: "main\n" }], "refs/heads/main");
  git(work, ["fetch", "-q", src, "refs/heads/main:refs/heads/main"]);
  return main;
}

describe("gitEntries (local throwaway repository)", () => {
  it("maps modes, reads bytes only for allowlisted files, and the validator reports link, case and allowlist violations", async () => {
    const main = seedMain();
    const tip = commit(
      src,
      main,
      [
        { path: "resurrection/package.json", mode: "100644", content: '{"name":"x"}\n' },
        { path: "resurrection/run.sh", mode: "100755", content: "echo\n" },
        { path: "resurrection/link.js", mode: "120000", content: "../../etc/passwd" },
        { path: "resurrection/sub", mode: "160000", sha: "1".repeat(40) },
        { path: "resurrection/Case.js", mode: "100644", content: "a\n" },
        { path: "resurrection/case.js", mode: "100644", content: "b\n" },
        { path: "outside.js", mode: "100644", content: "x\n" },
        { path: "deltas.json", mode: "100644", content: "{}\n" },
      ],
      BRANCH,
    );
    const res = await read(tip);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byPath = new Map(res.value.map((e) => [e.path, e]));
    expect(byPath.get("resurrection/package.json")?.type).toBe("file");
    expect(new TextDecoder().decode(byPath.get("resurrection/package.json")?.bytes)).toBe('{"name":"x"}\n');
    expect(byPath.get("resurrection/run.sh")?.type).toBe("file");
    expect(byPath.get("resurrection/link.js")?.type).toBe("symlink");
    expect(byPath.get("resurrection/link.js")?.bytes).toBeUndefined();
    expect(byPath.get("resurrection/sub")?.type).toBe("submodule");
    expect(byPath.get("outside.js")?.type).toBe("file");
    expect(byPath.get("outside.js")?.bytes).toBeUndefined();
    expect(byPath.has("README.md")).toBe(false); // unchanged since the merge base

    const verdict = validateIntake(res.value);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    const codes = new Set(verdict.violations.map((v) => `${v.path}:${v.code}`));
    expect(codes).toContain("resurrection/link.js:link");
    expect(codes).toContain("resurrection/sub:link");
    expect(codes).toContain("outside.js:outside-allowlist");
    expect([...codes].some((c) => c.endsWith(":case-collision"))).toBe(true);
  });

  it("fails with 'branch changed during intake' when the tip moved after it was resolved", async () => {
    const main = seedMain();
    const resolved = commit(src, main, [{ path: "deltas.json", mode: "100644", content: "{}\n" }], BRANCH);
    commit(src, resolved, [{ path: "harness.json", mode: "100644", content: "{}\n" }], BRANCH);
    const res = await read(resolved);
    expect(res).toEqual({ ok: false, error: BRANCH_CHANGED_MESSAGE });
  });

  it("reports a changed path outside the allowlist on a branch that carries main", async () => {
    const main = seedMain();
    const tip = commit(
      src,
      main,
      [
        { path: "README.md", mode: "100644", content: "edited\n" },
        { path: "resurrection/package.json", mode: "100644", content: "{}\n" },
      ],
      BRANCH,
    );
    const res = await read(tip);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const verdict = validateIntake(res.value);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.violations.some((v) => v.path === "README.md" && v.code === "outside-allowlist")).toBe(true);
  });
});
