// The publish-branch collision check (D2), shared by `intake.ts check-publish-branch` (before any signing) and
// `publish.ts push-pr` (before the push). One glob, one message, one fail-closed rule. The caller injects the
// runner of `git ls-remote`; this file starts no process itself.

import { branchSlug } from "../../common/branchNames";
import { err, ok, type Result } from "../../common/result";
import { commandText, gitDeleteBranchCommand, gitLsRemoteHeadsArgv } from "./ghCli";

/** `publish/<slug>-run<run_id>-*`: matches every attempt of this run, including earlier ones. */
export const publishBranchGlob = (packageName: string, runId: number): string =>
  `publish/${branchSlug(packageName)}-run${runId}-*`;

/** First branch name in `git ls-remote --heads` output, or null. */
export function firstRemoteHead(lsRemoteStdout: string): string | null {
  const ref = lsRemoteStdout
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/)[1])
    .find((r) => r !== undefined && r.startsWith("refs/heads/"));
  return ref === undefined ? null : ref.slice("refs/heads/".length);
}

export const collisionMessage = (branch: string): string =>
  `branch ${branch} already exists from an earlier attempt of this run. Delete it yourself and re-run: ${gitDeleteBranchCommand(branch)}`;

export interface GitRun {
  (argv: readonly string[]): Promise<{ readonly code: number; readonly stdout: string }>;
}

/**
 * Err with the collision message when a branch matches the glob; err with "command failed: ..." when `git ls-remote`
 * fails (fail closed). Pushes, deletes and writes nothing.
 */
export async function checkPublishCollision(
  runGit: GitRun,
  input: { readonly package: string; readonly runId: number },
): Promise<Result<null, string>> {
  const argv = gitLsRemoteHeadsArgv(publishBranchGlob(input.package, input.runId));
  const r = await runGit(argv);
  if (r.code !== 0) return err(`command failed: ${commandText("git", argv)}`);
  const existing = firstRemoteHead(r.stdout);
  return existing === null ? ok(null) : err(collisionMessage(existing));
}
