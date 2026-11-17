// Requirements: 2.6, 8.2, 8.3, 8.5
// Feature: medium-agent, Property 8: The Task_Prompt and argument list carry only the package name

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { supportedPackageNameProblem } from "../../../src/pipeline/common/packageNames";
import { buildKiroArgs } from "../../../src/pipeline/medium/core/kiroArgs";
import { MEDIUM_PROMPT_PREFIX, buildMediumPrompt } from "../../../src/pipeline/medium/core/prompt";
import { createKiroRunner, type SpawnFn, type SpawnedProcess } from "../../../src/pipeline/medium/shell/kiroRunner";

const NUM_RUNS = 100;

const NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789-._".split("");
const validNameArb = fc
  .array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: 30 })
  .map((chars) => chars.join(""))
  .filter((name) => supportedPackageNameProblem(name) === null);

const anyStringArb = fc.oneof(
  fc.string({ unit: "binary", maxLength: 40 }),
  fc.constantFrom("@scope/pkg", "safe-eval", "node-serialize", "", "UPPER", " x", "a b", ".x", "_x"),
);
const invalidNameArb = anyStringArb.filter((name) => supportedPackageNameProblem(name) !== null);

function isTrustFlag(arg: string): boolean {
  return arg === "--trust-all-tools" || arg.startsWith("--trust-tools") || arg.startsWith("--trust");
}

const FIXED_SUFFIX = buildMediumPrompt("a").slice(`${MEDIUM_PROMPT_PREFIX}a`.length);

describe("Property 8: The Task_Prompt and argument list carry only the package name", () => {
  it("builds prefix + name + fixed suffix and the exact seven-element list", () => {
    fc.assert(
      fc.property(validNameArb, (name) => {
        const prompt = buildMediumPrompt(name);
        expect(prompt).toBe(`${MEDIUM_PROMPT_PREFIX}${name}${FIXED_SUFFIX}`);
        const args = buildKiroArgs(name);
        expect(args).toEqual(["chat", "--v3", "--no-interactive", "--require-mcp-startup", "--agent", "medium", prompt]);
        expect(args.some(isTrustFlag)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("throws an error naming the problem for any unsupported name", () => {
    fc.assert(
      fc.property(invalidNameArb, (name) => {
        const problem = supportedPackageNameProblem(name);
        expect(problem).not.toBeNull();
        expect(() => buildMediumPrompt(name)).toThrow(problem as string);
        expect(() => buildKiroArgs(name)).toThrow(problem as string);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("passes the same trust-free argument list to spawn from createKiroRunner", async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (name) => {
        const calls: string[][] = [];
        const spawn: SpawnFn = (_command, args) => {
          calls.push(args);
          return {
            stdout: null,
            stderr: null,
            on(event: string, listener: (...a: never[]) => void) {
              if (event === "close") (listener as (code: number | null, signal: string | null) => void)(0, null);
              return this;
            },
          } as SpawnedProcess;
        };
        const runner = createKiroRunner({
          spawn,
          env: {},
          cwd: ".",
          added: { GRAVEYARD_CERTIFICATE_PATH: "/c.json", GUARD_LOG_FILE: "/g.log" },
          out: () => {},
          err: () => {},
        });
        await runner.run(name);
        expect(calls).toHaveLength(1);
        const passed = calls[0] ?? [];
        expect(passed).toEqual(buildKiroArgs(name));
        expect(passed.some(isTrustFlag)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
