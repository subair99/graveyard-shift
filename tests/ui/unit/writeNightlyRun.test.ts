// Requirements: 9.7, 9.10, 9.11, 12.2
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NightlyRunRecordSchema } from "../../../src/ui/core/nightlyRun";
import { checkNightlyRun, writeNightlyRun } from "../../../scripts/ui/writeNightlyRun.mjs";

const root = join(__dirname, "..", "..", "..");
const script = join(root, "scripts", "ui", "writeNightlyRun.mjs");
const SHA_A = "a".repeat(40);
const SHA_B = "0123456789abcdef0123456789abcdef01234567";

const good: Record<string, string> = {
  GS_RUN_ID: "123456789",
  GS_RUN_STARTED_AT: "2026-11-17T03:00:00Z",
  GS_CONCLUSION: "timed_out",
  GS_HEAD_SHA: SHA_A,
  GS_BUILD_SHA: SHA_B,
};

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "gs-nightly-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runChild(env: Record<string, string>, cwd: string) {
  return spawnSync(process.execPath, [script], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
}

describe("writeNightlyRun.mjs", () => {
  it("builds a record that NightlyRunRecordSchema accepts", () => {
    const r = checkNightlyRun(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(NightlyRunRecordSchema.safeParse(r.record).success).toBe(true);
      expect(r.record.runId).toBe(123456789);
    }
  });

  const bad: [string, string, string][] = [
    ["GS_RUN_ID", "0", "zero"],
    ["GS_RUN_ID", "-5", "negative"],
    ["GS_RUN_ID", "1.5", "fraction"],
    ["GS_RUN_ID", "12abc", "text"],
    ["GS_RUN_ID", "", "empty"],
    ["GS_RUN_STARTED_AT", "2026-11-17T03:00:00.000Z", "milliseconds"],
    ["GS_RUN_STARTED_AT", "2026-02-30T03:00:00Z", "impossible date"],
    ["GS_RUN_STARTED_AT", "2026-11-17 03:00:00", "no zone"],
    ["GS_CONCLUSION", "", "empty conclusion"],
    ["GS_CONCLUSION", "Success", "upper case"],
    ["GS_CONCLUSION", "a".repeat(33), "too long"],
    ["GS_HEAD_SHA", "A".repeat(40), "upper-case sha"],
    ["GS_HEAD_SHA", "abc", "short sha"],
    ["GS_BUILD_SHA", "g".repeat(40), "non-hex sha"],
  ];

  it.each(bad)("rejects %s = %j (%s) with a message naming the variable and agrees with the schema", (name, value) => {
    const env = { ...good, [name]: value };
    const r = checkNightlyRun(env);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.variables).toEqual([name]);
      expect(r.message).toContain(name);
      expect(r.message).not.toContain(value === "" ? "\u0000" : value);
    }
    const asRecord = {
      schemaVersion: 1,
      runId: Number(env.GS_RUN_ID),
      runStartedAt: env.GS_RUN_STARTED_AT,
      conclusion: env.GS_CONCLUSION,
      headSha: env.GS_HEAD_SHA,
      buildSha: env.GS_BUILD_SHA,
    };
    expect(NightlyRunRecordSchema.safeParse(asRecord).success).toBe(false);
  });

  it("treats a missing variable as bad", () => {
    const { GS_CONCLUSION: _omit, ...rest } = good;
    const r = checkNightlyRun(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.variables).toEqual(["GS_CONCLUSION"]);
  });

  it("writes 2-space JSON with a final newline that the schema parses, creating the directory", () => {
    const cwd = tmp();
    const r = writeNightlyRun(good, cwd);
    expect(r).toEqual({ exitCode: 0, written: true, lines: [] });
    const text = readFileSync(join(cwd, ".crypt-nightly", "run.json"), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "runId": 123456789,');
    expect(NightlyRunRecordSchema.parse(JSON.parse(text))).toMatchObject({ conclusion: "timed_out" });
  });

  it("as a child process: writes run.json and exits 0", () => {
    const cwd = tmp();
    const r = runChild(good, cwd);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(NightlyRunRecordSchema.safeParse(JSON.parse(readFileSync(join(cwd, ".crypt-nightly", "run.json"), "utf8"))).success).toBe(true);
  });

  it("as a child process: a bad value prints a warning with the variable name only, writes nothing, exits 0", () => {
    const cwd = tmp();
    const r = runChild({ ...good, GS_CONCLUSION: "SECRET-Value" }, cwd);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::");
    expect(r.stdout).toContain("GS_CONCLUSION");
    expect(r.stdout + r.stderr).not.toContain("SECRET-Value");
    expect(existsSync(join(cwd, ".crypt-nightly", "run.json"))).toBe(false);
  });
});
