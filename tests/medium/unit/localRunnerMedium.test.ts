// Requirements: 4.5, 4.6, 5.1, 5.6, 5.7, 8.3, 8.6, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 10.1, 10.11
// Local_Runner steps around the Medium, with a fake spawn through createKiroRunner, fake git, fake file
// system, fake prompt and fake clock. No kiro-cli, no network, no credit.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_MEDIUM_PATHS } from "../../../src/pipeline/common/constants";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";
import { parseLedger } from "../../../src/pipeline/local/core/ledger";
import { isAllowedCommitPath } from "../../../src/pipeline/local/core/pushPlan";
import type { StubCopyItem, StubListEntry } from "../../../src/pipeline/local/core/stubPlan";
import {
  runResurrect,
  type ResurrectDeps,
  type ResurrectFs,
} from "../../../src/pipeline/local/shell/resurrect";
import { createKiroRunner, type SpawnedProcess, type SpawnFn } from "../../../src/pipeline/medium/shell/kiroRunner";
import { LODASH_SET_CERT } from "../../pipeline/helpers/gravediggerCerts";

const ROOT = "/home/u/graveyard-shift";
const FIXTURE_REL = "tests/pipeline/fixtures/stub/lodash.set";
const FIXTURE_ABS = path.resolve(__dirname, "../../pipeline/fixtures/stub/lodash.set");
const NOW = new Date("2026-11-16T10:00:00.000Z");
const VERSION = LODASH_SET_CERT.package.version;
const GUARD_LOG = ".graveyard-work/guard.log";
const CONTEXT_DIR = ".graveyard-work/medium-context";
const MEASUREMENT_REL = `docs/measurements/lodash.set-${VERSION}.json`;
const ALLOW_LINE = "2026-11-16T10:00:00Z ALLOW fs_write resurrection/package.json";
const DENY_LINE = "2026-11-16T10:00:01Z DENY fs_write src/evil\u0001.ts";
const GOOD_LISTING: StubListEntry[] = [
  { path: "resurrection", type: "directory" },
  { path: "resurrection/package.json", type: "file" },
  { path: "deltas.json", type: "file" },
  { path: "harness.json", type: "file" },
];
const ORIGINAL_BYTES = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d, 0x0a, 0xff]);

type SpawnBehavior =
  | { kind: "close"; code: number | null; stdout?: string; stderr?: string }
  | { kind: "error"; code?: string; message: string }
  | { kind: "throw"; message: string };

interface Options {
  files?: Record<string, string>;
  answers?: string[];
  behavior?: SpawnBehavior;
  entries?: Awaited<ReturnType<ResurrectDeps["readEntries"]>>;
  gitStatuses?: Array<{ ok: true; value: string } | { ok: false; error: string }>;
  tarball?: Uint8Array | null;
  extractResult?: Awaited<ReturnType<ResurrectDeps["extract"]>>;
  writeBytesFailsFor?: string;
  truncateFails?: boolean;
  removeTreeFails?: boolean;
  rejectSecondAsk?: boolean;
  /** Runs when the fake child starts; plants what the Medium would write. */
  onSpawn?: (files: Map<string, string>) => void;
}

