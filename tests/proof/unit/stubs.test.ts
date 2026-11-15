import { afterEach, describe, expect, it } from 'vitest';
import { FROZEN_TIME_MS, installStubs, type StubHandle } from '../../../src/proof/child/stubs.ts';

const RealDate = globalThis.Date;
const realRandom = Math.random;

let handle: StubHandle | undefined;

afterEach(() => {
  handle?.restore();
  handle = undefined;
  globalThis.Date = RealDate;
  Math.random = realRandom;
});

function sequence(n: number): number[] {
  return Array.from({ length: n }, () => Math.random());
}

describe('Date stub', () => {
  it('freezes Date.now and new Date() at 2000-01-01T00:00:00.000Z', () => {
    handle = installStubs();
    expect(Date.now()).toBe(946684800000);
    expect(FROZEN_TIME_MS).toBe(946684800000);
    expect(new Date().toISOString()).toBe('2000-01-01T00:00:00.000Z');
    expect(new Date().getTime()).toBe(new Date().getTime());
  });

  it('uses a frozen time given in the options', () => {
    handle = installStubs({ frozenTimeMs: 5000 });
    expect(Date.now()).toBe(5000);
    expect(new Date().getTime()).toBe(5000);
  });

  it('leaves new Date(x), Date.UTC and Date.parse unchanged', () => {
    handle = installStubs();
    expect(new Date(123456).getTime()).toBe(123456);
    expect(new Date('2020-02-03T04:05:06.000Z').toISOString()).toBe('2020-02-03T04:05:06.000Z');
    expect(new Date(2020, 0, 1).getFullYear()).toBe(2020);
    expect(Date.UTC(2001, 1, 3)).toBe(RealDate.UTC(2001, 1, 3));
    expect(Date.parse('2001-02-03T00:00:00.000Z')).toBe(RealDate.parse('2001-02-03T00:00:00.000Z'));
  });

  it('keeps instanceof working for real Dates created before and after', () => {
    const before = new RealDate(42);
    handle = installStubs();
    expect(before instanceof Date).toBe(true);
    expect(new Date() instanceof Date).toBe(true);
    expect(new Date() instanceof RealDate).toBe(true);
    expect(Object.getPrototypeOf(new Date())).toBe(RealDate.prototype);
  });

  it('keeps Date subclassable and calling Date() returns a string', () => {
    handle = installStubs();
    class Sub extends Date {
      tag = 'sub';
    }
    const s = new Sub();
    expect(s instanceof Sub).toBe(true);
    expect(s.getTime()).toBe(FROZEN_TIME_MS);
    expect(new Sub(7).getTime()).toBe(7);
    expect(typeof (Date as unknown as () => string)()).toBe('string');
  });

  it('can be left off', () => {
    handle = installStubs({ date: false });
    expect(globalThis.Date).toBe(RealDate);
  });
});

describe('Math.random stub', () => {
  it('gives the same sequence for the same seed, values in [0, 1)', () => {
    handle = installStubs({ seed: 7 });
    const a = sequence(20);
    handle.reseed(7);
    const b = sequence(20);
    expect(b).toEqual(a);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gives different sequences for different seeds', () => {
    handle = installStubs();
    handle.reseed(1);
    const a = sequence(10);
    handle.reseed(2);
    expect(sequence(10)).not.toEqual(a);
  });

  it('restarts the sequence when re-seeded mid-way', () => {
    handle = installStubs();
    handle.reseed(-123);
    const first = Math.random();
    sequence(5);
    handle.reseed(-123);
    expect(Math.random()).toBe(first);
  });

  it('matches the mulberry32 reference for seed 0', () => {
    handle = installStubs({ seed: 0 });
    let s = 0;
    const ref = (): number => {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    expect(sequence(5)).toEqual([ref(), ref(), ref(), ref(), ref()]);
  });

  it('can be left off', () => {
    handle = installStubs({ random: false });
    expect(Math.random).toBe(realRandom);
    handle.reseed(1);
    expect(Math.random).toBe(realRandom);
  });
});

describe('install and restore', () => {
  it('restore returns the originals and is repeatable', () => {
    handle = installStubs();
    expect(globalThis.Date).not.toBe(RealDate);
    expect(Math.random).not.toBe(realRandom);
    handle.restore();
    expect(globalThis.Date).toBe(RealDate);
    expect(Math.random).toBe(realRandom);
    handle.restore();
    expect(globalThis.Date).toBe(RealDate);
  });

  it('is idempotent: installing twice does not wrap the stubs twice', () => {
    const first = installStubs();
    const stubDate = globalThis.Date;
    const stubRandom = Math.random;
    handle = installStubs();
    expect(globalThis.Date).toBe(stubDate);
    expect(Math.random).toBe(stubRandom);
    first.restore();
    expect(globalThis.Date).toBe(RealDate);
    expect(Math.random).toBe(realRandom);
  });

  it('does not touch Date.prototype', () => {
    const keys = Reflect.ownKeys(RealDate.prototype);
    handle = installStubs();
    expect(Reflect.ownKeys(Date.prototype)).toEqual(keys);
    expect(Date.prototype).toBe(RealDate.prototype);
  });
});
