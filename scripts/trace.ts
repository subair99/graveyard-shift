// Requirement trace (light): for each spec, lists which test files cite which acceptance criterion
// of the spec's requirements.md, and writes docs/traceability.md (one section per spec).
// Citations are the `// Requirements: ...` header lines of test files. Syntax of one line:
//   // Requirements: 1.2, 4.3                          bare list: the spec the test belongs to
//                                                      (tests/engine -> autopsy-engine, tests/proof -> proof-of-life-engine,
//                                                      tests/pipeline -> resurrection-pipeline)
//   // Requirements: proof-of-life-engine 15.5, 15.9   list for the named spec
//   // Requirements: 1.2, 4.3; proof-of-life-engine 15.5, 15.9   several groups, separated by semicolons
// A citation credits the criterion in the named spec's table, which shows the citing file path.
// An unknown spec name or an unknown number is listed under "Cited numbers that do not exist".
// Gap classes for all specs come from docs/traceability-gaps.json (class and evidence per gap).
// Reads files only; the single write is docs/traceability.md. Not a test. Run: npm run trace
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = join(ROOT, "docs", "traceability.md");
const GAPS_FILE = join(ROOT, "docs", "traceability-gaps.json");

type Id = string;

export interface SpecConfig {
  name: string;
  requirements: string;
  testsDir: string;
}

/** What runTrace reads: the root all spec paths are relative to, the gaps file and the specs. Tests pass a temp directory. */
export interface TraceContext {
  root: string;
  gapsFile: string;
  specs: readonly SpecConfig[];
}

const SPECS: readonly SpecConfig[] = [
  {
    name: "autopsy-engine",
    requirements: ".kiro/specs/autopsy-engine/requirements.md",
    testsDir: "tests/engine",
  },
  {
    name: "proof-of-life-engine",
    requirements: ".kiro/specs/proof-of-life-engine/requirements.md",
    testsDir: "tests/proof",
  },
  {
    name: "resurrection-pipeline",
    requirements: ".kiro/specs/resurrection-pipeline/requirements.md",
    testsDir: "tests/pipeline",
  },
];

const CLASSES = [
  "needs a test",
  "documentation only",
  "covered, header missing",
  "manual",
  "optional, skipped in first pass",
] as const;
type GapClass = (typeof CLASSES)[number];

interface GapEntry {
  spec: string;
  criterion: Id;
  class: GapClass;
  evidence: string;
}

const NOTE = "A citation shows which tests claim to cover a criterion; it does not prove coverage.";

function compareIds(a: Id, b: Id): number {
  const [an = 0, am = 0] = a.split(".").map(Number);
  const [bn = 0, bm = 0] = b.split(".").map(Number);
  return an - bn || am - bm;
}

function compareAnyId(a: string, b: string): number {
  const numeric = /^\d+\.\d+$/;
  return numeric.test(a) && numeric.test(b) ? compareIds(a, b) : compareText(a, b);
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

interface Citation {
  /** The spec the citation names (or the file's own spec for a bare list). */
  spec: string;
  id: Id;
}

/** Parses the `// Requirements:` lines of one file: groups separated by ";", each `[spec-name] N.M, N.M`. */
function parseCitations(file: string, ownSpec: string): Citation[] {
  const out: Citation[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\/\/ Requirements: (.*)$/.exec(line);
    if (match === null) continue;
    for (const group of (match[1] ?? "").split(";")) {
      const named = /^\s*([A-Za-z][\w-]*)\s+(.+)$/.exec(group);
      const spec = named === null ? ownSpec : (named[1] ?? ownSpec);
      const list = named === null ? group : (named[2] ?? "");
      for (const part of list.split(",")) {
        const id = part.trim();
        if (id !== "") out.push({ spec, id });
      }
    }
  }
  return out;
}

interface FileCitations {
  file: string;
  ownSpec: string;
  citations: Citation[];
}

function collectCitations(ctx: TraceContext): FileCitations[] {
  const all: FileCitations[] = [];
  for (const spec of ctx.specs) {
    for (const full of listTestFiles(join(ctx.root, spec.testsDir))) {
      const file = relative(ctx.root, full).split("\\").join("/");
      all.push({ file, ownSpec: spec.name, citations: parseCitations(full, spec.name) });
    }
  }
  return all;
}

function readGapEntries(gapsFile: string): GapEntry[] {
  if (!existsSync(gapsFile)) return [];
  const raw: unknown = JSON.parse(readFileSync(gapsFile, "utf8"));
  if (!Array.isArray(raw)) throw new Error("docs/traceability-gaps.json must be an array");
  return raw.map((item: unknown, index: number): GapEntry => {
    const e = item as Partial<GapEntry> | null;
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e.spec !== "string" ||
      typeof e.criterion !== "string" ||
      typeof e.evidence !== "string" ||
      e.evidence === "" ||
      !CLASSES.includes(e.class as GapClass)
    ) {
      throw new Error(`docs/traceability-gaps.json entry ${index} is not { spec, criterion, class, evidence }`);
    }
    return { spec: e.spec, criterion: e.criterion, class: e.class as GapClass, evidence: e.evidence };
  });
}

