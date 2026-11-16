// Requirements: 22.6
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SELF = resolve(import.meta.filename);
const SCAN_DIRS = ["src", "scripts", ".github"];
const SKIP_DIRS = new Set(["node_modules", "spike", "spikes", ".next"]);
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".ps1", ".sh"];

// Commands and settings that publish a package to a registry.
const PUBLISH_PATTERNS: readonly RegExp[] = [
  /\b(npm|pnpm|yarn)\s+publish\b/,
  /\bnpm\s+dist-tag\b/,
  /\bgh\s+release\s+create\b/,
  /\bregistry-url\b/,
  /\bNODE_AUTH_TOKEN\b/,
  /\buses:\s*\S*publish\S*/i,
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(full));
    } else if (entry.isFile() && EXTENSIONS.some((e) => entry.name.endsWith(e)) && resolve(full) !== SELF) {
      out.push(full);
    }
  }
  return out;
}

/** A comment-only line (`#`, `//`, `*`, `/*`) may name a forbidden command to forbid it. */
function isCommentLine(line: string): boolean {
  return /^\s*(#|\/\/|\*|\/\*)/.test(line);
}

describe("no npm publish (R22.6)", () => {
  it("src, scripts and .github contain no publish command or registry-publish setting", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listFiles(join(ROOT, dir))) {
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (isCommentLine(line)) return;
            if (PUBLISH_PATTERNS.some((p) => p.test(line))) {
              hits.push(`${relative(ROOT, file).split("\\").join("/")}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
