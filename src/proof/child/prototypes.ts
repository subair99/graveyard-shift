// Prototype_Snapshot, Prototype_Delta, restoration and verification for the six built-in
// prototypes (Requirements 5.10 to 5.12). Sandbox side: self-contained, erasable TypeScript only,
// no file system and no network.
//
// The module captures the intrinsics it needs when it loads, so a package that pollutes
// `Object.prototype` (for example with `get`, `value` or `then`) cannot disturb the snapshot,
// the diff or the restoration. Descriptors are stored as null-prototype records for the same reason.
//
// Scope: own properties of the six prototypes only (limitation L9). The [[Prototype]] of
// `Object.prototype` is immutable in the language (it is an immutable prototype exotic object),
// so the `__proto__` accessor on `Object.prototype` is covered as an ordinary own property and
// a prototype-chain change there cannot happen. Chains of the other five are not part of the delta.

import { compareCodePoints } from './codec/order.ts'

export type ProtoName =
  | 'Object.prototype'
  | 'Array.prototype'
  | 'Function.prototype'
  | 'String.prototype'
  | 'Number.prototype'
  | 'Boolean.prototype'

export type PrototypeSet = Readonly<Record<ProtoName, object>>

export type PropKey = string | symbol

export interface PrototypeSnapshot {
  readonly entries: ReadonlyMap<ProtoName, ReadonlyMap<PropKey, PropertyDescriptor>>
}

export interface RawDeltaEntry {
  prototype: ProtoName
  key: PropKey
  change: 'added' | 'changed' | 'removed'
  before?: PropertyDescriptor
  after?: PropertyDescriptor
}

/** The fixed order of the six prototypes. */
export const PROTO_NAMES: readonly ProtoName[] = [
  'Object.prototype',
  'Array.prototype',
  'Function.prototype',
  'String.prototype',
  'Number.prototype',
  'Boolean.prototype',
]

// Intrinsics captured at load time.
const ownKeys = Reflect.ownKeys
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor
const defineProperty = Reflect.defineProperty
const deleteProperty = Reflect.deleteProperty
const isExtensible = Reflect.isExtensible
const isFrozen = Object.isFrozen
const isSealed = Object.isSealed
const is = Object.is
const create = Object.create
const symbolDescription = (s: symbol): string => s.description ?? ''
const mapCtor = Map
const mapGet = Map.prototype.get
const mapSet = Map.prototype.set
const mapHas = Map.prototype.has
const mapKeys = Map.prototype.keys
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
const mapIterNext = Object.getPrototypeOf(new Map().keys()).next as () => IteratorResult<PropKey>
const arrayPush = Array.prototype.push
const arraySort = Array.prototype.sort

/** The real six prototypes of this realm. */
export function realPrototypes(): PrototypeSet {
  return {
    'Object.prototype': Object.prototype,
    'Array.prototype': Array.prototype,
    'Function.prototype': Function.prototype,
    'String.prototype': String.prototype,
    'Number.prototype': Number.prototype,
    'Boolean.prototype': Boolean.prototype,
  }
}

type Rec = { [k: string]: unknown }

function copyDescriptor(d: PropertyDescriptor): PropertyDescriptor {
  const out = create(null) as Rec
  const src = d as Rec
  if ('value' in d || 'writable' in d) {
    out['value'] = src['value']
    out['writable'] = src['writable']
  } else {
    out['get'] = src['get']
    out['set'] = src['set']
  }
  out['enumerable'] = src['enumerable']
  out['configurable'] = src['configurable']
  return out as PropertyDescriptor
}

function descriptorsEqual(a: PropertyDescriptor | undefined, b: PropertyDescriptor | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  const x = a as Rec
  const y = b as Rec
  const accessorA = 'get' in a || 'set' in a
  const accessorB = 'get' in b || 'set' in b
  if (accessorA !== accessorB) return false
  if (x['enumerable'] !== y['enumerable'] || x['configurable'] !== y['configurable']) return false
  if (accessorA) return is(x['get'], y['get']) && is(x['set'], y['set'])
  return x['writable'] === y['writable'] && is(x['value'], y['value'])
}

function currentDescriptors(proto: object): Map<PropKey, PropertyDescriptor> {
  const out = new mapCtor<PropKey, PropertyDescriptor>()
  const keys = ownKeys(proto) as PropKey[]
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    const d = getOwnPropertyDescriptor(proto, key)
    if (d !== undefined) mapSet.call(out, key, copyDescriptor(d))
  }
  return out
}

/** Records the own properties (strings and symbols) and their descriptors of the six prototypes. */
export function snapshotPrototypes(set: PrototypeSet): PrototypeSnapshot {
  const entries = new mapCtor<ProtoName, ReadonlyMap<PropKey, PropertyDescriptor>>()
  for (let i = 0; i < PROTO_NAMES.length; i++) {
    const name = PROTO_NAMES[i]!
    mapSet.call(entries, name, currentDescriptors(set[name]))
  }
  return { entries }
}

function keysOf(m: ReadonlyMap<PropKey, PropertyDescriptor>): PropKey[] {
  const out: PropKey[] = []
  const it = mapKeys.call(m) as Iterator<PropKey>
  for (;;) {
    const r = mapIterNext.call(it)
    if (r.done === true) break
    arrayPush.call(out, r.value)
  }
  return out
}

