// Requirements: 8.5
import { describe, expect, it } from 'vitest';
import { deriveSeed } from '../../../src/proof/core/seeds';

/** Independent reference: FNV-1a 32 bit with BigInt arithmetic over UTF-8 bytes. */
function referenceFnv1a(input: string): number {
  let hash = 0x811c9dc5n;
  for (const byte of new TextEncoder().encode(input)) {
    hash = ((hash ^ BigInt(byte)) * 0x01000193n) & 0xffffffffn;
  }
  return Number(BigInt.asIntN(32, hash));
}

describe('deriveSeed', () => {
  it('is stable across calls', () => {
    expect(deriveSeed(42, 'f', '[1]', '0')).toBe(deriveSeed(42, 'f', '[1]', '0'));
  });

  it('matches the FNV-1a reference over `${seed}\\0${parts.join("\\0")}`', () => {
    expect(deriveSeed(42, 'fn', '[1,2]', '3')).toBe(referenceFnv1a('42\0fn\0[1,2]\x003'));
    expect(deriveSeed(7)).toBe(referenceFnv1a('7\0'));
    expect(deriveSeed(-5, 'é', '😀')).toBe(referenceFnv1a('-5\0é\0😀'));
    expect(KNOWN.empty).toBe(referenceFnv1a('0\0'));
    expect(KNOWN.typical).toBe(referenceFnv1a('42\0set\0[{"a":1},"a.b",2]\x000'));
    expect(KNOWN.unicode).toBe(referenceFnv1a('-1\0é\0😀'));
  });

  it('matches known-answer regression values', () => {
    expect(deriveSeed(0)).toBe(KNOWN.empty);
    expect(deriveSeed(42, 'set', '[{"a":1},"a.b",2]', '0')).toBe(KNOWN.typical);
    expect(deriveSeed(-1, 'é', '😀')).toBe(KNOWN.unicode);
  });

  it('always returns an int32', () => {
    for (let i = 0; i < 200; i++) {
      const value = deriveSeed(i, 'f', String(i * 7));
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-2147483648);
      expect(value).toBeLessThanOrEqual(2147483647);
    }
  });

  it('gives different seeds for different inputs', () => {
    const base = deriveSeed(1, 'f', '[1]', '0');
    expect(deriveSeed(2, 'f', '[1]', '0')).not.toBe(base);
    expect(deriveSeed(1, 'g', '[1]', '0')).not.toBe(base);
    expect(deriveSeed(1, 'f', '[2]', '0')).not.toBe(base);
    expect(deriveSeed(1, 'f', '[1]', '1')).not.toBe(base);
  });

  it('separates parts with a delimiter so boundaries matter', () => {
    expect(deriveSeed(1, 'ab', 'c')).not.toBe(deriveSeed(1, 'a', 'bc'));
  });

  it('does not depend on what was derived before (no hidden state)', () => {
    const first = deriveSeed(9, 'a', 'x');
    deriveSeed(9, 'b', 'y');
    deriveSeed(3, 'c');
    expect(deriveSeed(9, 'a', 'x')).toBe(first);
  });
});

// Regression values computed from the implementation (and cross-checked by the
// BigInt reference above in the reference test).
const KNOWN = {
  empty: 837651325,
  typical: 1692114350,
  unicode: 1139600870,
};
