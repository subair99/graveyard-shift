// Requirements: 1.6
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function rules(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("pipeline determinism lint scope", () => {
  const probe = "src/pipeline/gravedigger/core/__lint_probe__.ts";

  it("flags Date.now() in a pipeline core file", async () => {
    expect(await rules("export const a = Date.now();", probe)).toEqual(["no-restricted-properties"]);
  });

  it("flags Math.random() in a pipeline core file", async () => {
    expect(await rules("export const a = Math.random();", probe)).toEqual(["no-restricted-properties"]);
  });

  it("flags new Date() without arguments in harness/core", async () => {
    expect(await rules("export const a = new Date();", "src/pipeline/harness/core/presets/x.ts")).toEqual([
      "no-restricted-syntax",
    ]);
  });

  it("does not apply to shell files", async () => {
    expect(await rules("export const a = Date.now();", "src/pipeline/common/shell/system.ts")).toEqual([]);
  });

  it("reports nothing for the real core files", async () => {
    const files = ["src/pipeline"].flatMap((d) => tsFiles(d)).filter((f) => /[\\/]core[\\/]/.test(f));
    for (const file of files) {
      expect(await rules(readFileSync(file, "utf8"), file), file).toEqual([]);
    }
  });
});
