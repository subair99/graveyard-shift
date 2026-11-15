// Requirements: 5.10, 5.12
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROTO_NAMES,
  diffPrototypes,
  isRestorable,
  realPrototypes,
  restorePrototypes,
  snapshotPrototypes,
  snapshotsEqual,
  type PrototypeSet,
  type ProtoName,
} from '../../../src/proof/child/prototypes.ts'

const PREFIX = '__gs_test_'

function fakeSet(): Record<ProtoName, Record<PropertyKey, unknown>> {
  const set = {} as Record<ProtoName, Record<PropertyKey, unknown>>
  for (const name of PROTO_NAMES) set[name] = { existing: 1, other: 'x' }
  return set
}

const realKeys = (): string[] =>
  Object.values(realPrototypes()).flatMap((p) =>
    Reflect.ownKeys(p as object).filter((k) => typeof k === 'string' && k.startsWith(PREFIX)),
  ) as string[]

afterEach(() => {
  // Safety net: never leave a test property on a real prototype.
  for (const p of Object.values(realPrototypes())) {
    for (const k of Reflect.ownKeys(p as object)) {
      if (typeof k === 'string' && k.startsWith(PREFIX)) Reflect.deleteProperty(p as object, k)
    }
  }
  expect(realKeys()).toEqual([])
})

describe('prototype delta on fake sets', () => {
  it('reports added, changed and removed properties in fixed prototype order', () => {
    const set = fakeSet()
    const before = snapshotPrototypes(set as unknown as PrototypeSet)
    set['Boolean.prototype']['added'] = 1
    set['Object.prototype']['existing'] = 2
    delete set['Array.prototype']['other']
    const delta = diffPrototypes(before, snapshotPrototypes(set as unknown as PrototypeSet))
    expect(delta.map((d) => [d.prototype, d.key, d.change])).toEqual([
      ['Object.prototype', 'existing', 'changed'],
      ['Array.prototype', 'other', 'removed'],
      ['Boolean.prototype', 'added', 'added'],
    ])
    expect(delta[0]!.before!.value).toBe(1)
    expect(delta[0]!.after!.value).toBe(2)
    expect(delta[1]!.after).toBeUndefined()
    expect(delta[2]!.before).toBeUndefined()
  })

  it('is empty when nothing changed', () => {
    const set = fakeSet() as unknown as PrototypeSet
    expect(diffPrototypes(snapshotPrototypes(set), snapshotPrototypes(set))).toEqual([])
  })

  it('orders string keys by code point, then symbols by description then index', () => {
    const set = fakeSet()
    const before = snapshotPrototypes(set as unknown as PrototypeSet)
    const o = set['Object.prototype']
    const sB = Symbol('b')
    const sA2 = Symbol('a')
    const sA1 = Symbol('a')
    o[sB] = 1
    o['z'] = 1
    o[sA1] = 1
    o['\u{1F600}'] = 1
    o['\uFFFF'] = 1
    o[sA2] = 1
    o['a'] = 1
    const keys = diffPrototypes(before, snapshotPrototypes(set as unknown as PrototypeSet)).map((d) => d.key)
    // Code point order puts U+FFFF before U+1F600 (UTF-16 order would not).
    expect(keys.slice(0, 4)).toEqual(['a', 'z', '\uFFFF', '\u{1F600}'])
    expect(keys.slice(4)).toEqual([sA1, sA2, sB])
  })

  it('records accessor descriptors and restores them', () => {
    const set = fakeSet()
    const get = (): number => 7
    Object.defineProperty(set['String.prototype'], 'acc', { get, configurable: true, enumerable: false })
    const s = set as unknown as PrototypeSet
    const before = snapshotPrototypes(s)
    Object.defineProperty(set['String.prototype'], 'acc', { value: 1, configurable: true })
    const delta = diffPrototypes(before, snapshotPrototypes(s))
    expect(delta).toHaveLength(1)
    expect(delta[0]!.change).toBe('changed')
    expect(delta[0]!.before!.get).toBe(get)
    restorePrototypes(s, before)
    const d = Object.getOwnPropertyDescriptor(set['String.prototype'], 'acc')!
    expect(d.get).toBe(get)
    expect(d.set).toBeUndefined()
    expect(d.enumerable).toBe(false)
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(true)
  })

  it('restores symbol keys, removed keys and changed flags, and verification passes', () => {
    const set = fakeSet()
    const sym = Symbol('keep')
    set['Number.prototype'][sym] = 'v'
    const s = set as unknown as PrototypeSet
    const before = snapshotPrototypes(s)
    delete set['Number.prototype'][sym]
    delete set['Function.prototype']['existing']
    Object.defineProperty(set['Object.prototype'], 'other', { enumerable: false })
    set['Array.prototype']['extra'] = 1
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(false)
    restorePrototypes(s, before)
    expect(set['Number.prototype'][sym]).toBe('v')
    expect(set['Function.prototype']['existing']).toBe(1)
    expect('extra' in set['Array.prototype']).toBe(false)
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(true)
  })

  it('is not disturbed by a polluted Object.prototype in the fake set', () => {
    const set = fakeSet()
    const s = set as unknown as PrototypeSet
    const before = snapshotPrototypes(s)
    set['Object.prototype']['polluted'] = 1
    restorePrototypes(s, before)
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(true)
  })
})

