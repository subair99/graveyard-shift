/**
 * Source scans of the Crypt UI (crypt-ui task 7.4): src/ui/**, src/app/**, scripts/ui/**.
 * Every file is parsed with @babel/parser and only code nodes are read, so comments never match.
 * Not handled (a human review must catch these): computed non-literal property keys, aliasing a banned
 * global through a variable, and a local variable named like a scanned name (false positive).
 */
// Requirements: 1.3, 1.5, 2.1, 5.5, 7.1, 7.6, 7.7, 8.7, 10.6, 11.2, 11.3
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..", "..", "..");
const ROOTS = ["src/ui", "src/app", "scripts/ui"];
const CODE = /\.(ts|tsx|mjs)$/;

type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown };
interface Hit {
  line: number;
  detail: string;
}
interface Facts {
  imports: (Hit & { spec: string })[];
  names: Hit[]; // every Identifier / JSXIdentifier name
  jsxAttrs: Hit[];
  texts: Hit[]; // string literals, template pieces, JSX text, directives
  directives: Hit[];
  members: Hit[]; // object.property
  newOf: Hit[]; // new X(...) with the argument count in detail "X/n"
}

const SKIP = new Set(["loc", "extra", "leadingComments", "trailingComments", "innerComments", "comments"]);
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

export function collectFacts(source: string, file: string): Facts {
  let ast: Node;
  try {
    ast = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx"], errorRecovery: false }) as unknown as Node;
  } catch (e) {
    throw new Error(`${file}: cannot parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  const f: Facts = { imports: [], names: [], jsxAttrs: [], texts: [], directives: [], members: [], newOf: [] };
  const lit = (n: Node | undefined): string | null => (n !== undefined && n.type === "StringLiteral" ? (n.value as string) : null);
  const visit = (n: Node): void => {
    const line = n.loc?.start.line ?? 0;
    switch (n.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        f.imports.push({ line, detail: "import", spec: lit(n.source as Node) ?? "" });
        break;
      case "ExportNamedDeclaration":
        if (n.source) f.imports.push({ line, detail: "export from", spec: lit(n.source as Node) ?? "" });
        break;
      case "ImportExpression":
        f.imports.push({ line, detail: "dynamic import", spec: lit(n.source as Node) ?? "(computed)" });
        break;
      case "CallExpression": {
        const c = n.callee as Node;
        const a0 = (n.arguments as Node[])[0];
        if (c.type === "Import") f.imports.push({ line, detail: "dynamic import", spec: lit(a0) ?? "(computed)" });
        if (c.type === "Identifier" && c.name === "require") f.imports.push({ line, detail: "require", spec: lit(a0) ?? "(computed)" });
        break;
      }
      case "Identifier":
      case "JSXIdentifier":
        f.names.push({ line, detail: n.name as string });
        break;
      case "JSXAttribute": {
        const nm = n.name as Node;
        f.jsxAttrs.push({ line, detail: nm.type === "JSXIdentifier" ? (nm.name as string) : "(namespaced)" });
        break;
      }
      case "StringLiteral":
        f.texts.push({ line, detail: n.value as string });
        break;
      case "TemplateElement":
        f.texts.push({ line, detail: String((n.value as { cooked?: string | null }).cooked ?? "") });
        break;
      case "JSXText":
        f.texts.push({ line, detail: n.value as string });
        break;
      case "Directive":
        f.directives.push({ line, detail: String(((n.value as Node).value as string) ?? "") });
        break;
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const o = n.object as Node;
        const p = n.property as Node;
        const pn = n.computed ? lit(p) : p.type === "Identifier" ? (p.name as string) : null;
        if (o.type === "Identifier" && pn !== null) f.members.push({ line, detail: `${o.name as string}.${pn}` });
        break;
      }
      case "NewExpression": {
        const c = n.callee as Node;
        if (c.type === "Identifier") f.newOf.push({ line, detail: `${c.name as string}/${(n.arguments as unknown[]).length}` });
        break;
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (SKIP.has(k)) continue;
      if (Array.isArray(v)) v.forEach((x) => isNode(x) && visit(x));
      else if (isNode(v)) visit(v);
    }
  };
  visit(ast);
  return f;
}

function walk(dir: string): string[] {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return CODE.test(e.name) ? [rel] : [];
  });
}

const FILES = ROOTS.flatMap(walk).sort();
const FACTS = new Map(FILES.map((f) => [f, collectFacts(readFileSync(join(repoRoot, f), "utf8"), f)]));
const facts = (f: string): Facts => FACTS.get(f)!;
const where = (f: string, h: Hit): string => `${f}:${h.line} ${h.detail}`;

/** Problems of a predicate over every file, as `file:line detail` lines. */
function scan(pick: (f: Facts, file: string) => Hit[]): string[] {
  return FILES.flatMap((file) => pick(facts(file), file).map((h) => where(file, h)));
}

/** Resolved repository path of an import specifier (no extension handling), or null for a package. */
function localTarget(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return relative(repoRoot, resolve(repoRoot, dirname(file), spec)).split(sep).join("/");
}

const SINK_NAMES = new Set(["dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "eval", "Function"]);
const NETWORK_NAMES = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]);
const STORAGE_NAMES = new Set(["localStorage", "sessionStorage"]);

// The only external URL prefix in code: the link builders of src/ui/core/site.ts.
const URL_ALLOWED: Record<string, string[]> = { "src/ui/core/site.ts": ["https://github.com/"] };

// Named exception: exactly this literal in exactly this file. It is the local preview address that
// scripts/ui/startNotice.mjs prints to standard error; it is never fetched (no network use).
const ALLOWED_URL_LITERALS: Record<string, string[]> = {
  "scripts/ui/startNotice.mjs": ["http://localhost:3000/graveyard-shift/"],
};

// Pipeline, engine and proof modules that the Site may import (design Component 2 and 4; Requirement 11.2, 11.3).
const ALLOWED_OUTSIDE = new Set([
  "src/engine/serialize/deserialize",
  "src/engine/types",
  "src/pipeline/common/constants",
  "src/pipeline/common/packageNames",
  "src/pipeline/common/result",
  "src/pipeline/gravedigger/core/eligibility",
  "src/pipeline/harness/core/deltas",
  "src/pipeline/harness/core/harnessFile",
  "src/pipeline/local/core/ledger",
  "src/pipeline/undertaker/core/layout",
  "src/pipeline/undertaker/core/nightlyClassify",
  "src/pipeline/undertaker/core/nightlyReport",
  "src/pipeline/undertaker/core/verifyCommands",
  "src/proof/serialize/deserialize",
  "src/proof/types",
  "src/proof/shell/tarball/tarballExtractor",
]);
// Named exceptions for the identifier `process`: exactly these members in exactly these scripts.
// Only writeNightlyRun.mjs may read process.env (Requirement 1.5).
const PROCESS_ALLOWED: Record<string, string[]> = {
  "scripts/ui/checkSite.mjs": ["process.argv", "process.cwd", "process.stdout", "process.stderr", "process.exitCode"],
  "scripts/ui/copyEntryFiles.ts": ["process.cwd", "process.stdout", "process.stderr", "process.exitCode"],
  "scripts/ui/startNotice.mjs": ["process.stderr", "process.exitCode"],
  "scripts/ui/writeNightlyRun.mjs": ["process.argv", "process.cwd", "process.env", "process.stdout", "process.exitCode"],
};

/**
 * Every use of the name `process` must be a `process.<member>` access of an allowed member of that file.
 * A bare use (destructuring, aliasing, passing it on) leaves more names than allowed member accesses.
 */
function processProblems(f: Facts, file: string): Hit[] {
  const names = f.names.filter((h) => h.detail === "process");
  if (names.length === 0) return [];
  const allowed = PROCESS_ALLOWED[file] ?? [];
  const members = f.members.filter((h) => h.detail.startsWith("process."));
  const bad = members.filter((h) => !allowed.includes(h.detail));
  const bare = names.length === members.length ? [] : names.slice(members.length).map((h) => ({ line: h.line, detail: "process (bare use)" }));
  return [...bad, ...bare];
}

const ALLOWED_PACKAGES = (spec: string): boolean => /^(react|react-dom|next|zod|semver)(\/|$)/.test(spec);

describe("Crypt UI source scans", () => {
  it("finds the source files", () => {
    expect(FILES.some((f) => f.startsWith("src/ui/core/"))).toBe(true);
    expect(FILES.some((f) => f.startsWith("src/ui/components/"))).toBe(true);
    expect(FILES.some((f) => f.startsWith("src/app/"))).toBe(true);
  });

  it("detects what it scans for (scanner self-check)", () => {
    const f = collectFacts(
      `"use client"; import x from "tar"; const a = <div dangerouslySetInnerHTML={{__html: y}} style={s} target="_blank">http://x.test</div>; document.cookie; fetch(u); new Date(); // eval`,
      "x.tsx",
    );
    expect(f.directives.map((h) => h.detail)).toEqual(["use client"]);
    expect(f.imports.map((h) => h.spec)).toEqual(["tar"]);
    expect(f.jsxAttrs.map((h) => h.detail)).toEqual(expect.arrayContaining(["dangerouslySetInnerHTML", "style", "target"]));
    expect(f.members.map((h) => h.detail)).toContain("document.cookie");
    expect(f.names.map((h) => h.detail)).toContain("fetch");
    expect(f.names.map((h) => h.detail)).not.toContain("eval");
    expect(f.newOf.map((h) => h.detail)).toContain("Date/0");
    expect(f.texts.map((h) => h.detail)).toContain("http://x.test");
  });

  it("has no HTML sink, eval or Function constructor (7.1)", () => {
    expect(scan((f) => f.names.filter((h) => SINK_NAMES.has(h.detail)))).toEqual([]);
    expect(scan((f) => f.members.filter((h) => /^document\.(write|writeln)$/.test(h.detail)))).toEqual([]);
  });

  it("has no 'use client' directive and no client hook or handler (server components only)", () => {
    expect(scan((f) => f.directives.filter((h) => /use (client|server)/.test(h.detail)))).toEqual([]);
    expect(scan((f) => f.names.filter((h) => /^use[A-Z]/.test(h.detail) && h.detail !== "use"))).toEqual([]);
    expect(scan((f) => f.jsxAttrs.filter((h) => /^on[A-Z]/.test(h.detail)))).toEqual([]);
  });

  it("makes no network call and uses no cookie or storage (1.3)", () => {
    expect(scan((f) => f.names.filter((h) => NETWORK_NAMES.has(h.detail) || STORAGE_NAMES.has(h.detail)))).toEqual([]);
    expect(scan((f) => f.members.filter((h) => h.detail === "document.cookie"))).toEqual([]);
  });

  it("has no style or target attribute and no style element (7.6, 7.7, 8.7)", () => {
    expect(scan((f) => f.jsxAttrs.filter((h) => h.detail === "style" || h.detail === "target"))).toEqual([]);
    expect(scan((f) => f.names.filter((h) => h.detail === "style"))).toEqual([]);
  });

  it("catches `const { env } = process` (scanner self-check for the process rule)", () => {
    const f = collectFacts(`const { env } = process; const a = process.argv;`, "x.ts");
    expect(f.names.filter((h) => h.detail === "process")).toHaveLength(2);
    expect(f.members.filter((h) => /^process\./.test(h.detail))).toHaveLength(1);
    expect(processProblems(f, "src/ui/shell/x.ts")).toHaveLength(2);
    expect(processProblems(f, "scripts/ui/startNotice.mjs")).toHaveLength(2);
  });

  it("uses the identifier `process` nowhere in src/ui and src/app, and only the named members in scripts/ui (1.5)", () => {
    expect(scan((f, file) => processProblems(f, file))).toEqual([]);
  });

  it("has no external http(s) URL literal except the link-builder constants (1.3, 7.4)", () => {
    const hits = scan((f, file) =>
      f.texts.filter((h) => {
        if (!/https?:\/\/|(^|[\s"'(=])\/\/[A-Za-z]/i.test(h.detail)) return false;
        if ((ALLOWED_URL_LITERALS[file] ?? []).includes(h.detail)) return false;
        return !(URL_ALLOWED[file] ?? []).some((prefix) => h.detail.startsWith(prefix));
      }),
    );
    expect(hits).toEqual([]);
  });

  it("imports `tar` nowhere and `extractTarball` only in tarballVersion.ts (2.1)", () => {
    expect(scan((f) => f.imports.filter((h) => h.spec === "tar" || h.spec.startsWith("tar/") || h.spec === "node:tar"))).toEqual([]);
    const importers = FILES.filter((file) => facts(file).names.some((h) => h.detail === "extractTarball"));
    expect(importers).toEqual(["src/ui/shell/tarballVersion.ts"]);
    expect(scan((f) => f.imports.filter((h) => /tarballExtractor$/.test(h.spec))).map((s) => s.split(":")[0])).toEqual([
      "src/ui/shell/tarballVersion.ts",
    ]);
  });

  it("writes the `gh attestation verify` text nowhere (only verifyCommands builds it) (5.5)", () => {
    expect(scan((f) => f.texts.filter((h) => /attestation\s+verify/.test(h.detail)))).toEqual([]);
  });

  it("has no z.object in src/ui/shell (the schemas live next to their types)", () => {
    const hits = scan((f, file) => (file.startsWith("src/ui/shell/") ? f.members.filter((h) => /^z\.(object|strictObject)$/.test(h.detail)) : []));
    expect(hits).toEqual([]);
  });

  it("keeps src/ui/core pure: no shell, component or app import, no node: module, no clock, randomness or process (10.6, 11.2)", () => {
    const core = FILES.filter((f) => f.startsWith("src/ui/core/"));
    expect(core.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const file of core) {
      const f = facts(file);
      for (const h of f.imports) {
        const t = localTarget(file, h.spec);
        if (h.spec.startsWith("node:") || isBuiltin(h.spec)) bad.push(`${where(file, h)} (node module)`);
        else if (t !== null && /^(src\/ui\/(shell|components)|src\/app|scripts)(\/|$)/.test(t)) bad.push(`${where(file, h)} (impure import)`);
      }
      for (const h of f.members) if (/^(Date\.now|Math\.random|performance\.now|crypto\.[a-zA-Z]+|process\.[a-zA-Z]+)$/.test(h.detail)) bad.push(where(file, h));
      for (const h of f.newOf) if (h.detail === "Date/0") bad.push(where(file, h));
      for (const h of f.names) if (h.detail === "process" || h.detail === "performance") bad.push(where(file, h));
    }
    expect(bad).toEqual([]);
  });

  it("imports only allowed modules (11.2, 11.3)", () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const h of facts(file).imports) {
        if (h.spec === "(computed)" || h.spec === "") {
          bad.push(`${where(file, h)} (computed import)`);
          continue;
        }
        const t = localTarget(file, h.spec);
        if (t === null) {
          if (h.spec.startsWith("node:") || isBuiltin(h.spec)) {
            if (file.startsWith("src/ui/shell/") || file.startsWith("scripts/ui/")) continue;
            bad.push(`${where(file, h)} (node module outside shell)`);
          } else if (!ALLOWED_PACKAGES(h.spec)) bad.push(`${where(file, h)} (package)`);
          continue;
        }
        if (/\.css$/.test(t)) continue;
        if (/^src\/ui\//.test(t)) continue;
        if (file.startsWith("src/app/") && /^src\/app\//.test(t)) continue;
        if (/^src\/pipeline\/medium\//.test(t)) bad.push(`${where(file, h)} (medium)`);
        else if (!ALLOWED_OUTSIDE.has(t) && !(file.startsWith("scripts/ui/") && /^scripts\/ui\//.test(t))) bad.push(`${where(file, h)} (not allowed: ${t})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps the .mjs scripts of scripts/ui dependency-free: node: imports only", () => {
    const bad = scan((f, file) => (file.startsWith("scripts/ui/") && file.endsWith(".mjs") ? f.imports.filter((h) => !(h.spec.startsWith("node:") || h.spec.startsWith("./"))) : []));
    expect(bad).toEqual([]);
  });
});
