import { describe, expect, it } from 'vitest';
import type { IdentityValues } from '../../../src/proof/core/identity';
import {
  redactIdentityDeep,
  redactIdentityDelta,
  redactIdentityOutcome,
  redactionMaskedDifference,
} from '../../../src/proof/core/redact';
import type { DeltaEntry, EncodedNode, ExportSummary, Outcome } from '../../../src/proof/types';

// Fake identity values only.
const str = (v: string): EncodedNode => ({ t: 'str', v });
const returned = (value: EncodedNode, args: EncodedNode[] = [], prototypeDelta: DeltaEntry[] = []): Outcome => ({
  kind: 'returned',
  async: false,
  value,
  args,
  prototypeDelta,
});
const json = (x: unknown): string => JSON.stringify(x);

const winAlice: IdentityValues = { pathValues: ['C:\\Users\\alice'], userName: 'alice' };
const userOnly: IdentityValues = { pathValues: [], userName: 'alice' };
const mallory: IdentityValues = { pathValues: ['/home/mallory'], userName: 'mallory' };

function ok<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error('expected ok result');
  return r.value;
}

describe('redactIdentityDeep', () => {
  it('uses the placeholders <user-home> and <user>', () => {
    const out = ok(redactIdentityDeep(str('C:\\Users\\alice\\x and alice'), winAlice, 'win32'));
    expect(out).toEqual(str('<user-home>\\x and <user>'));
  });

  it('visits every node type, key and string at any depth', () => {
    const m = 'mallory';
    const node: EncodedNode = {
      t: 'object',
      ctor: `${m} Ctor`,
      props: [
        [`k ${m}`, str(`/home/${m}/a`)],
        ['sym', { t: 'symbol', v: `desc ${m}` }],
        ['re', { t: 'regexp', source: `^${m}$`, flags: 'g' }],
        ['fn', { t: 'function', name: `${m} Fn`, arity: 1 }],
        ['map', { t: 'map', entries: [[str(`${m} key`), str(`/home/${m}`)]] }],
        ['set', { t: 'set', items: [str(`x ${m} y`)] }],
        [
          'err',
          {
            t: 'error',
            cls: 'Error',
            message: `open /home/${m}/f`,
            props: [[`p ${m}`, str(`/home/${m}/g`)]],
          },
        ],
        [
          'arr',
          {
            t: 'array',
            length: 2,
            items: [{ i: 0, n: str(`${m} z`) }],
            props: [[`ap ${m}`, str(m)]],
          },
        ],
        ['num', { t: 'num', v: 3 }],
        ['sym0', { t: 'symbol', v: null }],
      ],
    };
    const out = ok(redactIdentityDeep(node, mallory, 'posix'));
    const text = json(out);
    expect(text).not.toContain(m);
    expect(text).toContain('<user-home>/a');
    expect(text).toContain('<user> Ctor');
    expect(text).toContain('k <user>');
    expect(text).toContain('^<user>$');
    expect(text).toContain('<user> Fn');
    expect(text).toContain('<user> key');
    expect(text).toContain('x <user> y');
    expect(text).toContain('open <user-home>/f');
    expect(text).toContain('p <user>');
    expect(text).toContain('ap <user>');
    // Non-text fields are untouched.
    expect(text).toContain('"flags":"g"');
    expect(text).toContain('"arity":1');
  });

  it('is idempotent', () => {
    const node: EncodedNode = {
      t: 'array',
      length: 1,
      items: [{ i: 0, n: str('C:\\\\Users\\\\alice\\\\x file:///C:/Users/alice/y alice') }],
      props: [],
    };
    const once = ok(redactIdentityDeep(node, winAlice, 'win32'));
    expect(ok(redactIdentityDeep(once, winAlice, 'win32'))).toEqual(once);
  });

  it('returns normalization-collision when two keys become identical, without path or value', () => {
    const node: EncodedNode = {
      t: 'object',
      ctor: 'Object',
      props: [
        ['mallory', str('1')],
        ['<user>', str('2')],
      ],
    };
    const r = redactIdentityDeep(node, mallory, 'posix', 'value');
    expect(r).toEqual({ ok: false, error: { kind: 'normalization-collision', where: 'value' } });
    expect(json(r)).not.toContain('mallory');
  });

  it('detects a key collision inside an error node', () => {
    const node: EncodedNode = {
      t: 'error',
      cls: 'Error',
      message: 'm',
      props: [
        ['a/mallory', str('1')],
        ['a/<user>', str('2')],
      ],
    };
    expect(redactIdentityDeep(node, mallory, 'posix').ok).toBe(false);
  });
});

