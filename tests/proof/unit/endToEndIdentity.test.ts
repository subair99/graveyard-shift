// End-to-end identity safety (task 11.12; Requirements 13.25 to 13.30, decisions D10 and D11,
// limitations L4 and L14). The REAL engine runs (runProofOfLife, InProcess_Executor, Original as a
// tarball with SRI, Resurrection as a directory) on synthetic CommonJS packages whose functions
// return or throw strings holding the machine's real home path and user name. The two sides
// diverge on purpose. The identity values come from the same environment snapshot that
// `defaultProofDeps()` takes. No assertion message or test name prints a real value: every check
// is a boolean with a fixed message.
// Requirements: 3.6, 13.25, 13.26, 13.28, 13.29, 13.30, 16.3
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findIdentity,
  identityValuesFromEnv,
  isWordMatchableUserName,
  type IdentityValues,
  type Platform,
} from "../../../src/proof/core/identity";
import { createInProcessExecutorFactory } from "../../../src/proof/shell/executor/inProcessExecutor";
import { defaultProofDeps, runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { HarnessConfig, ProofRequest, ProofRun } from "../../../src/proof/types";
import { tarballOf } from "../helpers/buildTarball";
import type { TreeFile } from "../../../src/proof/shell/treeHash";

const snapshot = defaultProofDeps();
const platform: Platform = snapshot.platform;
const sep = platform === "win32" ? "\\" : "/";

// Real values when the machine has any; otherwise fixed synthetic ones, and the test says so.
const realIdentity = identityValuesFromEnv(snapshot.env, platform);
const hasRealValues = realIdentity.pathValues.length > 0 || realIdentity.userName !== undefined;
const FAKE_ENV: Record<string, string> =
  platform === "win32"
    ? { USERNAME: "zelda_fake", USERPROFILE: "C:\\Users\\zelda_fake" }
    : { USERNAME: "zelda_fake", HOME: "/home/zelda_fake" };
const env: Record<string, string | undefined> = hasRealValues ? { ...snapshot.env } : { ...FAKE_ENV };
const identity: IdentityValues = identityValuesFromEnv(env, platform);
if (!hasRealValues) {
  console.info("endToEndIdentity: no USERNAME/USERPROFILE/HOMEPATH/HOME is set; using fixed synthetic values");
}

const userName = identity.userName;
const homes = identity.pathValues;
const wordMatchable = userName !== undefined && isWordMatchableUserName(userName);

// ---------------------------------------------------------------------------------------------
// Leak check. Independent of the engine's own scanner where possible: raw and JSON-escaped and
// forward-slash forms of every home value, plus the user name as a path segment, plus the scanner.
// ---------------------------------------------------------------------------------------------

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

function leaks(text: string): boolean {
  const hay = platform === "win32" ? text.toLowerCase() : text;
  const norm = (s: string): string => (platform === "win32" ? s.toLowerCase() : s);
  for (const home of homes) {
    const trimmed = home.replace(/[/\\]+$/, "");
    const forms = [trimmed, JSON.stringify(trimmed).slice(1, -1), trimmed.replace(/\\/g, "/"), trimmed.replace(/\\/g, "\\\\")];
    if (forms.some((f) => f !== "" && hay.includes(norm(f)))) return true;
  }
  if (userName !== undefined) {
    const segment = new RegExp(`[\\\\/]${escapeRe(userName)}(?![A-Za-z0-9._~-])`, platform === "win32" ? "i" : "");
    if (segment.test(text)) return true;
  }
  return findIdentity(text, identity, platform).found;
}

// ---------------------------------------------------------------------------------------------
// Synthetic packages
// ---------------------------------------------------------------------------------------------

const enc = new TextEncoder();

function packageJson(): TreeFile {
  return { path: "package.json", bytes: enc.encode(JSON.stringify({ name: "ident-pkg", version: "1.0.0", main: "index.js", license: "MIT" })) };
}

function indexFile(source: string): TreeFile {
  return { path: "index.js", bytes: enc.encode(`"use strict";\n${source}\n`) };
}

const lit = (v: string): string => JSON.stringify(v);
const homesJoined = (tag: string): string => homes.map((h) => `${h}${sep}proj${sep}${tag}`).join(" | ");
const namePath = (tag: string): string => `${sep}opt${sep}${userName ?? "nobody"}${sep}${tag}`;

/** Functions that diverge between the sides by `tag` and carry identity values in what they return or throw. */
function divergentSource(tag: string): string {
  const parts: string[] = [];
  if (homes.length > 0) {
    parts.push(`exports.returnsHome = function returnsHome(x) { return ${lit(homesJoined(tag))}; };`);
    const fwd = homes.map((h) => h.replace(/\\/g, "/")).join(" ");
    const nameText = userName === undefined ? "" : ` user ${userName}`;
    parts.push(
      `exports.throwsHome = function throwsHome(x) { throw new Error(${lit(`failed at ${homes.join(" ")} (${fwd})${nameText} ${tag}`)}); };`,
    );
  }
  if (userName !== undefined) {
    parts.push(`exports.returnsName = function returnsName(x) { return ${lit(namePath(tag))}; };`);
  }
  return parts.join("\n");
}

/** Same bytes on both sides, so the run is alive. */
function equalSource(): string {
  return `exports.same = function same(x) { return ${lit(homes.length > 0 ? homesJoined("same") : "plain")}; };`;
}

let root: string;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gs-e2e-ident-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Captured {
  run: ProofRun;
  lines: string[];
  tempRoot: string;
}

async function runSides(originalSource: string, resurrectionSource: string, names: string[], caseCount = 3): Promise<Captured> {
  const dir = join(root, `case${counter++}`);
  mkdirSync(dir);
  const tempRoot = join(dir, "tmp");
  mkdirSync(tempRoot);
  const built = tarballOf([packageJson(), indexFile(originalSource)]);
  const tarballPath = join(dir, "original.tgz");
  writeFileSync(tarballPath, built.bytes);
  const resDir = join(dir, "res");
  mkdirSync(resDir);
  writeFileSync(join(resDir, "package.json"), packageJson().bytes);
  writeFileSync(join(resDir, "index.js"), indexFile(resurrectionSource).bytes);

  const harness: HarnessConfig = {
    package: "ident-pkg",
    seed: 7,
    caseCount,
    perCallTimeoutMs: 2000,
    heapLimitMb: 64,
    outputLimitBytes: 100_000,
    maxRestarts: 5,
    shrinkBudget: 20,
    functions: Object.fromEntries(names.map((n) => [n, { args: fc.constant(["x"] as unknown[]) }])),
    deltas: [],
  };
  const request: ProofRequest = {
    original: { name: "ident-pkg", version: "1.0.0", tarballPath, integrity: built.integrity },
    resurrection: { kind: "directory", path: resDir },
    harness,
    executorFactory: createInProcessExecutorFactory({ acknowledgeUnsandboxed: true }),
  };
  const lines: string[] = [];
  const run = await runProofOfLife(request, { ...snapshot, env, tempRoot, sink: (line) => void lines.push(line) });
  return { run, lines, tempRoot };
}

const divergentNames = [
  ...(homes.length > 0 ? ["returnsHome", "throwsHome"] : []),
  ...(userName !== undefined ? ["returnsName"] : []),
];

function everything(c: Captured): string {
  return [c.run.json, JSON.stringify(c.run.report), ...c.lines, ...c.run.report.harnessErrors.map((e) => e.message)].join("\n");
}

function divergenceText(c: Captured, fn: string): string {
  return c.run.report.divergences
    .filter((d) => d.function === fn)
    .map((d) => JSON.stringify(d))
    .join("\n");
}

describe.skipIf(divergentNames.length === 0)("diverging sides carry identity values (cases a and c)", () => {
  let captured: Captured;

  beforeAll(async () => {
    captured = await runSides(divergentSource("A"), divergentSource("B"), divergentNames);
  });

  it("verdict is restless, not inconclusive, with no harness error and no identity-leak", () => {
    expect(captured.run.report.harnessErrors.length, "the run produced a harness error").toBe(0);
    expect(captured.run.report.verdict).toBe("restless");
  });

  it("lists a divergence for every function that differs", () => {
    const listed = new Set(captured.run.report.divergences.map((d) => d.function));
    for (const fn of divergentNames) {
      expect(listed.has(fn), `no divergence is listed for ${fn}`).toBe(true);
    }
  });

  it("the redacted forms still differ, so redactionMaskedDifference is false", () => {
    expect(captured.run.report.divergences.length).toBeGreaterThan(0);
    for (const d of captured.run.report.divergences) {
      expect(d.redactionMaskedDifference, `redactionMaskedDifference is true for ${d.function}`).toBe(false);
    }
  });

  it.skipIf(homes.length === 0)("shows <user-home> where the home path was returned or thrown", () => {
    expect(divergenceText(captured, "returnsHome").includes("<user-home>"), "returnsHome lacks <user-home>").toBe(true);
    expect(divergenceText(captured, "throwsHome").includes("<user-home>"), "throwsHome lacks <user-home>").toBe(true);
  });

  it.skipIf(userName === undefined)("shows a placeholder where the user name is a path segment", () => {
    const text = divergenceText(captured, "returnsName");
    const homeOnly = identityValuesFromEnv({ ...env, USERNAME: undefined }, platform);
    const eatenByHome = findIdentity(namePath("A"), homeOnly, platform).found;
    const expected = eatenByHome ? "<user-home>" : "<user>";
    expect(text.includes(expected), "returnsName lacks the expected placeholder").toBe(true);
  });

  it.skipIf(!wordMatchable || homes.length === 0)("shows <user> for the bare user name in the thrown message (name is long and not generic)", () => {
    expect(divergenceText(captured, "throwsHome").includes("<user>"), "throwsHome lacks <user>").toBe(true);
  });

  it("no serialized report, log line or error message contains an Identity_Value", () => {
    expect(leaks(everything(captured)), "an Identity_Value reached the report, a log line or an error message").toBe(false);
    for (const line of captured.lines) {
      expect(leaks(line), "a sink line contains an Identity_Value").toBe(false);
    }
  });

  it("removes the work directory", () => {
    expect(readdirSync(captured.tempRoot)).toEqual([]);
  });
});

// L14: a short or generic bare name outside a path may stay; only the path-context promise is asserted.
describe("bare name assertions follow L14", () => {
  it.runIf(!wordMatchable)(
    "the bare-name check is not made: the user name is short, generic or unset, so a bare occurrence may remain (L14); path-context checks still run",
    () => {
      expect(wordMatchable).toBe(false);
    },
  );
});

describe.skipIf(homes.length === 0)("equal sides (case b)", () => {
  it("returns the same home-bearing string on both sides: alive, no Identity_Value anywhere", async () => {
    const c = await runSides(equalSource(), equalSource(), ["same"]);
    expect(c.run.report.harnessErrors.length, "the run produced a harness error").toBe(0);
    expect(c.run.report.verdict).toBe("alive");
    expect(c.run.report.divergences.length).toBe(0);
    expect(leaks(everything(c)), "an Identity_Value reached the report or a sink line").toBe(false);
    expect(readdirSync(c.tempRoot)).toEqual([]);
  });
});

// The emit path (completes the it.todo of identitySafety.test.ts, task 8.9): the engine itself logs
// an error message that echoes an exception message holding the identity values.
describe.skipIf(homes.length === 0)("emit path: an unloadable module whose load throws with the home path", () => {
  const ok = `exports.same = function same(x) { return "ok"; };`;
  const loadThrows = `throw new Error(${lit(`cannot start in ${homes.join(" ")} for ${userName ?? ""}${sep}${userName ?? ""}`)});`;

  it("redacts the sink line and the report message; nothing identity-bearing reaches either", async () => {
    const c = await runSides(ok, loadThrows, ["same"]);
    expect(c.run.report.verdict).toBe("inconclusive");
    expect(c.run.report.harnessErrors.some((e) => e.kind === "unloadable-module"), "no unloadable-module error").toBe(true);
    expect(c.lines.length, "nothing reached the sink").toBeGreaterThan(0);
    expect(c.lines.some((l) => l.includes("<user-home>")), "no sink line shows <user-home>").toBe(true);
    for (const line of c.lines) {
      expect(leaks(line), "a sink line contains an Identity_Value").toBe(false);
    }
    expect(leaks(everything(c)), "an Identity_Value reached the report or a sink line").toBe(false);
    expect(readdirSync(c.tempRoot)).toEqual([]);
  });
});

describe("emit path with fixed fake values", () => {
  it("a load error that echoes the fake home path and name is redacted in the sink and the report", async () => {
    const fakeEnv = platform === "win32" ? { USERNAME: "zelda_fake", USERPROFILE: "C:\\Users\\zelda_fake" } : { USERNAME: "zelda_fake", HOME: "/home/zelda_fake" };
    const fakeHome = platform === "win32" ? "C:\\Users\\zelda_fake" : "/home/zelda_fake";
    const dir = join(root, `case${counter++}`);
    mkdirSync(dir);
    const tempRoot = join(dir, "tmp");
    mkdirSync(tempRoot);
    const built = tarballOf([packageJson(), indexFile(`exports.same = function same(x) { return 1; };`)]);
    const tarballPath = join(dir, "original.tgz");
    writeFileSync(tarballPath, built.bytes);
    const resDir = join(dir, "res");
    mkdirSync(resDir);
    writeFileSync(join(resDir, "package.json"), packageJson().bytes);
    writeFileSync(join(resDir, "index.js"), indexFile(`throw new Error(${lit(`cannot start in ${fakeHome}${sep}pkg for zelda_fake`)});`).bytes);
    const lines: string[] = [];
    const run = await runProofOfLife(
      {
        original: { name: "ident-pkg", version: "1.0.0", tarballPath, integrity: built.integrity },
        resurrection: { kind: "directory", path: resDir },
        harness: {
          package: "ident-pkg",
          seed: 7,
          caseCount: 3,
          perCallTimeoutMs: 2000,
          heapLimitMb: 64,
          outputLimitBytes: 100_000,
          maxRestarts: 5,
          shrinkBudget: 20,
          functions: { same: { args: fc.constant(["x"] as unknown[]) } },
          deltas: [],
        },
        executorFactory: createInProcessExecutorFactory({ acknowledgeUnsandboxed: true }),
      },
      { ...snapshot, env: fakeEnv, tempRoot, sink: (l) => void lines.push(l) },
    );
    const text = [run.json, ...lines].join("\n").toLowerCase();
    expect(run.report.harnessErrors.some((e) => e.kind === "unloadable-module")).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(text.includes("zelda_fake"), "a fake identity value remains").toBe(false);
    expect(lines.some((l) => l.includes("<user-home>"))).toBe(true);
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});
