import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function rules(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const corePath = "src/engine/core/__lint_sample__.ts";

describe("determinism lint rule", () => {
  it("flags Date.now() in core", async () => {
    expect(await rules("export const a = Date.now();", corePath)).toEqual(["no-restricted-properties"]);
  });

  it("flags Math.random() in core", async () => {
    expect(await rules("export const a = Math.random();", corePath)).toEqual(["no-restricted-properties"]);
  });

  it("flags new Date() without arguments in core", async () => {
    expect(await rules("export const a = new Date();", corePath)).toEqual(["no-restricted-syntax"]);
  });

  it("flags the same in serialize", async () => {
    expect(await rules("export const a = Date.now();", "src/engine/serialize/s.ts")).toEqual([
      "no-restricted-properties",
    ]);
  });

  it("allows new Date(x) in core", async () => {
    expect(await rules("export const a = (x: string) => new Date(x);", corePath)).toEqual([]);
  });

  it("parses TypeScript syntax (annotations, generics, as const, satisfies) without errors", async () => {
    const code = [
      "export const K = { a: 1 } as const;",
      "export function id<T extends object>(x: T): T { return x; }",
      "export interface P { readonly n: number }",
      "export const p: P = { n: 1 } satisfies P;",
    ].join("\n");
    expect(await rules(code, corePath)).toEqual([]);
  });

  it("parses .tsx files", async () => {
    expect(await rules("export const C = (p: { a: string }) => <div>{p.a}</div>;", "src/app/x.tsx")).toEqual([]);
  });

  it("does not apply outside core and serialize", async () => {
    expect(await rules("export const a = Date.now();", "src/engine/io/clock.ts")).toEqual([]);
  });
});
