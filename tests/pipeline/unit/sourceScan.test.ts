/**
 * Source scan for the resurrection pipeline (task 2.3).
 *
 * Text scans over `src/pipeline/` and `scripts/` (whatever exists; missing
 * directories pass) and over the files that must not mention the spike URI host.
 * The `ci.yml` check is added in task 8.19.
 */
// Requirements: 1.5, 6.12, 13.8, 17.2
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");

const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const TEXT_EXT = new Set([...CODE_EXT, ".json", ".md", ".yml", ".yaml", ".txt", ".mdx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

function posix(p: string): string {
  return p.split(sep).join("/");
}

/** Repository-relative POSIX paths of all files under `rel` that pass `accept`; [] when missing. */
function walk(rel: string, accept: (name: string) => boolean): string[] {
  const abs = join(repoRoot, ...rel.split("/"));
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) visit(full);
      } else if (accept(name)) {
        out.push(posix(relative(repoRoot, full)));
      }
    }
  };
  if (statSync(abs).isDirectory()) visit(abs);
  else out.push(rel);
  return out.sort();
}

function read(rel: string): string {
  return readFileSync(join(repoRoot, ...rel.split("/")), "utf8");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function findAll(files: string[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const text = read(file);
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const m of text.matchAll(re)) hits.push(`${file}:${lineOf(text, m.index ?? 0)}`);
  }
  return hits;
}

const pipelineFiles = (): string[] => [
  ...walk("src/pipeline", (n) => CODE_EXT.has(extOf(n))),
  ...walk("scripts", (n) => CODE_EXT.has(extOf(n))),
];

/**
 * Documented `console` entries (thin command-line entries and recorders that
 * print to the terminal). Files under scripts/spike/ are one-off spike scripts.
 */
const CONSOLE_ALLOWED_FILES = new Set([
  "scripts/recordFixtures.ts",
  "scripts/recordTarball.ts",
  "scripts/printFixtureHashes.ts",
  "scripts/trace.ts",
]);
const CONSOLE_ALLOWED_PREFIXES = ["scripts/spike/"];

function consoleAllowed(file: string): boolean {
  return CONSOLE_ALLOWED_FILES.has(file) || CONSOLE_ALLOWED_PREFIXES.some((p) => file.startsWith(p));
}

/** Built by concatenation so that this file does not contain the scanned string. */
const SPIKE_HOST = "graveyard-shift" + ".dev";

describe("pipeline source scan", () => {
  it("imports no LLM client (R1.5)", () => {
    const clients =
      "openai|@anthropic-ai/[\\w.-]+|@google/generative-ai|@google/genai|@aws-sdk/client-bedrock[\\w-]*|ai|@ai-sdk/[\\w.-]+|langchain|@langchain/[\\w.-]+|@mistralai/[\\w.-]+|cohere-ai|ollama|groq-sdk|@huggingface/[\\w.-]+";
    const re = new RegExp(
      `(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*|import\\s+)["'](?:${clients})(?:/[^"']*)?["']`,
    );
    expect(findAll(pipelineFiles(), re)).toEqual([]);
  });

  it("uses no `shell: true` (R6.12)", () => {
    expect(findAll(pipelineFiles(), /\bshell\s*:\s*true\b/)).toEqual([]);
  });

  it("uses no `exec(` or `execSync(` with a string command (R6.12)", () => {
    const stringCall = /\bexec(?:Sync)?\s*\(\s*["'`]/;
    const importsExec = /import\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*from\s*["'](?:node:)?child_process["']/;
    const files = pipelineFiles();
    expect(findAll(files, stringCall)).toEqual([]);
    expect(findAll(files, importsExec)).toEqual([]);
  });

  it("uses no `console.` outside the documented entries", () => {
    const hits = findAll(pipelineFiles(), /\bconsole\s*\./).filter((h) => !consoleAllowed(h.slice(0, h.lastIndexOf(":"))));
    expect(hits).toEqual([]);
  });

  it("keeps the spike URI host out of src, scripts, tests, README, docs and workflows (R13.8)", () => {
    const files = [
      ...walk("src", (n) => TEXT_EXT.has(extOf(n))),
      ...walk("scripts", (n) => TEXT_EXT.has(extOf(n))),
      ...walk("tests", (n) => TEXT_EXT.has(extOf(n))),
      ...walk("README.md", () => true),
      ...walk("docs", (n) => TEXT_EXT.has(extOf(n))).filter((f) => f !== "docs/kiro-journal.md"),
      ...walk(".github/workflows", (n) => TEXT_EXT.has(extOf(n))).filter(
        (f) => f !== ".github/workflows/spike-attest.yml",
      ),
    ];
    const hits = files.filter((f) => read(f).includes(SPIKE_HOST));
    expect(hits).toEqual([]);
  });

  it("defines PREDICATE_TYPE in exactly one module (R17.2)", () => {
    const files = [
      ...walk("src", (n) => CODE_EXT.has(extOf(n))),
      ...walk("scripts", (n) => CODE_EXT.has(extOf(n))),
    ];
    const defs = findAll(files, /\b(?:const|let|var)\s+PREDICATE_TYPE\b/);
    const modules = new Set(defs.map((d) => d.slice(0, d.lastIndexOf(":"))));
    expect(defs).toHaveLength(1);
    expect(modules.size).toBe(1);
  });
});