function setup(opts: Options = {}) {
  const log: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const files = new Map<string, string>(Object.entries(opts.files ?? {}));
  const context = new Map<string, Uint8Array>();
  const truncated: string[] = [];
  const removed: string[] = [];
  const copies: StubCopyItem[][] = [];
  const spawns: Array<{ command: string; args: string[]; options: Parameters<SpawnFn>[2] }> = [];
  const pushes: Array<Parameters<ResurrectDeps["push"]>[0]> = [];
  const answers = [...(opts.answers ?? ["10 credits", "12 credits"])];
  let statusCalls = 0;
  const behavior: SpawnBehavior = opts.behavior ?? { kind: "close", code: 0 };

  const fakeSpawn: SpawnFn = (command, args, options) => {
    log.push("spawn");
    spawns.push({ command, args, options });
    if (behavior.kind === "throw") throw new Error(behavior.message);
    opts.onSpawn?.(files);
    const handlers: Record<string, Array<(...a: never[]) => void>> = {};
    const stream = (text: string | undefined) => ({
      on: (_event: "data", listener: (chunk: string) => void) => {
        if (text !== undefined) queueMicrotask(() => listener(text));
      },
    });
    const child = {
      stdout: stream(behavior.kind === "close" ? behavior.stdout : undefined),
      stderr: stream(behavior.kind === "close" ? behavior.stderr : undefined),
      on: (event: string, listener: (...a: never[]) => void) => {
        (handlers[event] ??= []).push(listener);
      },
    };
    setTimeout(() => {
      if (behavior.kind === "error") {
        const e = Object.assign(new Error(behavior.message), behavior.code === undefined ? {} : { code: behavior.code });
        for (const h of handlers["error"] ?? []) (h as (e: Error) => void)(e);
      } else if (behavior.kind === "close") {
        for (const h of handlers["close"] ?? []) (h as (c: number | null, s: string | null) => void)(behavior.code, null);
      }
    }, 0);
    return child as unknown as SpawnedProcess;
  };

  const fs: ResurrectFs = {
    exists: async (rel) => files.has(rel) || [...files.keys()].some((k) => k.startsWith(`${rel}/`)),
    readText: async (rel) => files.get(rel) ?? null,
    mkdir: async () => undefined,
    writeText: async (rel, text) => {
      files.set(rel, text);
    },
    writeAtomic: async (rel, text) => {
      log.push(`atomic ${rel}`);
      files.set(rel, text);
    },
    listDir: async () => GOOD_LISTING,
    copy: async (items) => {
      log.push("copy");
      copies.push([...items]);
    },
    readOptional: async (rel) => {
      const text = files.get(rel);
      return text === undefined ? null : new TextEncoder().encode(text);
    },
    removeTree: async (rel) => {
      log.push(`removeTree ${rel}`);
      if (opts.removeTreeFails === true) throw new Error("denied");
      removed.push(rel);
    },
    writeBytes: async (rel, bytes) => {
      log.push(`writeBytes ${rel}`);
      if (opts.writeBytesFailsFor !== undefined && rel === opts.writeBytesFailsFor) throw new Error("disk full");
      context.set(rel, bytes);
    },
    truncate: async (rel) => {
      log.push(`truncate ${rel}`);
      if (opts.truncateFails === true) throw new Error("denied");
      truncated.push(rel);
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
      tarball: opts.tarball === undefined ? new Uint8Array([1]) : opts.tarball,
    }),
    gitStatus: async () => {
      log.push("git status");
      const list = opts.gitStatuses ?? [{ ok: true, value: "" }];
      const i = Math.min(statusCalls, list.length - 1);
      statusCalls += 1;
      return list[i] as { ok: true; value: string } | { ok: false; error: string };
    },
    extract: async () =>
      opts.extractResult ?? {
        ok: true,
        value: [
          { path: "package.json", bytes: new TextEncoder().encode("{}") },
          { path: "lib/odd.bin", bytes: ORIGINAL_BYTES },
        ],
      },
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
      ask: async (q) => {
        asked.push(q);
        if (opts.rejectSecondAsk === true && asked.length === 2) throw new Error("interrupted");
        return answers.shift() ?? "";
      },
    },
    readEntries: async () => {
      log.push("validate");
      return opts.entries ?? readFsEntries(FIXTURE_ABS, ALLOWED_MEDIUM_PATHS);
    },
    push: async (input) => {
      log.push("push");
      pushes.push(input);
      return 0;
    },
    clock: { now: () => NOW },
    env: { GITHUB_TOKEN: "secret-token-value", HOME: "/home/u", PATH: "/usr/bin" },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { deps, log, out, err, asked, files, context, truncated, removed, copies, spawns, pushes };
}

