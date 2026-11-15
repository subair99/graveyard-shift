// Requirement trace (light): lists which proof test files cite which acceptance criterion of
// .kiro/specs/proof-of-life-engine/requirements.md, and writes docs/traceability.md.
// Reads files only; the single write is docs/traceability.md. Run: npm run trace
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REQUIREMENTS = join(ROOT, ".kiro", "specs", "proof-of-life-engine", "requirements.md");
const TESTS_DIR = join(ROOT, "tests", "proof");
const OUTPUT = join(ROOT, "docs", "traceability.md");

type Id = string;

function compareIds(a: Id, b: Id): number {
  const [an = 0, am = 0] = a.split(".").map(Number);
  const [bn = 0, bm = 0] = b.split(".").map(Number);
  return an - bn || am - bm;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every numbered acceptance criterion: Requirement N, criterion M becomes "N.M". */
function parseCriteria(markdown: string): Id[] {
  const ids: Id[] = [];
  let inRequirements = false;
  let current: number | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^## Requirements\s*$/.test(line)) {
      inRequirements = true;
      continue;
    }
    if (!inRequirements) continue;
    const heading = /^### Requirement (\d+):/.exec(line);
    if (heading !== null) {
      current = Number(heading[1]);
      continue;
    }
    const criterion = /^(\d+)\. /.exec(line);
    if (criterion !== null && current !== null) ids.push(`${current}.${criterion[1]}`);
  }
  return ids;
}

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function parseCitations(file: string): Id[] {
  const ids: Id[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\/\/ Requirements: (.*)$/.exec(line);
    if (match === null) continue;
    for (const part of (match[1] ?? "").split(",")) {
      const id = part.trim();
      if (id !== "") ids.push(id);
    }
  }
  return ids;
}

function main(): void {
  const criteria = parseCriteria(readFileSync(REQUIREMENTS, "utf8"));
  const known = new Set(criteria);
  const citedBy = new Map<Id, Set<string>>();
  const unknown = new Map<Id, Set<string>>();
  const files = listTestFiles(TESTS_DIR)
    .map((f) => relative(ROOT, f).split("\\").join("/"))
    .sort(compareText);
  for (const file of files) {
    for (const id of parseCitations(join(ROOT, file))) {
      const target = known.has(id) ? citedBy : unknown;
      const set = target.get(id) ?? new Set<string>();
      set.add(file);
      target.set(id, set);
    }
  }

  const sortedCriteria = [...criteria].sort(compareIds);
  const gaps = sortedCriteria.filter((id) => !citedBy.has(id));
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push("# Traceability: proof-of-life-engine", "");
  lines.push(`Generated on ${date} by \`npm run trace\` (system date; this is documentation, not a measured number).`, "");
  lines.push("A citation shows which tests claim to cover a criterion; it does not prove coverage.", "");
  lines.push(
    "Sources: acceptance criteria from `.kiro/specs/proof-of-life-engine/requirements.md`; citations are the `// Requirements:` header lines of `tests/proof/**/*.test.ts`.",
    "",
  );
  lines.push("## Summary", "");
  lines.push(`- Test files scanned: ${files.length}`);
  lines.push(`- Acceptance criteria: ${criteria.length}`);
  lines.push(`- Criteria cited by at least one test file: ${criteria.length - gaps.length}`);
  lines.push(`- Criteria with no citing test file (gaps): ${gaps.length}`, "");
  lines.push("## Criteria and citing test files", "");
  lines.push("| Criterion | Test files |", "| --- | --- |");
  for (const id of sortedCriteria) {
    const set = citedBy.get(id);
    const cell = set === undefined ? "(none)" : [...set].sort(compareText).map((f) => `\`${f}\``).join("<br>");
    lines.push(`| ${id} | ${cell} |`);
  }
  lines.push("", "## Gaps", "");
  if (gaps.length === 0) {
    lines.push("none", "");
  } else {
    lines.push("Criteria that no test file cites:", "");
    const byRequirement = new Map<string, Id[]>();
    for (const id of gaps) {
      const n = id.split(".")[0] ?? "";
      byRequirement.set(n, [...(byRequirement.get(n) ?? []), id]);
    }
    for (const [n, ids] of byRequirement) lines.push(`- Requirement ${n}: ${ids.join(", ")}`);
    lines.push("");
  }
  lines.push("## Cited numbers that do not exist in requirements.md", "");
  if (unknown.size === 0) {
    lines.push("none", "");
  } else {
    for (const id of [...unknown.keys()].sort(compareIds)) {
      lines.push(`- ${id}: ${[...(unknown.get(id) ?? [])].sort(compareText).map((f) => `\`${f}\``).join(", ")}`);
    }
    lines.push("");
  }
  writeFileSync(OUTPUT, lines.join("\n"), "utf8");
  process.stdout.write(
    `criteria ${criteria.length}, cited ${criteria.length - gaps.length}, gaps ${gaps.length}, unknown citations ${unknown.size}\n`,
  );
}

main();
