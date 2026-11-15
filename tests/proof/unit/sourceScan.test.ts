/**
 * Source scan for src/proof (task 3.5, Requirements 13.25, 13.28, 16.2, 16.3).
 *
 * (a) No file under the pure directories references `process.env`. The
 *     environment snapshot is read only in `defaultProofDeps()` and passed in
 *     as an argument (R13.25).
 * (b) No file under src/proof except the allowed paths below uses `console`,
 *     `process.stdout` or `process.stderr`. `emit` is the single output path (R13.28).
 *
 * The scanner parses each file with @babel/parser (the parser behind the repo's
 * ESLint setup) and walks the AST. Comments and string contents are never
 * matched, because they are not code nodes. The scan passes while directories
 * are missing or empty, and covers every .ts/.mts/.cts/.tsx file recursively.
 *
 * Evasions handled: `process.env`, `process['env']`, a template literal key
 * without substitutions, `globalThis.process.env` (also `global`, `window`,
 * `self`), `const { env } = process`, nested destructuring from globalThis,
 * assignment destructuring, aliases (`const p = process`, `const c = console`,
 * `const o = process.stdout`), `import process from 'node:process'`,
 * `import { env, stdout } from 'node:process'`, `import 'node:console'`, and
 * `require('node:process')`. Type positions (`typeof process.env` in a type)
 * are ignored.
 *
 * Not handled (a human review must catch these): computed keys that are not
 * literals (`process[k]`), passing `process` or `console` through a function
 * argument, `eval`/`new Function`, `Reflect.get(process, 'env')`, dynamic
 * `import('node:process')`, `fs.writeSync(1, ...)`, `process.binding`, and
 * alias tracking is by name for the whole file (no scopes), so a shadowing
 * local variable named like an alias can produce a false positive.
 */
// Requirements: 1.6, 3.8, 13.25, 13.28, 16.1, 16.2, 16.3
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const proofRoot = join(repoRoot, "src", "proof");

/** Pure directories of the design (R13.25). */
const PURE_DIRS = ["src/proof/core", "src/proof/serialize", "src/proof/child/codec"];

/** The only file allowed to write output (R13.28). The default sink lives here. */
const EMIT_FILE = "src/proof/shell/emit.ts";

/**
 * Documented exception, not in the design text (flagged for the user, task 3.5):
 * the child runner writes its protocol messages to the child's own stdout and
 * replaces process.stdout.write, process.stderr.write and the console methods
 * with no-ops. That is the sandbox-side protocol channel, not an engine log
 * line or error message.
 */
const RUNNER_EXCEPTION = {
  file: "src/proof/child/runner.ts",
  reason: "sandbox-side protocol channel on the child's own stdout; not an engine log line or error message",
};

/**
 * Documented exception (task 17.5): the CLI hands the canonical report to the caller on standard
 * output, which `emit` (one line on standard error) does not offer. Its log lines and error messages
 * still go through `emit`, and the report text is checked by the Identity_Scanner before it is written.
 */
const CLI_EXCEPTION = {
  file: "src/proof/cli.ts",
  reason: "the CLI writes the canonical report to standard output; its messages still go through emit",
};

const OUTPUT_ALLOWED = [EMIT_FILE, RUNNER_EXCEPTION.file, CLI_EXCEPTION.file];

type Rule = "process-env" | "console-or-stdio" | "network" | "parse-error";
export interface Violation {
  file: string;
  line: number;
  rule: Rule;
  detail: string;
}

type Kind = "process" | "console" | "stream" | "env" | "global";
type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };

const GLOBAL_NAMES = new Set(["globalThis", "global", "window", "self"]);
const PROCESS_MODULES = new Set(["process", "node:process"]);
const CONSOLE_MODULES = new Set(["console", "node:console"]);
const TRANSPARENT = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);
const SKIP_KEYS = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeParameters",
  "superTypeArguments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "loc",
  "extra",
]);

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function memberKind(kind: Kind | null, key: string | null): Kind | null {
  if (kind === null || key === null) return null;
  if (kind === "global") {
    if (key === "process") return "process";
    if (key === "console") return "console";
    return GLOBAL_NAMES.has(key) ? "global" : null;
  }
  if (kind === "process") {
    if (key === "env") return "env";
    if (key === "stdout" || key === "stderr") return "stream";
    if (key === "process") return "process";
  }
  return null;
}

