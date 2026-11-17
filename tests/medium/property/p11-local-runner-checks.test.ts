// Requirements: 4.6, 5.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 10.9, 10.10
// Feature: medium-agent, Property 11: The Local_Runner makes one attempt and pushes only when every check passes
// Model-based: the Local_Runner with a fake spawn, fake git, fake file system, fake prompt and fake clock.
// No kiro-cli, no network, no credit.
import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { ALLOWED_MEDIUM_PATHS } from "../../../src/pipeline/common/constants";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";
import { parseLedger } from "../../../src/pipeline/local/core/ledger";
import {
  runResurrect,
  type ResurrectDeps,
  type ResurrectFs,
} from "../../../src/pipeline/local/shell/resurrect";
import { createKiroRunner, type SpawnedProcess, type SpawnFn } from "../../../src/pipeline/medium/shell/kiroRunner";
import { LODASH_SET_CERT } from "../../pipeline/helpers/gravediggerCerts";

const ROOT = "/home/u/graveyard-shift";
const FIXTURE_ABS = path.resolve(__dirname, "../../pipeline/fixtures/stub/lodash.set");
const NOW = new Date("2026-11-16T10:00:00.000Z");
const GUARD_LOG = ".graveyard-work/guard.log";
const ALLOW_LINE = "2026-11-16T10:00:00Z ALLOW fs_write resurrection/package.json";
const DENY_LINE = "2026-11-16T10:00:01Z DENY fs_write src/evil.ts";
const GOOD_LISTING = [
  { path: "resurrection", type: "directory" },
  { path: "resurrection/package.json", type: "file" },
  { path: "deltas.json", type: "file" },
  { path: "harness.json", type: "file" },
] as const;

type Git1 = "clean" | "dirty" | "fail";
type Ctx = "ok" | "noTarball" | "extractError" | "writeError" | "guardLogError";
type Kiro =
  | { kind: "exited"; code: number; usageLimit: boolean }
  | { kind: "not-found" }
  | { kind: "failed-to-start" };
type GuardContent = "missing" | "empty" | "allow" | "deny";
type After = "none" | "expected" | "unexpected" | "fail";

interface Scenario {
  git1: Git1;
  ctx: Ctx;
  kiro: Kiro;
  interrupt: boolean;
  guard: GuardContent;
  outputs: boolean;
  after: After;
  intakeOk: boolean;
  parseOk: boolean;
  before: string;
  afterReading: string;
  pushCode: number;
}

const reading = fc.stringMatching(/^[a-z0-9]{1,8}( credits)?$/);
const scenario: fc.Arbitrary<Scenario> = fc.record({
  git1: fc.constantFrom<Git1>("clean", "clean", "dirty", "fail"),
  ctx: fc.constantFrom<Ctx>("ok", "ok", "ok", "noTarball", "extractError", "writeError", "guardLogError"),
  kiro: fc.oneof(
    { weight: 6, arbitrary: fc.record({ kind: fc.constant("exited" as const), code: fc.constantFrom(0, 0, 0, 1, 3), usageLimit: fc.boolean() }) },
    { weight: 1, arbitrary: fc.constant<Kiro>({ kind: "not-found" }) },
    { weight: 1, arbitrary: fc.constant<Kiro>({ kind: "failed-to-start" }) },
  ),
  interrupt: fc.boolean(),
  guard: fc.constantFrom<GuardContent>("missing", "empty", "allow", "allow", "deny"),
  outputs: fc.boolean(),
  after: fc.constantFrom<After>("none", "expected", "expected", "unexpected", "fail"),
  intakeOk: fc.boolean(),
  parseOk: fc.boolean(),
  before: reading,
  afterReading: reading,
  pushCode: fc.constantFrom(0, 0, 1, 2),
});

const STATUS_AFTER: Record<After, { ok: true; value: string } | { ok: false; error: string }> = {
  none: { ok: true, value: "" },
  expected: { ok: true, value: " M deltas.json\0?? harness.json\0" },
  unexpected: { ok: true, value: " M src/x.ts\0" },
  fail: { ok: false, error: "x" },
};

let goodEntries: Awaited<ReturnType<ResurrectDeps["readEntries"]>>;
let goodDeltas: string;
beforeAll(async () => {
  goodEntries = await readFsEntries(FIXTURE_ABS, ALLOWED_MEDIUM_PATHS);
  goodDeltas = readFileSync(path.join(FIXTURE_ABS, "deltas.json"), "utf8");
});

