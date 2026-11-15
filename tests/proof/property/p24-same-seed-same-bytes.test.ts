// Feature: proof-of-life-engine, Property 24: Same seed, same bytes
// Requirements: 13.4, 15.2
// Validates: Requirements 15.2 (and 12/13/15 determinism: no timestamps, no temp paths in the report)
//
// Two runs of runProofOfLife with the same request, deps and a fresh InProcess_Executor produce
// byte-identical canonical JSON. Variants:
//   - Haunting_Radius listed in another order (same set): bytes identical.
//   - Resurrection as directory versus tarball with the same files: the reports differ ONLY in
//     `resurrection.source` (the request kind, which the report records). Everything else,
//     including treeHash, verdict, divergences and cases, is seed-determined and must be equal.
// The different-seed self-consistency check lives in p24b-different-seed-self-consistent.test.ts.
//
// Reduced inner size (assertions unchanged, numRuns stays max(100, fcParams())): maxFunctions
// 3 -> 2, caseCount 5..8 -> 3..5, runProofOfLife calls per case 4 -> 3 (the different-seed run
// moved to p24b, where it is the only call). The same-seed pair and the directory-versus-tarball
// run cannot be merged: the pair needs two identical requests, the variant needs another kind and order.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import { createSameSeedRunner, scenarioArb } from "../helpers/sameSeedRunner";

const runner = createSameSeedRunner("gs-p24-base-");
let elapsedMs = 0;
let runs = 0;

beforeAll(() => runner.setup());

afterAll(() => {
  runner.teardown();
  console.log(`p24: ${runs} generated cases, ${elapsedMs} ms in the property`);
});

describe("Feature: proof-of-life-engine, Property 24: Same seed, same bytes", () => {
  it("two runs with the same request produce byte-identical canonical reports", async () => {
    const started = Date.now();
    await fc.assert(
      fc.asyncProperty(scenarioArb(2, { min: 3, max: 5 }), async (s) => {
        runs += 1;
        const a = await runner.run(s, "directory");
        const b = await runner.run(s, "directory");
        expect(b.json).toBe(a.json);
        expect(b.report.verdict).toBe(a.report.verdict);
        expect(a.report.harnessErrors).toEqual([]);

        // Directory versus tarball, with the same functions listed in another order: only the
        // recorded source kind differs.
        const t = await runner.run(s, "tarball", { haunting: s.haunting });
        expect(t.report.resurrection.source).toBe("tarball");
        expect(a.report.resurrection.source).toBe("directory");
        expect(t.report.resurrection.treeHash).toBe(a.report.resurrection.treeHash);
        expect(t.report.verdict).toBe(a.report.verdict);
        expect(t.json.replace('"source":"tarball"', '"source":"directory"')).toBe(a.json);
      }),
      { ...fcParams(), numRuns: Math.max(100, fcParams().numRuns ?? 100) },
    );
    elapsedMs = Date.now() - started;
  }, 300_000);
});