/** Name of a property when it is statically known, else null. */
function keyName(node: Node, computed: boolean): string | null {
  if (!computed) return node.type === "Identifier" ? (node.name as string) : null;
  if (node.type === "StringLiteral") return node.value as string;
  if (node.type === "TemplateLiteral") {
    const exprs = node.expressions as unknown[];
    const quasis = node.quasis as { value: { cooked?: string | null } }[];
    if (exprs.length === 0 && quasis.length === 1) return quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function requireTarget(node: Node): string | null {
  const callee = node.callee as Node | undefined;
  const args = node.arguments as Node[] | undefined;
  if (callee?.type !== "Identifier" || callee.name !== "require" || !args || args.length < 1) return null;
  const first = args[0];
  return first?.type === "StringLiteral" ? (first.value as string) : null;
}

class FileScan {
  readonly aliases = new Map<string, Kind>();
  readonly found: { line: number; rule: Rule; detail: string }[] = [];
  reporting = false;

  classify(node: Node | null | undefined): Kind | null {
    if (!node) return null;
    if (TRANSPARENT.has(node.type)) return this.classify(node.expression as Node);
    if (node.type === "Identifier") {
      const name = node.name as string;
      const alias = this.aliases.get(name);
      if (alias) return alias;
      if (name === "process") return "process";
      if (name === "console") return "console";
      return GLOBAL_NAMES.has(name) ? "global" : null;
    }
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const prop = node.property as Node;
      const key = keyName(prop, node.computed === true);
      return memberKind(this.classify(node.object as Node), key);
    }
    if (node.type === "CallExpression") {
      const target = requireTarget(node);
      if (target !== null && PROCESS_MODULES.has(target)) return "process";
      if (target !== null && CONSOLE_MODULES.has(target)) return "console";
    }
    return null;
  }

  report(node: Node, kind: Kind | null, detail: string): void {
    if (!this.reporting) return;
    const line = node.loc?.start.line ?? 0;
    if (kind === "env") this.found.push({ line, rule: "process-env", detail });
    else if (kind === "console" || kind === "stream") this.found.push({ line, rule: "console-or-stdio", detail });
  }

  /** Binds the names of a destructuring pattern whose source has kind `kind`. */
  bindPattern(pattern: Node | null | undefined, kind: Kind | null): void {
    if (!pattern) return;
    if (pattern.type === "AssignmentPattern") return this.bindPattern(pattern.left as Node, kind);
    if (pattern.type === "Identifier") {
      if (kind !== null) this.aliases.set(pattern.name as string, kind);
      return;
    }
    if (pattern.type !== "ObjectPattern") return;
    for (const prop of pattern.properties as Node[]) {
      if (prop.type !== "ObjectProperty") continue;
      const key = keyName(prop.key as Node, prop.computed === true);
      const sub = memberKind(kind, key);
      this.report(prop, sub, `destructuring of ${String(key)}`);
      this.bindPattern(prop.value as Node, sub);
    }
  }

  visitImport(node: Node): void {
    const source = (node.source as Node).value as string;
    if (CONSOLE_MODULES.has(source)) {
      this.report(node, "console", `import of ${source}`);
      return;
    }
    if (!PROCESS_MODULES.has(source)) return;
    for (const spec of node.specifiers as Node[]) {
      if (spec.type !== "ImportSpecifier") {
        this.bindPattern(spec.local as Node, "process");
        continue;
      }
      const imported = spec.imported as Node;
      const name = imported.type === "Identifier" ? (imported.name as string) : (imported.value as string);
      const kind = memberKind("process", name);
      this.report(spec, kind, `import of ${name} from ${source}`);
      this.bindPattern(spec.local as Node, kind);
    }
  }

  visit(node: Node): void {
    switch (node.type) {
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
      case "TSDeclareFunction":
      case "TSModuleDeclaration":
        return;
      case "ImportDeclaration":
        this.visitImport(node);
        return;
      case "VariableDeclarator": {
        const id = node.id as Node;
        const init = node.init as Node | null;
        this.bindPattern(id, this.classify(init));
        if (id.type !== "Identifier") this.walkChildren(id);
        if (init) this.visit(init);
        return;
      }
      case "AssignmentExpression": {
        const left = node.left as Node;
        if (node.operator === "=") {
          this.bindPattern(left, this.classify(node.right as Node));
        }
        if (left.type !== "Identifier") this.visit(left);
        this.visit(node.right as Node);
        return;
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        this.report(node, this.classify(node), "member access");
        break;
      }
      case "Identifier": {
        const kind = this.classify(node);
        if (kind === "console" || kind === "stream" || kind === "env") this.report(node, kind, `reference to ${String(node.name)}`);
        return;
      }
      case "CallExpression": {
        const target = requireTarget(node);
        if (target !== null && CONSOLE_MODULES.has(target)) this.report(node, "console", `require of ${target}`);
        break;
      }
      default:
    }
    this.walkChildren(node);
  }

  walkChildren(node: Node): void {
    const computed = node.computed === true;
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key)) continue;
      if (key === "property" && !computed && (node.type === "MemberExpression" || node.type === "OptionalMemberExpression")) continue;
      if (key === "key" && !computed && (node.type === "ObjectProperty" || node.type === "ObjectMethod" || node.type === "ClassMethod" || node.type === "ClassProperty")) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.visit(item);
      } else if (isNode(value)) {
        this.visit(value);
      }
    }
  }
}

