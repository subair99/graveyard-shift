// Requirements: 13.1, 13.2, 13.3
import { describe, expect, it } from 'vitest';
import {
  REPORT_KEY_ORDER,
  canonicalReport,
  canonicalizeReport,
} from '../../../src/proof/serialize/canonicalReport';
import { deserializeReport } from '../../../src/proof/serialize/deserialize';
import type {
  Divergence,
  EncodedNode,
  Outcome,
  ProofReport,
} from '../../../src/proof/types';

const str = (v: string): EncodedNode => ({ t: 'str', v });
const num = (v: number): EncodedNode => ({ t: 'num', v });
const returned: Outcome = {
  kind: 'returned',
  async: false,
  value: num(1),
  args: [],
  prototypeDelta: [],
};

const divergence = (
  fn: string,
  args: EncodedNode[],
  kind: 'unexplained' | 'delta-violation' = 'unexplained',
): Exclude<Divergence, { kind: 'api-surface' }> => ({
  function: fn,
  kind,
  args,
  replay: { phase: 'generated', seed: 7, path: '0:1' },
  differences: [],
  original: returned,
  resurrection: returned,
  shrink: { attempts: 3, budgetExhausted: false },
  redactionMaskedDifference: false,
});

function baseReport(): ProofReport {
  return {
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
    functionsTested: ['b', 'a'],
    casesPerFunction: [
      { function: 'b', cases: 2 },
      { function: 'a', cases: 1 },
    ],
    unencodableValues: [],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    verdict: 'alive',
    seed: 42,
    toolVersions: { node: '22.0.0', fastCheck: '4.0.0', reportSchema: 1 },
  };
}

