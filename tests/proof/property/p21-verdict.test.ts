import { describe, expect, it } from 'vitest';
import { computeVerdict, type RunFacts } from '../../../src/proof/core/verdict';
import { HarnessErrorKindSchema } from '../../../src/proof/types';
import { fc, fcParams } from '../../engine/helpers/fc';
import {
  allHarnessErrorKinds,
  divergenceArb,
  makeCount,
  makeDelta,
  makeHarnessError,
  runFactsArb,
  shuffleBy,
} from '../helpers/runFactsArb';

/** Independent oracle: not derived from verdict.ts. */
function lacksEvidence(facts: RunFacts, fn: string): boolean {
  const entries = facts.unencodable.filter((u) => u.function === fn);
  return entries.some((u) => u.cases === 0 || u.casesWithUnencodable === u.cases);
}

function oracleAlive(f: RunFacts): boolean {
  return (
    f.harnessErrors.length === 0 &&
    f.divergences.length === 0 &&
    f.deltas.every((d) => d.status === 'demonstrated') &&
    f.nonDeterministic.length === 0 &&
    f.functionsTested.length >= 1 &&
    f.functionsTested.every((fn) => !lacksEvidence(f, fn))
  );
}

const hasRestlessCause = (f: RunFacts): boolean =>
  f.divergences.length > 0 || f.deltas.some((d) => d.status === 'not-demonstrated');

const kindAlt = allHarnessErrorKinds.join('|');
const reasonPattern = new RegExp(
  `^(harness-error:(${kindAlt})|no-functions-tested|divergence:(unexplained|delta-violation|api-surface):.+|delta-not-demonstrated:.+|non-deterministic:.+|lacking-evidence:.+)$`,
);

/** Remove every problem so that the run must be alive. */
function cleaned(f: RunFacts): RunFacts {
  const tested = f.functionsTested.length > 0 ? f.functionsTested : ['f0'];
  return {
    harnessErrors: [],
    divergences: [],
    deltas: f.deltas.map((d) => makeDelta(d.id, 'demonstrated')),
    nonDeterministic: [],
    functionsTested: tested,
    unencodable: tested.map((fn) => makeCount(fn, 3, 0)),
  };
}

const cleanArb = runFactsArb.map(cleaned);

