// Starts the Medium (`kiro-cli chat --v3 --no-interactive --agent medium "<prompt>"`) once.
// Spawned with an argument list and no shell (R6.12), with an environment without
// only the Medium_Env_Keys (R6.7, medium-agent R11.1). Only environment key names are printed;
// the child's own output is forwarded.

import { spawn as nodeSpawn } from "node:child_process";
import { KIRO_COMMAND, buildKiroArgs } from "../core/kiroArgs";
import { buildMediumEnv } from "../core/mediumEnv";

export const SETUP_NOTE_PATH = "spikes/kiro-agent/README.md";
export const SETUP_NOTE_SECTION = "Setup note: log in with the right account";

export interface SpawnedStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface SpawnedProcess {
  stdout: SpawnedStream | null;
  stderr: SpawnedStream | null;
  on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
}

export interface SpawnOptions {
  env: Record<string, string>;
  cwd: string;
  shell: false;
  stdio: ["ignore", "pipe", "pipe"];
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => SpawnedProcess;

export type KiroOutcome =
  | { kind: "exited"; exitCode: number; usageLimit: boolean }
  | { kind: "not-found" }
  | { kind: "failed-to-start"; message: string };

export interface KiroRunner {
  run(packageName: string): Promise<KiroOutcome>;
}

export interface KiroRunnerDeps {
  spawn: SpawnFn;
  /** The caller's environment; only the Medium_Env_Keys reach the child. */
  env: Readonly<Record<string, string | undefined>>;
  /** Repository root, the working directory of the child. */
  cwd: string;
  /** Absolute paths added to the child's environment. */
  added: { GRAVEYARD_CERTIFICATE_PATH: string; GUARD_LOG_FILE: string };
  /** Receives the child's standard output text. */
  out: (text: string) => void;
  /** Receives the child's standard error text. */
  err: (text: string) => void;
}

const USAGE_LIMIT_PATTERN = /usage[\s_-]*limit|UsageLimitReached/i;
const SCAN_TAIL_CHARS = 64;

export function createKiroRunner(deps: KiroRunnerDeps): KiroRunner {
  return {
    run(packageName: string): Promise<KiroOutcome> {
      const args = buildKiroArgs(packageName);
      const env = buildMediumEnv(deps.env, deps.added);
      deps.err(`Medium environment keys: ${Object.keys(env).sort().join(", ")}\n`);
      return new Promise<KiroOutcome>((resolve) => {
        let settled = false;
        let usageLimit = false;
        const tails = { out: "", err: "" };
        const settle = (outcome: KiroOutcome): void => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };
        const watch = (stream: SpawnedStream | null, which: "out" | "err"): void => {
          stream?.on("data", (chunk) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            const window = tails[which] + text;
            if (USAGE_LIMIT_PATTERN.test(window)) usageLimit = true;
            tails[which] = window.slice(-SCAN_TAIL_CHARS);
            deps[which](text);
          });
        };

        let child: SpawnedProcess;
        try {
          child = deps.spawn(KIRO_COMMAND, args, { env, cwd: deps.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
          settle(startFailure(error));
          return;
        }
        watch(child.stdout, "out");
        watch(child.stderr, "err");
        child.on("error", (error) => settle(startFailure(error)));
        child.on("close", (code) => settle({ kind: "exited", exitCode: code ?? 1, usageLimit }));
      });
    },
  };
}

function startFailure(error: unknown): KiroOutcome {
  const code = (error as { code?: string } | null)?.code;
  if (code === "ENOENT") return { kind: "not-found" };
  return { kind: "failed-to-start", message: error instanceof Error ? error.message : "unknown error" };
}

/** The real spawn: node:child_process with no shell. */
export const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, args, options as unknown as Parameters<typeof nodeSpawn>[2]) as unknown as SpawnedProcess;

/**
 * The text that names the cause of a missing kiro-cli or a usage limit, with the pointer to
 * the setup note. Returns null for any other outcome.
 */
export function describeKiroFailure(outcome: KiroOutcome): string | null {
  const pointer = `See "${SETUP_NOTE_SECTION}" in ${SETUP_NOTE_PATH}.`;
  if (outcome.kind === "not-found") {
    return `kiro-cli was not found on PATH. Install kiro-cli in WSL and log in. ${pointer}`;
  }
  if (outcome.kind === "exited" && outcome.usageLimit) {
    return (
      "kiro-cli reported a usage limit: this login has no credits. " +
      `Log in with the account that holds the credits. ${pointer}`
    );
  }
  return null;
}