function build(sc: Scenario) {
  const log: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const spawns: string[] = [];
  const pushes: unknown[] = [];
  const answers = [sc.before, sc.afterReading];
  let asks = 0;
  let statusCalls = 0;
  const enc = new TextEncoder();

  const fakeSpawn: SpawnFn = (command) => {
    log.push("spawn");
    spawns.push(command);
    // What the Medium leaves behind.
    if (sc.guard === "missing") files.delete(GUARD_LOG);
    else if (sc.guard === "empty") files.set(GUARD_LOG, "");
    else if (sc.guard === "allow") files.set(GUARD_LOG, `${ALLOW_LINE}\n`);
    else files.set(GUARD_LOG, `${ALLOW_LINE}\n${DENY_LINE}\n`);
    if (sc.outputs) files.set("deltas.json", sc.parseOk ? goodDeltas : "{ nope");
    const handlers: Record<string, Array<(...a: never[]) => void>> = {};
    const stream = (text: string | undefined) => ({
      on: (_e: "data", listener: (chunk: string) => void) => {
        if (text !== undefined) queueMicrotask(() => listener(text));
      },
    });
    const stderr = sc.kiro.kind === "exited" && sc.kiro.usageLimit ? "Error: UsageLimitReached" : undefined;
    const child = {
      stdout: stream(undefined),
      stderr: stream(stderr),
      on: (event: string, listener: (...a: never[]) => void) => {
        (handlers[event] ??= []).push(listener);
      },
    };
    setTimeout(() => {
      if (sc.kiro.kind === "exited") {
        for (const h of handlers["close"] ?? []) (h as (c: number | null, s: string | null) => void)(sc.kiro.code, null);
      } else {
        const code = sc.kiro.kind === "not-found" ? "ENOENT" : "EACCES";
        for (const h of handlers["error"] ?? []) (h as (e: Error) => void)(Object.assign(new Error(`${code} boom`), { code }));
      }
    }, 0);
    return child as unknown as SpawnedProcess;
  };

  const fs: ResurrectFs = {
    exists: async (rel) => files.has(rel),
    readText: async (rel) => files.get(rel) ?? null,
    mkdir: async () => undefined,
    writeText: async (rel, text) => {
      files.set(rel, text);
    },
    writeAtomic: async (rel, text) => {
      log.push(`atomic ${rel}`);
      files.set(rel, text);
    },
    listDir: async () => [...GOOD_LISTING],
    copy: async () => undefined,
    readOptional: async (rel) => {
      const text = files.get(rel);
      return text === undefined ? null : enc.encode(text);
    },
    removeTree: async () => undefined,
    writeBytes: async (rel) => {
      if (sc.ctx === "writeError" && rel.endsWith("/eligibility.json")) throw new Error("disk full");
    },
    truncate: async (rel) => {
      if (sc.ctx === "guardLogError") throw new Error("denied");
      files.set(rel, "");
    },
  };

  const deps: ResurrectDeps = {
    repoRoot: ROOT,
    path: path.posix,
    fs,
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
      tarball: sc.ctx === "noTarball" ? null : new Uint8Array([1]),
    }),
    gitStatus: async () => {
      const call = statusCalls;
      statusCalls += 1;
      log.push(`git status ${call}`);
      if (call === 0) {
        if (sc.git1 === "clean") return { ok: true, value: "" };
        if (sc.git1 === "dirty") return { ok: true, value: " M src/a.ts\0" };
        return { ok: false, error: "x" };
      }
      return STATUS_AFTER[sc.after];
    },
    extract: async () =>
      sc.ctx === "extractError"
        ? { ok: false, error: { kind: "archive-too-large", limit: "entries" } }
        : { ok: true, value: [{ path: "package.json", bytes: enc.encode("{}") }] },
    identity: { pathValues: [], userName: undefined },
    platform: "posix",
    kiro: (env) =>
      createKiroRunner({
        spawn: fakeSpawn,
        env,
        cwd: ROOT,
        added: {
          GRAVEYARD_CERTIFICATE_PATH: env["GRAVEYARD_CERTIFICATE_PATH"] ?? "",
          GUARD_LOG_FILE: env["GUARD_LOG_FILE"] ?? "",
        },
        out: () => undefined,
        err: () => undefined,
      }),
    kiroVersion: async () => "kiro-cli 1.2.3",
    prompt: {
      ask: async () => {
        asks += 1;
        log.push(`ask${asks}`);
        if (asks === 2 && sc.interrupt) throw new Error("interrupted");
        return answers[asks - 1] ?? "";
      },
    },
    readEntries: async () => {
      log.push("validate");
      return sc.intakeOk ? goodEntries : [];
    },
    push: async () => {
      log.push("push");
      pushes.push(1);
      return sc.pushCode;
    },
    clock: { now: () => NOW },
    env: { PATH: "/usr/bin" },
    out: () => undefined,
    err: (l) => err.push(l),
  };
  return { deps, log, err, files, spawns, pushes };
}

