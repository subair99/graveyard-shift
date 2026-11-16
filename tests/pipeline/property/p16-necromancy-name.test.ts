// Requirements: 10.5, 10.9
// Feature: resurrection-pipeline, Property 16: Necromancy name rule
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { checkNecromancy, NAME_SCOPE } from "../../../src/pipeline/necromancy/core/gate";

const nameArb = fc.oneof(
  fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,15}$/),
  fc.stringMatching(/^@[a-z0-9]{1,6}\/[a-z0-9._-]{1,10}$/),
  fc.string({ maxLength: 12 }),
);

function nameCheckOk(original: string, resurrection: string): boolean {
  const result = checkNecromancy({
    original: { name: original, version: "1.0.0", license: "MIT" },
    resurrection: { name: resurrection, version: "1.0.1", license: "MIT" },
    originalLicense: null,
    resurrectionLicense: null,
  });
  const checks = result.checks.filter((c) => c.id === "name");
  expect(checks).toHaveLength(1);
  return checks[0]!.ok;
}

describe("Property 16: Necromancy name rule", () => {
  it("passes iff the Resurrection name is @graveyard-shift/ + the Original name", () => {
    fc.assert(
      fc.property(nameArb, nameArb, fc.boolean(), (original, other, useExpected) => {
        const resurrection = useExpected ? `${NAME_SCOPE}${original}` : other;
        expect(nameCheckOk(original, resurrection)).toBe(resurrection === `${NAME_SCOPE}${original}`);
      }),
      { numRuns: 200 },
    );
  });

  it("fails for near-miss names", () => {
    fc.assert(
      fc.property(nameArb, (original) => {
        expect(nameCheckOk(original, original)).toBe(false);
        expect(nameCheckOk(original, `${NAME_SCOPE}${original}x`)).toBe(false);
        expect(nameCheckOk(original, `${NAME_SCOPE.toUpperCase()}${original}`)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
