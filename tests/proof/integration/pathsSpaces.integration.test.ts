// Task 18.11 (paths-spaces; Requirements 5.2, 5.17, 13.19). Basis: the task 1.6 spike (journal).
//
// Package directories whose names contain a space, non-ASCII characters, `#` or `%` (also a literal
// `%20`) must start the real Sandbox_Executor, load, list and call; the child's cwd must be the
// package real path; Node error text carries the NATIVE path (characters unencoded) while
// `pathToFileURL` text carries the percent-encoded form with uppercase hex; the Root_Normalizer
// replaces both with `<package>`. One full engine run uses a temp root named `gs space`.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeOutcome } from "../../../src/proof/core/normalize";
import { runProofOfLife, defaultProofDeps } from "../../../src/proof/shell/orchestrator";
import type { EncodedNode, HarnessConfig, Outcome } from "../../../src/proof/types";
import { tarballOf } from "../helpers/buildTarball";
import { createHarness, makeRequest } from "./helpers/sandboxHarness";

const isWindows = process.platform === "win32";
const NAMES = ["gs space", "gs-\u00fcn\u00ef-\u00e9", "gs#hash", "gs%pct", "gs%20pct"];

const SOURCE = [
  "'use strict';",
  "const { pathToFileURL } = require('node:url');",
  "exports.add = (a, b) => a + b;",
  "exports.cwd = () => process.cwd();",
  "exports.throwNative = () => { throw new Error('at ' + __dirname); };",
  "exports.throwUrl = () => { throw new Error('at ' + pathToFileURL(__dirname).href); };",
].join("\n");

function writePackage(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "gs-paths", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(dir, "index.js"), SOURCE);
}

const same = (a: string, b: string): boolean => (isWindows ? a.toLowerCase() === b.toLowerCase() : a === b);

function errorMessage(outcome: Outcome): string {
  if (outcome.kind !== "threw") throw new Error(`expected a thrown error, got ${outcome.kind}`);
  const node: EncodedNode = outcome.value;
  if (node.t !== "error") throw new Error("the thrown value is not an error");
  return node.message;
}

describe("paths-spaces: special characters in the package directory", () => {
  it.each(NAMES)("directory %j: starts, loads, lists, calls, cwd and error text", async (name) => {
    const harness = createHarness({ limits: { callTimeoutMs: 10000 } });
    try {
      const dir = join(harness.root, name, "pkg");
      writePackage(dir);
      const packageDir = realpathSync.native(dir);
      const opened = await harness.executor.open({
        side: "original",
        packageDir,
        entryFile: join(packageDir, "index.js"),
        readPaths: [],
        limits: { callTimeoutMs: 10000, heapLimitMb: 256, outputLimitBytes: 100000 },
      });
      if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
      const handle = opened.value;
      const call = async (fn: string, args: readonly unknown[] = []): Promise<Outcome> => {
        const r = await handle.call(makeRequest(fn, args));
        if (!r.ok) throw new Error(`call failed: ${r.error.kind}`);
        return r.value.outcome;
      };

      const listed = await handle.listExports();
      expect(listed.ok && listed.value.entries.map((e) => e.name)).toEqual(["add", "cwd", "throwNative", "throwUrl"]);

      const sum = await call("add", [2, 3]);
      expect(sum.kind).toBe("returned");

      // cwd is the package real path.
      const cwd = await call("cwd");
      expect(cwd.kind === "returned" && cwd.value.t === "str" && same(cwd.value.v, packageDir)).toBe(true);

      // Native error text: the path with the special characters unencoded.
      const native = await call("throwNative");
      const nativeMessage = errorMessage(native);
      expect(same(nativeMessage, `at ${packageDir}`)).toBe(true);
      expect(nativeMessage.includes(name) || (isWindows && nativeMessage.toLowerCase().includes(name.toLowerCase()))).toBe(true);

      // URL error text: percent-encoded, uppercase hex.
      const url = await call("throwUrl");
      const urlMessage = errorMessage(url);
      expect(urlMessage.startsWith("at file://")).toBe(true);
      expect(urlMessage).toBe(`at ${pathToFileURL(packageDir).href}`);
      if (name === "gs space") expect(urlMessage).toContain("gs%20space");
      if (name === "gs#hash") expect(urlMessage).toContain("gs%23hash");
      if (name === "gs%pct") expect(urlMessage).toContain("gs%25pct");
      if (name === "gs%20pct") expect(urlMessage).toContain("gs%2520pct");
      if (name.includes("\u00fc")) expect(urlMessage).toContain("gs-%C3%BCn%C3%AF-%C3%A9");

      // The Root_Normalizer replaces both forms with <package>.
      for (const outcome of [native, url]) {
        const normalized = normalizeOutcome(outcome, { created: packageDir }, isWindows);
        expect(normalized.ok).toBe(true);
        if (normalized.ok) expect(errorMessage(normalized.value)).toBe("at <package>");
      }
    } finally {
      await harness.cleanup();
    }
  }, 30000);
});