interface SpecResult {
  criteria: number;
  cited: number;
  gaps: number;
  unknownCitations: number;
  classCounts: Record<GapClass, number>;
  problems: number;
  messages: string[];
}

function renderSpec(ctx: TraceContext, spec: SpecConfig, entries: readonly GapEntry[], allCitations: readonly FileCitations[], lines: string[]): SpecResult {
  const criteria = parseCriteria(readFileSync(join(ctx.root, spec.requirements), "utf8"));
  const known = new Set(criteria);
  const citedBy = new Map<Id, Set<string>>();
  const unknown = new Map<Id, Set<string>>();
  const files = listTestFiles(join(ctx.root, spec.testsDir))
    .map((f) => relative(ctx.root, f).split("\\").join("/"))
    .sort(compareText);
  const specNames = new Set(ctx.specs.map((s) => s.name));
  const add = (target: Map<Id, Set<string>>, key: Id, file: string): void => {
    const set = target.get(key) ?? new Set<string>();
    set.add(file);
    target.set(key, set);
  };
  for (const { file, ownSpec, citations } of allCitations) {
    for (const c of citations) {
      if (!specNames.has(c.spec)) {
        // An unknown spec name is reported in the section of the spec the citing file belongs to.
        if (ownSpec === spec.name) add(unknown, `${c.spec} ${c.id}`, file);
      } else if (c.spec === spec.name) {
        add(known.has(c.id) ? citedBy : unknown, c.id, file);
      }
    }
  }

  const sortedCriteria = [...criteria].sort(compareIds);
  const gaps = sortedCriteria.filter((id) => !citedBy.has(id));
  const classCounts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<GapClass, number>;
  let problems = 0;
  const messages: string[] = [];

  lines.push(`## Spec: ${spec.name}`, "");
  lines.push(`Requirements: \`${spec.requirements}\`. Tests: \`${spec.testsDir}/**/*.test.ts\`.`, "");
  lines.push(NOTE, "");
  lines.push("### Summary", "");
  lines.push(`- Test files scanned: ${files.length}`);
  lines.push(`- Acceptance criteria: ${criteria.length}`);
  lines.push(`- Criteria cited by at least one test file: ${criteria.length - gaps.length}`);
  lines.push(`- Criteria with no citing test file (gaps): ${gaps.length}`, "");

  lines.push("### Criteria and citing test files", "");
  lines.push("| Criterion | Test files |", "| --- | --- |");
  for (const id of sortedCriteria) {
    const set = citedBy.get(id);
    const cell = set === undefined ? "(none)" : [...set].sort(compareText).map((f) => `\`${f}\``).join("<br>");
    lines.push(`| ${id} | ${cell} |`);
  }
  lines.push("");

  lines.push("### Gaps", "");
  if (gaps.length === 0) {
    lines.push("none", "");
  } else {
    const mine = entries.filter((e) => e.spec === spec.name);
    const byCriterion = new Map<Id, GapEntry>();
    for (const e of mine) byCriterion.set(e.criterion, e);
    lines.push("Criteria that no test file cites, with the class and evidence from `docs/traceability-gaps.json`:", "");
    for (const id of gaps) {
      const e = byCriterion.get(id);
      if (e === undefined) {
        lines.push(`- ${id}: UNCLASSIFIED`);
      } else {
        classCounts[e.class] += 1;
        lines.push(`- ${id}: ${e.class}. ${e.evidence}`);
      }
    }
    lines.push("");
    lines.push("Gaps per class:", "");
    for (const c of CLASSES) lines.push(`- ${c}: ${classCounts[c]}`);
    lines.push("");

    const gapSet = new Set(gaps);
    const unclassified = gaps.filter((id) => !byCriterion.has(id));
    const notCriteria = mine.map((e) => e.criterion).filter((id) => !known.has(id)).sort(compareIds);
    const stale = mine.map((e) => e.criterion).filter((id) => known.has(id) && !gapSet.has(id)).sort(compareIds);
    const duplicates = mine
      .map((e) => e.criterion)
      .filter((id, i, all) => all.indexOf(id) !== i)
      .sort(compareIds);
    problems = unclassified.length + notCriteria.length + stale.length + duplicates.length;
    if (unclassified.length > 0) messages.push(`unclassified gaps: ${unclassified.join(', ')}`);
    if (notCriteria.length > 0) messages.push(`classified criteria that do not exist: ${notCriteria.join(', ')}`);
    if (stale.length > 0) messages.push(`stale classification entries: ${stale.join(', ')}`);
    if (duplicates.length > 0) messages.push(`duplicate classification entries: ${duplicates.join(', ')}`);
    lines.push("### Classification check", "");
    lines.push(`- Unclassified gaps: ${unclassified.length === 0 ? "none" : unclassified.join(", ")}`);
    lines.push(`- Classified criteria that do not exist in requirements.md: ${notCriteria.length === 0 ? "none" : notCriteria.join(", ")}`);
    lines.push(`- Stale classification entries (no longer gaps): ${stale.length === 0 ? "none" : stale.join(", ")}`);
    lines.push(`- Duplicate classification entries: ${duplicates.length === 0 ? "none" : duplicates.join(", ")}`, "");
  }

  lines.push("### Cited numbers that do not exist in requirements.md", "");
  if (unknown.size === 0) {
    lines.push("none", "");
  } else {
    for (const id of [...unknown.keys()].sort(compareAnyId)) {
      lines.push(`- ${id}: ${[...(unknown.get(id) ?? [])].sort(compareText).map((f) => `\`${f}\``).join(", ")}`);
    }
    lines.push("");
  }

  return { criteria: criteria.length, cited: criteria.length - gaps.length, gaps: gaps.length, unknownCitations: unknown.size, classCounts, problems, messages };
}

/** Core of the trace: reads files only. `report` is the markdown, `output` the text printed to stdout. */
export function runTrace(ctx: TraceContext): { exitCode: number; output: string; report: string } {
  const entries = readGapEntries(ctx.gapsFile);
  const specNames = new Set(ctx.specs.map((s) => s.name));
  const allCitations = collectCitations(ctx);
  const strangeSpecs = entries.filter((e) => !specNames.has(e.spec));
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push("# Traceability", "");
  lines.push(`Generated on ${date} by \`npm run trace\` (system date; this is documentation, not a measured number).`, "");
  lines.push(NOTE, "");
  lines.push(
    "One section per spec. Acceptance criteria come from the spec's `requirements.md`; citations are the `// Requirements:` header lines of the test files. Gap classes (class and evidence per gap) for every spec are read from `docs/traceability-gaps.json`. An unclassified gap or a stale classification entry in any spec makes `npm run trace` exit with 1.",
    "",
    "Header syntax: `// Requirements: 1.2, 4.3` is a bare list and means the spec the test belongs to (`tests/engine` is autopsy-engine, `tests/proof` is proof-of-life-engine, `tests/pipeline` is resurrection-pipeline). `// Requirements: proof-of-life-engine 15.5, 15.9` cites criteria of another spec, and groups are separated by semicolons: `// Requirements: 1.2, 4.3; proof-of-life-engine 15.5, 15.9`. A citation credits the criterion in the named spec's table, which shows the citing file path. An unknown spec name or an unknown number is listed under \"Cited numbers that do not exist\" in the section of the spec the citing file belongs to.",
    "",
  );

  let failed = false;
  const summary: string[] = [];
  for (const spec of ctx.specs) {
    const r = renderSpec(ctx, spec, entries, allCitations, lines);
    const classText = `, classes: ${CLASSES.map((c) => `${c} ${r.classCounts[c]}`).join("; ")}`;
    summary.push(
      `${spec.name}: criteria ${r.criteria}, cited ${r.cited}, gaps ${r.gaps}, unknown citations ${r.unknownCitations}${classText}`,
    );
    if (r.problems > 0) {
      failed = true;
      for (const m of r.messages) summary.push(`  ${spec.name}: ${m}`);
    }
  }
  if (strangeSpecs.length > 0) failed = true;
  let output = "";
  for (const s of summary) output += `${s}\n`;
  if (strangeSpecs.length > 0) {
    output += `classification entries for an unknown spec: ${strangeSpecs.map((e) => `${e.spec} ${e.criterion}`).join(", ")}\n`;
  }
  if (failed) {
    output +=
      "classification problems: see 'Classification check' in docs/traceability.md (unclassified gaps, classified criteria that do not exist, stale classification entries)\n";
  }
  return { exitCode: failed ? 1 : 0, output, report: lines.join("\n") };
}

function main(): void {
  const result = runTrace({ root: ROOT, gapsFile: GAPS_FILE, specs: SPECS });
  writeFileSync(OUTPUT, result.report, "utf8");
  process.stdout.write(result.output);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

// Run only as a script (npm run trace), not when a test imports runTrace.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