/** Scans one source text. `rules` selects which checks apply. */
export function scanSource(
  source: string,
  file: string,
  rules: { processEnv: boolean; output: boolean },
): Violation[] {
  let ast: Node;
  try {
    const plugins: ("typescript" | "jsx")[] = file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
    ast = parse(source, { sourceType: "unambiguous", plugins, errorRecovery: false }) as unknown as Node;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [{ file, line: 0, rule: "parse-error", detail }];
  }
  const scan = new FileScan();
  // Pass 1 collects aliases (repeated so that chains of aliases resolve); pass 2 reports.
  for (let i = 0; i < 3; i += 1) scan.visit(ast);
  scan.reporting = true;
  scan.visit(ast);
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const f of scan.found) {
    const wanted = f.rule === "process-env" ? rules.processEnv : rules.output;
    const id = `${f.rule}:${f.line}`;
    if (!wanted || seen.has(id)) continue;
    seen.add(id);
    out.push({ file, line: f.line, rule: f.rule, detail: f.detail });
  }
  return out;
}

const SOURCE_EXT = /\.(?:ts|mts|cts|tsx)$/;

/** All source files under `dir`, recursively. A missing directory yields none. */
function listSourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) return [];
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries.sort()) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...listSourceFiles(full));
    else if (SOURCE_EXT.test(name)) files.push(full);
  }
  return files;
}

function repoPath(full: string): string {
  return relative(repoRoot, full).split(sep).join("/");
}

function inPureDir(path: string): boolean {
  return PURE_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/** Applies both rules to every file under src/proof. */
function scanProofTree(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const full of listSourceFiles(root)) {
    const path = repoPath(full);
    violations.push(
      ...scanSource(readFileSync(full, "utf8"), path, {
        processEnv: inPureDir(path),
        output: !OUTPUT_ALLOWED.includes(path),
      }),
    );
  }
  return violations;
}

/*
 * Network and `tar` import scans (Requirements 1.6, 16.1, 3.8).
 *
 * Network (R1.6, R16.1): no file under src/proof, the sandbox-side child included, imports a network
 * module or references a network global. The design (Offline, "Testing Strategy") allows no exception,
 * so NETWORK_EXCEPTIONS is empty. The tarball recorder lives in scripts/, outside src/proof, and
 * needs none. Strings and comments are not code nodes, so the sandboxExecutor probe text never matches.
 * Not handled: computed non-literal keys (`globalThis[k]`), `eval`, and passing a network module through a
 * function argument. A local binding named like a network global (`fetch`) is a false positive.
 *
 * `tar` (R3.8): only the Tarball_Extractor imports the `tar` package.
 */
const NETWORK_EXCEPTIONS: readonly { file: string; reason: string }[] = [];
const TAR_FILE = "src/proof/shell/tarball/tarballExtractor.ts";

const NETWORK_MODULES = new Set([
  "net", "http", "https", "http2", "dns", "dgram", "tls", "undici", "node-fetch", "axios",
]);
const NETWORK_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);

function specifierBase(spec: string, stripNodePrefix: boolean): string {
  const bare = stripNodePrefix && spec.startsWith("node:") ? spec.slice(5) : spec;
  return bare.split("/")[0] ?? bare;
}
const isNetworkModule = (spec: string): boolean => NETWORK_MODULES.has(specifierBase(spec, true));
const isTarModule = (spec: string): boolean => {
  const base = specifierBase(spec, false);
  return base === "tar" || base === "node-tar";
};

