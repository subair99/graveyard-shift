// Requirements: 5.7, 13.1, 13.2, 13.3, 13.9, 13.10
// Documentation checks: structure.md lists the Medium files, the README subsection and the
// Enforcement_Test_Doc carry the required phrases, .gitignore keeps /.graveyard-work/, the spike
// record is unchanged (pinned sha256), and the work places nothing under ~/.kiro/.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

const AGENT_DEFINITION = ".kiro/agents/medium.json";
const ENFORCEMENT_DOC = "docs/medium-enforcement-test.md";

// Requirement 13.2: Agent_Definition, Write_Guard, Context_Server, Path_Rules_File, Enforcement_Test_Doc.
const LISTED_PATHS = [
  AGENT_DEFINITION,
  "src/pipeline/medium/agent/writeGuard.mjs",
  "src/pipeline/medium/agent/contextServer.mjs",
  "src/pipeline/medium/agent/pathRules.mjs",
  ENFORCEMENT_DOC,
];

// sha256 of the spike files as committed (Requirement 13.3: none changed). All are LF-only.
const SPIKE_HASHES: Record<string, string> = {
  "spikes/kiro-agent/medium.json": "6dc9a7c0a7fd10547388b72afec4388703463c5d5e8ff97eb35240f0c1ef810a",
  "spikes/kiro-agent/hooks/pre-tool-write-guard.mjs": "064f5525fffc80d0160f8675e9eea49f55b91ccf1b594422b1060e6a87626431",
  "spikes/kiro-agent/hooks/pre-tool-write-guard.test-cases.json":
    "98325fe7443f77da8dd2a13824427445b14515cbe3774f8d09fed84918d12e5f",
  "spikes/kiro-agent/mcp-stub/server.mjs": "38204b55e0fc2dbc2e3055eecaf79570f096669c5552144ef1be2237a59fe256",
  "spikes/kiro-agent/make-guardtest-agents.mjs": "ce1db7800a1774e5e0f6afd95c62ae8ed1751325cbcde5b6080a7e1e49f53ec4",
  "spikes/kiro-agent/README.md": "dadf29f99ec28ca017814430ad4915a1a60864b2574a38ef117d80e4501e358f",
};

describe("structure.md (13.2)", () => {
  const structure = read(".kiro/steering/structure.md");
  for (const path of LISTED_PATHS) {
    it(`lists ${path} and the file exists`, () => {
      expect(structure.split("\n").some((line) => line.startsWith(`${path} `))).toBe(true);
      expect(existsSync(join(ROOT, path))).toBe(true);
    });
  }
});

describe("README subsection (13.9)", () => {
  const readme = read("README.md");
  const start = readme.indexOf("Running the Medium in WSL");
  const next = readme.indexOf("\n## ", start + 1);
  const section = start === -1 ? "" : readme.slice(start, next === -1 ? undefined : next);

  it("exists under 'Running the Medium in WSL'", () => {
    expect(section).not.toBe("");
  });
  for (const phrase of ["kiro-cli agent validate", AGENT_DEFINITION, ENFORCEMENT_DOC]) {
    it(`contains ${phrase}`, () => {
      expect(section).toContain(phrase);
    });
  }
});

describe("Enforcement_Test_Doc (13.10)", () => {
  const doc = read(ENFORCEMENT_DOC);
  it("names the Agent_Definition", () => {
    expect(doc).toContain(AGENT_DEFINITION);
  });
  it("names no --agent value other than medium", () => {
    const values = [...doc.matchAll(/--agent(?:\s+|=)([^\s`"']+)/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => v !== "medium")).toEqual([]);
  });
});

describe(".gitignore (5.7)", () => {
  it("keeps /.graveyard-work/", () => {
    expect(read(".gitignore").split(/\r?\n/)).toContain("/.graveyard-work/");
  });
});

describe("spike record (13.3)", () => {
  for (const [path, hash] of Object.entries(SPIKE_HASHES)) {
    it(`${path} exists and is unchanged`, () => {
      expect(existsSync(join(ROOT, path))).toBe(true);
      expect(createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex")).toBe(hash);
    });
  }
});

describe("no file under ~/.kiro/ (13.1)", () => {
  it("the Agent_Definition is in the repository and no repository file requires one under ~/.kiro", () => {
    expect(existsSync(join(ROOT, AGENT_DEFINITION))).toBe(true);
    const text = [read(AGENT_DEFINITION), read(ENFORCEMENT_DOC)].join("\n");
    expect(text).not.toMatch(/~\/\.kiro\/agents|\$HOME\/\.kiro\/agents/);
  });
});
