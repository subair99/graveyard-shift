import { describe, expect, it } from 'vitest';
import {
  computeVerdict,
  functionsLackingEvidence,
  type RunFacts,
} from '../../../src/proof/core/verdict';
import {
  HarnessErrorKindSchema,
  type DeltaReport,
  type Divergence,
  type HarnessError,
  type UnencodableCount,
} from '../../../src/proof/types';

const okCount = (fn: string, cases = 10, withUnencodable = 0): UnencodableCount => ({
  function: fn,
  cases,
  casesWithUnencodable: withUnencodable,
  total: 0,
  reasons: { cycle: 0, depth: 0, getter: 0, proxy: 0 },
});

const divergence = (fn: string, kind: 'unexplained' | 'delta-violation' = 'unexplained'): Divergence => ({
  function: fn,
  kind,
  args: [],
  replay: { phase: 'explicit', index: 0 },
  differences: [],
  original: { kind: 'crash' },
  resurrection: { kind: 'crash' },
  shrink: { attempts: 0, budgetExhausted: false },
  redactionMaskedDifference: false,
});

const apiDivergence = (name: string): Divergence => ({
  function: name,
  kind: 'api-surface',
  apiSurface: { export: name, original: { type: 'function' }, resurrection: null },
  redactionMaskedDifference: false,
});

const delta = (id: string, status: DeltaReport['status']): DeltaReport => ({
  id,
  function: 'f',
  status,
  predicateCasesChecked: 1,
  demonstration: null,
});

const harnessError = (kind: HarnessError['kind']): HarnessError => ({ kind, message: 'm' });

function facts(overrides: Partial<RunFacts> = {}): RunFacts {
  return {
    harnessErrors: [],
    divergences: [],
    deltas: [],
    nonDeterministic: [],
    functionsTested: ['f'],
    unencodable: [okCount('f')],
    ...overrides,
  };
}

