// git and gh through an injected runner (R8.7). Every child process gets an argument list, no shell.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: Uint8Array;
}

export interface CommandRunner {
  run(command: "git" | "gh", argv: readonly string[], options?: CommandOptions): Promise<CommandResult>;
}

export const nodeCommandRunner: CommandRunner = {
  run(command, argv, options) {
    return new Promise((resolve) => {
      const child = spawn(command, [...argv], {
        shell: false,
        env: { ...process.env, ...options?.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      const errs: Buffer[] = [];
      child.stdout.on("data", (b: Buffer) => out.push(b));
      child.stderr.on("data", (b: Buffer) => errs.push(b));
      child.on("error", () => resolve({ code: 127, stdout: "", stderr: `could not start ${command}` }));
      child.on("close", (code) =>
        resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(errs).toString("utf8") }),
      );
      child.stdin.on("error", () => undefined);
      child.stdin.end(options?.input ? Buffer.from(options.input) : undefined);
    });
  },
};

export interface TempIndex {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** A path for a temporary git index that does not exist yet. */
export async function makeTempIndex(): Promise<TempIndex> {
  const dir = await mkdtemp(join(tmpdir(), "gs-index-"));
  return { path: join(dir, "index"), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export class CommandFailure extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`command failed: ${command}`);
    this.command = command;
  }
}

/** Display form of a command (arguments carry no secret). */
export function commandText(command: string, argv: readonly string[]): string {
  return [command, ...argv].join(" ");
}

async function must(
  runner: CommandRunner,
  command: "git" | "gh",
  argv: readonly string[],
  options?: CommandOptions,
): Promise<string> {
  const r = await runner.run(command, argv, options);
  if (r.code !== 0) throw new CommandFailure(commandText(command, argv));
  return r.stdout;
}

/** The only git command before the confirmation. Null when no email is configured. */
export async function readConfiguredEmail(runner: CommandRunner): Promise<string | null> {
  const r = await runner.run("git", ["config", "user.email"]);
  const email = r.stdout.trim();
  return r.code === 0 && email !== "" ? email : null;
}

export async function fetchMain(runner: CommandRunner): Promise<void> {
  await must(runner, "git", ["fetch", "origin", "main"]);
}

export async function remoteBranchExists(runner: CommandRunner, branch: string): Promise<boolean> {
  const out = await must(runner, "git", ["ls-remote", "--heads", "origin", branch]);
  return out.trim() !== "";
}

export interface CommitFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Commit on `origin/main` with exactly `files` added, built with a temporary index. The working tree and index are untouched. */
export async function buildCommit(
  runner: CommandRunner,
  files: readonly CommitFile[],
  message: string,
  tempIndex: TempIndex,
): Promise<string> {
  const env = { GIT_INDEX_FILE: tempIndex.path };
  try {
    await must(runner, "git", ["read-tree", "origin/main"], { env });
    for (const f of files) {
      const blob = (await must(runner, "git", ["hash-object", "-w", "--stdin"], { env, input: f.bytes })).trim();
      await must(runner, "git", ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], { env });
    }
    const tree = (await must(runner, "git", ["write-tree"], { env })).trim();
    const commit = (await must(runner, "git", ["commit-tree", tree, "-p", "origin/main", "-m", message], { env })).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new CommandFailure("git commit-tree");
    return commit;
  } finally {
    await tempIndex.cleanup().catch(() => undefined);
  }
}

export async function pushCommit(runner: CommandRunner, commit: string, branch: string): Promise<void> {
  await must(runner, "git", ["push", "origin", `${commit}:refs/heads/${branch}`]);
}

export async function runGh(runner: CommandRunner, argv: readonly string[]): Promise<void> {
  await must(runner, "gh", argv);
}
