// Requirements: 3.11, 13.1
// The runtime export names of pathRules.mjs equal the names declared in pathRules.d.mts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pathRules from "../../../src/pipeline/medium/agent/pathRules.mjs";

const DIRECTORY = join(__dirname, "..", "..", "..", "src", "pipeline", "medium", "agent");

describe("pathRules.mjs and pathRules.d.mts", () => {
  it("declare the same export names", () => {
    const declaration = readFileSync(join(DIRECTORY, "pathRules.d.mts"), "utf8");
    const declared = [...declaration.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    expect(Object.keys(pathRules).sort()).toEqual([...declared].sort());
  });

  it("imports nothing", () => {
    const body = readFileSync(join(DIRECTORY, "pathRules.mjs"), "utf8");
    expect(body).not.toMatch(/^\s*import\b|\brequire\(|\bimport\(/m);
  });
});
