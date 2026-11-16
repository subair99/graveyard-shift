// Requirements: 6.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9, 8.11, 8.12, 23.6
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_MEDIUM_PATHS, REPO } from "../../../src/pipeline/common/constants";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";
import { planPush } from "../../../src/pipeline/local/core/pushPlan";
import type { CommandRunner, CommandResult } from "../../../src/pipeline/local/shell/gitPlumbing";
import { runEligibilityDispatch, runPush, type PushDeps } from "../../../src/pipeline/local/shell/push";

const FIXTURE = resolve(__dirname, "../fixtures/stub/lodash.set");
const SHA = "a".repeat(40);
const EMAIL = "1234+someone@users.noreply.github.com";

interface Call {
  command: string;
  argv: string[];
  env?: Record<string, string>;
}

function fakes(opts: { email?: string; branchExists?: boolean; failOn?: string; confirm?: boolean; entries?: boolean } = {}) {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const runner: CommandRunner = {
    async run(command, argv, options): Promise<CommandResult> {
      calls.push({ command, argv: [...argv], env: options?.env as Record<string, string> | undefined });
      const text = `${command} ${argv.join(" ")}`;
      if (opts.failOn !== undefined && text.startsWith(opts.failOn)) return { code: 1, stdout: "", stderr: "boom" };
      if (text === "git config user.email") {
        return opts.email === "" ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: `${opts.email ?? EMAIL}\n`, stderr: "" };
      }
      if (argv[0] === "ls-remote") return { code: 0, stdout: opts.branchExists ? `${SHA}\trefs/heads/resurrect/lodash.set\n` : "", stderr: "" };
      if (argv[0] === "hash-object") return { code: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" };
      if (argv[0] === "write-tree") return { code: 0, stdout: `${"c".repeat(40)}\n`, stderr: "" };
      if (argv[0] === "commit-tree") return { code: 0, stdout: `${SHA}\n`, stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const deps: PushDeps = {
    runner,
    readEntries: (root) => readFsEntries(root, ALLOWED_MEDIUM_PATHS),
    confirmEmail: async (email) => {
      calls.push({ command: "confirm", argv: [email] });
      return opts.confirm ?? true;
    },
    makeTempIndex: async () => ({ path: "/tmp/idx", cleanup: async () => undefined }),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { calls, out, err, deps };
}

const input = { package: "lodash.set", version: "4.3.3", mode: "stub" as const, root: FIXTURE };

describe("Push_Script", () => {
  it("asks for the email first and pushes the three paths, then dispatches", async () => {
    const f = fakes();
    expect(await runPush(input, f.deps)).toBe(0);
    const names = f.calls.map((c) => `${c.command} ${c.argv[0]}`);
    expect(names.slice(0, 3)).toEqual(["git config", `confirm ${EMAIL}`, "git fetch"]);
    const indexCalls = f.calls.filter((c) => ["read-tree", "hash-object", "update-index", "write-tree", "commit-tree"].includes(c.argv[0] ?? ""));
    expect(indexCalls.every((c) => c.env?.GIT_INDEX_FILE === "/tmp/idx")).toBe(true);
    const added = f.calls.filter((c) => c.argv[0] === "update-index").map((c) => c.argv[3]?.split(",")[2]);
    expect(added).toContain("deltas.json");
    expect(added).toContain("harness.json");
    expect(added.every((p) => p === "deltas.json" || p === "harness.json" || p?.startsWith("resurrection/"))).toBe(true);
    expect(added).not.toContain("ledger.json");
    const push = f.calls.find((c) => c.argv[0] === "push");
    expect(push?.argv).toEqual(["push", "origin", `${SHA}:refs/heads/resurrect/lodash.set`]);
    expect(push?.argv).not.toContain("--force");
    const gh = f.calls.find((c) => c.command === "gh");
    expect(gh?.argv).toEqual([
      "workflow", "run", "resurrect.yml", "--repo", REPO, "--ref", "main",
      "-f", "package=lodash.set", "-f", "version=4.3.3", "-f", "branch=resurrect/lodash.set", "-f", "medium_mode=stub",
    ]);
    expect(f.out.join("\n")).toContain(`https://github.com/${REPO}/actions/workflows/resurrect.yml`);
    expect([...f.out, ...f.err].join("\n")).not.toContain(EMAIL);
  });

  it("runs no further git command when the email is missing or not confirmed", async () => {
    const none = fakes({ email: "" });
    expect(await runPush(input, none.deps)).toBe(1);
    expect(none.calls.map((c) => c.argv[0])).toEqual(["config"]);
    const no = fakes({ confirm: false });
    expect(await runPush(input, no.deps)).toBe(1);
    expect(no.calls.map((c) => c.argv[0])).toEqual(["config", EMAIL]);
    expect(no.err.join("\n")).not.toContain(EMAIL);
  });

  it("stops before pushing when the branch exists and only prints the delete command", async () => {
    const f = fakes({ branchExists: true });
    expect(await runPush(input, f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("git push origin --delete resurrect/lodash.set");
    expect(f.calls.some((c) => c.argv[0] === "push" || c.argv[0] === "--delete" || c.command === "gh")).toBe(false);
  });

  it("validates before any git command", async () => {
    const f = fakes();
    f.deps = { ...f.deps, readEntries: async () => [{ path: "ledger.json", type: "file", size: 1, bytes: new Uint8Array([1]) }] };
    expect(await runPush(input, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
    expect(f.err.join("\n")).toContain("ledger.json");
  });

  it("names the failing command and exits non-zero", async () => {
    const f = fakes({ failOn: "git push" });
    expect(await runPush(input, f.deps)).toBe(1);
    expect(f.err.join("\n")).toContain("command failed: git push origin");
    expect(f.calls.some((c) => c.command === "gh")).toBe(false);
  });

  it("refuses an unsupported package name before any command", async () => {
    const f = fakes();
    expect(await runPush({ ...input, package: "@a/b" }, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
  });

  it("planPush rejects paths outside the allowlist", () => {
    const r = planPush({ package: "x", version: "1.0.0", mode: "local", files: [{ path: "ledger.json", type: "file", size: 0 }] });
    expect(r.ok).toBe(false);
  });

  it("eligibility-only dispatch has no branch and medium_mode=local, and runs only gh", async () => {
    const f = fakes();
    expect(await runEligibilityDispatch({ package: "inflight", version: "1.0.6" }, f.deps)).toBe(0);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.command).toBe("gh");
    expect(f.calls[0]?.argv.join(" ")).not.toContain("branch=");
    expect(f.calls[0]?.argv.slice(-2)).toEqual(["-f", "medium_mode=local"]);
  });
});
