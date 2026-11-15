// Requirements: 16.2
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function rules(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const scopedDirs = ["src/proof/core", "src/proof/serialize", "src/proof/child/codec"];

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

describe("proof determinism lint scope", () => {
  for (const dir of scopedDirs) {
    describe(dir, () => {
      const probe = `${dir}/__lint_probe__.ts`;

      it("flags Date.now()", async () => {
        expect(await rules("export const a = Date.now();", probe)).toEqual(["no-restricted-properties"]);
      });

      it("flags Math.random()", async () => {
        expect(await rules("export const a = Math.random();", probe)).toEqual(["no-restricted-properties"]);
      });

      it("flags new Date() without arguments", async () => {
        expect(await rules("export const a = new Date();", probe)).toEqual(["no-restricted-syntax"]);
      });

      it("allows new Date(x)", async () => {
        expect(await rules("export const a = (x: string) => new Date(x);", probe)).toEqual([]);
      });

      it("reports nothing for the real files in the directory", async () => {
        for (const file of tsFiles(dir)) {
          expect(await rules(readFileSync(file, "utf8"), file), file).toEqual([]);
        }
      });
    });
  }

  it("does not apply to src/proof/child outside codec (stubs.ts)", async () => {
    expect(await rules("export const a = Date.now();", "src/proof/child/stubs.ts")).toEqual([]);
  });

  it("does not apply to other proof directories", async () => {
    expect(await rules("export const a = Math.random();", "src/proof/io/x.ts")).toEqual([]);
  });
});