describe("paths-spaces: full engine run with a temp root named `gs space`", () => {
  it("the report shows <package> and neither the temp root nor the directory name", async () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-spaces-")));
    try {
      const tempRoot = join(base, "gs space");
      mkdirSync(tempRoot);

      // Original: the same function names, returning a plain value. Resurrection: throws with both path forms.
      const original = tarballOf([
        { path: "package.json", bytes: new TextEncoder().encode(JSON.stringify({ name: "gs-paths", version: "1.0.0", main: "index.js" })) },
        { path: "index.js", bytes: new TextEncoder().encode("'use strict';\nexports.where = () => 'ok';\n") },
      ]);
      const originalPath = join(base, "original.tgz");
      writeFileSync(originalPath, original.bytes);

      const resurrectionDir = join(base, "resurrection");
      mkdirSync(resurrectionDir);
      writeFileSync(
        join(resurrectionDir, "package.json"),
        JSON.stringify({ name: "gs-paths", version: "1.0.0", main: "index.js" }),
      );
      writeFileSync(
        join(resurrectionDir, "index.js"),
        [
          "'use strict';",
          "const { pathToFileURL } = require('node:url');",
          "exports.where = () => { throw new Error('native=' + __dirname + ' url=' + pathToFileURL(__dirname).href); };",
        ].join("\n"),
      );

      const harness: HarnessConfig = {
        package: "gs-paths",
        seed: 1,
        caseCount: 3,
        perCallTimeoutMs: 10000,
        heapLimitMb: 256,
        outputLimitBytes: 100000,
        maxRestarts: 5,
        shrinkBudget: 20,
        functions: { where: { args: fc.tuple(fc.integer({ min: 0, max: 5 })) } },
        deltas: [],
      };
      const run = await runProofOfLife(
        {
          original: { name: "gs-paths", version: "1.0.0", tarballPath: originalPath, integrity: original.integrity },
          resurrection: { kind: "directory", path: resurrectionDir },
          harness,
        },
        { ...defaultProofDeps(), tempRoot, sink: () => undefined },
      );

      // The two sides differ, so the thrown message is in the report.
      expect(run.report.divergences.length).toBeGreaterThan(0);
      const json = run.json;
      expect(json.split("<package>").length - 1).toBeGreaterThanOrEqual(2);

      // Every textual form of the temp root and of the special directory name is gone (booleans only).
      const jsonEscaped = (s: string): string => JSON.stringify(s).slice(1, -1);
      const lower = json.toLowerCase();
      const forms = [
        tempRoot,
        base,
        jsonEscaped(tempRoot),
        jsonEscaped(base),
        tempRoot.replaceAll("\\", "/"),
        pathToFileURL(tempRoot).href,
        "gs space",
        "gs%20space",
      ];
      const leaked = forms.filter((f) => lower.includes(f.toLowerCase()));
      expect(leaked.length).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 30000);
});
