// Task 18.11 (env-minimum; Requirements 5.3, 5.18, 5.19). Basis: the task 1.4 spike (journal).
//
// The engine passes only `TZ=UTC` to the sandbox child. The spike observed that the child needs no
// variable at all to start under `--permission`, load a package and answer on stdin: on Windows the
// process launcher adds OS-supplied names when the env block is empty. `TZ=UTC` is the only entry
// with an observed effect (time zone offset). This file checks:
//   1. the production builder returns exactly `{ TZ: 'UTC' }`;
//   2. the real Sandbox_Executor, which uses that builder, starts, loads, lists and calls;
//   3. the spike's candidate sets { }, { TZ }, { SystemRoot }, { SystemRoot, TZ } each start and
//      load a package under `--permission`, and only the TZ ones are in UTC.
// That the parent's variables do not reach the child is asserted in envScrubbed.integration.test.ts.
// Requirements: 5.3, 5.18, 5.19
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSandboxEnv } from "../../../src/proof/shell/executor/sandboxCommand";
import { withExecutor } from "./helpers/sandboxHarness";

const isWindows = process.platform === "win32";

const PACKAGE = {
  "index.js": [
    "'use strict';",
    "exports.ping = () => 'pong';",
    "exports.tz = () => process.env.TZ;",
    "exports.offset = () => new Date().getTimezoneOffset();",
  ].join("\n"),
};

describe("env-minimum: the production environment", () => {
  it("buildSandboxEnv has exactly one key, TZ=UTC", () => {
    const env = buildSandboxEnv();
    expect(Object.keys(env)).toEqual(["TZ"]);
    expect(env.TZ).toBe("UTC");
  });

  it("the real Sandbox_Executor, started with only TZ=UTC, starts, loads, lists exports and answers", async () => {
    await withExecutor(
      PACKAGE,
      async (ctx) => {
        const exported = await ctx.side.exports();
        expect(exported.entries.map((e) => e.name)).toEqual(["offset", "ping", "tz"]);
        expect(await ctx.side.callValue("ping")).toBe("pong");
        expect(await ctx.side.callValue("tz")).toBe("UTC");
        expect(await ctx.side.callValue("offset")).toBe(0);
      },
      { limits: { callTimeoutMs: 10000 } },
    );
  }, 30000);
});

describe("env-minimum: spike candidate sets under --permission", () => {
  let root = "";
  let pkgDir = "";
  let runner = "";

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-envmin-")));
    pkgDir = join(root, "pkg");
    runner = join(root, "runner.cjs");
    writeFileSync(runner, RUNNER_SOURCE);
    writePackage(pkgDir);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  interface Observed {
    exit: number | null;
    stderr: string;
    loaded: boolean;
    reply: string | null;
    offset: number;
  }

  function runWith(env: Record<string, string>): Observed {
    const r = spawnSync(
      process.execPath,
      ["--permission", `--allow-fs-read=${root}`, runner, pkgDir],
      { shell: false, env: { ...env } as NodeJS.ProcessEnv, input: "ping\n", encoding: "utf8", timeout: 20000 },
    );
    const parsed = JSON.parse(r.stdout.trim()) as Omit<Observed, "exit" | "stderr">;
    return { exit: r.status, stderr: r.stderr, ...parsed };
  }

  const systemRoot = process.env.SystemRoot;
  const candidates: ReadonlyArray<{ label: string; env: () => Record<string, string>; needsSystemRoot: boolean; utc: boolean }> = [
    { label: "{}", env: () => ({}), needsSystemRoot: false, utc: false },
    { label: "{ TZ }", env: () => ({ TZ: "UTC" }), needsSystemRoot: false, utc: true },
    { label: "{ SystemRoot }", env: () => ({ SystemRoot: systemRoot ?? "" }), needsSystemRoot: true, utc: false },
    { label: "{ SystemRoot, TZ }", env: () => ({ SystemRoot: systemRoot ?? "", TZ: "UTC" }), needsSystemRoot: true, utc: true },
  ];

  for (const c of candidates) {
    const skip = c.needsSystemRoot && (!isWindows || systemRoot === undefined);
    // Skipped on non-Windows platforms: SystemRoot is a Windows variable, so the case has no meaning there.
    it.skipIf(skip)(`${c.label}: the child starts, loads the package and answers`, () => {
      const seen = runWith(c.env());
      expect(seen.exit).toBe(0);
      expect(seen.stderr).toBe("");
      expect(seen.loaded).toBe(true);
      expect(seen.reply).toBe("ping");
      // Only the TZ sets have an observed effect: UTC offset 0.
      if (c.utc) expect(seen.offset).toBe(0);
    }, 30000);
  }

  it("SystemRoot adds nothing the production set lacks: {TZ} and {SystemRoot, TZ} observe the same", () => {
    const production = runWith({ ...buildSandboxEnv() });
    expect(production.exit).toBe(0);
    expect(production.loaded).toBe(true);
    expect(production.offset).toBe(0);
    if (isWindows && systemRoot !== undefined) {
      const withRoot = runWith({ SystemRoot: systemRoot, ...buildSandboxEnv() });
      expect(withRoot).toEqual(production);
    }
  }, 30000);
});

// The runner is plain CommonJS so it needs no type stripping or loader; it reads stdin once.
const RUNNER_SOURCE = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const out = { loaded: false, reply: null, offset: new Date().getTimezoneOffset() };",
  "try { out.loaded = require(path.join(process.argv[2], 'index.js')).main === 'ok'; } catch { out.loaded = false; }",
  "try { out.reply = fs.readFileSync(0, 'utf8').trim(); } catch { out.reply = null; }",
  "console.log(JSON.stringify(out));",
].join("\n");

function writePackage(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pkg", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(dir, "index.js"), "module.exports = { main: 'ok' }\n");
}
