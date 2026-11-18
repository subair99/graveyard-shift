// Requirements: 10.3
// The ui property tests run at least 100 generated cases and replay a seed given through FC_SEED.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fc, fcParams } from "../../engine/helpers/fc";
import { siteInputArb } from "../helpers/arbitraries";

const PROPERTY_DIR = join(__dirname, "..", "property");
const previous = process.env["FC_SEED"];

afterEach(() => {
  if (previous === undefined) delete process.env["FC_SEED"];
  else process.env["FC_SEED"] = previous;
});

function sampleWith(params: fc.Parameters<unknown>): string[] {
  const seen: string[] = [];
  fc.assert(
    fc.property(siteInputArb(), (input) => {
      seen.push(JSON.stringify(input));
    }),
    params,
  );
  return seen;
}

describe("FC_SEED replay of the ui property tests (R10.3)", () => {
  it("runs at least 100 cases and takes the seed from FC_SEED", () => {
    process.env["FC_SEED"] = "424242";
    const params = fcParams();
    expect(params.numRuns).toBeGreaterThanOrEqual(100);
    expect(params.seed).toBe(424242);
  });

  it("the same FC_SEED generates the same site inputs, in the same order", () => {
    process.env["FC_SEED"] = "424242";
    const first = sampleWith(fcParams());
    const second = sampleWith(fcParams());
    expect(first).toHaveLength(100);
    expect(second).toEqual(first);
  });

  it("a failing property names the seed for replay", () => {
    process.env["FC_SEED"] = "424242";
    let message = "";
    try {
      fc.assert(
        fc.property(siteInputArb(), () => false),
        fcParams(),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("seed: 424242");
  });

  it("every fc.assert of tests/ui/property takes its parameters from fcParams()", () => {
    const files = readdirSync(PROPERTY_DIR).filter((f) => f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(PROPERTY_DIR, file), "utf8");
      const asserts = source.match(/fc\.assert\(/g)?.length ?? 0;
      const params = source.match(/fcParams\(\)/g)?.length ?? 0;
      expect(params, file).toBe(asserts);
      expect(source, file).not.toMatch(/numRuns:|\bseed:/);
    }
  });
});
