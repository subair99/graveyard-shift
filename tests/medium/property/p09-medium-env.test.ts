// Requirements: 11.1, 11.2, 11.6
// Feature: medium-agent, Property 9: The Medium_Environment is an allowlist

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MEDIUM_ADDED_KEYS,
  MEDIUM_ENV_KEYS,
  SECRET_KEY_PATTERN,
  buildMediumEnv,
} from "../../../src/pipeline/medium/core/mediumEnv";
import { createKiroRunner, type SpawnFn, type SpawnedProcess } from "../../../src/pipeline/medium/shell/kiroRunner";

const NUM_RUNS = 100;
const LINE_PREFIX = "Medium environment keys: ";

// Values carry a marker that cannot occur in the printed line text or in key names.
const valueArb = fc.option(fc.string({ maxLength: 20 }).map((s) => `\u0001VAL\u0001${s}`), { nil: undefined });

const keyNameArb = fc.oneof(
  fc.constantFrom(...MEDIUM_ENV_KEYS),
  fc.constantFrom(...MEDIUM_ENV_KEYS).map((k) => k.toLowerCase()),
  fc.constantFrom(...MEDIUM_ENV_KEYS).map((k) => k[0] + k.slice(1).toLowerCase()),
  fc.constantFrom(...MEDIUM_ENV_KEYS).map((k) => `${k}_TOKEN`),
  fc.constantFrom("GITHUB_TOKEN", "AWS_SECRET", "API_KEY", "api_key", "My_Secret", "x_token", "HOME_KEY"),
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,12}$/),
  fc
    .tuple(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/), fc.constantFrom("_TOKEN", "_KEY", "_SECRET", "_token", "_Key"))
    .map(([a, b]) => a + b),
);

const callerArb = fc
  .array(fc.tuple(keyNameArb, valueArb), { maxLength: 15 })
  .map((pairs) => {
    const caller: Record<string, string | undefined> = {};
    for (const [k, v] of pairs) {
      if (k === "__proto__") continue;
      caller[k] = v;
    }
    return caller;
  });

const addedArb = fc.record({
  GRAVEYARD_CERTIFICATE_PATH: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `/cert/${s}`),
  GUARD_LOG_FILE: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `/log/${s}`),
});

function expectedEnv(
  caller: Record<string, string | undefined>,
  added: Record<(typeof MEDIUM_ADDED_KEYS)[number], string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(caller)) {
    if (v === undefined) continue;
    if (!MEDIUM_ENV_KEYS.includes(k)) continue;
    if (SECRET_KEY_PATTERN.test(k)) continue;
    out[k] = v;
  }
  for (const k of MEDIUM_ADDED_KEYS) out[k] = added[k];
  return out;
}

async function printedLine(
  caller: Record<string, string | undefined>,
  added: { GRAVEYARD_CERTIFICATE_PATH: string; GUARD_LOG_FILE: string },
): Promise<{ line: string; spawnEnv: Record<string, string> }> {
  const errs: string[] = [];
  let spawnEnv: Record<string, string> = {};
  const spawn: SpawnFn = (_command, _args, options) => {
    spawnEnv = options.env;
    return {
      stdout: null,
      stderr: null,
      on(event: string, listener: (...a: never[]) => void) {
        if (event === "close") (listener as (code: number | null, signal: string | null) => void)(0, null);
        return this;
      },
    } as SpawnedProcess;
  };
  const runner = createKiroRunner({ spawn, env: caller, cwd: ".", added, out: () => {}, err: (t) => errs.push(t) });
  await runner.run("some-package");
  const lines = errs.filter((e) => e.startsWith(LINE_PREFIX));
  expect(lines).toHaveLength(1);
  return { line: lines[0] ?? "", spawnEnv };
}

describe("Property 9: The Medium_Environment is an allowlist", () => {
  it("returns exactly the allowed caller keys with unchanged values plus the two added keys", () => {
    fc.assert(
      fc.property(callerArb, addedArb, (caller, added) => {
        expect(buildMediumEnv(caller, added)).toEqual(expectedEnv(caller, added));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("prints exactly the key names, no value, and spawns with the same environment", async () => {
    await fc.assert(
      fc.asyncProperty(callerArb, addedArb, async (caller, added) => {
        const expected = expectedEnv(caller, added);
        const { line, spawnEnv } = await printedLine(caller, added);
        expect(spawnEnv).toEqual(expected);
        expect(line).toBe(`${LINE_PREFIX}${Object.keys(expected).sort().join(", ")}\n`);
        for (const value of Object.values(caller)) {
          if (value !== undefined) expect(line).not.toContain(value);
        }
        for (const value of Object.values(added)) expect(line).not.toContain(value);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