describe('redactIdentityOutcome and redactIdentityDelta', () => {
  const delta = (s: string, v: string): DeltaEntry => ({
    prototype: 'Object.prototype',
    key: { s },
    change: 'added',
    after: { value: str(v), enumerable: true, configurable: true, writable: true },
  });

  it('redacts value, args and Prototype_Delta strings', () => {
    const o = returned(str('/home/mallory/a'), [str('mallory')], [delta('mallory', '/home/mallory')]);
    const out = ok(redactIdentityOutcome(o, mallory, 'posix'));
    const text = json(out);
    expect(text).not.toContain('mallory');
    expect(text).toContain('<user-home>/a');
    expect(text).toContain('"s":"<user>"');
  });

  it('handles outcomes without text and a timeout with a delta', () => {
    expect(ok(redactIdentityOutcome({ kind: 'crash' }, mallory, 'posix'))).toEqual({ kind: 'crash' });
    const t = ok(
      redactIdentityOutcome({ kind: 'timeout', prototypeDelta: [delta('mallory', 'v')] }, mallory, 'posix'),
    );
    expect(json(t)).not.toContain('mallory');
  });

  it('reports a collision in Prototype_Delta keys and re-sorts after renaming', () => {
    const collide = redactIdentityDelta([delta('mallory', 'a'), delta('<user>', 'b')], mallory, 'posix');
    expect(collide).toEqual({ ok: false, error: { kind: 'normalization-collision', where: 'prototypeDelta' } });
    const sorted = ok(redactIdentityDelta([delta('zzz', 'a'), delta('mallory', 'b')], mallory, 'posix'));
    expect(sorted.map((e) => ('s' in e.key ? e.key.s : null))).toEqual(['<user>', 'zzz']);
  });

  it('reports the collision of a value or args with the matching where', () => {
    const bad: EncodedNode = {
      t: 'object',
      ctor: 'Object',
      props: [
        ['mallory', str('1')],
        ['<user>', str('2')],
      ],
    };
    expect(redactIdentityOutcome(returned(bad), mallory, 'posix')).toEqual({
      ok: false,
      error: { kind: 'normalization-collision', where: 'value' },
    });
    expect(redactIdentityOutcome(returned(str('x'), [bad]), mallory, 'posix')).toEqual({
      ok: false,
      error: { kind: 'normalization-collision', where: 'args' },
    });
  });
});

describe('redactionMaskedDifference', () => {
  it('is false for alice against bob when only alice is an identity value', () => {
    const a = returned(str('C:\\Users\\alice\\x'));
    const b = returned(str('C:\\Users\\bob\\x'));
    expect(a).not.toEqual(b);
    const ra = ok(redactIdentityOutcome(a, userOnly, 'win32'));
    const rb = ok(redactIdentityOutcome(b, userOnly, 'win32'));
    expect(ra).toEqual(returned(str('C:\\Users\\<user>\\x')));
    expect(rb).toEqual(b);
    expect(redactionMaskedDifference({ kind: 'outcome', original: a, resurrection: b }, userOnly, 'win32')).toBe(
      false,
    );
  });

  it('is true when two different identity values redact to the same text', () => {
    const both: IdentityValues = { pathValues: ['C:\\Users\\alice', 'C:\\Users\\bob'], userName: undefined };
    const a = returned(str('C:\\Users\\alice\\x'));
    const b = returned(str('C:\\Users\\bob\\x'));
    expect(redactionMaskedDifference({ kind: 'outcome', original: a, resurrection: b }, both, 'win32')).toBe(true);
  });

  it('is true for a home path that differs only in case on Windows', () => {
    const a = returned(str('C:\\Users\\alice'));
    const b = returned(str('c:\\users\\ALICE'));
    expect(redactionMaskedDifference({ kind: 'outcome', original: a, resurrection: b }, winAlice, 'win32')).toBe(
      true,
    );
  });

  it('is false when the outcomes are equal before redaction', () => {
    const a = returned(str('C:\\Users\\alice\\x'));
    expect(redactionMaskedDifference({ kind: 'outcome', original: a, resurrection: a }, winAlice, 'win32')).toBe(
      false,
    );
  });

  it('is false when the difference is not about an identity value', () => {
    const a = returned(str('/home/mallory/a'));
    const b = returned(str('/home/mallory/b'));
    expect(redactionMaskedDifference({ kind: 'outcome', original: a, resurrection: b }, mallory, 'posix')).toBe(
      false,
    );
  });

  it('compares argument post-states and Prototype_Delta too', () => {
    const a = returned(str('same'), [str('/home/mallory/1')]);
    const b = returned(str('same'), [str('mallory')]);
    expect(redactionMaskedDifference({ kind: 'outcome', original: a, resurrection: b }, mallory, 'posix')).toBe(
      false,
    );
    const c = returned(str('same'), [str('mallory')]);
    const d = returned(str('same'), [str('<user>')]);
    expect(redactionMaskedDifference({ kind: 'outcome', original: c, resurrection: d }, mallory, 'posix')).toBe(
      true,
    );
  });

  it('works on api-surface summaries', () => {
    const a: ExportSummary = { type: 'string', primitive: str('/home/mallory/a') };
    const b: ExportSummary = { type: 'string', primitive: str('/home/mallory/a') };
    const c: ExportSummary = { type: 'string', primitive: str('<user-home>/a') };
    expect(
      redactionMaskedDifference({ kind: 'api-surface', original: a, resurrection: b }, mallory, 'posix'),
    ).toBe(false);
    expect(
      redactionMaskedDifference({ kind: 'api-surface', original: a, resurrection: c }, mallory, 'posix'),
    ).toBe(true);
    expect(
      redactionMaskedDifference({ kind: 'api-surface', original: null, resurrection: c }, mallory, 'posix'),
    ).toBe(false);
  });

  it('is false when a side cannot be redacted because of a key collision', () => {
    const bad: EncodedNode = {
      t: 'object',
      ctor: 'Object',
      props: [
        ['mallory', str('1')],
        ['<user>', str('2')],
      ],
    };
    expect(
      redactionMaskedDifference(
        { kind: 'outcome', original: returned(bad), resurrection: returned(str('x')) },
        mallory,
        'posix',
      ),
    ).toBe(false);
  });
});
