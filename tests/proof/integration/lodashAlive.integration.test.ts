// Task 18.8: the committed lodash.set@4.3.2 tarball against the hand-written alive resurrection,
// through the real engine and the real Sandbox_Executor (Requirements 11, 12, 14.7).
//
// The case counts are reduced (20 generated, 10 delta) to keep the test short; the production
// default of the harness is 100 each (see helpers/lodashRun.ts).
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LODASH_ALIVE_DIR, runLodash, type LodashRun } from "./helpers/lodashRun";

function protoKeys(): string[] {
  return Reflect.ownKeys(Object.prototype).map(String).sort();
}

describe("lodash.set alive (real engine, real sandbox)", () => {
  it("is alive with a Demonstration, deterministic, and leaves nothing behind", async () => {
    // A private temp root, so parallel tests cannot affect the "nothing left behind" check.
    const tempRoot = mkdtempSync(join(tmpdir(), "gs-alive-test-"));
    const keysBefore = protoKeys();
    try {
      const first: LodashRun = await runLodash({ resurrectionDir: LODASH_ALIVE_DIR, deps: { tempRoot } });
      const second: LodashRun = await runLodash({ resurrectionDir: LODASH_ALIVE_DIR, deps: { tempRoot } });
      const report = first.run.report;

      expect(report.harnessErrors).toEqual([]);
      expect(report.divergences).toEqual([]);
      expect(report.verdict).toBe("alive");
      expect(report.original.verified).toBe(true);

      expect(report.sandbox.mechanism).toBe("node-permission");
      for (const counts of [report.sandbox.restartEvents, report.sandbox.otherRestarts]) {
        expect(typeof counts.original).toBe("number");
        expect(typeof counts.resurrection).toBe("number");
      }

      expect(report.functionsTested).toEqual(["default"]);
      const set = report.casesPerFunction.find((c) => c.function === "default");
      expect(set).toBeDefined();
      expect(set!.cases).toBeGreaterThan(0);

      expect(report.deltas).toHaveLength(1);
      const delta = report.deltas[0]!;
      expect(delta.id).toBe("lodash.set-prototype-pollution");
      expect(delta.status).toBe("demonstrated");
      const demo = delta.demonstration;
      expect(demo).not.toBeNull();
      // Fails on the Original (Object.prototype gained a key), passes on the Resurrection.
      expect(demo!.original.ok).toBe(false);
      expect(JSON.stringify(demo!.original.detail)).toMatch(/Object\.prototype\.\S+ added/);
      expect(demo!.resurrection.ok).toBe(true);
      // The demonstrated case has a dangerous path segment.
      expect(JSON.stringify(demo!.args[1])).toMatch(/__proto__|constructor|prototype/);

      // Determinism: same seed, identical canonical bytes.
      expect(second.json).toBe(first.json);

      // No temp root path text in the report or the log lines.
      const roots = [tempRoot, realpathSync(tempRoot)].flatMap((r) => [r, r.replaceAll("\\", "/")]);
      for (const text of [first.json, ...first.sinkLines]) {
        for (const root of roots) expect(text.toLowerCase()).not.toContain(root.toLowerCase());
      }

      // The test process is untouched and the engine's work directories are gone.
      expect(protoKeys()).toEqual(keysBefore);
      expect(readdirSync(tempRoot)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
