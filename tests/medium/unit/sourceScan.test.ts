/**
 * Source scans for the Medium side (medium-agent task 11.1).
 *
 * Every scan parses the file with @babel/parser and reads code nodes only, so comments never match.
 * Files are read from disk: every `.mjs` file of the Agent_Directory (src/pipeline/medium/agent/) is
 * listed with readdirSync, so a new agent file is scanned without a change here (Requirement 11.5).
 *
 * Not handled (a human review must catch these): computed non-literal property keys, `eval`,
 * `new Function`, passing `process` through a function argument (reported as a value use of `process`),
 * and a shadowing local variable named like a scanned name (false positive).
 *
 * For Requirement 8.1 a "literal" is a code node: a string or template literal, or an identifier. A
 * comment that quotes the command line is not an argument and is not reported.
 */
// Requirements: 3.7, 3.11, 6.4, 8.1, 11.3, 11.5, 13.5, 13.6, 13.7
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { MEDIUM_PROMPT_PREFIX } from "../../../src/pipeline/medium/core/prompt";
import { ALLOWED_MEDIUM_PATHS, FORBIDDEN_SEGMENTS } from "../../../src/pipeline/medium/agent/pathRules.mjs";

const repoRoot = resolve(__dirname, "..", "..", "..");
const AGENT_DIR = "src/pipeline/medium/agent";
const PATH_RULES = `${AGENT_DIR}/pathRules.mjs`;
const WRITE_GUARD = `${AGENT_DIR}/writeGuard.mjs`;
const CONTEXT_SERVER = `${AGENT_DIR}/contextServer.mjs`;

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };
type Hit = { line: number; detail: string };

interface Facts {
  imports: (Hit & { spec: string | null; names: string[] })[];
  identifiers: Hit[];
  strings: (Hit & { value: string; raw: string })[];
  regexes: Hit[];
  declared: Hit[];
  calls: Hit[];
  envUses: (Hit & { key: string | null })[];
  processValueUses: Hit[];
}

const SKIP_KEYS = new Set(["loc", "extra", "leadingComments", "trailingComments", "innerComments", "comments"]);

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function repoPath(full: string): string {
  return relative(repoRoot, full).split(sep).join("/");
}

function propertyName(node: Node, computed: boolean): string | null {
  if (!computed) return node.type === "Identifier" ? (node.name as string) : null;
  return node.type === "StringLiteral" ? (node.value as string) : null;
}

function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value as string;
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) {
    return (node.quasis as { value: { cooked?: string | null } }[])[0]?.value.cooked ?? null;
  }
  return null;
}

