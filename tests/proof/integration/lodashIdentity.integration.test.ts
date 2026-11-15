// Identity test for the lodash.set run (task 18.14; Requirements 13.25 to 13.30, decisions D10 and
// D11, limitations L4 and L14). The REAL engine runs with the REAL Sandbox_Executor on lodash.set:
// the committed Original tarball against the alive fixture (equal sides) and against the broken
// fixture (diverging sides). The harness is the lodash.set harness with a fixed seed, a small
// caseCount and explicit cases whose objects and values carry the machine's real identity values.
// The values come from the same environment snapshot `defaultProofDeps()` takes. No assertion
// message or test name prints a real value: every check is a boolean with a fixed message.
// Requirements: 13.25, 13.26, 13.28, 13.29, 13.30, 16.3
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
import { lodashSetHarness } from "../../../src/proof/harnesses/lodash.set/config";
import { defaultProofDeps } from "../../../src/proof/shell/orchestrator";
import type { HarnessConfig, ProofRun } from "../../../src/proof/types";
import {
  LODASH_ALIVE_DIR,
  LODASH_BROKEN_DIR,
  LODASH_ORIGINAL_META,
  LODASH_ORIGINAL_TARBALL,
  runLodash,
} from "./helpers/lodashRun";

const snapshot = defaultProofDeps();
const platform: Platform = snapshot.platform;
const sep = platform === "win32" ? "\\" : "/";
const env = { ...snapshot.env };
const identity: IdentityValues = identityValuesFromEnv(env, platform);
const homes = identity.pathValues;
const userName = identity.userName;
const wordMatchable = userName !== undefined && isWordMatchableUserName(userName);

// ---------------------------------------------------------------------------------------------
// Leak check: raw, JSON-escaped and forward-slash forms of every home value, the user name as a
// path segment, and the engine's own scanner.
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
// Identity-carrying strings and the harness copy
// ---------------------------------------------------------------------------------------------

const homeText = (tag: string): string =>
  homes.map((h) => `${h}${sep}proj${sep}${tag} ${h.replace(/\\/g, "/")}/fwd`).join(" | ");
const namePath = (tag: string): string => `${sep}opt${sep}${userName ?? "nobody"}${sep}${tag}`;
const carrier = (tag: string): string => `${homeText(tag)} ${namePath(tag)}`;

const EXPORT = "default";

/** Overrides for the shared small lodash harness (helpers/lodashRun.ts). */
function identityOverrides(divergent: boolean): Partial<HarnessConfig> {
  // alive: equal sides, string keys only. broken: a numeric next segment, which the broken
  // fixture turns into an object instead of an array, so the sides diverge on that Case.
  const cases: (readonly unknown[])[] = divergent
    ? [[{ [homes[0] ?? "k"]: carrier("o") }, "a[0]", carrier("v")]]
    : [
        [{}, "home", carrier("v")],
        [{ [namePath("k")]: 1 }, "a.b", carrier("w")],
        [{ note: carrier("o") }, ["x", "y"], { path: carrier("p") }],
      ];
  return {
    seed: 20260101,
    caseCount: 3,
    maxRestarts: 5,
    shrinkBudget: 20,
    perCallTimeoutMs: 5000,
    functions: {
      [EXPORT]: { args: fc.constant(cases[0] as readonly unknown[]), explicitCases: cases, caseCount: 3 },
    },
    deltas: lodashSetHarness.deltas.map((d) => ({ ...d, caseCount: 3 })),
  };
}

// ---------------------------------------------------------------------------------------------
// Run wrapper over the shared helper
// ---------------------------------------------------------------------------------------------