describe('restorability', () => {
  it('reports frozen, sealed and non-extensible sets as not restorable', () => {
    for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) {
      const set = fakeSet()
      lock(set['Array.prototype'])
      expect(isRestorable(set as unknown as PrototypeSet)).toBe(false)
    }
    expect(isRestorable(fakeSet() as unknown as PrototypeSet)).toBe(true)
  })

  it('fails verification when a non-configurable property was changed or removed', () => {
    const set = fakeSet()
    Object.defineProperty(set['Boolean.prototype'], 'nc', { value: 1, configurable: false, writable: false })
    Object.defineProperty(set['Boolean.prototype'], 'nc2', { value: 1, configurable: false, writable: true })
    const s = set as unknown as PrototypeSet
    const before = snapshotPrototypes(s)
    // A writable non-configurable value can be put back; a read-only one is never changed here.
    set['Boolean.prototype']['nc2'] = 5
    restorePrototypes(s, before)
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(true)

    // A non-configurable property that is added cannot be deleted.
    Object.defineProperty(set['Boolean.prototype'], 'added_nc', { value: 1, configurable: false })
    restorePrototypes(s, before)
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(false)
  })

  it('fails verification on a frozen set after a change was made earlier', () => {
    const set = fakeSet()
    const s = set as unknown as PrototypeSet
    const before = snapshotPrototypes(s)
    set['String.prototype']['late'] = 1
    Object.freeze(set['String.prototype'])
    restorePrototypes(s, before)
    expect(snapshotsEqual(before, snapshotPrototypes(s))).toBe(false)
    expect(isRestorable(s)).toBe(false)
  })
})

describe('real prototypes', () => {
  it('detects and restores properties added, changed and removed on each prototype', () => {
    const real = realPrototypes()
    const before = snapshotPrototypes(real)
    try {
      for (const name of PROTO_NAMES) {
        const p = real[name] as Record<string, unknown>
        p[`${PREFIX}added`] = 1
      }
      const mid = snapshotPrototypes(real)
      const delta = diffPrototypes(before, mid)
      expect(delta.map((d) => [d.prototype, d.key, d.change])).toEqual(
        PROTO_NAMES.map((n) => [n, `${PREFIX}added`, 'added']),
      )
      restorePrototypes(real, before)
      expect(snapshotsEqual(before, snapshotPrototypes(real))).toBe(true)
      expect(realKeys()).toEqual([])
    } finally {
      restorePrototypes(real, before)
    }
  })

  it('restores a changed and a removed property and an accessor with a symbol key', () => {
    const real = realPrototypes()
    const sym = Symbol(`${PREFIX}sym`)
    const key = `${PREFIX}own`
    Object.defineProperty(Array.prototype, key, { value: 'orig', configurable: true, writable: true })
    Object.defineProperty(Object.prototype, sym, { get: () => 1, configurable: true })
    const before = snapshotPrototypes(real)
    try {
      Object.defineProperty(Array.prototype, key, { value: 'changed' })
      delete (Object.prototype as unknown as Record<symbol, unknown>)[sym]
      const delta = diffPrototypes(before, snapshotPrototypes(real))
      expect(delta.map((d) => [d.prototype, d.change])).toEqual([
        ['Object.prototype', 'removed'],
        ['Array.prototype', 'changed'],
      ])
      restorePrototypes(real, before)
      expect(snapshotsEqual(before, snapshotPrototypes(real))).toBe(true)
      expect(Object.getOwnPropertyDescriptor(Object.prototype, sym)!.get).toBeTypeOf('function')
      expect((Array.prototype as unknown as Record<string, unknown>)[key]).toBe('orig')
    } finally {
      restorePrototypes(real, before)
      Reflect.deleteProperty(Array.prototype, key)
      Reflect.deleteProperty(Object.prototype, sym)
    }
  })

  it('treats the real prototypes as restorable', () => {
    expect(isRestorable(realPrototypes())).toBe(true)
  })
})