type Hit = { line: number; detail: string };

function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value as string;
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) {
    return (node.quasis as { value: { cooked?: string | null } }[])[0]?.value.cooked ?? null;
  }
  return null;
}

/** Module specifiers named by import/export-from/require/dynamic import, and network global references. */
function collectModulesAndGlobals(source: string, file: string): { modules: (Hit & { spec: string })[]; globals: Hit[] } | "parse-error" {
  let ast: Node;
  try {
    const plugins: ("typescript" | "jsx")[] = file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
    ast = parse(source, { sourceType: "unambiguous", plugins, errorRecovery: false }) as unknown as Node;
  } catch {
    return "parse-error";
  }
  const modules: (Hit & { spec: string })[] = [];
  const globals: Hit[] = [];
  const lineOf = (n: Node): number => n.loc?.start.line ?? 0;
  const addModule = (n: Node, spec: string | null): void => {
    if (spec !== null) modules.push({ line: lineOf(n), detail: spec, spec });
  };
  const addGlobal = (n: Node, name: string): void => {
    globals.push({ line: lineOf(n), detail: name });
  };
  const globalAliases = new Set<string>();
  const isGlobalObject = (n: Node | null | undefined): boolean =>
    !!n && n.type === "Identifier" && (GLOBAL_NAMES.has(n.name as string) || globalAliases.has(n.name as string));

  const walk = (node: Node, skipSelfAsKey: boolean): void => {
    switch (node.type) {
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
      case "TSDeclareFunction":
        return;
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        addModule(node, literalText(node.source as Node));
        return;
      case "ExportNamedDeclaration":
        if (node.source) addModule(node, literalText(node.source as Node));
        break;
      case "TSImportEqualsDeclaration": {
        const ref = node.moduleReference as Node;
        if (ref.type === "TSExternalModuleReference") addModule(node, literalText(ref.expression as Node));
        return;
      }
      case "CallExpression": {
        const callee = node.callee as Node;
        const first = (node.arguments as Node[])[0];
        if (callee.type === "Identifier" && callee.name === "require") addModule(node, literalText(first));
        if (callee.type === "Import") addModule(node, literalText(first));
        break;
      }
      case "ImportExpression":
        addModule(node, literalText(node.source as Node));
        break;
      case "VariableDeclarator": {
        const id = node.id as Node;
        const init = node.init as Node | null;
        if (id.type === "Identifier" && isGlobalObject(init)) globalAliases.add(id.name as string);
        if (id.type === "ObjectPattern" && isGlobalObject(init)) {
          for (const prop of id.properties as Node[]) {
            if (prop.type !== "ObjectProperty") continue;
            const key = keyName(prop.key as Node, prop.computed === true);
            if (key !== null && NETWORK_GLOBALS.has(key)) addGlobal(prop, key);
          }
        }
        break;
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const key = keyName(node.property as Node, node.computed === true);
        if (key !== null && NETWORK_GLOBALS.has(key) && isGlobalObject(node.object as Node)) addGlobal(node, key);
        break;
      }
      case "Identifier":
        if (!skipSelfAsKey && NETWORK_GLOBALS.has(node.name as string)) addGlobal(node, node.name as string);
        return;
      default:
    }
    const computed = node.computed === true;
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const memberProp = key === "property" && !computed && (node.type === "MemberExpression" || node.type === "OptionalMemberExpression");
      const objectKey = key === "key" && !computed && /^(ObjectProperty|ObjectMethod|ClassMethod|ClassProperty)$/.test(node.type);
      if (memberProp || objectKey) continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) walk(item, false);
      } else if (isNode(value)) {
        walk(value, false);
      }
    }
  };
  // Twice, so an alias declared after its use still resolves.
  walk(ast, false);
  globals.length = 0;
  modules.length = 0;
  walk(ast, false);
  return { modules, globals };
}

export function scanNetwork(source: string, file: string): Violation[] {
  const found = collectModulesAndGlobals(source, file);
  if (found === "parse-error") return [{ file, line: 0, rule: "parse-error", detail: "parse error" }];
  const out: Violation[] = [];
  for (const m of found.modules) if (isNetworkModule(m.spec)) out.push({ file, line: m.line, rule: "network", detail: `import of ${m.spec}` });
  for (const g of found.globals) out.push({ file, line: g.line, rule: "network", detail: `reference to ${g.detail}` });
  return out;
}

