import fc from 'fast-check';
import type { RunFacts } from '../../../src/proof/core/verdict';
import {
  HarnessErrorKindSchema,
  type DeltaReport,
  type Divergence,
  type HarnessError,
  type UnencodableCount,
} from '../../../src/proof/types';

export const allHarnessErrorKinds = HarnessErrorKindSchema.options;
export const divergenceKinds = ['unexplained', 'delta-violation', 'api-surface'] as const;

const functionPool = ['f0', 'f1', 'f2', 'f3', 'f4', 'g\u00e9', 'Z'] as const;

export function makeHarnessError(kind: HarnessError['kind'], fn?: string): HarnessError {
  return fn === undefined ? { kind, message: 'm' } : { kind, function: fn, message: 'm' };
}

export function makeDivergence(kind: (typeof divergenceKinds)[number], fn: string): Divergence {
  if (kind === 'api-surface') {
    return {
      function: fn,
      kind,
      apiSurface: { export: fn, original: { type: 'function' }, resurrection: null },
      redactionMaskedDifference: false,
    };
  }
  return {
    function: fn,
    kind,
    args: [],
    replay: { phase: 'explicit', index: 0 },
    differences: [],
    original: { kind: 'crash' },
    resurrection: { kind: 'crash' },
    shrink: { attempts: 0, budgetExhausted: false },
    redactionMaskedDifference: false,
  };
}

export function makeDelta(id: string, status: DeltaReport['status']): DeltaReport {
  return { id, function: 'f0', status, predicateCasesChecked: 1, demonstration: null };
}

export function makeCount(fn: string, cases: number, casesWithUnencodable: number): UnencodableCount {
  return {
    function: fn,
    cases,
    casesWithUnencodable,
    total: 0,
    reasons: { cycle: 0, depth: 0, getter: 0, proxy: 0 },
  };
}

const fnName: fc.Arbitrary<string> = fc.constantFrom<string>(...functionPool);

const harnessErrorArb: fc.Arbitrary<HarnessError> = fc.record({
  kind: fc.constantFrom(...allHarnessErrorKinds),
  fn: fc.option(fnName, { nil: undefined }),
}).map(({ kind, fn }) => makeHarnessError(kind, fn));

export const divergenceArb: fc.Arbitrary<Divergence> = fc
  .record({ kind: fc.constantFrom(...divergenceKinds), fn: fnName })
  .map(({ kind, fn }) => makeDivergence(kind, fn));

const deltaArb: fc.Arbitrary<DeltaReport> = fc
  .record({
    id: fc.constantFrom('d1', 'd2', 'd3', 'delta/4'),
    status: fc.constantFrom<DeltaReport['status']>('demonstrated', 'not-demonstrated'),
  })
  .map(({ id, status }) => makeDelta(id, status));

/** Cases and casesWithUnencodable biased toward zero and all-unencodable. */
const countArb = (fn: string): fc.Arbitrary<UnencodableCount> =>
  fc.oneof(
    fc.constant(makeCount(fn, 0, 0)),
    fc.integer({ min: 1, max: 6 }).map((c) => makeCount(fn, c, c)),
    fc.integer({ min: 1, max: 6 }).chain((c) =>
      fc.integer({ min: 0, max: c }).map((u) => makeCount(fn, c, u)),
    ),
    fc.integer({ min: 1, max: 6 }).map((c) => makeCount(fn, c, 0)),
  );

/** Arbitrary RunFacts: every tested function carries exactly one UnencodableCount entry. */
export const runFactsArb: fc.Arbitrary<RunFacts> = fc
  .record({
    harnessErrors: fc.oneof(
      fc.constant<HarnessError[]>([]),
      fc.constant<HarnessError[]>([]),
      fc.array(harnessErrorArb, { maxLength: 4 }),
    ),
    divergences: fc.oneof(
      fc.constant<Divergence[]>([]),
      fc.constant<Divergence[]>([]),
      fc.array(divergenceArb, { maxLength: 4 }),
    ),
    deltas: fc.oneof(
      fc.array(fc.constant('demonstrated' as const), { maxLength: 3 }).map((s) =>
        s.map((st, i) => makeDelta(`ok${i}`, st)),
      ),
      fc.array(deltaArb, { maxLength: 4 }),
    ),
    nonDeterministic: fc.oneof(
      fc.constant<string[]>([]),
      fc.constant<string[]>([]),
      fc.array(fnName, { maxLength: 3 }),
    ),
    tested: fc.oneof(
      fc.constant<string[]>([]),
      fc.uniqueArray(fnName, { maxLength: 5 }),
      fc.uniqueArray(fnName, { minLength: 1, maxLength: 5 }),
    ),
  })
  .chain((r) =>
    fc.tuple(...r.tested.map((fn: string) => countArb(fn))).map(
      (unencodable): RunFacts => ({
        harnessErrors: r.harnessErrors,
        divergences: r.divergences,
        deltas: r.deltas,
        nonDeterministic: r.nonDeterministic,
        functionsTested: r.tested,
        unencodable,
      }),
    ),
  );

/** Deterministic shuffle driven by generated sort keys. */
export function shuffleBy<T>(list: readonly T[], keys: readonly number[]): T[] {
  return list
    .map((item, i) => ({ item, key: keys[i % Math.max(keys.length, 1)] ?? 0, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.item);
}