type Setup = ReturnType<typeof setup>;
const run = (s: Setup, name = "lodash.set") => runResurrect([name], s.deps);
const errText = (s: Setup) => s.err.join("\n");
const ledgerEntries = (s: Setup) => {
  const parsed = parseLedger(s.files.get("ledger.json") ?? "");
  if (!parsed.ok) throw new Error("ledger not valid");
  return parsed.value.entries;
};
/** The state a Medium run that wrote one allowed file leaves behind. */
const allowedRun = (f: Map<string, string>): void => void f.set(GUARD_LOG, `${ALLOW_LINE}\n`);

describe("Guard_Log (4.5, 4.6)", () => {
  it("4.5: empties the Guard_Log before the spawn and passes its absolute path to the child", async () => {
    const s = setup({ files: { [GUARD_LOG]: "old line\n" }, onSpawn: allowedRun });
    await run(s);
    expect(s.truncated).toEqual([GUARD_LOG]);
    expect(s.log.indexOf(`truncate ${GUARD_LOG}`)).toBeLessThan(s.log.indexOf("spawn"));
    expect(s.files.get(GUARD_LOG)).not.toContain("old line");
    expect(s.spawns).toHaveLength(1);
    expect(s.spawns[0]?.options.env["GUARD_LOG_FILE"]).toBe(`${ROOT}/${GUARD_LOG}`);
  });

  it("4.6: a Guard_Log that cannot be created stops the run: no spawn, no reading, no Ledger entry", async () => {
    const s = setup({ truncateFails: true });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(s.spawns).toHaveLength(0);
    expect(s.asked).toEqual([]);
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
    expect(errText(s)).toContain(GUARD_LOG);
  });
});

describe("Medium_Context (5.1, 5.6, 5.7)", () => {
  it("5.1: without a Measurement_File writes the three generated files and the Original bytes unchanged", async () => {
    const s = setup({ onSpawn: allowedRun });
    await run(s);
    expect(s.removed).toEqual([CONTEXT_DIR]);
    expect([...s.context.keys()]).toEqual([
      `${CONTEXT_DIR}/certificate.json`,
      `${CONTEXT_DIR}/eligibility.json`,
      `${CONTEXT_DIR}/preset-menu.json`,
      `${CONTEXT_DIR}/original/package.json`,
      `${CONTEXT_DIR}/original/lib/odd.bin`,
    ]);
    expect(s.context.get(`${CONTEXT_DIR}/original/lib/odd.bin`)).toEqual(ORIGINAL_BYTES);
    // The context is complete before the Medium starts.
    expect(s.log.lastIndexOf(`writeBytes ${CONTEXT_DIR}/original/lib/odd.bin`)).toBeLessThan(s.log.indexOf("spawn"));
  });

  it("5.1: with a Measurement_File copies its bytes to measurement.json", async () => {
    const s = setup({ files: { [MEASUREMENT_REL]: '{"m":1}\n' }, onSpawn: allowedRun });
    await run(s);
    expect(new TextDecoder().decode(s.context.get(`${CONTEXT_DIR}/measurement.json`))).toBe('{"m":1}\n');
    expect(s.context.has(`${CONTEXT_DIR}/certificate.json`)).toBe(true);
  });

  it.each([
    ["no tarball", { tarball: null }],
    ["an extract error", { extractResult: { ok: false, error: { kind: "archive-too-large", limit: "entries" } } as const }],
    ["a write error", { writeBytesFailsFor: `${CONTEXT_DIR}/eligibility.json` }],
    ["a remove error", { removeTreeFails: true }],
  ] as Array<[string, Options]>)("5.6: %s: no spawn, no reading, no Ledger entry, non-zero exit", async (_name, opts) => {
    const s = setup(opts);
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(s.spawns).toHaveLength(0);
    expect(s.asked).toEqual([]);
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
    expect(errText(s)).not.toBe("");
  });

  it("5.6: an extract error names its kind and reason", async () => {
    const s = setup({ extractResult: { ok: false, error: { kind: "archive-too-large", limit: "entries" } } });
    await run(s);
    expect(errText(s)).toContain("archive-too-large");
    expect(errText(s)).toContain("entries");
  });

  it("5.7: no file written for the Medium is a commit path", async () => {
    const s = setup({ files: { [MEASUREMENT_REL]: "{}" }, onSpawn: allowedRun });
    await run(s);
    const written = [...s.context.keys(), GUARD_LOG, ".graveyard-work/certificate.json"];
    for (const rel of written) {
      expect(rel.startsWith(".graveyard-work/")).toBe(true);
      expect(isAllowedCommitPath(rel)).toBe(false);
    }
    expect(ALLOWED_MEDIUM_PATHS.some((p) => p.startsWith(".graveyard-work"))).toBe(false);
  });
});

