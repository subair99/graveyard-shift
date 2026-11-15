// Generators of small Proof_Reports whose sortable lists hold many entries that tie on every
// documented sort key and differ only in content (deltaId, replay, shrink, outcomes, function,
// descriptor parts). Used by the canonical ordering property (Property 23).

import { fc } from '../../engine/helpers/fc';
import type {
  DeltaEntry,
  DeltaReport,
  Divergence,
  EncodedNode,
  HarnessError,
  Outcome,
  ProofReport,
} from '../../../src/proof/types';

type Unexplained = Exclude<Divergence, { kind: 'api-surface' }>;
type Returned = Extract<Outcome, { kind: 'returned' }>;

const str = (v: string): EncodedNode => ({ t: 'str', v });
const small = fc.integer({ min: 0, max: 3 });

const nodeArb: fc.Arbitrary<EncodedNode> = fc.oneof(
  small.map((v): EncodedNode => ({ t: 'num', v })),
  fc.constantFrom('a', 'b', 'c').map(str),
  fc.constantFrom(['x', 'y'], ['y', 'x']).map((items): EncodedNode => ({ t: 'set', items: items.map(str) })),
);

const descArb = fc.record({
  value: nodeArb,
  enumerable: fc.boolean(),
  configurable: fc.boolean(),
});

const protoEntryArb: fc.Arbitrary<DeltaEntry> = fc.record(
  {
    prototype: fc.constantFrom('Object.prototype' as const, 'Array.prototype' as const),
    key: fc.constantFrom({ s: 'k' }, { sym: 'k' }, { sym: null }),
    change: fc.constantFrom('added' as const, 'changed' as const, 'removed' as const),
    before: descArb,
    after: descArb,
  },
  { requiredKeys: ['prototype', 'key', 'change'] },
);

const outcomeArb: fc.Arbitrary<Returned> = fc.record({
  kind: fc.constant('returned' as const),
  async: fc.boolean(),
  value: nodeArb,
  args: fc.array(nodeArb, { maxLength: 1 }),
  prototypeDelta: fc.array(protoEntryArb, { maxLength: 4 }),
});

/** Same function, kind and rendered args; everything else may differ. */
const tiedDivergenceArb: fc.Arbitrary<Unexplained> = fc.record({
  function: fc.constant('f'),
  kind: fc.constant('delta-violation' as const),
  deltaId: fc.option(fc.constantFrom('d1', 'd2', 'd3'), { nil: undefined }),
  args: fc.constant<EncodedNode[]>([str('same')]),
  replay: fc.oneof(
    fc.record({
      phase: fc.constantFrom('generated' as const, 'delta:d1' as const),
      seed: small,
      path: fc.constantFrom('0', '1:2'),
    }),
    fc.record({ phase: fc.constant('explicit' as const), index: small }),
  ),
  differences: fc.array(
    fc.record({
      part: fc.constantFrom('kind' as const, 'value' as const),
      path: fc.constantFrom('', 'a'),
    }),
    { maxLength: 3 },
  ),
  original: outcomeArb,
  resurrection: outcomeArb,
  shrink: fc.record({ attempts: small, budgetExhausted: fc.boolean() }),
  redactionMaskedDifference: fc.boolean(),
});

/** Same kind and message; the function (or its absence) differs. */
const tiedHarnessErrorArb: fc.Arbitrary<HarnessError> = fc.record(
  {
    kind: fc.constant('property-error' as const),
    function: fc.constantFrom('f', 'g', 'h'),
    message: fc.constant('same message'),
  },
  { requiredKeys: ['kind', 'message'] },
);

/** Same id; function, status and counts differ. */
const tiedDeltaArb: fc.Arbitrary<DeltaReport> = fc.record({
  id: fc.constant('d1'),
  function: fc.constantFrom('f', 'g', 'h'),
  status: fc.constantFrom('demonstrated' as const, 'not-demonstrated' as const),
  predicateCasesChecked: small,
  demonstration: fc.constant(null),
});

