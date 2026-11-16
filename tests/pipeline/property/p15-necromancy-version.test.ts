// Requirements: 10.4, 10.9
// Feature: resurrection-pipeline, Property 15: Necromancy version rule
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { checkNecromancy } from "../../../src/pipeline/necromancy/core/gate";

interface Parts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string | null;
}

// Small ranges make equal, lower, higher and same-major cases frequent.
const partsArb: fc.Arbitrary<Parts> = fc.record({
  major: fc.integer({ min: 0, max: 3 }),
  minor: fc.integer({ min: 0, max: 3 }),
  patch: fc.integer({ min: 0, max: 3 }),
  pre: fc.option(fc.constantFrom("alpha", "beta.1", "rc.2", "0"), { nil: null }),
});

const render = (p: Parts): string =>
  `${p.major}.${p.minor}.${p.patch}${p.pre === null ? "" : `-${p.pre}`}`;

// Precedence of the numeric triple; a prerelease never passes, so it needs no ordering here.
function triple(p: Parts): readonly [number, number, number] {
  return [p.major, p.minor, p.patch];
}

function greater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return false;
}

function versionCheck(original: string, resurrection: string) {
  const result = checkNecromancy({
    original: { name: "pkg", version: original },
    resurrection: { name: "@graveyard-shift/pkg", version: resurrection },
    originalLicense: null,
    resurrectionLicense: null,
  });
  const found = result.checks.filter((c) => c.id === "version");
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("Property 15: Necromancy version rule", () => {
  it("passes iff the version is greater, has the same major and has no prerelease", () => {
    fc.assert(
      fc.property(partsArb, partsArb, (o, r) => {
        // An original prerelease is outside the rule's domain: the original is a release.
        const original: Parts = { ...o, pre: null };
        const expected =
          r.pre === null && r.major === original.major && greater(triple(r), triple(original));
        const check = versionCheck(render(original), render(r));
        expect(check.ok).toBe(expected);
        expect(check.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });
});