describe("Medium process (8.3, 8.6, 9.5 to 9.10)", () => {
  it("8.3: an unsupported package name stops with exit 64 and zero spawns", async () => {
    const s = setup();
    const r = await run(s, "Bad Name;rm");
    expect(r.exitCode).toBe(64);
    expect(s.spawns).toHaveLength(0);
    expect(s.asked).toEqual([]);
    expect(s.context.size).toBe(0);
  });

  it("8.6: spawns kiro-cli once with an argument array, no shell and the repository root as cwd", async () => {
    const s = setup({ onSpawn: allowedRun });
    await run(s);
    expect(s.spawns).toHaveLength(1);
    const call = s.spawns[0];
    expect(call?.command).toBe("kiro-cli");
    expect(Array.isArray(call?.args)).toBe(true);
    expect(call?.args.slice(0, 6)).toEqual(["chat", "--v3", "--no-interactive", "--require-mcp-startup", "--agent", "medium"]);
    expect(call?.args).toHaveLength(7);
    expect(call?.args[6]).toContain("lodash.set");
    expect(call?.args).not.toContain("--trust-all-tools");
    expect(call?.options.shell).toBe(false);
    expect(call?.options.cwd).toBe(ROOT);
    expect(call?.options.env["GRAVEYARD_CERTIFICATE_PATH"]).toBe(`${ROOT}/.graveyard-work/certificate.json`);
    expect(call?.options.env["GITHUB_TOKEN"]).toBeUndefined();
  });

  it("9.x: prints the Credit_Ceiling once and asks the first reading before the spawn", async () => {
    const s = setup({ onSpawn: allowedRun });
    await run(s);
    expect(s.out.filter((l) => l.includes("Credit_Ceiling"))).toHaveLength(1);
    expect(s.asked).toHaveLength(2);
  });

  it("exited 0: one Ledger entry with the readings as typed and no cliUsage key", async () => {
    const s = setup({ onSpawn: allowedRun });
    await run(s);
    const entries = ledgerEntries(s);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ mode: "local", creditBefore: "10 credits", creditAfter: "12 credits", exitCode: 0 });
    expect(Object.keys(entries[0] ?? {})).not.toContain("cliUsage");
  });

  it("empty readings are recorded as not provided", async () => {
    const s = setup({ answers: ["", ""], onSpawn: allowedRun });
    await run(s);
    expect(ledgerEntries(s)[0]).toMatchObject({ creditBefore: "not provided", creditAfter: "not provided" });
  });

  it("exited non-zero: Ledger entry with that code, no push, non-zero exit", async () => {
    const s = setup({ behavior: { kind: "close", code: 3 } });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(ledgerEntries(s)[0]).toMatchObject({ exitCode: 3 });
    expect(s.pushes).toEqual([]);
  });

  it("exited with a null code is recorded as 1", async () => {
    const s = setup({ behavior: { kind: "close", code: null } });
    await run(s);
    expect(ledgerEntries(s)[0]).toMatchObject({ exitCode: 1 });
    expect(s.pushes).toEqual([]);
  });

  it("usage limit text on standard error: Ledger entry, cause printed, no push", async () => {
    const s = setup({ behavior: { kind: "close", code: 0, stderr: "Error: UsageLimitReached" } });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(errText(s)).toContain("usage limit");
    expect(ledgerEntries(s)).toHaveLength(1);
    expect(s.pushes).toEqual([]);
  });

  it("not-found (ENOENT): no second reading, no Ledger entry, no push, cause printed", async () => {
    const s = setup({ behavior: { kind: "error", code: "ENOENT", message: "spawn kiro-cli ENOENT" } });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(s.asked).toHaveLength(1);
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
    expect(errText(s)).toContain("kiro-cli was not found");
  });

  it.each([
    ["an error event", { kind: "error", code: "EACCES", message: "EACCES boom" }],
    ["a throwing spawn", { kind: "throw", message: "EACCES boom" }],
  ] as Array<[string, SpawnBehavior]>)("failed-to-start by %s: no second reading, no Ledger entry, no push", async (_n, behavior) => {
    const s = setup({ behavior });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(s.spawns).toHaveLength(1);
    expect(s.asked).toHaveLength(1);
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
    expect(errText(s)).toContain("EACCES boom");
  });

  it("a rejected second reading is an interrupt: exit 130, no Ledger entry, no push, Journal note", async () => {
    const s = setup({ rejectSecondAsk: true, onSpawn: allowedRun });
    const r = await run(s);
    expect(r.exitCode).toBe(130);
    expect(s.spawns).toHaveLength(1);
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
    expect(errText(s)).toContain("kiro-journal.md by hand");
  });

  it("a stub run spawns nothing, writes no context, asks nothing and pushes once in stub mode", async () => {
    const s = setup();
    const r = await runResurrect(["lodash.set", "--stub", FIXTURE_REL], s.deps);
    expect(r.exitCode).toBe(0);
    expect(s.spawns).toHaveLength(0);
    expect(s.asked).toEqual([]);
    expect(s.context.size).toBe(0);
    expect(s.removed).toEqual([]);
    expect(s.truncated).toEqual([]);
    expect(s.log).not.toContain("git status");
    expect(s.out.join("\n")).not.toContain("Credit_Ceiling");
    expect(ledgerEntries(s)[0]).toMatchObject({ mode: "stub" });
    expect(s.pushes).toHaveLength(1);
    expect(s.pushes[0]?.mode).toBe("stub");
  });
});

