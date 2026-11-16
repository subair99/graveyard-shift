// Argument builders and JSON parsing for `gh` and the git commands of the publish job (R14.7, R15.1, R15.6).
// Every command is an argument list, never a shell string. There is no builder for merge or auto-merge.

import { z } from "zod";

import { err, ok, type Result } from "../../common/result";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a child process without a shell. The real one lives in the entry script; tests inject a fake. */
export interface CommandRunner {
  run(command: "git" | "gh", argv: readonly string[]): Promise<CommandResult>;
}

export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/** The repository setting that must be on for `gh pr create` to work with the workflow token. */
export const PR_SETTING_NAME = "Allow GitHub Actions to create and approve pull requests";

export const gitConfigArgv = (key: "user.name" | "user.email", value: string): string[] => [
  "config",
  key,
  value,
];

export const ghAuthSetupGitArgv = (): string[] => ["auth", "setup-git"];

/** `git ls-remote --heads origin "<pattern>"`; the pattern is one argument, so git (not a shell) expands the glob. */
export const gitLsRemoteHeadsArgv = (pattern: string): string[] => [
  "ls-remote",
  "--heads",
  "origin",
  pattern,
];

export const gitCheckoutNewBranchArgv = (branch: string): string[] => ["checkout", "-b", branch];

/** Stages additions, changes and removals under one path only. */
export const gitAddPathArgv = (path: string): string[] => ["add", "--all", "--", path];

export const gitCommitArgv = (message: string): string[] => ["commit", "-m", message];

/** A plain push of one branch. There is no force option. */
export const gitPushArgv = (branch: string): string[] => ["push", "origin", branch];

export const gitDeleteBranchCommand = (branch: string): string => `git push origin --delete ${branch}`;

export function ghPrCreateArgv(i: {
  readonly branch: string;
  readonly title: string;
  readonly bodyFile: string;
}): string[] {
  return [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    i.branch,
    "--title",
    i.title,
    "--body-file",
    i.bodyFile,
  ];
}

export function ghPrListArgv(slug: string): string[] {
  return [
    "pr",
    "list",
    "--search",
    `head:publish/${slug}-`,
    "--state",
    "open",
    "--json",
    "number,title,url,headRefName",
  ];
}

const OpenPrSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    url: z.string(),
    headRefName: z.string(),
  }),
);

export type OpenPr = z.infer<typeof OpenPrSchema>[number];

/** Parses the JSON of `gh pr list --json number,title,url,headRefName`. */
export function parseOpenPrs(stdout: string): Result<OpenPr[], string> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return err("gh pr list did not print JSON");
  }
  const parsed = OpenPrSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err("gh pr list JSON has an unexpected shape");
}

/** The pull request URL: the last non-empty line of `gh pr create` output that starts with https://. */
export function parsePrUrl(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("https://"));
  return lines.length === 0 ? null : lines[lines.length - 1]!;
}

/** Display form of a command for messages. */
export function commandText(command: string, argv: readonly string[]): string {
  return [command, ...argv].join(" ");
}
