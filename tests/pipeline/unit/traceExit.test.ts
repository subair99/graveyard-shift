// Requirements: 21.7
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTrace, type TraceContext } from "../../../scripts/trace";

// A temp fixture: one spec with criteria 1.1, 1.2 and 1.3; the test file cites 1.1 only.
const REQUIREMENTS = [
  "# Requirements",
  "",
  "## Requirements",
  "",
  "### Requirement 1: Demo",
  "",
  "#### Acceptance Criteria",
  "",
  "1. THE demo SHALL do A.",
  "2. THE demo SHALL do B.",
  "3. THE demo SHALL do C.",
  "",
].join("\n");

let root: string;

function gap(criterion: string): object {
  return { spec: "demo", criterion, class: "manual", evidence: "Manual_Task of the user" };
}

function setup(gaps: readonly object[]): TraceContext {
  mkdirSync(join(root, "specs"), { recursive: true });
  mkdirSync(join(root, "tests", "demo"), { recursive: true });
  writeFileSync(join(root, "specs", "requirements.md"), REQUIREMENTS);
  writeFileSync(join(root, "tests", "demo", "a.test.ts"), "// Requirements: 1.1\n");
  writeFileSync(join(root, "gaps.json"), JSON.stringify(gaps));
  return {
    root,
    gapsFile: join(root, "gaps.json"),
    specs: [{ name: "demo", requirements: "specs/requirements.md", testsDir: "tests/demo" }],
  };
}

describe("trace exit code (R21.7)", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "trace-fixture-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns 0 when every gap is classified and no entry is stale", () => {
    const r = runTrace(setup([gap("1.2"), gap("1.3")]));
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("gaps 2");
  });

  it("returns 1 for an unclassified gap", () => {
    const r = runTrace(setup([gap("1.2")]));
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("unclassified gaps: 1.3");
  });

  it("returns 1 for a stale entry (criterion now covered by a test)", () => {
    const r = runTrace(setup([gap("1.1"), gap("1.2"), gap("1.3")]));
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("stale classification entries: 1.1");
  });

  it("returns 1 for an entry whose criterion does not exist", () => {
    const r = runTrace(setup([gap("1.2"), gap("1.3"), gap("9.9")]));
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("classified criteria that do not exist: 9.9");
  });
});