/** Facts of one source text. A parse error throws, naming the file. */
export function collectFacts(source: string, file: string): Facts {
  let ast: Node;
  try {
    const plugins: ("typescript" | "jsx")[] = file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
    ast = parse(source, { sourceType: "unambiguous", plugins, errorRecovery: false }) as unknown as Node;
  } catch (error) {
    throw new Error(`${file}: cannot parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  const facts: Facts = {
    imports: [],
    identifiers: [],
    strings: [],
    regexes: [],
    declared: [],
    calls: [],
    envUses: [],
    processValueUses: [],
  };
  const lineOf = (n: Node): number => n.loc?.start.line ?? 0;

  const visit = (node: Node, parent: Node | null, key: string): void => {
    const line = lineOf(node);
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        facts.imports.push({ line, detail: "import", spec: literalText(node.source as Node), names: importedNames(node) });
        break;
      case "ExportNamedDeclaration":
        if (node.source) {
          facts.imports.push({ line, detail: "export from", spec: literalText(node.source as Node), names: [] });
        }
        break;
      case "ImportExpression":
        facts.imports.push({ line, detail: "dynamic import", spec: literalText(node.source as Node), names: [] });
        break;
      case "CallExpression": {
        const callee = node.callee as Node;
        const first = (node.arguments as Node[])[0];
        if (callee.type === "Import") facts.imports.push({ line, detail: "dynamic import", spec: literalText(first), names: [] });
        if (callee.type === "Identifier" && callee.name === "require") {
          facts.imports.push({ line, detail: "require", spec: literalText(first), names: [] });
        }
        if (callee.type === "Identifier") facts.calls.push({ line, detail: callee.name as string });
        if (callee.type === "MemberExpression") {
          const name = propertyName(callee.property as Node, callee.computed === true);
          if (name !== null) facts.calls.push({ line, detail: name });
        }
        break;
      }
      case "StringLiteral":
        facts.strings.push({ line, detail: "string", value: node.value as string, raw: String((node.extra as { raw?: string } | undefined)?.raw ?? "") });
        break;
      case "TemplateElement": {
        const cooked = (node.value as { cooked?: string | null; raw: string }).cooked ?? "";
        facts.strings.push({ line, detail: "template", value: cooked, raw: (node.value as { raw: string }).raw });
        break;
      }
      case "RegExpLiteral":
        facts.regexes.push({ line, detail: node.pattern as string });
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "TSDeclareFunction":
        if (isNode(node.id) && node.id.type === "Identifier") facts.declared.push({ line, detail: node.id.name as string });
        break;
      case "VariableDeclarator":
        if (isNode(node.id) && node.id.type === "Identifier") facts.declared.push({ line, detail: node.id.name as string });
        break;
      case "Identifier": {
        const name = node.name as string;
        facts.identifiers.push({ line, detail: name });
        const isMemberObject = parent !== null && /^(Optional)?MemberExpression$/.test(parent.type) && key === "object";
        if (name === "process" && !isMemberObject) facts.processValueUses.push({ line, detail: "process used as a value" });
        break;
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const name = propertyName(node.property as Node, node.computed === true);
        const object = node.object as Node;
        const onProcess =
          (object.type === "Identifier" && object.name === "process") ||
          (/^(Optional)?MemberExpression$/.test(object.type) &&
            propertyName(object.property as Node, object.computed === true) === "process");
        if (name === "env" && onProcess) {
          const outer =
            parent !== null && /^(Optional)?MemberExpression$/.test(parent.type) && key === "object"
              ? propertyName(parent.property as Node, parent.computed === true)
              : null;
          facts.envUses.push({ line, detail: "process.env", key: outer });
        }
        break;
      }
      default:
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(childKey)) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, node, childKey);
      } else if (isNode(value)) {
        visit(value, node, childKey);
      }
    }
  };
  visit(ast, null, "");
  // `import { env } from "node:process"` reads the environment without `process.env`.
  for (const imp of facts.imports) {
    if (imp.spec === "process" || imp.spec === "node:process") {
      facts.envUses.push({ line: imp.line, detail: `import of ${imp.spec}`, key: null });
    }
  }
  return facts;
}

function importedNames(node: Node): string[] {
  const names: string[] = [];
  for (const spec of (node.specifiers as Node[] | undefined) ?? []) {
    const imported = spec.imported as Node | undefined;
    if (imported) names.push(imported.type === "Identifier" ? (imported.name as string) : String(imported.value));
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// File listing

const SOURCE_EXT = /\.(?:ts|mts|cts|tsx|js|mjs|cjs)$/;

function listFiles(dir: string, ext: RegExp): string[] {
  const full = join(repoRoot, dir);
  if (!existsSync(full) || !statSync(full).isDirectory()) return [];
  const out: string[] = [];
  for (const name of readdirSync(full).sort()) {
    const child = `${dir}/${name}`;
    if (statSync(join(repoRoot, child)).isDirectory()) out.push(...listFiles(child, ext));
    else if (ext.test(name)) out.push(child);
  }
  return out;
}

const readRepo = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const factsOf = (path: string): Facts => collectFacts(readRepo(path), path);

const agentFiles = (): string[] =>
  readdirSync(join(repoRoot, AGENT_DIR))
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .map((name) => `${AGENT_DIR}/${name}`);

/** Resolves a relative specifier of `file` to a repository-relative path (no extension added). */
function resolveSpec(file: string, spec: string): string {
  return repoPath(resolve(join(repoRoot, dirname(file)), spec));
}

// ---------------------------------------------------------------------------------------------
// Scan rules (pure over Facts, so the self-tests below can feed them violating text)

const NETWORK_AND_PROCESS_MODULES = new Set([
  "net", "http", "https", "http2", "dns", "dgram", "tls", "child_process", "cluster", "worker_threads",
]);
const moduleBase = (spec: string): string => (spec.startsWith("node:") ? spec.slice(5) : spec).split("/")[0] ?? spec;

export function networkOrChildProcessImports(facts: Facts, file: string): string[] {
  const out: string[] = [];
  for (const imp of facts.imports) {
    if (imp.spec !== null && NETWORK_AND_PROCESS_MODULES.has(moduleBase(imp.spec))) {
      out.push(`${file}:${imp.line} imports ${imp.spec}`);
    }
  }
  for (const id of facts.identifiers) {
    if (["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].includes(id.detail)) {
      out.push(`${file}:${id.line} references ${id.detail}`);
    }
  }
  return out;
}

const FS_MUTATORS =
  /^(write|append|copy|rename|unlink|rm|rmdir|mkdir|mkdtemp|truncate|ftruncate|chmod|chown|lchown|fchmod|fchown|utimes|futimes|lutimes|symlink|link|cp|createWriteStream)/;

export function fileSystemWrites(facts: Facts, file: string): string[] {
  const out: string[] = [];
  for (const call of facts.calls) {
    // `process.stdout.write` and `process.stderr.write` are stream writes (the MCP channel), not file writes.
    if (call.detail === "write") continue;
    if (FS_MUTATORS.test(call.detail)) out.push(`${file}:${call.line} calls ${call.detail}`);
  }
  for (const imp of facts.imports) {
    for (const name of imp.names) {
      if (FS_MUTATORS.test(name)) out.push(`${file}:${imp.line} imports ${name}`);
    }
    if (imp.spec !== null && moduleBase(imp.spec) === "fs" && imp.spec.endsWith("promises")) {
      out.push(`${file}:${imp.line} imports ${imp.spec}`);
    }
  }
  return out;
}

const LLM_CLIENTS = [
  "openai", "@anthropic-ai/", "anthropic", "@google/generative-ai", "@google/genai", "@aws-sdk/client-bedrock",
  "langchain", "@langchain/", "ai", "@ai-sdk/", "cohere-ai", "ollama", "@mistralai/", "groq-sdk", "replicate",
  "@huggingface/", "llamaindex", "together-ai", "@azure/openai", "@kiro", "@aws/",
];

export function llmClientImports(facts: Facts, file: string): string[] {
  const out: string[] = [];
  for (const imp of facts.imports) {
    if (imp.spec === null) continue;
    const hit = LLM_CLIENTS.some((name) => (name.endsWith("/") ? imp.spec?.startsWith(name) : imp.spec === name || imp.spec?.startsWith(`${name}/`)));
    if (hit) out.push(`${file}:${imp.line} imports ${imp.spec}`);
  }
  return out;
}

/** Imports that are not `node:` modules or one of `allowedRelative` (repository-relative paths). */
export function foreignImports(facts: Facts, file: string, allowedRelative: readonly string[], requirePrefix: boolean): string[] {
  const out: string[] = [];
  for (const imp of facts.imports) {
    if (imp.spec === null) {
      out.push(`${file}:${imp.line} has a ${imp.detail} that is not a string literal`);
    } else if (imp.spec.startsWith(".")) {
      if (!allowedRelative.includes(resolveSpec(file, imp.spec))) out.push(`${file}:${imp.line} imports ${imp.spec}`);
    } else if (requirePrefix ? !imp.spec.startsWith("node:") : !isBuiltin(imp.spec)) {
      out.push(`${file}:${imp.line} imports ${imp.spec}`);
    }
  }
  return out;
}

const CONTROL_RANGE = /\\u0000|\\x00|\\u001f|\\x1f|\\u007f|\\x7f|\\p\{(?:Cc|Control)\}|[\u0000-\u0008\u000e-\u001f\u007f]/i;
const RULE_NAMES = new Set([
  "isAllowlisted", "badPathReason", "pathRuleProblem", "firstControlCharacter", "escapeControlCharacters", "codePointLabel",
  "CONTROL_CHARACTER_PATTERN", "FORBIDDEN_SEGMENTS", "ALLOWED_MEDIUM_PATHS",
]);

/** A control-character pattern, a forbidden segment, the resurrection prefix or a rule function defined in `file`. */
export function ownPathRules(facts: Facts, file: string): string[] {
  const out: string[] = [];
  for (const re of facts.regexes) {
    if (CONTROL_RANGE.test(re.detail)) out.push(`${file}:${re.line} has its own control-character pattern /${re.detail}/`);
  }
  for (const s of facts.strings) {
    if (CONTROL_RANGE.test(s.raw) && /\\u00|\\x[01]|\\x7f/i.test(s.raw)) {
      out.push(`${file}:${s.line} has its own control-character pattern in a string`);
    }
    if (FORBIDDEN_SEGMENTS.includes(s.value)) out.push(`${file}:${s.line} lists the forbidden segment "${s.value}"`);
    if (s.value === ALLOWED_MEDIUM_PATHS[0]) out.push(`${file}:${s.line} checks the allowed path "${s.value}"`);
  }
  for (const d of facts.declared) {
    if (RULE_NAMES.has(d.detail)) out.push(`${file}:${d.line} defines ${d.detail}`);
  }
  return out;
}

/** Uses of the environment. `allowedKeys` lists the keys that `process.env.<key>` may read. */
export function environmentUses(facts: Facts, file: string, allowedKeys: readonly string[]): string[] {
  const out: string[] = [];
  for (const use of facts.envUses) {
    if (use.key === null || !allowedKeys.includes(use.key)) {
      out.push(`${file}:${use.line} ${use.detail}${use.key === null ? " (whole or computed)" : `.${use.key}`}`);
    }
  }
  for (const use of facts.processValueUses) out.push(`${file}:${use.line} ${use.detail}`);
  return out;
}

export function forbiddenImportTargets(facts: Facts, file: string): string[] {
  const out: string[] = [];
  for (const imp of facts.imports) {
    if (imp.spec === null) continue;
    const target = imp.spec.startsWith(".") ? resolveSpec(file, imp.spec) : imp.spec;
    if (/(^|\/)src\/pipeline\/(undertaker|gravedigger)(\/|$)/.test(target) || /^\.\.?\/.*\/(undertaker|gravedigger)\//.test(imp.spec)) {
      out.push(`${file}:${imp.line} imports ${imp.spec} (${target})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe("Write_Guard imports (R3.7)", () => {
  it("imports only node: modules and the Path_Rules_File", () => {
    expect(foreignImports(factsOf(WRITE_GUARD), WRITE_GUARD, [PATH_RULES], true)).toEqual([]);
  });

  it("opens no network connection and starts no process", () => {
    expect(networkOrChildProcessImports(factsOf(WRITE_GUARD), WRITE_GUARD)).toEqual([]);
  });
});

describe("Path_Rules_File is the single source of the Shared_Path_Rules (R3.11)", () => {
  const importers = [
    "src/pipeline/intake/core/validator.ts",
    "src/pipeline/intake/core/safePath.ts",
    "src/pipeline/intake/shell/fsEntries.ts",
    "src/pipeline/intake/shell/gitEntries.ts",
    "src/pipeline/local/core/pushPlan.ts",
    WRITE_GUARD,
  ];

  it("lists the files it scans", () => {
    for (const path of importers) expect(existsSync(join(repoRoot, path)), path).toBe(true);
    expect(listFiles("src/pipeline/intake/core", /\.ts$/).length).toBeGreaterThan(0);
  });

  it.each(importers)("%s imports the Path_Rules_File", (file) => {
    const specs = factsOf(file).imports.flatMap((imp) => (imp.spec?.startsWith(".") ? [resolveSpec(file, imp.spec)] : []));
    expect(specs).toContain(PATH_RULES);
  });

  it("the Path_Rules_File imports nothing", () => {
    expect(factsOf(PATH_RULES).imports).toEqual([]);
  });

  it("no scanned file defines its own control-character pattern, forbidden segment list or allowed-path check", () => {
    const scanned = [...new Set([...listFiles("src/pipeline/intake/core", /\.ts$/), ...importers])];
    expect(scanned.flatMap((file) => ownPathRules(factsOf(file), file))).toEqual([]);
  });
});

describe("Context_Server is read-only (R6.4)", () => {
  it("imports no network or child-process module", () => {
    expect(networkOrChildProcessImports(factsOf(CONTEXT_SERVER), CONTEXT_SERVER)).toEqual([]);
  });

  it("calls no file system write, rename or delete function", () => {
    expect(fileSystemWrites(factsOf(CONTEXT_SERVER), CONTEXT_SERVER)).toEqual([]);
  });
});

describe("the command line comes only from prompt.ts and kiroArgs.ts (R8.1)", () => {
  const ALLOWED = ["src/pipeline/medium/core/prompt.ts", "src/pipeline/medium/core/kiroArgs.ts"];

  it("no other file under src/ or scripts/ holds the MEDIUM_PROMPT_PREFIX text or the literal --agent", () => {
    const files = [...listFiles("src", SOURCE_EXT), ...listFiles("scripts", SOURCE_EXT)].filter((f) => !ALLOWED.includes(f));
    expect(files.length).toBeGreaterThan(50);
    const violations: string[] = [];
    for (const file of files) {
      const facts = factsOf(file);
      for (const id of facts.identifiers) {
        if (id.detail === "MEDIUM_PROMPT_PREFIX") violations.push(`${file}:${id.line} references MEDIUM_PROMPT_PREFIX`);
      }
      for (const imp of facts.imports) {
        if (imp.names.includes("MEDIUM_PROMPT_PREFIX")) violations.push(`${file}:${imp.line} imports MEDIUM_PROMPT_PREFIX`);
      }
      for (const s of facts.strings) {
        if (s.value.includes(MEDIUM_PROMPT_PREFIX)) violations.push(`${file}:${s.line} holds the MEDIUM_PROMPT_PREFIX text`);
        if (s.value === "--agent" || s.value.startsWith("--agent=")) violations.push(`${file}:${s.line} holds the literal ${s.value}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("the two allowed files still hold them", () => {
    expect(factsOf(ALLOWED[0] as string).strings.some((s) => s.value.includes(MEDIUM_PROMPT_PREFIX))).toBe(true);
    expect(factsOf(ALLOWED[1] as string).strings.some((s) => s.value === "--agent")).toBe(true);
  });
});

describe("environment use (R11.3)", () => {
  it("reads no environment variable in the Context_Server and the Path_Rules_File", () => {
    for (const file of [CONTEXT_SERVER, PATH_RULES]) expect(environmentUses(factsOf(file), file, [])).toEqual([]);
  });

  it("reads only GUARD_LOG_FILE in the Write_Guard", () => {
    const facts = factsOf(WRITE_GUARD);
    expect(environmentUses(facts, WRITE_GUARD, ["GUARD_LOG_FILE"])).toEqual([]);
    expect(facts.envUses.map((use) => use.key)).toContain("GUARD_LOG_FILE");
  });
});

describe("agent files and the pipeline (R11.5, R13.5, R13.6, R13.7)", () => {
  it("scans every .mjs file of the Agent_Directory", () => {
    expect(agentFiles()).toEqual([CONTEXT_SERVER, PATH_RULES, WRITE_GUARD].sort());
  });

  it("no agent file imports an LLM client library (R11.5)", () => {
    expect(agentFiles().flatMap((file) => llmClientImports(factsOf(file), file))).toEqual([]);
  });

  it("no agent file, file of src/pipeline/medium/ or the Agent_Definition imports undertaker/ or gravedigger/ (R13.5)", () => {
    const files = listFiles("src/pipeline/medium", /\.(?:ts|mts|mjs)$/);
    expect(files.length).toBeGreaterThan(agentFiles().length);
    expect(files.flatMap((file) => forbiddenImportTargets(factsOf(file), file))).toEqual([]);
    const definition = ".kiro/agents/medium.json";
    expect(readRepo(definition), definition).not.toMatch(/(undertaker|gravedigger)\//);
  });

  it("only the Local_Runner receives the Gravedigger result on the Medium side (R13.6)", () => {
    const LOCAL_RUNNER = "src/pipeline/local/shell/resurrect.ts";
    const mediumSide = [...listFiles("src/pipeline/medium", /\.(?:ts|mts|mjs)$/), ...listFiles("src/pipeline/local", /\.ts$/)];
    const holders = mediumSide.filter((file) =>
      factsOf(file).identifiers.some((id) => id.detail === "GravediggerResult" || id.detail === "runGravedigger"),
    );
    expect(holders).toEqual([LOCAL_RUNNER]);
  });

  it("the Write_Guard and the Context_Server import only Node built-ins and Agent_Directory files (R13.7)", () => {
    const agentPaths = agentFiles();
    for (const file of [WRITE_GUARD, CONTEXT_SERVER]) {
      expect(foreignImports(factsOf(file), file, agentPaths, false), file).toEqual([]);
    }
  });

  it("package.json lists no dependency that the Write_Guard or the Context_Server import (R13.7)", () => {
    const pkg = JSON.parse(readRepo("package.json")) as { dependencies?: object; devDependencies?: object };
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const imported = [WRITE_GUARD, CONTEXT_SERVER].flatMap((file) =>
      factsOf(file).imports.flatMap((imp) => (imp.spec !== null && !imp.spec.startsWith(".") && !isBuiltin(imp.spec) ? [imp.spec] : [])),
    );
    expect(imported.filter((spec) => declared.has(spec))).toEqual([]);
    expect([...declared].filter((name) => /write-?guard|context-?server|path-?rules/i.test(name))).toEqual([]);
  });
});

describe("the scanners find what they look for", () => {
  const scan = (source: string): Facts => collectFacts(source, "fixture.mjs");

  it("network, child-process, write and LLM imports", () => {
    const facts = scan(
      'import { createServer } from "node:http";\nimport { spawn } from "child_process";\nimport { writeFileSync, rmSync } from "node:fs";\nimport OpenAI from "openai";\nfs.unlinkSync("x");\nawait fetch("u");',
    );
    expect(networkOrChildProcessImports(facts, "f").length).toBe(3);
    expect(fileSystemWrites(facts, "f").length).toBe(3);
    expect(llmClientImports(facts, "f")).toHaveLength(1);
  });

  it("foreign imports, dynamic imports and require", () => {
    const facts = scan('import a from "zod";\nimport b from "./other.mjs";\nconst c = require("tar");\nawait import(name);');
    expect(foreignImports(facts, "src/pipeline/medium/agent/x.mjs", [], false)).toHaveLength(4);
    expect(foreignImports(scan('import a from "fs";'), "f.mjs", [], true)).toHaveLength(1);
  });

  it("process.env uses, destructuring and aliases", () => {
    const facts = scan(
      'const a = process.env.GUARD_LOG_FILE;\nconst b = process.env["OTHER"];\nconst { env } = process;\nconst c = process.env;\nprocess.exit(0);',
    );
    expect(environmentUses(facts, "f", ["GUARD_LOG_FILE"])).toHaveLength(3);
    expect(environmentUses(scan("process.exit(0);"), "f", [])).toEqual([]);
  });

  it("own path rules", () => {
    const own = collectFacts(
      'const p = /[\\u0000-\\u001f]/;\nconst s = [".git", ".github"];\nfunction isAllowlisted(x) { return x.startsWith("resurrection/"); }\nconst msg = "needs resurrection/ first";',
      "f.ts",
    );
    expect(ownPathRules(own, "f").length).toBe(5);
    expect(ownPathRules(collectFacts('import { isAllowlisted } from "./pathRules.mjs";', "f.ts"), "f")).toEqual([]);
  });

  it("forbidden import targets name the file and the import", () => {
    const facts = collectFacts('import { x } from "../../undertaker/core/y";', "src/pipeline/medium/core/z.ts");
    expect(forbiddenImportTargets(facts, "src/pipeline/medium/core/z.ts")).toEqual([
      "src/pipeline/medium/core/z.ts:1 imports ../../undertaker/core/y (src/pipeline/undertaker/core/y)",
    ]);
  });

  it("comments are not code", () => {
    const facts = scan('// process.env.X and "--agent" and import "openai"\n/* fetch(x) */\nconst a = 1;');
    expect(environmentUses(facts, "f", [])).toEqual([]);
    expect(facts.strings).toEqual([]);
    expect(facts.imports).toEqual([]);
  });
});
