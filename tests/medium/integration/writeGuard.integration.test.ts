// Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const GUARD = resolve("src/pipeline/medium/agent/writeGuard.mjs");
const SPIKE_CASES = resolve("spikes/kiro-agent/hooks/pre-tool-write-guard.test-cases.json");
const BLOCK_PREFIX = "write-guard: blocked:";

interface SpikeCase {
  id: string;
  path?: string;
  tool?: string;
  expect: "allow" | "deny";
  needs?: "symlink" | "posix";
  omitPath?: boolean;
}
interface SpikeFile {
  setup: {
    files: string[];
    dirs: string[];
    symlinks: { link: string; target: string; type: "dir" | "file" }[];
  };
  cases: SpikeCase[];
}

const spike = JSON.parse(readFileSync(SPIKE_CASES, "utf8")) as SpikeFile;

function canCreateSymlinks(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "wg-probe-"));
  try {
    writeFileSync(join(probe, "t"), "x");
    symlinkSync(join(probe, "t"), join(probe, "l"), "file");
    mkdirSync(join(probe, "d"));
    symlinkSync(join(probe, "d"), join(probe, "ld"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const symlinksOk = canCreateSymlinks();
const isWindows = process.platform === "win32";

let base = "";
let root = "";
let logFile = "";

function snapshot(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map(String).sort();
}

interface GuardRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runGuard(input: string): GuardRun {
  const r = spawnSync(process.execPath, [GUARD], {
    input,
    encoding: "utf8",
    env: { ...process.env, GUARD_LOG_FILE: logFile },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function event(over: Record<string, unknown>): string {
  return JSON.stringify({ hook_event_name: "preToolUse", cwd: root, tool_name: "fs_write", ...over });
}

function check(run: GuardRun, expected: "allow" | "deny", before: string[]): void {
  expect(run.status).toBe(expected === "allow" ? 0 : 2);
  expect(run.stdout).toBe("");
  if (expected === "deny") {
    expect(run.stderr.startsWith(BLOCK_PREFIX)).toBe(true);
  } else {
    expect(run.stderr).toBe("");
  }
  expect(snapshot(root)).toEqual(before);
  expect(snapshot(base).filter((p) => p !== "guard.log" && !p.startsWith("root") && !p.startsWith("outside"))).toEqual([]);
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "medium-guard-it-")));
  root = join(base, "root");
  logFile = join(base, "guard.log");
  mkdirSync(root);
  mkdirSync(join(base, "outside"));
  for (const d of spike.setup.dirs) mkdirSync(join(root, d), { recursive: true });
  for (const f of spike.setup.files) {
    const target = f.startsWith("outside/") ? join(base, f) : join(root, f);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "fixture\n");
  }
  if (symlinksOk) {
    for (const s of spike.setup.symlinks) {
      symlinkSync(s.target, join(root, s.link), s.type === "dir" ? "dir" : "file");
    }
  }
});

afterAll(() => {
  if (base !== "") rmSync(base, { recursive: true, force: true });
});

describe("Write_Guard child process: spike case table", () => {
  it("reads at least one case from the spike file", () => {
    expect(spike.cases.length).toBeGreaterThan(0);
  });

  for (const c of spike.cases) {
    const skip = (c.needs === "symlink" && !symlinksOk) || (c.needs === "posix" && isWindows);
    it.skipIf(skip)(`${c.id} -> ${c.expect}`, () => {
      const toolInput: Record<string, unknown> = {};
      if (c.omitPath !== true) toolInput.path = String(c.path).replaceAll("{ROOT}", root);
      const before = snapshot(root);
      const run = runGuard(event({ tool_name: c.tool ?? "fs_write", tool_input: toolInput }));
      check(run, c.expect, before);
    });
  }
});

describe("Write_Guard child process: Requirement 3.3 conditions", () => {
  const cases: { id: string; path: string; expect: "allow" | "deny"; needs?: "symlink" | "posix" }[] = [
    { id: "drive prefix, lower-case letter", path: "c:foo", expect: "deny" },
    { id: "drive prefix with slash", path: "D:/resurrection/a.js", expect: "deny" },
    { id: "double-slash start", path: "//server/share/x", expect: "deny" },
    { id: "tilde start", path: "~", expect: "deny" },
    { id: "backslash inside", path: "resurrection/a\\b.js", expect: "deny" },
    { id: "control character U+0001", path: "resurrection/a\u0001b.js", expect: "deny" },
    { id: "control character U+007F", path: "resurrection/a\u007fb.js", expect: "deny" },
    { id: "newline in path", path: "resurrection/a\nb.js", expect: "deny" },
    { id: "outside through ..", path: "resurrection/../../outside/x", expect: "deny" },
    { id: "absolute outside", path: "/outside/x.txt", expect: "deny" },
    { id: "work root itself", path: ".", expect: "deny" },
    { id: ".git segment", path: "resurrection/.git/config", expect: "deny" },
    { id: ".GIT upper case", path: "resurrection/.GIT/config", expect: "deny" },
    { id: ".GitHub mixed case", path: "resurrection/.GitHub/x.yml", expect: "deny" },
    { id: ".Kiro mixed case", path: ".Kiro/agents/medium.json", expect: "deny" },
    { id: ".graveyard-work path", path: ".graveyard-work/guard.log", expect: "deny" },
    { id: "Resurrection capital R", path: "Resurrection/a.js", expect: "deny" },
    { id: "RESURRECTION upper case", path: "RESURRECTION/a.js", expect: "deny" },
    { id: "Deltas.json capital D", path: "Deltas.json", expect: "deny" },
    { id: "HARNESS.JSON upper case", path: "HARNESS.JSON", expect: "deny" },
    { id: "deltas.json as directory", path: "deltas.json/x", expect: "deny" },
    { id: "other path", path: "src/index.js", expect: "deny" },
    { id: "doubled slash normalized by resolution", path: "resurrection//a.js", expect: "allow" },
    { id: "allowed file with dot segment", path: "resurrection/./a.js", expect: "allow" },
    { id: "allowed file with leading dot slash", path: "./harness.json", expect: "allow" },
  ];
  for (const c of cases) {
    it.skipIf(c.needs === "symlink" && !symlinksOk)(`${c.id} -> ${c.expect}`, () => {
      const before = snapshot(root);
      check(runGuard(event({ tool_input: { path: c.path } })), c.expect, before);
    });
  }

  it("blocks when one of several targets is bad (paths array)", () => {
    const before = snapshot(root);
    const run = runGuard(event({ tool_input: { paths: ["resurrection/a.js", "README.md"] } }));
    check(run, "deny", before);
  });

  it("allows a paths array of allowed targets", () => {
    const before = snapshot(root);
    const run = runGuard(event({ tool_input: { paths: ["resurrection/a.js", "deltas.json"] } }));
    check(run, "allow", before);
  });

  it.skipIf(!symlinksOk)("blocks a symbolic link that resolves outside resurrection/", () => {
    const before = snapshot(root);
    check(runGuard(event({ tool_input: { path: "resurrection/readme-link" } })), "deny", before);
  });
});

describe("Write_Guard child process: Requirements 3.4 to 3.6", () => {
  it("blocks invalid JSON", () => {
    const before = snapshot(root);
    check(runGuard("not json"), "deny", before);
  });

  it("blocks empty standard input", () => {
    const before = snapshot(root);
    check(runGuard(""), "deny", before);
  });

  for (const [id, text] of [
    ["array", "[]"],
    ["string", '"fs_write"'],
    ["number", "5"],
    ["null", "null"],
  ] as const) {
    it(`blocks a JSON ${id}`, () => {
      const before = snapshot(root);
      check(runGuard(text), "deny", before);
    });
  }

  it("blocks a missing tool_name", () => {
    const before = snapshot(root);
    const input = JSON.stringify({ cwd: root, tool_input: { path: "resurrection/a.js" } });
    check(runGuard(input), "deny", before);
  });

  for (const [id, value] of [
    ["number", 5],
    ["null", null],
    ["array", ["fs_write"]],
    ["object", { name: "fs_write" }],
  ] as const) {
    it(`blocks a ${id} tool_name`, () => {
      const before = snapshot(root);
      check(runGuard(event({ tool_name: value, tool_input: { path: "resurrection/a.js" } })), "deny", before);
    });
  }

  it("blocks a write tool without tool_input", () => {
    const before = snapshot(root);
    const input = JSON.stringify({ cwd: root, tool_name: "fs_write" });
    check(runGuard(input), "deny", before);
  });

  it("blocks a write tool whose tool_input has no path key", () => {
    const before = snapshot(root);
    check(runGuard(event({ tool_input: { text: "x" } })), "deny", before);
  });

  it("blocks an empty path", () => {
    const before = snapshot(root);
    check(runGuard(event({ tool_input: { path: "" } })), "deny", before);
  });

  it("blocks a non-string path", () => {
    const before = snapshot(root);
    check(runGuard(event({ tool_input: { path: 5 } })), "deny", before);
  });

  it("blocks a missing cwd", () => {
    const before = snapshot(root);
    const input = JSON.stringify({ tool_name: "fs_write", tool_input: { path: "resurrection/a.js" } });
    check(runGuard(input), "deny", before);
  });

  it("blocks a non-string cwd", () => {
    const before = snapshot(root);
    check(runGuard(event({ cwd: 5, tool_input: { path: "resurrection/a.js" } })), "deny", before);
  });

  it("blocks a cwd that does not exist", () => {
    const before = snapshot(root);
    const run = runGuard(event({ cwd: join(base, "no-such-dir"), tool_input: { path: "resurrection/a.js" } }));
    check(run, "deny", before);
  });

  for (const tool of ["read_file", "list_directory", "shell", "@mediumcontext/get_certificate"]) {
    it(`allows the non-write tool ${tool} without checking tool_input`, () => {
      const before = snapshot(root);
      check(runGuard(event({ tool_name: tool, tool_input: { path: "/etc/passwd" } })), "allow", before);
    });
  }

  it("allows a non-write tool with a missing cwd and no tool_input", () => {
    const before = snapshot(root);
    check(runGuard(JSON.stringify({ tool_name: "read_file" })), "allow", before);
  });
});
