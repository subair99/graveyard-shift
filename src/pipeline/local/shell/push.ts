// Push_Script (R8). Validates again, confirms the commit email, pushes the three paths with a
// plumbing-built commit on origin/main, then dispatches the CI_Workflow. Never force-pushes,
// never deletes a branch, never runs a shell.
import { ALLOWED_MEDIUM_PATHS } from "../../common/constants";
import { safePathForLog } from "../../intake/core/safePath";
import { validateIntake } from "../../intake/core/validator";
import type { IntakeEntry } from "../../intake/core/types";
import { readFsEntries } from "../../intake/shell/fsEntries";
import { planEligibilityDispatch, planPush, WORKFLOW_RUNS_URL, type MediumMode } from "../core/pushPlan";
import {
  buildCommit,
  CommandFailure,
  commandText,
  fetchMain,
  makeTempIndex,
  nodeCommandRunner,
  pushCommit,
  readConfiguredEmail,
  remoteBranchExists,
  runGh,
  type CommandRunner,
  type TempIndex,
} from "./gitPlumbing";

export interface PushDeps {
  readonly runner: CommandRunner;
  readonly readEntries: (root: string) => Promise<IntakeEntry[]>;
  /** Shows the email on the terminal and asks the user. The email goes nowhere else. */
  readonly confirmEmail: (email: string) => Promise<boolean>;
  readonly makeTempIndex: () => Promise<TempIndex>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface PushInput {
  readonly package: string;
  readonly version: string;
  readonly mode: MediumMode;
  /** Directory holding `resurrection/`, `deltas.json` and `harness.json`. */
  readonly root: string;
}

export function defaultPushDeps(
  io: Pick<PushDeps, "confirmEmail" | "out" | "err">,
): PushDeps {
  return {
    runner: nodeCommandRunner,
    readEntries: (root) => readFsEntries(root, ALLOWED_MEDIUM_PATHS),
    makeTempIndex,
    ...io,
  };
}

export async function runPush(input: PushInput, deps: PushDeps): Promise<number> {
  let failing = "";
  try {
    // 1. Validate again, before any git command (R8.1).
    const entries = await deps.readEntries(input.root);
    const validated = validateIntake(entries);
    if (!validated.ok) {
      deps.err("The Medium output fails the intake check; nothing was pushed:");
      for (const v of validated.violations) deps.err(`  ${safePathForLog(v.path)}: ${v.code}: ${v.message}`);
      return 1;
    }
    const plan = planPush({ package: input.package, version: input.version, mode: input.mode, files: validated.files });
    if (!plan.ok) {
      deps.err(`Push refused: ${plan.error}`);
      return 1;
    }
    const files = validated.files.map((f) => ({ path: f.path, bytes: f.bytes }));
    if (files.some((f) => f.bytes === undefined)) {
      deps.err("Push refused: a file has no content.");
      return 1;
    }

    // 2. Commit email: the only git command before the confirmation (R8.9, R8.12).
    const email = await readConfiguredEmail(deps.runner);
    if (email === null) {
      deps.err("No commit email is configured (git config user.email). Nothing was pushed.");
      return 1;
    }
    if (!(await deps.confirmEmail(email))) {
      deps.err("The commit email was not confirmed. Nothing was pushed.");
      return 1;
    }

    // 3. Fetch and look for the branch (R8.3).
    failing = "git fetch origin main";
    await fetchMain(deps.runner);
    failing = `git ls-remote --heads origin ${plan.value.branch}`;
    if (await remoteBranchExists(deps.runner, plan.value.branch)) {
      deps.err(`The branch ${plan.value.branch} already exists on the remote. Nothing was pushed.`);
      deps.err(`To remove it yourself, run: ${plan.value.deleteCommand}`);
      return 1;
    }

    // 4 and 5. Commit with a temporary index, push without force.
    failing = "git commit build";
    const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => ({ path: f.path, bytes: f.bytes as Uint8Array }));
    const commit = await buildCommit(deps.runner, sorted, `resurrect: ${input.package}@${input.version}`, await deps.makeTempIndex());
    failing = `git push origin <commit>:refs/heads/${plan.value.branch}`;
    await pushCommit(deps.runner, commit, plan.value.branch);

    // 6. Dispatch (R8.4, R8.5).
    failing = commandText("gh", plan.value.dispatchArgv);
    await runGh(deps.runner, plan.value.dispatchArgv);
    deps.out(`Ran: ${commandText("gh", plan.value.dispatchArgv)}`);
    deps.out(`Workflow runs: ${WORKFLOW_RUNS_URL}`);
    return 0;
  } catch (e) {
    deps.err(`${e instanceof CommandFailure ? e.message : `command failed: ${failing}`}. Local files are unchanged.`);
    return 1;
  }
}

/** Dispatch without a Resurrection_Branch, to record a Not_Resurrected_Entry (R6.4). Only `gh` runs. */
export async function runEligibilityDispatch(
  input: { package: string; version: string },
  deps: Pick<PushDeps, "runner" | "out" | "err">,
): Promise<number> {
  const argv = planEligibilityDispatch(input);
  if (!argv.ok) {
    deps.err(`Dispatch refused: ${argv.error}`);
    return 1;
  }
  try {
    await runGh(deps.runner, argv.value);
  } catch {
    deps.err(`command failed: ${commandText("gh", argv.value)}`);
    return 1;
  }
  deps.out(`Ran: ${commandText("gh", argv.value)}`);
  deps.out(`Workflow runs: ${WORKFLOW_RUNS_URL}`);
  return 0;
}