describe('computeVerdict precedence table', () => {
  it('row 6: no problems gives alive with no reasons', () => {
    expect(computeVerdict(facts())).toEqual({ verdict: 'alive', reasons: [] });
  });

  it('row 6: every delta demonstrated and zero divergences gives alive', () => {
    const result = computeVerdict(
      facts({ deltas: [delta('d1', 'demonstrated'), delta('d2', 'demonstrated')] }),
    );
    expect(result).toEqual({ verdict: 'alive', reasons: [] });
  });

  it.each(HarnessErrorKindSchema.options)('row 1: harness error %s gives inconclusive', (kind) => {
    const result = computeVerdict(facts({ harnessErrors: [harnessError(kind)] }));
    expect(result.verdict).toBe('inconclusive');
    expect(result.reasons).toEqual([`harness-error:${kind}`]);
  });

  it('row 1: harness error with divergences stays inconclusive (R12.4)', () => {
    const result = computeVerdict(
      facts({ harnessErrors: [harnessError('unloadable-module')], divergences: [divergence('f')] }),
    );
    expect(result.verdict).toBe('inconclusive');
    expect(result.reasons).toEqual(['harness-error:unloadable-module']);
  });

  it('row 1: harness error with a not-demonstrated delta stays inconclusive', () => {
    const result = computeVerdict(
      facts({ harnessErrors: [harnessError('property-error')], deltas: [delta('d', 'not-demonstrated')] }),
    );
    expect(result.verdict).toBe('inconclusive');
  });

  it('row 1: no-functions-tested error with empty tested list is inconclusive', () => {
    const result = computeVerdict(
      facts({ harnessErrors: [harnessError('no-functions-tested')], functionsTested: [], unencodable: [] }),
    );
    expect(result).toEqual({ verdict: 'inconclusive', reasons: ['harness-error:no-functions-tested'] });
  });

  it('row 2: an unexplained divergence gives restless', () => {
    const result = computeVerdict(facts({ divergences: [divergence('f')] }));
    expect(result).toEqual({ verdict: 'restless', reasons: ['divergence:unexplained:f'] });
  });

  it('row 2: a delta-violation divergence gives restless', () => {
    const result = computeVerdict(facts({ divergences: [divergence('f', 'delta-violation')] }));
    expect(result).toEqual({ verdict: 'restless', reasons: ['divergence:delta-violation:f'] });
  });

  it('row 2: an api-surface divergence gives restless', () => {
    const result = computeVerdict(facts({ divergences: [apiDivergence('g')] }));
    expect(result).toEqual({ verdict: 'restless', reasons: ['divergence:api-surface:g'] });
  });

  it('row 2: a not-demonstrated delta gives restless', () => {
    const result = computeVerdict(
      facts({ deltas: [delta('d1', 'demonstrated'), delta('d2', 'not-demonstrated')] }),
    );
    expect(result).toEqual({ verdict: 'restless', reasons: ['delta-not-demonstrated:d2'] });
  });

  it('row 2: divergence with a flaky original gives restless (design resolution)', () => {
    const result = computeVerdict(facts({ divergences: [divergence('f')], nonDeterministic: ['h'] }));
    expect(result.verdict).toBe('restless');
  });

  it('row 2: divergence with a no-evidence function gives restless (R12.7)', () => {
    const result = computeVerdict(
      facts({ divergences: [divergence('f')], unencodable: [okCount('f', 5, 5)] }),
    );
    expect(result.verdict).toBe('restless');
  });

  it('row 2: not-demonstrated delta with a no-evidence function gives restless (R12.7)', () => {
    const result = computeVerdict(
      facts({ deltas: [delta('d', 'not-demonstrated')], unencodable: [okCount('f', 5, 5)] }),
    );
    expect(result.verdict).toBe('restless');
  });

  it('row 3: a flaky original without divergences gives inconclusive', () => {
    const result = computeVerdict(facts({ nonDeterministic: ['f'] }));
    expect(result).toEqual({ verdict: 'inconclusive', reasons: ['non-deterministic:f'] });
  });

  it('row 4: no function tested without a harness error is never alive', () => {
    const result = computeVerdict(facts({ functionsTested: [], unencodable: [] }));
    expect(result).toEqual({ verdict: 'inconclusive', reasons: ['no-functions-tested'] });
  });

  it('row 5: a function whose every case was unencodable gives inconclusive', () => {
    const result = computeVerdict(facts({ unencodable: [okCount('f', 7, 7)] }));
    expect(result).toEqual({ verdict: 'inconclusive', reasons: ['lacking-evidence:f'] });
  });

  it('row 5: a function with zero cases lacks evidence', () => {
    const result = computeVerdict(facts({ unencodable: [okCount('f', 0, 0)] }));
    expect(result).toEqual({ verdict: 'inconclusive', reasons: ['lacking-evidence:f'] });
  });

  it('row 5: some unencodable cases but not all still gives alive', () => {
    expect(computeVerdict(facts({ unencodable: [okCount('f', 7, 6)] })).verdict).toBe('alive');
  });

  it('flaky original beats no-evidence in the reasons (row 3 before row 5)', () => {
    const result = computeVerdict(facts({ nonDeterministic: ['f'], unencodable: [okCount('f', 3, 3)] }));
    expect(result.reasons).toEqual(['non-deterministic:f']);
  });
});

describe('computeVerdict reasons', () => {
  it('are sorted and unique regardless of input order', () => {
    const a = computeVerdict(facts({ divergences: [divergence('z'), divergence('a'), divergence('z')] }));
    const b = computeVerdict(facts({ divergences: [divergence('a'), divergence('z')] }));
    expect(a.reasons).toEqual(['divergence:unexplained:a', 'divergence:unexplained:z']);
    expect(a).toEqual(b);
  });

  it('list all harness error kinds sorted', () => {
    const result = computeVerdict(
      facts({ harnessErrors: [harnessError('temp-root-leak'), harnessError('identity-leak')] }),
    );
    expect(result.reasons).toEqual(['harness-error:identity-leak', 'harness-error:temp-root-leak']);
  });

  it('never return alive when a harness error exists', () => {
    for (const kind of HarnessErrorKindSchema.options) {
      expect(computeVerdict(facts({ harnessErrors: [harnessError(kind)] })).verdict).not.toBe('alive');
    }
  });
});

describe('functionsLackingEvidence', () => {
  it('returns sorted names with zero cases or all cases unencodable', () => {
    const names = functionsLackingEvidence([
      okCount('b', 4, 4),
      okCount('ok', 4, 1),
      okCount('a', 0, 0),
    ]);
    expect(names).toEqual(['a', 'b']);
  });
});