describe("Property 11: one attempt, pushed only when every check passes", () => {
  it("matches the model for every combination", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (sc) => {
        const m = build(sc);
        const r = await runResurrect(["lodash.set"], m.deps);
        const errText = m.err.join("\n");
        const count = (prefix: string) => m.log.filter((l) => l.startsWith(prefix)).length;
        const hasLedger = m.files.has("ledger.json");

        const preOk = sc.git1 === "clean" && sc.ctx === "ok";
        if (!preOk) {
          expect(m.spawns).toHaveLength(0);
          expect(count("ask")).toBe(0);
          expect(hasLedger).toBe(false);
          expect(m.pushes).toHaveLength(0);
          expect(r.exitCode).not.toBe(0);
          return;
        }

        // One attempt; the first reading comes before the spawn.
        expect(m.spawns).toHaveLength(1);
        expect(m.log.indexOf("ask1")).toBeGreaterThanOrEqual(0);
        expect(m.log.indexOf("ask1")).toBeLessThan(m.log.indexOf("spawn"));

        if (sc.kiro.kind !== "exited") {
          expect(count("ask")).toBe(1);
          expect(hasLedger).toBe(false);
          expect(m.pushes).toHaveLength(0);
          expect(r.exitCode).not.toBe(0);
          return;
        }

        // The second reading comes only after the process ended.
        expect(m.log.indexOf("ask2")).toBeGreaterThan(m.log.indexOf("spawn"));
        if (sc.interrupt) {
          expect(r.exitCode).toBe(130);
          expect(hasLedger).toBe(false);
          expect(m.pushes).toHaveLength(0);
          return;
        }

        // One Ledger entry with the readings as typed, before any check after the run.
        const ledger = parseLedger(m.files.get("ledger.json") ?? "");
        expect(ledger.ok).toBe(true);
        if (!ledger.ok) return;
        expect(ledger.value.entries).toHaveLength(1);
        expect(ledger.value.entries[0]).toMatchObject({
          mode: "local",
          creditBefore: sc.before,
          creditAfter: sc.afterReading,
          exitCode: sc.kiro.code,
        });
        const ledgerAt = m.log.indexOf("atomic ledger.json");
        expect(ledgerAt).toBeGreaterThan(m.log.indexOf("ask2"));
        for (const later of ["git status 1", "validate", "push"]) {
          if (m.log.includes(later)) expect(m.log.indexOf(later)).toBeGreaterThan(ledgerAt);
        }

        // The checks in order; the first failure stops the run.
        let stage: "10.7" | "10.3" | "10.4" | "10.5" | "10.8" | "pass" = "pass";
        if (sc.kiro.code !== 0 || sc.kiro.usageLimit) stage = "10.7";
        else if (sc.guard === "deny") stage = "10.3";
        else if ((sc.guard === "missing" || sc.guard === "empty") && sc.outputs) stage = "10.4";
        else if (sc.after === "fail" || sc.after === "unexpected") stage = "10.5";
        else if (!sc.intakeOk || (sc.outputs && !sc.parseOk)) stage = "10.8";

        const messages: Record<string, string> = {
          "10.3": "Write_Guard blocked writes",
          "10.4": "left no record",
          "10.5": stage === "10.5" && sc.after === "fail" ? "git status after the run" : "outside its three outputs",
          "10.8": "fails the intake check",
        };
        const reachedStatus = stage === "10.5" || stage === "10.8" || stage === "pass";
        expect(count("git status 1")).toBe(reachedStatus ? 1 : 0);
        expect(count("validate")).toBe(stage === "10.8" || stage === "pass" ? 1 : 0);
        if (stage === "10.7") expect(errText).toMatch(/exited with code|usage limit/i);
        else for (const [k, text] of Object.entries(messages)) expect(errText.includes(text)).toBe(k === stage);

        if (stage === "pass") {
          expect(m.pushes).toHaveLength(1);
          expect(m.log[m.log.length - 1]).toBe("push");
          expect(r.exitCode).toBe(sc.pushCode);
        } else {
          expect(m.pushes).toHaveLength(0);
          expect(r.exitCode).not.toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