export const tiedReportArb: fc.Arbitrary<ProofReport> = fc
  .record({
    divergences: fc.array(tiedDivergenceArb, { minLength: 2, maxLength: 6 }),
    harnessErrors: fc.array(tiedHarnessErrorArb, { minLength: 2, maxLength: 6 }),
    deltas: fc.array(tiedDeltaArb, { minLength: 2, maxLength: 6 }),
    cases: fc.array(small, { minLength: 2, maxLength: 4 }),
    reasons: fc.array(fc.constantFrom('r1', 'r2', 'r3'), { minLength: 2, maxLength: 4 }),
    nonDet: fc.array(fc.array(nodeArb, { maxLength: 2 }), { minLength: 2, maxLength: 4 }),
  })
  .map((x): ProofReport => ({
    schemaVersion: 1,
    package: { name: 'pkg', version: '1.0.0' },
    original: { integrity: 'sha512-abc', verified: true },
    resurrection: { source: 'directory', treeHash: null },
    sandbox: {
      mechanism: 'node-permission',
      restartEvents: { original: 0, resurrection: 0 },
      otherRestarts: { original: 0, resurrection: 0 },
      limits: {
        callTimeoutMs: 1000,
        heapLimitMb: 256,
        outputLimitBytes: 1048576,
        maxRestarts: 20,
        casesRequested: 100,
        shrinkBudget: 500,
      },
    },
    functionsTested: ['f', 'g'],
    casesPerFunction: x.cases.map((cases) => ({ function: 'f', cases })),
    unencodableValues: x.cases.map((c) => ({
      function: 'f',
      cases: 3,
      casesWithUnencodable: c,
      total: c,
      reasons: { cycle: c, depth: 0, getter: 0, proxy: 0 },
    })),
    excludedFunctions: x.reasons.map((reason) => ({ function: 'f', reason })),
    nonDeterministicFunctions: x.nonDet.map((args) => ({ function: 'f', args, differences: [] })),
    divergences: x.divergences,
    deltas: x.deltas,
    harnessErrors: x.harnessErrors,
    verdict: 'restless',
    seed: 42,
    toolVersions: { node: '22.0.0', fastCheck: '4.0.0', reportSchema: 1 },
  }));

/** Reorders a list by sorting on the given random keys (a permutation for any key array). */
export function permute<T>(list: readonly T[], keys: readonly number[]): T[] {
  return list
    .map((item, i) => ({ item, k: keys.length === 0 ? 0 : keys[i % keys.length]!, i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((e) => e.item);
}

/** Applies independent permutations to every sortable list of a report. */
export function permuteReport(r: ProofReport, keys: readonly number[][]): ProofReport {
  const k = (n: number): readonly number[] => keys[n % keys.length] ?? [];
  const permuteOutcome = (o: Returned, n: number): Returned => ({
    ...o,
    prototypeDelta: permute(o.prototypeDelta, k(n)),
  });
  return {
    ...r,
    functionsTested: permute(r.functionsTested, k(0)),
    casesPerFunction: permute(r.casesPerFunction, k(1)),
    unencodableValues: permute(r.unencodableValues, k(2)),
    excludedFunctions: permute(r.excludedFunctions, k(3)),
    nonDeterministicFunctions: permute(r.nonDeterministicFunctions, k(4)),
    divergences: permute(
      r.divergences.map((d): Divergence =>
        d.kind === 'api-surface' || d.original.kind !== 'returned' || d.resurrection.kind !== 'returned'
          ? d
          : {
              ...d,
              differences: permute(d.differences, k(5)),
              original: permuteOutcome(d.original, 6),
              resurrection: permuteOutcome(d.resurrection, 7),
            },
      ),
      k(8),
    ),
    deltas: permute(r.deltas, k(9)),
    harnessErrors: permute(r.harnessErrors, k(10)),
  };
}
