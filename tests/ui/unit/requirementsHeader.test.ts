// Requirements: 10.7
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const UI_TESTS = resolve(__dirname, "..");

function listTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTests(full));
    else if (entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("tests/ui requirement headers", () => {
  it("every test file has a // Requirements: line before any code", () => {
    const files = listTests(UI_TESTS);
    expect(files.length).toBeGreaterThan(0);
    const missing = files.filter((file) => {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("// Requirements:")) return false;
        if (t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) continue;
        return true; // code reached first
      }
      return true;
    });
    expect(missing).toEqual([]);
  });
});