// Feature: proof-of-life-engine, Property 21: Verdict
// **Validates: Requirements 9.4, 10.4, 11.6, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7**
describe('Feature: proof-of-life-engine, Property 21: Verdict', () => {
  it('covers the full HarnessErrorKind set', () => {
    expect(allHarnessErrorKinds).toEqual(HarnessErrorKindSchema.options);
    expect(allHarnessErrorKinds.length).toBeGreaterThan(0);
  });

  it('alive exactly when no problem exists (oracle)', () => {
    fc.assert(
      fc.property(runFactsArb, (f) => {
        const r = computeVerdict(f);
        expect(r.verdict === 'alive').toBe(oracleAlive(f));
      }),
      fcParams(),
    );
  });

  it('any harness error gives inconclusive, never alive or restless, and lists the error', () => {
    fc.assert(
      fc.property(runFactsArb, fc.constantFrom(...allHarnessErrorKinds), (f, kind) => {
        const g = { ...f, harnessErrors: [...f.harnessErrors, makeHarnessError(kind)] };
        const r = computeVerdict(g);
        expect(r.verdict).toBe('inconclusive');
        expect(r.reasons).toContain(`harness-error:${kind}`);
      }),
      fcParams(),
    );
    fc.assert(
      fc.property(runFactsArb, (f) => {
        if (f.harnessErrors.length === 0) return;
        expect(computeVerdict(f).verdict).toBe('inconclusive');
      }),
      fcParams(),
    );
  });

  it('without harness error, divergence or not-demonstrated delta gives restless', () => {
    fc.assert(
      fc.property(runFactsArb, (f) => {
        const g = { ...f, harnessErrors: [] };
        const r = computeVerdict(g);
        if (hasRestlessCause(g)) expect(r.verdict).toBe('restless');
        else expect(r.verdict).not.toBe('restless');
      }),
      fcParams(),
    );
  });

  it('restless also when functions are non-deterministic or lack evidence', () => {
    fc.assert(
      fc.property(
        runFactsArb,
        divergenceArb,
        fc.constantFrom('f0', 'f1'),
        (f, div, fn) => {
          const g: RunFacts = {
            ...f,
            harnessErrors: [],
            divergences: [...f.divergences, div],
            nonDeterministic: [...f.nonDeterministic, fn],
            functionsTested: [fn],
            unencodable: [makeCount(fn, 0, 0)],
          };
          expect(computeVerdict(g).verdict).toBe('restless');
          const h: RunFacts = {
            ...g,
            divergences: [],
            deltas: [...g.deltas, makeDelta('nd', 'not-demonstrated')],
          };
          expect(computeVerdict(h).verdict).toBe('restless');
        },
      ),
      fcParams(),
    );
  });

  it('a function whose every case is unencodable prevents alive', () => {
    fc.assert(
      fc.property(cleanArb, fc.integer({ min: 1, max: 8 }), (f, n) => {
        const fn = f.functionsTested[0] as string;
        const g: RunFacts = {
          ...f,
          unencodable: [makeCount(fn, n, n), ...f.unencodable.filter((u) => u.function !== fn)],
        };
        const r = computeVerdict(g);
        expect(r.verdict).not.toBe('alive');
        expect(r.reasons).toContain(`lacking-evidence:${fn}`);
      }),
      fcParams(),
    );
  });

  it('is deterministic and independent of list order', () => {
    const keys = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(runFactsArb, keys, keys, keys, keys, keys, keys, (f, k1, k2, k3, k4, k5, k6) => {
        const g: RunFacts = {
          harnessErrors: shuffleBy(f.harnessErrors, k1),
          divergences: shuffleBy(f.divergences, k2),
          deltas: shuffleBy(f.deltas, k3),
          nonDeterministic: shuffleBy(f.nonDeterministic, k4),
          functionsTested: shuffleBy(f.functionsTested, k5),
          unencodable: shuffleBy(f.unencodable, k6),
        };
        const a = computeVerdict(f);
        expect(computeVerdict(f)).toEqual(a);
        expect(computeVerdict(g)).toEqual(a);
      }),
      fcParams(),
    );
  });

  it('is monotone: a divergence makes an alive run restless', () => {
    fc.assert(
      fc.property(cleanArb, divergenceArb, (f, div) => {
        expect(computeVerdict(f).verdict).toBe('alive');
        const r = computeVerdict({ ...f, divergences: [div] });
        expect(r.verdict).toBe('restless');
        expect(r.reasons).toContain(`divergence:${div.kind}:${div.function}`);
      }),
      fcParams(),
    );
  });

  it('is monotone: removing all problems yields alive; each single cause blocks alive', () => {
    fc.assert(
      fc.property(runFactsArb, (f) => {
        expect(computeVerdict(cleaned(f)).verdict).toBe('alive');
      }),
      fcParams(),
    );
    fc.assert(
      fc.property(
        cleanArb,
        fc.constantFrom('harness', 'divergence', 'delta', 'flaky', 'none-tested', 'zero-cases', 'all-unenc'),
        divergenceArb,
        fc.constantFrom(...allHarnessErrorKinds),
        (f, cause, div, kind) => {
          const fn = f.functionsTested[0] as string;
          const broken: RunFacts =
            cause === 'harness'
              ? { ...f, harnessErrors: [makeHarnessError(kind)] }
              : cause === 'divergence'
                ? { ...f, divergences: [div] }
                : cause === 'delta'
                  ? { ...f, deltas: [...f.deltas, makeDelta('x', 'not-demonstrated')] }
                  : cause === 'flaky'
                    ? { ...f, nonDeterministic: [fn] }
                    : cause === 'none-tested'
                      ? { ...f, functionsTested: [], unencodable: [] }
                      : cause === 'zero-cases'
                        ? { ...f, unencodable: [makeCount(fn, 0, 0)] }
                        : { ...f, unencodable: [makeCount(fn, 4, 4)] };
          const expected =
            cause === 'harness'
              ? 'inconclusive'
              : cause === 'divergence' || cause === 'delta'
                ? 'restless'
                : 'inconclusive';
          expect(computeVerdict(broken).verdict).toBe(expected);
          // Removing the single cause (restoring the clean run) gives alive again.
          expect(computeVerdict(f).verdict).toBe('alive');
        },
      ),
      fcParams(),
    );
  });

  it('reasons are empty iff alive, and otherwise sorted, unique and in the documented formats', () => {
    fc.assert(
      fc.property(runFactsArb, (f) => {
        const r = computeVerdict(f);
        expect(r.reasons.length === 0).toBe(r.verdict === 'alive');
        for (const reason of r.reasons) expect(reason).toMatch(reasonPattern);
        const sorted = [...new Set(r.reasons)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect(r.reasons).toEqual(sorted);
      }),
      fcParams(),
    );
  });
});
