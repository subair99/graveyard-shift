// Requirements: 4.1, 4.2, 4.3, 4.4, 4.7
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { summarizeGuardLog } from "../../../src/pipeline/medium/core/guardLog";

const GUARD = resolve("src/pipeline/medium/agent/writeGuard.mjs");

let base = "";
let root = "";
let logFile = "";

interface GuardRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runGuard(input: string, guardLog: string = logFile): GuardRun {
  const r = spawnSync(process.execPath, [GUARD], {
    input,
    encoding: "utf8",
    env: { ...process.env, GUARD_LOG_FILE: guardLog },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function event(over: Record<string, unknown>): string {
  return JSON.stringify({ hook_event_name: "preToolUse", cwd: root, tool_name: "fs_write", ...over });
}

function logLines(): string[] {
  const text = readFileSync(logFile, "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "medium-guardlog-it-")));
  root = join(base, "root");
  mkdirSync(root);
});

beforeEach(() => {
  logFile = join(base, "guard.log");
  rmSync(logFile, { force: true });
});

afterAll(() => {
  if (base !== "") rmSync(base, { recursive: true, force: true });
});

describe("Guard_Log lines written by the Write_Guard child process", () => {
  it("logs an allowed write as one ALLOW line", () => {
    const run = runGuard(event({ tool_input: { path: "resurrection/index.js" } }));
    expect(run.status).toBe(0);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    const fields = lines[0]!.split(" ");
    expect(fields[0]).toMatch(TIMESTAMP);
    expect(fields[1]).toBe("ALLOW");
    expect(lines[0]).toContain("tool=fs_write");
    expect(lines[0]).toContain("path=resurrection/index.js");
  });

  it("logs a blocked write as one DENY line with the reason", () => {
    const run = runGuard(event({ tool_input: { path: "src/evil.js" } }));
    expect(run.status).toBe(2);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    const fields = lines[0]!.split(" ");
    expect(fields[0]).toMatch(TIMESTAMP);
    expect(fields[1]).toBe("DENY");
    expect(lines[0]).toContain("tool=fs_write");
    expect(lines[0]).toContain("reason=path is not under resurrection/");
    expect(lines[0]).toContain("path=src/evil.js");
  });

  it("logs a call of a tool that is not a Write_Tool as ALLOW", () => {
    const run = runGuard(event({ tool_name: "fs_read", tool_input: { path: "src/evil.js" } }));
    expect(run.status).toBe(0);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.split(" ")[1]).toBe("ALLOW");
    expect(lines[0]).toContain("tool=fs_read");
    expect(lines[0]).toContain("reason=not a write tool");
  });

  it("logs invalid JSON as DENY", () => {
    const run = runGuard("{not json");
    expect(run.status).toBe(2);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.split(" ")[1]).toBe("DENY");
    expect(lines[0]).toContain("reason=hook event is not valid JSON");
    expect(lines[0]).not.toContain("tool=");
  });

  it("logs an event without tool_name as DENY", () => {
    const run = runGuard(JSON.stringify({ cwd: root, tool_input: { path: "resurrection/a.js" } }));
    expect(run.status).toBe(2);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.split(" ")[1]).toBe("DENY");
    expect(lines[0]).toContain("reason=hook event has no string tool_name");
    expect(lines[0]).not.toContain("tool=");
  });

  it("cuts a path of more than 200 code units to 200 in the log", () => {
    const longPath = `resurrection/${"a".repeat(300)}`;
    const run = runGuard(event({ tool_input: { path: longPath } }));
    expect(run.status).toBe(0);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    const logged = lines[0]!.split(" path=")[1]!;
    expect(logged).toBe(longPath.slice(0, 200));
    expect(logged).toHaveLength(200);
  });

  it("escapes a control character so the entry stays on one line", () => {
    const run = runGuard(event({ tool_input: { path: "resurrection/a\nb\u0001c" } }));
    expect(run.status).toBe(2);
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("path=resurrection/a\\u000ab\\u0001c");
    expect(lines[0]).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    expect(lines[0]!.split(" ")[1]).toBe("DENY");
  });

  it("only appends to an existing log and the reader counts every line and DENY line", () => {
    const existing = "2020-01-01T00:00:00.000Z DENY tool=fs_write reason=earlier path=x\nold line without newline end\n";
    writeFileSync(logFile, existing);
    runGuard(event({ tool_input: { path: "resurrection/ok.js" } }));
    runGuard(event({ tool_input: { path: "src/bad.js" } }));
    const text = readFileSync(logFile, "utf8");
    expect(text.startsWith(existing)).toBe(true);
    const added = text.slice(existing.length).split("\n").filter((l) => l !== "");
    expect(added).toHaveLength(2);
    expect(added[0]!.split(" ")[1]).toBe("ALLOW");
    expect(added[1]!.split(" ")[1]).toBe("DENY");
    const summary = summarizeGuardLog(text);
    expect(summary.lineCount).toBe(4);
    expect(summary.denyLines).toHaveLength(2);
  });
});

describe("unwritable Guard_Log", () => {
  const cases: { name: string; input: () => string }[] = [
    { name: "allowed write", input: () => event({ tool_input: { path: "resurrection/index.js" } }) },
    { name: "blocked write", input: () => event({ tool_input: { path: "src/evil.js" } }) },
  ];

  for (const c of cases) {
    it(`keeps exit code and standard error of an ${c.name} when the parent directory is missing`, () => {
      const baseline = runGuard(c.input());
      const missing = join(base, "no-such-dir", "guard.log");
      const run = runGuard(c.input(), missing);
      expect(run).toEqual(baseline);
      expect(existsSync(join(base, "no-such-dir"))).toBe(false);
    });

    it(`keeps exit code and standard error of an ${c.name} when the Guard_Log is a directory`, () => {
      const baseline = runGuard(c.input());
      const dirLog = join(base, "log-is-a-dir");
      mkdirSync(dirLog, { recursive: true });
      const run = runGuard(c.input(), dirLog);
      expect(run).toEqual(baseline);
      expect(statSync(dirLog).isDirectory()).toBe(true);
    });
  }
});
