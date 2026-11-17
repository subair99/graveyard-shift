// Requirements: 12.2, 12.3
// Every test file under tests/medium/ carries a `// Requirements:` header (grammar of scripts/trace.ts) that names
// existing criteria, and integration tests are named *.integration.test.ts.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCitationsText, parseCriteria } from "../../../scripts/trace";

const ROOT = process.cwd();
const MEDIUM_DIR = join(ROOT, "tests", "medium");
const OWN_SPEC = "medium-agent";

function loadCriteria(spec: string): Set<string> {
  return new Set(parseCriteria(readFileSync(join(ROOT, ".kiro", "specs", spec, "requirements.md"), "utf8")));
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = listFiles(MEDIUM_DIR)
  .filter((f) => f.endsWith(".ts"))
  .sort();

/** True for a blank line or a line inside the leading comment block (`/**`, ` *`, ` */`, `//`). */
function isLeadingComment(line: string): boolean {
  return /^\s*$/.test(line) || /^\s*(\/\*|\*|\/\/)/.test(line);
}

/** The header line: the first `// Requirements:` line, which must come before any code line. */
function findHeader(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (/^\/\/ Requirements: /.test(line)) return line;
    if (!isLeadingComment(line)) return null;
  }
  return null;
}

interface Group {
  spec: string;
  ids: string[];
}

/** Groups the citations of the header line by spec, using the parser of scripts/trace.ts. */
function parseHeader(line: string): Group[] {
  const bySpec = new Map<string, string[]>();
  for (const c of parseCitationsText(line, OWN_SPEC)) bySpec.set(c.spec, [...(bySpec.get(c.spec) ?? []), c.id]);
  return [...bySpec].map(([spec, ids]) => ({ spec, ids }));
}

describe("tests/medium requirements headers", () => {
  it("finds the test files, including this one", () => {
    const names = files.map((f) => relative(MEDIUM_DIR, f).replace(/\\/g, "/"));
    expect(names).toContain("unit/requirementsHeader.test.ts");
    expect(files.every((f) => f.endsWith(".test.ts"))).toBe(true);
  });

  it("names only existing criteria in a well-formed header of every file", () => {
    const known: Record<string, Set<string>> = {
      [OWN_SPEC]: loadCriteria(OWN_SPEC),
      "resurrection-pipeline": loadCriteria("resurrection-pipeline"),
    };
    const problems: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const header = findHeader(readFileSync(file, "utf8"));
      if (header === null) {
        problems.push(`${rel}: no "// Requirements:" line before the first code line`);
        continue;
      }
      const groups = parseHeader(header);
      const bare = groups.filter((g) => g.spec === OWN_SPEC);
      if (bare.length === 0) {
        problems.push(`${rel}: header has no medium-agent criterion`);
      }
      for (const group of groups) {
        const criteria = known[group.spec];
        if (criteria === undefined) {
          problems.push(`${rel}: header names the spec "${group.spec}"; only ${OWN_SPEC} and resurrection-pipeline are allowed`);
          continue;
        }
        for (const id of group.ids) {
          if (!/^\d+\.\d+$/.test(id)) problems.push(`${rel}: malformed criterion "${id}"`);
          else if (!criteria.has(id)) problems.push(`${rel}: ${group.spec} has no criterion ${id}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("names every file under tests/medium/integration/ *.integration.test.ts", () => {
    const integration = join(MEDIUM_DIR, "integration");
    const bad = files
      .filter((f) => f.startsWith(integration))
      .filter((f) => !f.endsWith(".integration.test.ts"))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"));
    expect(bad).toEqual([]);
  });
});
