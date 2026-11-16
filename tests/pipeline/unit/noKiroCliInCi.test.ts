// Requirements: 22.7
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

describe("no Medium run in CI (R22.7)", () => {
  for (const name of ["resurrect.yml", "nightly.yml"]) {
    it(`${name} exists and never invokes kiro-cli in a run or uses step`, () => {
      const path = join(ROOT, ".github", "workflows", name);
      expect(existsSync(path)).toBe(true);
      const doc = parse(readFileSync(path, "utf8")) as {
        jobs?: Record<string, { steps?: { run?: unknown; uses?: unknown }[] }>;
      };
      const jobs = Object.values(doc.jobs ?? {});
      expect(jobs.length).toBeGreaterThan(0);
      const offending: string[] = [];
      let steps = 0;
      for (const job of jobs) {
        for (const step of job.steps ?? []) {
          steps += 1;
          for (const text of [step.run, step.uses]) {
            if (typeof text === "string" && /kiro-cli/i.test(text)) offending.push(text);
          }
        }
      }
      expect(steps).toBeGreaterThan(0);
      expect(offending).toEqual([]);
    });
  }
});