describe("Clean tree and checks after the run (10.1 to 10.11)", () => {
  it("10.1: a dirty tree starts nothing; ledger.json alone adds the commit message", async () => {
    const s = setup({ gitStatuses: [{ ok: true, value: " M ledger.json\0" }] });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(errText(s)).toContain("commit ledger.json first");
    expect(s.spawns).toHaveLength(0);
    expect(s.asked).toEqual([]);
    expect(s.context.size).toBe(0);
    expect(s.files.has("ledger.json")).toBe(false);
  });

  it("10.1: another dirty path is listed escaped without the commit message", async () => {
    const s = setup({ gitStatuses: [{ ok: true, value: " M src/a\nb.ts\0" }] });
    await run(s);
    expect(errText(s)).toContain("src/a\\u000ab.ts");
    expect(errText(s)).not.toContain("commit ledger.json first");
    expect(s.spawns).toHaveLength(0);
  });

  it("10.2: a failed first git status read fails closed: no spawn, no reading, no Ledger entry", async () => {
    const s = setup({ gitStatuses: [{ ok: false, error: "x" }] });
    expect((await run(s)).exitCode).not.toBe(0);
    expect(s.spawns).toHaveLength(0);
    expect(s.asked).toEqual([]);
    expect(s.files.has("ledger.json")).toBe(false);
  });

  it("10.7: a non-zero exit stops before the Guard_Log, git status and intake checks", async () => {
    const s = setup({ behavior: { kind: "close", code: 2 }, files: { [GUARD_LOG]: `${DENY_LINE}\n` } });
    await run(s);
    expect(s.log.filter((l) => l === "git status")).toHaveLength(1);
    expect(s.log).not.toContain("validate");
    expect(errText(s)).toContain("exited with code 2");
    expect(s.pushes).toEqual([]);
  });

  it("10.3: a DENY line stops before the push, prints the line escaped, keeps the Ledger entry, deletes nothing", async () => {
    const s = setup({ onSpawn: (f) => f.set(GUARD_LOG, `${ALLOW_LINE}\n${DENY_LINE}\n`) });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(errText(s)).toContain("src/evil\\u0001.ts");
    expect(ledgerEntries(s)).toHaveLength(1);
    expect(s.pushes).toEqual([]);
    expect(s.log.filter((l) => l === "git status")).toHaveLength(1);
    expect(s.log).not.toContain("validate");
    expect(s.removed).toEqual([CONTEXT_DIR]);
  });

  it("10.4: output present and an empty Guard_Log stops before the push", async () => {
    const s = setup({ onSpawn: (f) => f.set("deltas.json", "{}") });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(errText(s)).toContain("Write_Guard left no record");
    expect(ledgerEntries(s)).toHaveLength(1);
    expect(s.pushes).toEqual([]);
    expect(s.log).not.toContain("validate");
  });

  it("10.4: an unreadable Guard_Log stops before the push", async () => {
    const s = setup({ onSpawn: allowedRun });
    const read = s.deps.fs.readOptional;
    s.deps = {
      ...s.deps,
      fs: {
        ...s.deps.fs,
        readOptional: async (rel) => {
          if (rel === GUARD_LOG) throw new Error("EIO");
          return read(rel);
        },
      },
    };
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(errText(s)).toContain(GUARD_LOG);
    expect(s.pushes).toEqual([]);
  });

  it("10.5: a changed path outside the outputs stops before the push, escaped, nothing deleted", async () => {
    const s = setup({
      onSpawn: allowedRun,
      gitStatuses: [{ ok: true, value: "" }, { ok: true, value: " M src/a\nb.ts\0?? deltas.json\0" }],
    });
    const r = await run(s);
    expect(r.exitCode).not.toBe(0);
    expect(errText(s)).toContain("src/a\\u000ab.ts");
    expect(s.pushes).toEqual([]);
    expect(s.log).not.toContain("validate");
  });

  it("10.5/10.6: a failed git status read after the run stops before the push", async () => {
    const s = setup({ onSpawn: allowedRun, gitStatuses: [{ ok: true, value: "" }, { ok: false, error: "x" }] });
    expect((await run(s)).exitCode).not.toBe(0);
    expect(s.pushes).toEqual([]);
    expect(ledgerEntries(s)).toHaveLength(1);
  });

  it("10.8: a deltas.json that fails to parse stops before the push", async () => {
    const s = setup({
      onSpawn: (f) => {
        f.set("deltas.json", "{ nope");
        f.set(GUARD_LOG, `${ALLOW_LINE}\n`);
      },
    });
    expect((await run(s)).exitCode).not.toBe(0);
    expect(errText(s)).toContain("deltas.json:");
    expect(s.pushes).toEqual([]);
  });

  it("10.8: an intake violation stops before the push", async () => {
    const s = setup({ onSpawn: allowedRun, entries: [] });
    expect((await run(s)).exitCode).not.toBe(0);
    expect(errText(s)).toContain("missing-required");
    expect(s.pushes).toEqual([]);
  });

  it("10.11: when every check passes, one push in local mode and its exit code is returned", async () => {
    const s = setup({ onSpawn: allowedRun });
    const r = await run(s);
    expect(r.exitCode).toBe(0);
    expect(s.pushes).toEqual([{ package: "lodash.set", version: VERSION, mode: "local", root: ROOT }]);
    expect(s.log).toEqual([
      "git status",
      `removeTree ${CONTEXT_DIR}`,
      ...[...s.context.keys()].map((k) => `writeBytes ${k}`),
      `truncate ${GUARD_LOG}`,
      "spawn",
      "atomic ledger.json",
      "git status",
      "validate",
      "push",
    ]);
  });
});