function entriesOf(s: PrototypeSnapshot, name: ProtoName): ReadonlyMap<PropKey, PropertyDescriptor> {
  return (mapGet.call(s.entries, name) as ReadonlyMap<PropKey, PropertyDescriptor> | undefined) ?? new mapCtor()
}

/** Orders keys: strings by code point, then symbols by description (code point), then by first-seen index. */
function sortKeys(keys: PropKey[]): PropKey[] {
  const indexed: Array<{ key: PropKey; index: number }> = []
  for (let i = 0; i < keys.length; i++) arrayPush.call(indexed, { key: keys[i]!, index: i })
  arraySort.call(indexed, (a: { key: PropKey; index: number }, b: { key: PropKey; index: number }) => {
    const sa = typeof a.key === 'symbol'
    const sb = typeof b.key === 'symbol'
    if (sa !== sb) return sa ? 1 : -1
    if (!sa) {
      const c = compareCodePoints(a.key as string, b.key as string)
      return c !== 0 ? c : a.index - b.index
    }
    const c = compareCodePoints(symbolDescription(a.key as symbol), symbolDescription(b.key as symbol))
    return c !== 0 ? c : a.index - b.index
  })
  const out: PropKey[] = []
  for (let i = 0; i < indexed.length; i++) arrayPush.call(out, indexed[i]!.key)
  return out
}

/**
 * The properties added, changed or removed between two snapshots, in canonical order: fixed
 * prototype order, then string keys by code point, then symbol keys by description then index.
 */
export function diffPrototypes(before: PrototypeSnapshot, after: PrototypeSnapshot): RawDeltaEntry[] {
  const out: RawDeltaEntry[] = []
  for (let p = 0; p < PROTO_NAMES.length; p++) {
    const name = PROTO_NAMES[p]!
    const b = entriesOf(before, name)
    const a = entriesOf(after, name)
    const union: PropKey[] = keysOf(b)
    const ak = keysOf(a)
    for (let i = 0; i < ak.length; i++) {
      if (!(mapHas.call(b, ak[i]!) as boolean)) arrayPush.call(union, ak[i]!)
    }
    const sorted = sortKeys(union)
    for (let i = 0; i < sorted.length; i++) {
      const key = sorted[i]!
      const db = mapGet.call(b, key) as PropertyDescriptor | undefined
      const da = mapGet.call(a, key) as PropertyDescriptor | undefined
      if (db === undefined && da !== undefined) {
        arrayPush.call(out, { prototype: name, key, change: 'added', after: da } satisfies RawDeltaEntry)
      } else if (db !== undefined && da === undefined) {
        arrayPush.call(out, { prototype: name, key, change: 'removed', before: db } satisfies RawDeltaEntry)
      } else if (db !== undefined && da !== undefined && !descriptorsEqual(db, da)) {
        arrayPush.call(out, { prototype: name, key, change: 'changed', before: db, after: da } satisfies RawDeltaEntry)
      }
    }
  }
  return out
}

/**
 * Deletes added properties and redefines changed or removed ones from the saved descriptors
 * (accessors and symbols included). A property that cannot be touched (non-configurable, or the
 * prototype is frozen, sealed or non-extensible) is left as is; `snapshotsEqual` then reports the failure.
 */
export function restorePrototypes(set: PrototypeSet, snapshot: PrototypeSnapshot): void {
  for (let p = 0; p < PROTO_NAMES.length; p++) {
    const name = PROTO_NAMES[p]!
    const proto = set[name]
    const saved = entriesOf(snapshot, name)
    const now = currentDescriptors(proto)
    const nowKeys = keysOf(now)
    for (let i = 0; i < nowKeys.length; i++) {
      const key = nowKeys[i]!
      if (!(mapHas.call(saved, key) as boolean)) {
        try {
          deleteProperty(proto, key)
        } catch {
          // ignored: verification reports it
        }
      }
    }
    const savedKeys = keysOf(saved)
    for (let i = 0; i < savedKeys.length; i++) {
      const key = savedKeys[i]!
      const want = mapGet.call(saved, key) as PropertyDescriptor
      const have = mapGet.call(now, key) as PropertyDescriptor | undefined
      if (have !== undefined && descriptorsEqual(have, want)) continue
      try {
        defineProperty(proto, key, copyDescriptor(want))
      } catch {
        // ignored: verification reports it
      }
    }
  }
}

/** True when the two snapshots hold the same keys with equal descriptors on every prototype. */
export function snapshotsEqual(a: PrototypeSnapshot, b: PrototypeSnapshot): boolean {
  for (let p = 0; p < PROTO_NAMES.length; p++) {
    const name = PROTO_NAMES[p]!
    const x = entriesOf(a, name)
    const y = entriesOf(b, name)
    if ((mapSize.call(x) as number) !== (mapSize.call(y) as number)) return false
    const keys = keysOf(x)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!
      if (!(mapHas.call(y, key) as boolean)) return false
      if (!descriptorsEqual(mapGet.call(x, key) as PropertyDescriptor, mapGet.call(y, key) as PropertyDescriptor)) {
        return false
      }
    }
  }
  return true
}

/** False when any prototype is frozen, sealed or non-extensible, so removed properties cannot come back. */
export function isRestorable(set: PrototypeSet): boolean {
  for (let p = 0; p < PROTO_NAMES.length; p++) {
    const proto = set[PROTO_NAMES[p]!]
    if (isFrozen(proto) || isSealed(proto) || !isExtensible(proto)) return false
  }
  return true
}
