// Requirements: 11.4; resurrection-pipeline 6.7
// Synthetic sentinel values in GITHUB_TOKEN, one other variable and a `.env` file at the working directory.
// The Local_Runner runs with fakes (kiro-cli, git, prompt, clock); the fake kiro-cli starts the real
// Write_Guard and Context_Server as child processes with the environment the runner gave it.
// No sentinel may appear in any output, the Guard_Log, the Ledger or the Medium_Context.
import { spawnSync } from "node:child_process";
import { promises as fsp, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALLOWED_MEDIUM_PATHS } from "../../../src/pipeline/common/constants";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";
import {
  runResurrect,
  type ResurrectDeps,
  type ResurrectFs,
} from "../../../src/pipeline/local/shell/resurrect";
import { createKiroRunner, type SpawnedProcess, type SpawnFn } from "../../../src/pipeline/medium/shell/kiroRunner";
import { LODASH_SET_CERT } from "../../pipeline/helpers/gravediggerCerts";

const GUARD = path.resolve("src/pipeline/medium/agent/writeGuard.mjs");
const SERVER = path.resolve("src/pipeline/medium/agent/contextServer.mjs");
const FIXTURE_ABS = path.resolve(__dirname, "../../pipeline/fixtures/stub/lodash.set");
const NOW = new Date("2026-11-16T10:00:00.000Z");

// Synthetic values; none is a real secret.
const SENTINELS = [
  "SENTINEL-GITHUB-TOKEN-5c1e8a7f",
  "SENTINEL-OTHER-VARIABLE-b2d94e60",
  "SENTINEL-DOTENV-FILE-VALUE-0a77c3d1",
];

let root = "";

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "medium-secrets-it-")));
  writeFileSync(path.join(root, ".env"), `GITHUB_TOKEN=${SENTINELS[2]}\nCUSTOM_SETTING=${SENTINELS[2]}\n`);
});

afterEach(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

function realFs(): ResurrectFs {
  const full = (rel: string): string => path.join(root, ...rel.split("/"));
  const missing = (e: unknown): boolean => (e as { code?: string }).code === "ENOENT";
  return {
    exists: async (rel) => fsp.lstat(full(rel)).then(() => true, () => false),
    readText: async (rel) => fsp.readFile(full(rel), "utf8").catch((e) => (missing(e) ? null : Promise.reject(e))),
    mkdir: async (rel) => void (await fsp.mkdir(full(rel), { recursive: true })),
    writeText: (rel, text) => fsp.writeFile(full(rel), text, "utf8"),
    writeAtomic: (rel, text) => fsp.writeFile(full(rel), text, "utf8"),
    listDir: async () => [],
    copy: async () => undefined,
    readOptional: async (rel) =>
      fsp.readFile(full(rel)).then((b) => new Uint8Array(b), (e) => (missing(e) ? null : Promise.reject(e))),
    removeTree: (rel) => fsp.rm(full(rel), { recursive: true, force: true }),
    writeBytes: async (rel, bytes) => {
      await fsp.mkdir(path.dirname(full(rel)), { recursive: true });
      await fsp.writeFile(full(rel), bytes);
    },
    truncate: async (rel) => {
      await fsp.mkdir(path.dirname(full(rel)), { recursive: true });
      await fsp.writeFile(full(rel), "");
    },
  };
}

function toolCall(id: number, name: string, args?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } });
}

