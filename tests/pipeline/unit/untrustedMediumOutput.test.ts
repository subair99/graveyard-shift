// Requirements: 1.3
// R1.3: every byte of the Medium_Output is untrusted data in the Local_Runner, the Push_Script and the CI_Workflow.
// Hostile names are either rejected by the shared Intake_Validator or travel as one whole argument of an
// argument-list command; they are never executed or interpolated into a command line.
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PINNED_NODE_VERSION } from "../../../src/pipeline/common/constants";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import type { IntakeEntry } from "../../../src/pipeline/intake/core/types";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import type { CommandResult, CommandRunner } from "../../../src/pipeline/local/shell/gitPlumbing";
import { runPush, type PushDeps } from "../../../src/pipeline/local/shell/push";
import { runResurrect, type ResurrectDeps, type ResurrectFs } from "../../../src/pipeline/local/shell/resurrect";
import type { PushInput } from "../../../src/pipeline/local/shell/push";
import { fetchAndValidateStep, type Env, type IntakeDeps } from "../../../scripts/ci/lib/intakeSteps";
import { extractTarball, packTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { tarballOf } from "../../proof/helpers/buildTarball";
import { IP_CERT, LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function file(p: string, text = "1\n"): IntakeEntry {
  const bytes = enc(text);
  return { path: p, type: "file", size: bytes.length, bytes };
}

const base = (): IntakeEntry[] => [
  file("resurrection/package.json", "{}"),
  file("deltas.json", "{}"),
  file("harness.json", "{}"),
];

/**
 * Names the Intake_Validator must reject: traversal, backslash, control characters (NUL, newline, R9.6 amended),
 * absolute, drive, forbidden segments, outside the allowlist.
 */
const REJECTED_NAMES = [
  "resurrection/../../x.js",
  "resurrection\\..\\..\\x.js",
  "..\\..\\x",
  "..\\..\\x.js",
  "resurrection/a\0.js",
  "/etc/cron.d/x",
  "C:/Windows/x.js",
  "resurrection/.git/hooks/pre-commit",
  "resurrection/.github/x.js",
  "a;touch x.js",
  "$(id).js",
  "`id`.js",
  "x\ny.js",
  "resurrection/a\nb.js",
  "resurrection/a\n::warning::x",
  "src/$(id).js",
];

/** Names the validator accepts (inside resurrection/, allowed extension). They are data and must stay data. */
const ACCEPTED_HOSTILE_NAMES = [
  "resurrection/a;touch x.js",
  "resurrection/$(id).js",
  "resurrection/`id`.js",
  "resurrection/a&&id.js",
  "resurrection/a|id.js",
];

const MARKERS = [";", "$(", "`", "&&", "|", "\n", "..", "\\"];
const hasMarker = (s: string): boolean => MARKERS.some((m) => s.includes(m));

describe("Intake_Validator (shared by the three places)", () => {
  it.each(REJECTED_NAMES)("rejects %j", (name) => {
    const r = validateIntake([...base(), file(name)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.some((v) => v.path === name && (v.code === "bad-path" || v.code === "outside-allowlist"))).toBe(true);
  });

  it("accepts the shell-looking names inside resurrection/ as plain data", () => {
    const r = validateIntake([...base(), ...ACCEPTED_HOSTILE_NAMES.map((n) => file(n))]);
    expect(r.ok).toBe(true);
  });
});

interface Call {
  command: string;
  argv: string[];
}

function pushFakes(entries: IntakeEntry[]) {
  const calls: Call[] = [];
  const err: string[] = [];
  const SHA = "a".repeat(40);
  const runner: CommandRunner = {
    async run(command, argv): Promise<CommandResult> {
      calls.push({ command, argv: [...argv] });
      const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
      if (argv[0] === "config") return ok("1234+someone@users.noreply.github.com\n");
      if (argv[0] === "hash-object") return ok(`${"b".repeat(40)}\n`);
      if (argv[0] === "write-tree") return ok(`${"c".repeat(40)}\n`);
      if (argv[0] === "commit-tree") return ok(`${SHA}\n`);
      return ok();
    },
  };
  const deps: PushDeps = {
    runner,
    readEntries: async () => entries,
    confirmEmail: async () => true,
    makeTempIndex: async () => ({ path: "/tmp/idx", cleanup: async () => undefined }),
    out: () => undefined,
    err: (l) => err.push(l),
  };
  return { calls, err, deps };
}

describe("Push_Script", () => {
  const input = { package: "lodash.set", version: "4.3.3", mode: "local" as const, root: "unused" };

  it.each(REJECTED_NAMES)("runs no command at all for %j", async (name) => {
    const f = pushFakes([...base(), file(name)]);
    expect(await runPush(input, f.deps)).toBe(1);
    expect(f.calls).toEqual([]);
  });

  it("passes accepted shell-looking names only as one argument of update-index, never as a command or a split argument", async () => {
    const f = pushFakes([...base(), ...ACCEPTED_HOSTILE_NAMES.map((n) => file(n))]);
    expect(await runPush(input, f.deps)).toBe(0);

    const hostile = f.calls.filter((c) => c.argv.some(hasMarker));
    expect(hostile.length).toBe(ACCEPTED_HOSTILE_NAMES.length);
    for (const call of hostile) {
      expect(call.command).toBe("git");
      expect(call.argv.slice(0, 3)).toEqual(["update-index", "--add", "--cacheinfo"]);
      expect(call.argv).toHaveLength(4);
      expect(call.argv[3]).toMatch(/^100644,[0-9a-f]{40},resurrection\//);
    }
    const passed = hostile.map((c) => (c.argv[3] ?? "").split(",").slice(2).join(","));
    expect(passed.sort()).toEqual([...ACCEPTED_HOSTILE_NAMES].sort());

    // Every command is git or gh with an argument list whose first element is a known subcommand, never a name from the Medium_Output.
    const subcommands = new Set(["config", "fetch", "ls-remote", "read-tree", "hash-object", "update-index", "write-tree", "commit-tree", "push", "workflow"]);
    for (const c of f.calls) {
      expect(["git", "gh"]).toContain(c.command);
      expect(subcommands.has(c.argv[0] ?? "")).toBe(true);
    }
    // The message, the branch and the dispatch carry only the validated package name and version.
    const text = f.calls.filter((c) => !hostile.includes(c)).flatMap((c) => c.argv);
    expect(text.some(hasMarker)).toBe(false);
    expect(f.calls.find((c) => c.argv[0] === "push")?.argv).toEqual(["push", "origin", `${"a".repeat(40)}:refs/heads/resurrect/lodash.set`]);
  });
});

describe("Local_Runner", () => {
  function setup(entries: IntakeEntry[]) {
    const err: string[] = [];
    const pushes: PushInput[] = [];
    const kiroRuns: string[] = [];
    const files = new Map<string, string>();
    const fs: ResurrectFs = {
      exists: async (rel) => files.has(rel),
      readText: async (rel) => files.get(rel) ?? null,
      mkdir: async () => undefined,
      writeText: async (rel, text) => void files.set(rel, text),
      writeAtomic: async (rel, text) => void files.set(rel, text),
      listDir: async () => [],
      copy: async () => undefined,
      readOptional: async () => null,
      removeTree: async () => undefined,
      writeBytes: async () => undefined,
      truncate: async () => undefined,
    };
    const deps: ResurrectDeps = {
      repoRoot: "/home/u/graveyard-shift",
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
        tarball: new Uint8Array([1]),
      }),
      gitStatus: async () => ({ ok: true, value: "" }),
      extract: async () => ({ ok: true, value: [] }),
      identity: { pathValues: [], userName: undefined },
      platform: "posix",
      kiro: () => ({
        run: async (name) => {
          kiroRuns.push(name);
          return { kind: "exited", exitCode: 0, usageLimit: false };
        },
      }),
      kiroVersion: async () => "kiro-cli 1.2.3",
      prompt: { ask: async () => "10 credits" },
      readEntries: async () => entries,
      push: async (input) => {
        pushes.push(input);
        return 0;
      },
      clock: { now: () => new Date("2026-11-16T10:00:00.000Z") },
      env: { HOME: "/home/u" },
      out: () => undefined,
      err: (l) => err.push(l),
    };
    return { deps, err, pushes, kiroRuns };
  }

  it.each(REJECTED_NAMES)("reports %j as a violation and does not call the Push_Script", async (name) => {
    const s = setup([...base(), file(name)]);
    expect((await runResurrect(["lodash.set"], s.deps)).exitCode).toBe(1);
    expect(s.pushes).toEqual([]);
    expect(s.err.join("\n")).toMatch(/bad-path|outside-allowlist/);
  });

  it("starts the Medium only with the validated package name and hands the push only fixed fields", async () => {
    const s = setup([...base(), ...ACCEPTED_HOSTILE_NAMES.map((n) => file(n))]);
    expect((await runResurrect(["lodash.set"], s.deps)).exitCode).toBe(0);
    expect(s.kiroRuns).toEqual(["lodash.set"]);
    expect(s.pushes).toEqual([
      { package: "lodash.set", version: LODASH_SET_CERT.package.version, mode: "local", root: "/home/u/graveyard-shift" },
    ]);
    expect(JSON.stringify(s.pushes)).not.toMatch(/touch|\$\(|`/);
  });
});

describe("CI intake", () => {
  const SHA = "a".repeat(40);
  const env: Env = {
    GS_REF: "refs/heads/main",
    GS_PACKAGE: "ip",
    GS_VERSION: "2.0.1",
    GS_BRANCH: "resurrect/ip",
    GS_MEDIUM_MODE: "local",
    GS_BRANCH_COMMIT: SHA,
  };
  const originalTar = tarballOf([
    { path: "package.json", bytes: enc(JSON.stringify({ name: "ip", version: "2.0.1", license: "MIT", author: "A B" })) },
    { path: "LICENSE", bytes: enc("MIT text\n") },
  ]);
  const manifest = JSON.stringify({ name: "@graveyard-shift/ip", version: "2.0.2", license: "MIT", author: "A B" });
  const good = (): IntakeEntry[] => [
    file("resurrection/package.json", manifest),
    file("resurrection/LICENSE", "MIT text\n"),
    file("deltas.json", "{}"),
    file("harness.json", "{}"),
  ];

  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "gs-untrusted-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(cwd, "original.tgz"), originalTar.bytes);
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function run(entries: IntakeEntry[]) {
    const commands: string[][] = [];
    const errors: string[] = [];
    const record = async (argv: readonly string[]) => {
      commands.push([...argv]);
      return { code: 0, stdout: "", stderr: "" };
    };
    const deps: IntakeDeps = {
      cwd,
      env,
      io: { log: () => undefined, error: (l) => errors.push(l), setOutput: () => undefined, summary: () => undefined },
      nodeVersion: `v${PINNED_NODE_VERSION}`,
      coroner: async () => ({ certificates: [IP_CERT], errors: [], notes: [] }),
      gravedigger: async () => {
        throw new Error("not used");
      },
      runGh: record,
      runGit: record,
      readGitEntries: async () => ({ ok: true, value: entries }),
      extractOriginal: async (bytes) => {
        const dir = await mkdtemp(path.join(tmpdir(), "gs-untrusted-x-"));
        try {
          const r = await extractTarball(bytes, dir);
          return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error.kind };
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      packTarball,
    };
    return { deps, commands, errors };
  }

  const exists = (rel: string): Promise<boolean> =>
    stat(path.join(cwd, rel)).then(
      () => true,
      () => false,
    );

  it.each(REJECTED_NAMES)("rejects %j before writing anything and runs no command", async (name) => {
    const r = run([...good(), file(name)]);
    expect(await fetchAndValidateStep(r.deps)).toBe(1);
    expect(r.commands).toEqual([]);
    expect(await exists("work")).toBe(false);
  });

  it("writes accepted shell-looking names as literal files under work/medium and runs no command", async () => {
    // `|` is not valid in Windows file names, so it is left to the Push_Script test. A newline is rejected (R9.6).
    const names = ACCEPTED_HOSTILE_NAMES.filter((n) => !n.includes("|"));
    const r = run([...good(), ...names.map((n) => file(n))]);
    expect(await fetchAndValidateStep(r.deps)).toBe(0);
    expect(r.commands).toEqual([]);
    const written = await readdir(path.join(cwd, "work/medium/resurrection"));
    for (const n of names) expect(written).toContain(n.slice("resurrection/".length));
    expect(await readFile(path.join(cwd, "work/medium/resurrection", "a;touch x.js"), "utf8")).toBe("1\n");
    expect(await exists("x.js")).toBe(false);
    expect(await exists("work/medium/x.js")).toBe(false);
  });
});

describe("no shell anywhere in the Pipeline", () => {
  const ROOT = path.resolve(__dirname, "../../..");

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === "spike") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (name.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  const files = [
    ...sources(path.join(ROOT, "src/pipeline")),
    ...sources(path.join(ROOT, "scripts/ci")),
    path.join(ROOT, "scripts/resurrect.ts"),
    path.join(ROOT, "scripts/push-resurrection.ts"),
  ];

  it("scans the Pipeline sources", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("no module starts a child process through a shell", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/shell\s*:\s*true/.test(text) || /(?<![.\w])(exec|execSync)\s*\(/.test(text)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });

  it("the command runner, the Medium runner and the version probe say shell: false", () => {
    for (const rel of ["src/pipeline/local/shell/gitPlumbing.ts", "src/pipeline/medium/shell/kiroRunner.ts", "src/pipeline/local/shell/resurrect.ts"]) {
      expect(readFileSync(path.join(ROOT, rel), "utf8")).toMatch(/shell\s*:\s*false/);
    }
  });
});
