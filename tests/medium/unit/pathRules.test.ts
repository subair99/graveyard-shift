// Requirements: 3.11, 6.2, 6.5, 13.1
// The runtime export names of pathRules.mjs equal the names declared in pathRules.d.mts.
// The Context_Server constants equal the TypeScript sources and the list of Requirement 6.2.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTAKE_LIMITS } from "../../../src/pipeline/common/constants";
import { MAX_FILE_BYTES, TOOLS } from "../../../src/pipeline/medium/agent/contextServer.mjs";
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

describe("contextServer.mjs constants", () => {
  it("MAX_FILE_BYTES equals INTAKE_LIMITS.maxFileBytes", () => {
    expect(MAX_FILE_BYTES).toBe(INTAKE_LIMITS.maxFileBytes);
  });

  it("lists the six tool names of Requirement 6.2", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      "get_certificate",
      "get_eligibility",
      "get_advisories",
      "list_original_files",
      "read_original_file",
      "get_preset_menu",
    ]);
  });
});