export function scanTar(source: string, file: string): { imports: boolean; parseError: boolean } {
  const found = collectModulesAndGlobals(source, file);
  if (found === "parse-error") return { imports: false, parseError: true };
  return { imports: found.modules.some((m) => isTarModule(m.spec)), parseError: false };
}

const proofFiles = (): string[] => listSourceFiles(proofRoot).map((full) => repoPath(full));
const isExcepted = (path: string): boolean => NETWORK_EXCEPTIONS.some((e) => e.file === path);

describe("network and tar import scans of src/proof", () => {
  it("no file under src/proof imports a network module or references a network global (R1.6, R16.1)", () => {
    const violations = proofFiles()
      .filter((path) => !isExcepted(path))
      .flatMap((path) => scanNetwork(readFileSync(join(repoRoot, path), "utf8"), path));
    expect(violations).toEqual([]);
  });

  it("the design allows no network exception", () => {
    expect(NETWORK_EXCEPTIONS).toEqual([]);
    expect(proofFiles().some((path) => path.startsWith("src/proof/child/"))).toBe(true);
  });

  it("only the Tarball_Extractor imports the tar package, and it does (R3.8)", () => {
    const files = proofFiles();
    expect(files).toContain(TAR_FILE);
    const importers = files.filter((path) => {
      const r = scanTar(readFileSync(join(repoRoot, path), "utf8"), path);
      expect(r.parseError).toBe(false);
      return r.imports;
    });
    expect(importers).toEqual([TAR_FILE]);
  });
});

describe("network and tar scanner negative tests", () => {
  const netRules = (source: string): string[] => scanNetwork(source, "probe.ts").map((v) => v.rule);

  it.each([
    "import net from 'node:net';",
    "import { request } from 'node:http';",
    "import https from 'https';",
    "import http2 from 'node:http2';",
    "import dns from 'node:dns';",
    "import { lookup } from 'dns/promises';",
    "import dgram from 'dgram';",
    "import tls from 'tls';",
    "import { fetch } from 'undici';",
    "import f from 'node-fetch';",
    "import axios from 'axios';",
    "export * from 'node:net';",
    "export { get } from 'http';",
    "const n = require('node:tls');",
    "const n = require(`axios`);",
    "const n = import('node:https');",
    "import n = require('net');",
  ])("flags a network module: %s", (source) => {
    expect(netRules(source)).toEqual(["network"]);
  });

  it.each([
    "fetch('x');",
    "globalThis.fetch('x');",
    "globalThis['fetch']('x');",
    "const f = fetch;",
    "const { fetch } = globalThis;",
    "const g = globalThis;\nconst { fetch: f } = g;",
    "const h = global;\nh.fetch('x');",
    "new XMLHttpRequest();",
    "new WebSocket('ws://x');",
    "new EventSource('x');",
  ])("flags a network global: %s", (source) => {
    expect(netRules(source)).toContain("network");
  });

  it("ignores comments, strings, other modules and unrelated members", () => {
    const source = [
      "// import http from 'node:http'; fetch('x')",
      "const probe = \"import net from 'node:net'; fetch(1)\";",
      "const t = `require('http')`;",
      "import path from 'node:path';",
      "import { Parser } from 'tar';",
      "const o = { fetch: 1, WebSocket: 2 };",
      "const x = o.fetch + o.WebSocket;",
      "const n = require(name);",
      "type F = typeof fetch;",
    ].join("\n");
    expect(netRules(source)).toEqual([]);
  });

  it("flags tar specifiers outside the extractor and ignores node:path", () => {
    for (const s of ["import * as tar from 'tar';", "import { x } from 'tar/dist/y';", "const t = require('node-tar');", "import('tar');"]) {
      expect(scanTar(s, "src/proof/shell/other.ts").imports).toBe(true);
    }
    expect(scanTar("import path from 'node:path';\nconst s = 'tar';", "src/proof/shell/other.ts").imports).toBe(false);
  });
});

const pure = { processEnv: true, output: false };
const output = { processEnv: false, output: true };
const rulesOf = (source: string, rules: { processEnv: boolean; output: boolean }): string[] =>
  scanSource(source, "probe.ts", rules).map((v) => v.rule);

