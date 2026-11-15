import { createRequire } from "node:module";
import * as path from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DANGEROUS_SEGMENTS,
  POLLUTION_MODULE_PATH,
  dangerousArgs,
  lodashSetHarness,
  ordinaryArgs,
  ordinaryExplicitCases,
  parsePathSegments,
  pathHasDangerousSegment,
  prototypePollutionDelta,
} from "../../../src/proof/harnesses/lodash.set/config";
import { validateRequest } from "../../../src/proof/shell/orchestrator";
import type { ProofRequest } from "../../../src/proof/types";

/** Validates: Requirements 8.14, 10.1, 11.9, 14.6, 14.10 */

const SEED = 20260101;
const SAMPLES = 200;

const request: ProofRequest = {
  original: {
    name: "lodash.set",
    version: "4.3.2",
    tarballPath: path.resolve("lodash.set-4.3.2.tgz"),
    integrity: "sha512-x",
  },
  resurrection: { kind: "directory", path: path.resolve("resurrection") },
  harness: lodashSetHarness,
};

type Check = (ctx: unknown) => { ok: boolean; detail?: unknown };
const pollution = createRequire(import.meta.url)(POLLUTION_MODULE_PATH) as { check: Check };

/** Small independent reference for the string and array forms the generators produce. */
function referenceSegments(p: string | string[]): string[] {
  if (Array.isArray(p)) return p;
  const dotted = p.replace(/\[["']?([^\]"']*)["']?\]/g, ".$1").replace(/^\./, "");
  return dotted === "" ? [] : dotted.split(".");
}

describe("lodash.set harness config", () => {
  it("passes validateRequest", () => {
    expect(() => validateRequest(request)).not.toThrow();
  });

  it("has set with arity 3 arguments, the delta, and an absolute readable module path", () => {
    expect(Object.keys(lodashSetHarness.functions)).toEqual(["set"]);
    expect(path.isAbsolute(POLLUTION_MODULE_PATH)).toBe(true);
    expect(lodashSetHarness.readPaths).toContain(POLLUTION_MODULE_PATH);
    expect(prototypePollutionDelta.propertyModule).toBe(POLLUTION_MODULE_PATH);
    expect(prototypePollutionDelta.function).toBe("set");
    for (const args of ordinaryExplicitCases) expect(args).toHaveLength(3);
  });

  it("constructive generator samples all satisfy the predicate", () => {
    const samples = fc.sample(dangerousArgs, { seed: SEED, numRuns: SAMPLES });
    expect(samples).toHaveLength(SAMPLES);
    for (const args of samples) {
      expect(args).toHaveLength(3);
      expect(prototypePollutionDelta.predicate(args)).toBe(true);
    }
  });

  it("ordinary generator samples never satisfy the predicate", () => {
    const samples = fc.sample(ordinaryArgs, { seed: SEED, numRuns: SAMPLES });
    expect(samples).toHaveLength(SAMPLES);
    for (const args of samples) {
      expect(args).toHaveLength(3);
      expect(prototypePollutionDelta.predicate(args)).toBe(false);
    }
  });

  it("ordinary explicit cases are outside the predicate, demonstration cases are inside", () => {
    for (const args of ordinaryExplicitCases) expect(pathHasDangerousSegment(args)).toBe(false);
    expect(prototypePollutionDelta.explicitCases).toHaveLength(3);
    for (const args of prototypePollutionDelta.explicitCases) {
      expect(prototypePollutionDelta.predicate(args)).toBe(true);
    }
  });

  it("parses paths like lodash 4.3.2 and agrees with a small reference", () => {
    expect(parsePathSegments("a.b[0]['c']")).toEqual(["a", "b", "0", "c"]);
    expect(parsePathSegments('["__proto__"].x')).toEqual(["__proto__", "x"]);
    expect(parsePathSegments(["a", "constructor"])).toEqual(["a", "constructor"]);
    for (const name of DANGEROUS_SEGMENTS) {
      expect(pathHasDangerousSegment([{}, `x.${name}.y`, 1])).toBe(true);
      expect(pathHasDangerousSegment([{}, `x.${name}s.y`, 1])).toBe(false);
    }
    for (const generator of [ordinaryArgs, dangerousArgs]) {
      for (const args of fc.sample(generator, { seed: SEED, numRuns: SAMPLES })) {
        const p = args[1] as string | string[];
        expect(parsePathSegments(p)).toEqual(referenceSegments(p));
      }
    }
  });
});

describe("pollution.cjs", () => {
  it("returns ok true for an empty prototype delta", () => {
    expect(pollution.check({ functionName: "set", kind: "returned", prototypeDelta: [], result: {} })).toEqual({
      ok: true,
    });
  });

  it("returns ok false with a detail for a delta with an added key", () => {
    const result = pollution.check({
      functionName: "set",
      kind: "returned",
      prototypeDelta: [
        { prototype: "Object.prototype", key: "polluted", change: "added", after: { value: "yes" } },
      ],
      result: {},
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toEqual(["Object.prototype.polluted added"]);
  });

  it("returns ok false when no delta is given", () => {
    expect(pollution.check({}).ok).toBe(false);
  });
});