interface Captured {
  run: ProofRun;
  lines: string[];
  tempRoot: string;
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gs-lodash-ident-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function requireFixtures(): void {
  if (!existsSync(LODASH_ORIGINAL_TARBALL) || !existsSync(LODASH_ORIGINAL_META)) {
    throw new Error(
      "The committed lodash.set tarball or metadata is missing under tests/proof/fixtures/lodash.set. Run `npm run fixtures:record-tarball`.",
    );
  }
}

let runCounter = 0;

async function runIdentity(resurrectionDir: string, divergent: boolean): Promise<Captured> {
  requireFixtures();
  const tempRoot = join(root, `run${runCounter++}`);
  mkdirSync(tempRoot);
  const r = await runLodash({
    resurrectionDir,
    overrides: identityOverrides(divergent),
    deps: { ...snapshot, env, tempRoot },
  });
  return { run: r.run, lines: r.sinkLines, tempRoot };
}

function everything(c: Captured): string {
  return [c.run.json, JSON.stringify(c.run.report), ...c.lines, ...c.run.report.harnessErrors.map((e) => e.message)].join("\n");
}

function divergenceText(c: Captured): string {
  return c.run.report.divergences.map((d) => JSON.stringify(d)).join("\n");
}

const TIMEOUT = 120_000;

describe("fixtures are present", () => {
  it("the committed lodash.set tarball and metadata exist", () => {
    expect(existsSync(LODASH_ORIGINAL_TARBALL), "the committed lodash.set tarball is missing").toBe(true);
    expect(existsSync(LODASH_ORIGINAL_META), "the committed lodash.set metadata is missing").toBe(true);
  });
});

describe("real Sandbox_Executor: original vs alive fixture carrying identity strings", () => {
  let captured: Captured;

  beforeAll(async () => {
    captured = await runIdentity(LODASH_ALIVE_DIR, false);
  }, TIMEOUT);

  it("has no harness error and no divergence on the identity-carrying cases", () => {
    expect(captured.run.report.harnessErrors.length, "the run produced a harness error").toBe(0);
    expect(captured.run.report.divergences.length, "the alive run listed a divergence").toBe(0);
    expect(captured.run.report.verdict).toBe("alive");
  });

  it("no serialized report, sink line or error message contains an Identity_Value", () => {
    expect(leaks(everything(captured)), "an Identity_Value reached the report, a log line or an error message").toBe(false);
    for (const line of captured.lines) {
      expect(leaks(line), "a sink line contains an Identity_Value").toBe(false);
    }
  });

  it("removes the work directory", () => {
    expect(readdirSync(captured.tempRoot)).toEqual([]);
  });
});

describe("real Sandbox_Executor: original vs broken fixture diverging on an identity-carrying case", () => {
  let captured: Captured;

  beforeAll(async () => {
    captured = await runIdentity(LODASH_BROKEN_DIR, true);
  }, TIMEOUT);

  it("verdict is restless, not inconclusive, with a divergence and no identity-leak", () => {
    expect(captured.run.report.harnessErrors.length, "the run produced a harness error").toBe(0);
    expect(captured.run.report.verdict).toBe("restless");
    expect(captured.run.report.divergences.length, "no divergence is listed").toBeGreaterThan(0);
  });

  it.skipIf(homes.length === 0)("shows <user-home> in the counterexample", () => {
    expect(divergenceText(captured).includes("<user-home>"), "the counterexample lacks <user-home>").toBe(true);
  });

  it.skipIf(userName === undefined)("shows a placeholder where the user name is a path segment", () => {
    const homeOnly = identityValuesFromEnv({ ...env, USERNAME: undefined }, platform);
    const eatenByHome = findIdentity(namePath("v"), homeOnly, platform).found;
    const expected = eatenByHome ? "<user-home>" : "<user>";
    expect(divergenceText(captured).includes(expected), "the counterexample lacks the expected placeholder").toBe(true);
  });

  // L14: a short or generic bare name outside a path may stay; only the path-context promise is asserted.
  it.runIf(!wordMatchable)(
    "the bare-name check is not made: the user name is short, generic or unset (L14); path-context checks still run",
    () => {
      expect(wordMatchable).toBe(false);
    },
  );

  it("no serialized report, sink line or error message contains an Identity_Value", () => {
    expect(leaks(everything(captured)), "an Identity_Value reached the report, a log line or an error message").toBe(false);
    for (const line of captured.lines) {
      expect(leaks(line), "a sink line contains an Identity_Value").toBe(false);
    }
  });

  it("removes the work directory", () => {
    expect(readdirSync(captured.tempRoot)).toEqual([]);
  });
});