describe("source scan of src/proof", () => {
  it("(a) no pure directory file references process.env (R13.25)", () => {
    const found = PURE_DIRS.flatMap((dir) => scanProofTree(join(repoRoot, dir)))
      .filter((v) => v.rule !== "console-or-stdio");
    expect(found).toEqual([]);
  });

  it("(b) no file under src/proof outside emit.ts and the runner uses console or stdio (R13.28)", () => {
    expect(scanProofTree(proofRoot)).toEqual([]);
  });

  it("states the documented exceptions and their reasons", () => {
    expect(OUTPUT_ALLOWED).toEqual([EMIT_FILE, "src/proof/child/runner.ts", "src/proof/cli.ts"]);
    expect(RUNNER_EXCEPTION.reason).toContain("protocol channel");
    expect(CLI_EXCEPTION.reason).toContain("standard output");
  });

  it("passes when a directory is missing or empty", () => {
    expect(scanProofTree(join(repoRoot, "src", "proof", "does-not-exist"))).toEqual([]);
    expect(listSourceFiles(join(repoRoot, "src", "proof", "does-not-exist"))).toEqual([]);
  });
});

describe("scanner negative tests", () => {
  it("reports process.env in a pure directory probe", () => {
    const found = scanSource("export const f = () => process.env.HOME;", "src/proof/core/x.ts", pure);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "process-env", line: 1, file: "src/proof/core/x.ts" });
  });

  it("reports console.log in another file probe", () => {
    const found = scanSource("export function g() {\n  console.log('x');\n}", "src/proof/shell/other.ts", output);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "console-or-stdio", line: 2 });
  });

  it.each([
    ["bracket access", "const a = process['env'];"],
    ["template key", "const a = process[`env`];"],
    ["optional chain", "const a = process?.env?.HOME;"],
    ["destructuring", "const { env } = process;"],
    ["renamed destructuring with default", "const { env: e = {} } = process;"],
    ["globalThis", "const a = globalThis.process.env;"],
    ["global bracket", "const a = global['process']['env'];"],
    ["nested destructuring", "const { process: { env } } = globalThis;"],
    ["alias", "const p = process;\nconst a = p.env;"],
    ["alias chain", "const q = p;\nconst p = process;\nconst a = q.env;"],
    ["assignment destructuring", "let env;\n({ env } = process);"],
    ["TS cast", "const a = (process as NodeJS.Process).env;"],
    ["default import", "import proc from 'node:process';\nconst a = proc.env;"],
    ["named import", "import { env } from 'process';"],
    ["require", "const a = require('node:process').env;"],
  ])("finds process.env: %s", (_name, source) => {
    expect(rulesOf(source, pure)).toContain("process-env");
  });

  it.each([
    ["console.log", "console.log('x');"],
    ["console bracket", "console['error']('x');"],
    ["alias", "const c = console;\nc.log('x');"],
    ["destructuring", "const { log } = console;"],
    ["globalThis console", "globalThis.console.warn('x');"],
    ["process.stdout.write", "process.stdout.write('x');"],
    ["process.stderr bracket", "process['stderr'].write('x');"],
    ["stream alias", "const o = process.stdout;\no.write('x');"],
    ["stream destructuring", "const { stdout } = process;"],
    ["process alias", "const p = process;\np.stderr.write('x');"],
    ["named import", "import { stdout } from 'node:process';"],
    ["console module import", "import { Console } from 'node:console';"],
    ["console require", "const k = require('console');"],
  ])("finds console or stdio use: %s", (_name, source) => {
    expect(rulesOf(source, output)).toContain("console-or-stdio");
  });

  it("ignores comments, strings, type positions, and unrelated members", () => {
    const source = [
      "// process.env and console.log in a comment",
      "/* process.stdout.write('x') */",
      "const s = 'process.env console.log process.stdout';",
      "const t = `console.log ${1}`;",
      "type E = typeof process.env;",
      "interface I { env: typeof process.env }",
      "const o = { console: 1, env: 2 };",
      "const x = o.console + o.env;",
      "const logger = { log(m: string) { return m; } };",
      "logger.log('x');",
    ].join("\n");
    expect(scanSource(source, "probe.ts", { processEnv: true, output: true })).toEqual([]);
  });

  it("applies only the selected rule", () => {
    expect(rulesOf("process.env.X; console.log(1);", pure)).toEqual(["process-env"]);
    expect(rulesOf("process.env.X; console.log(1);", output)).toEqual(["console-or-stdio"]);
  });

  it("reports a parse error instead of passing silently", () => {
    expect(rulesOf("const = ;", pure)).toEqual(["parse-error"]);
  });
});