async function runScenario(guardedPath: string): Promise<{ exitCode: number; captured: string[]; pushes: number }> {
  const captured: string[] = [];
  const answers = ["10 credits", "12 credits"];
  let pushes = 0;

  const fakeSpawn: SpawnFn = (_command, _args, options) => {
    const childEnv = { ...options.env } as unknown as NodeJS.ProcessEnv;
    const guardEvent = JSON.stringify({
      hook_event_name: "preToolUse",
      cwd: options.cwd,
      tool_name: "fs_write",
      tool_input: { path: guardedPath },
    });
    const guard = spawnSync(process.execPath, [GUARD], { input: guardEvent, encoding: "utf8", cwd: options.cwd, env: childEnv });
    captured.push(guard.stdout, guard.stderr);

    const contextDir = path.join(options.cwd, ".graveyard-work", "medium-context");
    const lines = [
      toolCall(1, "get_certificate"),
      toolCall(2, "get_eligibility"),
      toolCall(3, "get_advisories"),
      toolCall(4, "list_original_files"),
      toolCall(5, "get_preset_menu"),
      toolCall(6, "read_original_file", { path: "package.json" }),
      toolCall(7, "read_original_file", { path: "../../../.env" }),
      toolCall(8, "read_original_file", { path: ".env" }),
    ];
    const server = spawnSync(process.execPath, [SERVER, "--context", contextDir], {
      input: lines.map((l) => `${l}\n`).join(""),
      encoding: "utf8",
      cwd: options.cwd,
      env: childEnv,
    });
    captured.push(server.stdout, server.stderr);

    const handlers: Record<string, Array<(...a: never[]) => void>> = {};
    const child = {
      stdout: null,
      stderr: null,
      on: (event: string, listener: (...a: never[]) => void) => {
        (handlers[event] ??= []).push(listener);
      },
    };
    setTimeout(() => {
      for (const h of handlers["close"] ?? []) (h as (c: number | null, s: string | null) => void)(0, null);
    }, 0);
    return child as unknown as SpawnedProcess;
  };

  const out = (line: string): void => void captured.push(line);
  const deps: ResurrectDeps = {
    repoRoot: root,
    path,
    fs: realFs(),
    coroner: async () => ({ certificates: [LODASH_SET_CERT], errors: [], notes: [] }),
    gravedigger: async (c): Promise<GravediggerResult> => ({
      record: buildEligibilityRecord({
        name: c.package.name,
        version: c.package.version,
        cert: c,
        expectedIntegrity: "sha512-AAAA",
        computedIntegrity: "sha512-AAAA",
        pkg: { license: "MIT" },
        lineCount: 10,
        packumentUrl: "https://registry.npmjs.org/x",
        tarballUrl: "https://registry.npmjs.org/x/-/x.tgz",
        fetchedAt: "2026-11-16T10:00:00Z",
      }),
      tarball: new Uint8Array([1]),
    }),
    gitStatus: async () => ({ ok: true, value: "" }),
    extract: async () => ({
      ok: true,
      value: [
        { path: "package.json", bytes: new TextEncoder().encode("{}") },
        { path: "lib/index.js", bytes: new TextEncoder().encode("module.exports = 1;\n") },
      ],
    }),
    identity: { pathValues: [], userName: undefined },
    platform: process.platform === "win32" ? "win32" : "posix",
    kiro: (env) =>
      createKiroRunner({
        spawn: fakeSpawn,
        env,
        cwd: root,
        added: {
          GRAVEYARD_CERTIFICATE_PATH: env["GRAVEYARD_CERTIFICATE_PATH"] ?? "",
          GUARD_LOG_FILE: env["GUARD_LOG_FILE"] ?? "",
        },
        out: (t) => void captured.push(t),
        err: (t) => void captured.push(t),
      }),
    kiroVersion: async () => "kiro-cli 1.2.3",
    prompt: { ask: async (q) => (captured.push(q), answers.shift() ?? "") },
    readEntries: async () => readFsEntries(FIXTURE_ABS, ALLOWED_MEDIUM_PATHS),
    push: async () => {
      pushes += 1;
      return 0;
    },
    clock: { now: () => NOW },
    env: {
      GITHUB_TOKEN: SENTINELS[0],
      CUSTOM_SETTING: SENTINELS[1],
      HOME: root,
      PATH: process.env["PATH"],
      ...(process.platform === "win32" ? { SystemRoot: process.env["SystemRoot"] } : {}),
    },
    out,
    err: out,
  };
  const result = await runResurrect(["lodash.set"], deps);
  return { exitCode: result.exitCode, captured, pushes };
}

async function readTree(dir: string): Promise<Array<{ rel: string; bytes: Buffer }>> {
  const found: Array<{ rel: string; bytes: Buffer }> = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const f of await readTree(abs)) found.push({ rel: `${entry.name}/${f.rel}`, bytes: f.bytes });
    } else {
      found.push({ rel: entry.name, bytes: await fsp.readFile(abs) });
    }
  }
  return found;
}

async function assertNoSentinel(captured: string[]): Promise<void> {
  const places: Array<{ where: string; bytes: Buffer }> = [
    { where: "output", bytes: Buffer.from(captured.join("\n"), "utf8") },
    { where: "guard.log", bytes: await fsp.readFile(path.join(root, ".graveyard-work", "guard.log")) },
    { where: "ledger.json", bytes: await fsp.readFile(path.join(root, "ledger.json")) },
  ];
  const context = await readTree(path.join(root, ".graveyard-work", "medium-context"));
  expect(context.length).toBeGreaterThan(0);
  for (const f of context) places.push({ where: `medium-context/${f.rel}`, bytes: f.bytes });
  for (const place of places) {
    for (const [i, sentinel] of SENTINELS.entries()) {
      // Report only where and which sentinel, never a value.
      expect(place.bytes.includes(sentinel), `sentinel ${i} found in ${place.where}`).toBe(false);
    }
  }
}

describe("secrets never reach the Medium side", () => {
  it("allowed write: no sentinel in output, Guard_Log, Ledger entry or Medium_Context", async () => {
    const { exitCode, captured, pushes } = await runScenario("resurrection/package.json");
    expect(exitCode).toBe(0);
    expect(pushes).toBe(1);
    expect(captured.join("\n")).toContain("Medium environment keys:");
    await assertNoSentinel(captured);
  }, 30_000);

  it("blocked write: no sentinel in the block message or the DENY line", async () => {
    const { exitCode, captured, pushes } = await runScenario("src/outside.js");
    expect(exitCode).toBe(1);
    expect(pushes).toBe(0);
    expect(captured.join("\n")).toContain("write-guard: blocked:");
    await assertNoSentinel(captured);
  }, 30_000);
});
