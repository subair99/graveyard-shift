// Requirements: 21.6
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The rule of scripts/trace.ts (parseCitations): a line that starts with `// Requirements: `.
const HEADER = /^\/\/ Requirements: (.*)$/;
const ROOT = resolve(import.meta.dirname, "..", "..", "..");

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("Requirements header (R21.6)", () => {
  it("every tests/pipeline/**/*.test.ts file has a non-empty `// Requirements:` header line", () => {
    const missing: string[] = [];
    for (const file of listTestFiles(join(ROOT, "tests", "pipeline"))) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      const ok = lines.some((line) => {
        const m = HEADER.exec(line);
        return m !== null && (m[1] ?? "").trim() !== "";
      });
      if (!ok) missing.push(relative(ROOT, file).split("\\").join("/"));
    }
    expect(missing).toEqual([]);
  });
});