/** Same data, object keys in reverse insertion order at every level. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

describe('canonicalReport', () => {
  it('writes top-level keys in the table order whatever the construction order', () => {
    const r = baseReport();
    const reversed = reverseKeys(r) as ProofReport;
    const json = canonicalReport(reversed);
    expect(Object.keys(JSON.parse(json))).toEqual([...REPORT_KEY_ORDER.report]);
    expect(json).toBe(canonicalReport(r));
  });

  it('sorts function lists by name and breaks ties by the canonical JSON of the entry', () => {
    const r = baseReport();
    r.excludedFunctions = [
      { function: 'z', reason: 'first' },
      { function: 'a', reason: 'x' },
      { function: 'z', reason: 'second' },
    ];
    const out = JSON.parse(canonicalReport(r)) as ProofReport;
    expect(out.functionsTested).toEqual(['a', 'b']);
    expect(out.casesPerFunction.map((c) => c.function)).toEqual(['a', 'b']);
    expect(out.excludedFunctions.map((e) => e.reason)).toEqual(['x', 'first', 'second']);
  });

  it('sorts by code point, not UTF-16 unit', () => {
    const r = baseReport();
    r.functionsTested = ['\u{1F600}', '\uFFFD'];
    const out = JSON.parse(canonicalReport(r)) as ProofReport;
    expect(out.functionsTested).toEqual(['\uFFFD', '\u{1F600}']);
  });

  it('sorts divergences by function, kind, then the rendered counterexample', () => {
    const r = baseReport();
    r.divergences = [
      divergence('f', [str('b')]),
      divergence('f', [str('a')]),
      divergence('f', [str('z')], 'delta-violation'),
      divergence('e', [str('z')]),
    ];
    const out = JSON.parse(canonicalReport(r)) as ProofReport;
    const keys = out.divergences.map((d) => [
      d.function,
      d.kind,
      d.kind === 'api-surface' ? '' : (d.args[0] as { v: string }).v,
    ]);
    expect(keys).toEqual([
      ['e', 'unexplained', 'z'],
      ['f', 'delta-violation', 'z'],
      ['f', 'unexplained', 'a'],
      ['f', 'unexplained', 'b'],
    ]);
  });

  it('puts redactionMaskedDifference last in a Divergence', () => {
    const r = baseReport();
    r.divergences = [reverseKeys(divergence('f', [str('a')])) as Divergence];
    const out = JSON.parse(canonicalReport(r)) as { divergences: Record<string, unknown>[] };
    const keys = Object.keys(out.divergences[0]!);
    expect(keys[keys.length - 1]).toBe('redactionMaskedDifference');
    expect(keys).toEqual(
      REPORT_KEY_ORDER.divergence.filter((k) => keys.includes(k)),
    );
  });

  it('sorts differences by part then path, deltas by id, harness errors by kind then message', () => {
    const r = baseReport();
    r.divergences = [
      {
        ...divergence('f', []),
        differences: [
          { part: 'args', path: 'b' },
          { part: 'kind', path: 'z' },
          { part: 'args', path: 'a' },
        ],
      },
    ];
    r.deltas = [
      { id: 'd2', function: 'f', status: 'not-demonstrated', predicateCasesChecked: 0, demonstration: null },
      { id: 'd1', function: 'f', status: 'not-demonstrated', predicateCasesChecked: 0, demonstration: null },
    ];
    r.harnessErrors = [
      { kind: 'property-error', message: 'b' },
      { kind: 'harness-config-error', message: 'z' },
      { kind: 'property-error', message: 'a' },
    ];
    const out = JSON.parse(canonicalReport(r)) as ProofReport;
    const div = out.divergences[0]!;
    expect(div.kind !== 'api-surface' && div.differences.map((d) => `${d.part}:${d.path}`)).toEqual([
      'kind:z',
      'args:a',
      'args:b',
    ]);
    expect(out.deltas.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(out.harnessErrors.map((e) => `${e.kind}:${e.message}`)).toEqual([
      'harness-config-error:z',
      'property-error:a',
      'property-error:b',
    ]);
  });

  it('orders a prototypeDelta by prototype, string keys, then symbol keys', () => {
    const r = baseReport();
    const d = (prototype: 'Object.prototype' | 'Array.prototype', key: { s: string } | { sym: string | null }) => ({
      prototype,
      key,
      change: 'added' as const,
    });
    r.divergences = [
      {
        ...divergence('f', []),
        original: {
          kind: 'returned',
          async: false,
          value: num(1),
          args: [],
          prototypeDelta: [
            d('Array.prototype', { s: 'a' }),
            d('Object.prototype', { sym: 'x' }),
            d('Object.prototype', { s: 'b' }),
            d('Object.prototype', { s: 'a' }),
          ],
        },
      },
    ];
    const out = JSON.parse(canonicalReport(r)) as { divergences: { original: { prototypeDelta: unknown[] } }[] };
    expect(out.divergences[0]!.original.prototypeDelta).toEqual([
      d('Object.prototype', { s: 'a' }),
      d('Object.prototype', { s: 'b' }),
      d('Object.prototype', { sym: 'x' }),
      d('Array.prototype', { s: 'a' }),
    ]);
  });

  it('writes encoded nodes in canonical form', () => {
    const r = baseReport();
    const set: EncodedNode = { t: 'set', items: [str('b'), str('a')] };
    r.nonDeterministicFunctions = [{ function: 'f', args: [set], differences: [] }];
    const json = canonicalReport(r);
    expect(json).toContain('{"t":"set","items":[{"t":"str","v":"a"},{"t":"str","v":"b"}]}');
  });

  it('is byte-stable across calls and for equal data built in another order', () => {
    const r = baseReport();
    r.divergences = [divergence('f', [str('b')]), divergence('f', [str('a')])];
    const first = canonicalReport(r);
    expect(canonicalReport(r)).toBe(first);
    const shuffled = reverseKeys(r) as ProofReport;
    shuffled.divergences = [...shuffled.divergences].reverse();
    shuffled.functionsTested = [...shuffled.functionsTested].reverse();
    expect(canonicalReport(shuffled)).toBe(first);
  });

  it('contains no timestamp fields or ISO dates', () => {
    const json = canonicalReport(baseReport());
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(json).not.toMatch(/"(timestamp|createdAt|generatedAt|date|time)[A-Za-z]*"/i);
  });
});

describe('deserializeReport', () => {
  it('round trips: deserialize(canonicalReport(r)) equals the canonicalized r', () => {
    const r = baseReport();
    r.divergences = [divergence('f', [{ t: 'set', items: [str('b'), str('a')] }])];
    const result = deserializeReport(canonicalReport(r));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(canonicalizeReport(r));
    expect(canonicalReport(result.value)).toBe(canonicalReport(r));
  });

  it('reports malformed JSON', () => {
    const result = deserializeReport('{"schemaVersion":');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed-json');
  });

  it('names a missing field', () => {
    const data = JSON.parse(canonicalReport(baseReport())) as Record<string, unknown>;
    delete data['verdict'];
    const result = deserializeReport(JSON.stringify(data));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-report');
    expect(result.error.message).toContain('verdict');
    expect(result.error.issues.map((i) => i.path)).toContain('verdict');
  });

  it('names a nested missing field by path', () => {
    const data = JSON.parse(canonicalReport(baseReport())) as { sandbox: { limits: Record<string, unknown> } };
    delete data.sandbox.limits['shrinkBudget'];
    const result = deserializeReport(JSON.stringify(data));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('sandbox.limits.shrinkBudget');
  });

  it('rejects an unknown key', () => {
    const data = JSON.parse(canonicalReport(baseReport())) as Record<string, unknown>;
    data['generatedAt'] = '2026-01-01T00:00:00Z';
    const result = deserializeReport(JSON.stringify(data));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-report');
    expect(result.error.message).toContain('generatedAt');
  });
});
