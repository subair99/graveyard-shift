// Feature: proof-of-life-engine, Property 7: Prototype delta and restoration
//
// Properties 1 to 4 and the not-restorable cases run on injected FAKE prototype sets (plain objects
// under the six prototype names). Only property 5 touches the six real prototypes, through the
// SideRuntime, and every real mutation is made under the unique prefix `__gs_p7_`, with an
// unconditional cleanup in `finally` and a guard test that compares the six real prototypes with a
// snapshot taken before this file ran.
// Requirements: 5.10, 5.12
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeValue } from '../../../src/proof/child/codec/encode.ts'
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
  type PrototypeSnapshot,
} from '../../../src/proof/child/prototypes.ts'
import { createSideRuntime } from '../../../src/proof/child/sideRuntime.ts'
import { fc, fcParams } from '../../engine/helpers/fc.ts'

const PREFIX = '__gs_p7_'

type Fake = Record<ProtoName, Record<PropertyKey, unknown>>
const asSet = (f: Fake): PrototypeSet => f as unknown as PrototypeSet

// ---------------------------------------------------------------------------
// Real prototype guard
// ---------------------------------------------------------------------------

function realState(): Array<[string, PropertyKey, string]> {
  const out: Array<[string, PropertyKey, string]> = []
  const real = realPrototypes()
  for (const name of PROTO_NAMES) {
    const p = real[name]
    for (const k of Reflect.ownKeys(p)) {
      const d = Reflect.getOwnPropertyDescriptor(p, k)!
      const desc =
        'value' in d
          ? `v:${typeof d.value}:${d.writable}:${d.enumerable}:${d.configurable}`
          : `a:${d.enumerable}:${d.configurable}`
      out.push([name, k, desc])
    }
  }
  return out
}

function cleanRealPrototypes(): void {
  const real = realPrototypes()
  for (const name of PROTO_NAMES) {
    const p = real[name]
    for (const k of Reflect.ownKeys(p)) {
      const text = typeof k === 'symbol' ? (k.description ?? '') : k
      if (text.startsWith(PREFIX)) Reflect.deleteProperty(p, k)
    }
  }
}

let originalRealState: Array<[string, PropertyKey, string]>
let originalRealSnapshot: PrototypeSnapshot

beforeAll(() => {
  cleanRealPrototypes()
  originalRealState = realState()
  originalRealSnapshot = snapshotPrototypes(realPrototypes())
})

afterAll(() => {
  cleanRealPrototypes()
})

// ---------------------------------------------------------------------------
// Fake sets and mutations
// ---------------------------------------------------------------------------

interface Keys {
  all: PropertyKey[]
}

function makeKeys(): Keys {
  return {
    all: [
      'existing',
      'other',
      `${PREFIX}a`,
      `${PREFIX}b`,
      Symbol(`${PREFIX}sa`),
      Symbol(`${PREFIX}sb`),
    ],
  }
}

function makeFake(keys: Keys): Fake {
  const set = {} as Fake
  for (const name of PROTO_NAMES) {
    const o: Record<PropertyKey, unknown> = { existing: 1, other: 'x' }
    Object.defineProperty(o, keys.all[4]!, { value: 'sym', writable: true, enumerable: false, configurable: true })
    Object.defineProperty(o, 'acc', { get: () => 1, set: () => undefined, enumerable: false, configurable: true })
    set[name] = o
  }
  return set
}

type Op =
  | { op: 'data'; value: number; enumerable: boolean; writable: boolean }
  | { op: 'accessor'; hasGet: boolean; hasSet: boolean }
  | { op: 'delete' }

interface Mutation {
  proto: number
  key: number
  op: Op
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    op: fc.constant('data' as const),
    value: fc.integer({ min: 0, max: 3 }),
    enumerable: fc.boolean(),
    writable: fc.boolean(),
  }),
  fc.record({ op: fc.constant('accessor' as const), hasGet: fc.boolean(), hasSet: fc.boolean() }),
  fc.record({ op: fc.constant('delete' as const) }),
)

const mutationArb: fc.Arbitrary<Mutation> = fc.record({
  proto: fc.integer({ min: 0, max: 5 }),
  key: fc.integer({ min: 0, max: 5 }),
  op: opArb,
})

function applyMutation(set: Fake, keys: Keys, m: Mutation): void {
  const target = set[PROTO_NAMES[m.proto]!]
  const key = keys.all[m.key]!
  if (m.op.op === 'delete') {
    Reflect.deleteProperty(target, key)
  } else if (m.op.op === 'data') {
    Reflect.defineProperty(target, key, {
      value: m.op.value,
      writable: m.op.writable,
      enumerable: m.op.enumerable,
      configurable: true,
    })
  } else {
    const desc: PropertyDescriptor = { enumerable: false, configurable: true }
    if (m.op.hasGet) desc.get = () => 1 // a fresh function, so it is a different accessor
    if (m.op.hasSet) desc.set = () => undefined
    Reflect.defineProperty(target, key, desc)
  }
}

// Independent oracle: reads the descriptors directly, without the module under test.
type Summary = [ProtoName, string, 'added' | 'changed' | 'removed']

function sameDescriptor(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
  const accA = 'get' in a || 'set' in a
  const accB = 'get' in b || 'set' in b
  if (accA !== accB) return false
  if (a.enumerable !== b.enumerable || a.configurable !== b.configurable) return false
  if (accA) return Object.is(a.get, b.get) && Object.is(a.set, b.set)
  return a.writable === b.writable && Object.is(a.value, b.value)
}

function keyText(k: PropertyKey): string {
  return typeof k === 'symbol' ? `sym:${k.description ?? ''}` : `str:${String(k)}`
}

function rawDescriptors(set: Fake): Map<string, PropertyDescriptor> {
  const out = new Map<string, PropertyDescriptor>()
  for (const name of PROTO_NAMES) {
    for (const k of Reflect.ownKeys(set[name])) {
      out.set(`${name}|${keyText(k)}`, Reflect.getOwnPropertyDescriptor(set[name], k)!)
    }
  }
  return out
}

function oracle(before: Map<string, PropertyDescriptor>, after: Map<string, PropertyDescriptor>): string[] {
  const out: string[] = []
  for (const [id, d] of before) {
    const a = after.get(id)
    if (a === undefined) out.push(`${id}|removed`)
    else if (!sameDescriptor(d, a)) out.push(`${id}|changed`)
  }
  for (const id of after.keys()) if (!before.has(id)) out.push(`${id}|added`)
  return out.sort()
}

function summarize(delta: ReturnType<typeof diffPrototypes>): Summary[] {
  return delta.map((e) => [e.prototype, keyText(e.key), e.change])
}

function asIds(delta: ReturnType<typeof diffPrototypes>): string[] {
  return delta.map((e) => `${e.prototype}|${keyText(e.key)}|${e.change}`).sort()
}

function lockDown(o: object, how: 'preventExtensions' | 'seal' | 'freeze'): void {
  if (how === 'seal') Object.seal(o)
  else if (how === 'freeze') Object.freeze(o)
  else Object.preventExtensions(o)
}

const mutationsArb = fc.array(mutationArb, { minLength: 0, maxLength: 25 })

// ---------------------------------------------------------------------------
// Properties 1 to 4 on fake sets
// ---------------------------------------------------------------------------

describe('Feature: proof-of-life-engine, Property 7: Prototype delta and restoration (fake sets)', () => {
  it('(1) diffPrototypes reports exactly the net changes, with the right kinds', () => {
    fc.assert(
      fc.property(mutationsArb, (mutations) => {
        const keys = makeKeys()
        const set = makeFake(keys)
        const beforeRaw = rawDescriptors(set)
        const before = snapshotPrototypes(asSet(set))
        for (const m of mutations) applyMutation(set, keys, m)
        const delta = diffPrototypes(before, snapshotPrototypes(asSet(set)))
        expect(asIds(delta)).toEqual(oracle(beforeRaw, rawDescriptors(set)))
        for (const e of delta) {
          if (e.change === 'added') expect(e.before).toBeUndefined()
          if (e.change === 'removed') expect(e.after).toBeUndefined()
          if (e.change === 'changed') {
            expect(e.before).toBeDefined()
            expect(e.after).toBeDefined()
          }
        }
      }),
      fcParams(),
    )
  })

  it('(2) restore then re-snapshot equals the original snapshot, and the diff is empty', () => {
    fc.assert(
      fc.property(mutationsArb, (mutations) => {
        const keys = makeKeys()
        const set = makeFake(keys)
        const before = snapshotPrototypes(asSet(set))
        for (const m of mutations) applyMutation(set, keys, m)
        restorePrototypes(asSet(set), before)
        const after = snapshotPrototypes(asSet(set))
        expect(snapshotsEqual(before, after)).toBe(true)
        expect(diffPrototypes(before, after)).toEqual([])
        expect(isRestorable(asSet(set))).toBe(true)
      }),
      fcParams(),
    )
  })

  it('(3) the delta order is deterministic and does not depend on the mutation order', () => {
    // One final state per (prototype, key): the net result no longer depends on the order.
    const distinctArb = fc
      .array(mutationArb, { minLength: 0, maxLength: 30 })
      .map((ms) => {
        const seen = new Map<string, Mutation>()
        for (const m of ms) seen.set(`${m.proto}|${m.key}`, m)
        return [...seen.values()]
      })
    // Accessor mutations create a fresh function per application, so a "changed" accessor
    // would compare unequal across the two runs only in its identity, not in its summary.
    fc.assert(
      fc.property(distinctArb, fc.array(fc.integer(), { minLength: 30, maxLength: 30 }), (muts, weights) => {
        const run = (order: Mutation[]): Summary[] => {
          const keys = makeKeys()
          const set = makeFake(keys)
          const before = snapshotPrototypes(asSet(set))
          for (const m of order) applyMutation(set, keys, m)
          return summarize(diffPrototypes(before, snapshotPrototypes(asSet(set))))
        }
        const shuffled = muts
          .map((m, i) => ({ m, w: weights[i % weights.length]! }))
          .sort((a, b) => a.w - b.w)
          .map((x) => x.m)
        const first = run(muts)
        expect(run(shuffled)).toEqual(first)
        expect(run(muts)).toEqual(first)
        // Fixed prototype order, then strings before symbols.
        const protoIdx = first.map((s) => PROTO_NAMES.indexOf(s[0]))
        expect(protoIdx).toEqual([...protoIdx].sort((a, b) => a - b))
        for (const name of PROTO_NAMES) {
          const kinds = first.filter((s) => s[0] === name).map((s) => (s[1].startsWith('sym:') ? 1 : 0))
          expect(kinds).toEqual([...kinds].sort((a, b) => a - b))
        }
      }),
      fcParams(),
    )
  })

  it('(4) restoring twice equals restoring once', () => {
    fc.assert(
      fc.property(mutationsArb, (mutations) => {
        const keys = makeKeys()
        const set = makeFake(keys)
        const before = snapshotPrototypes(asSet(set))
        for (const m of mutations) applyMutation(set, keys, m)
        restorePrototypes(asSet(set), before)
        const once = snapshotPrototypes(asSet(set))
        restorePrototypes(asSet(set), before)
        const twice = snapshotPrototypes(asSet(set))
        expect(snapshotsEqual(once, twice)).toBe(true)
        expect(snapshotsEqual(before, twice)).toBe(true)
      }),
      fcParams(),
    )
  })
})

// ---------------------------------------------------------------------------
// Not restorable: fake sets only
// ---------------------------------------------------------------------------

describe('Feature: proof-of-life-engine, Property 7: Prototype delta and restoration (not restorable, fake sets)', () => {
  const protoArb = fc.integer({ min: 0, max: 5 })

  it('an added non-configurable property cannot be removed: restoration is not complete', () => {
    fc.assert(
      fc.property(protoArb, fc.integer({ min: 2, max: 3 }), mutationsArb, (p, k, mutations) => {
        const keys = makeKeys()
        const set = makeFake(keys)
        const before = snapshotPrototypes(asSet(set))
        for (const m of mutations) applyMutation(set, keys, m)
        // Key 2 and 3 do not exist in the base set; make sure the pin is the last write.
        const target = set[PROTO_NAMES[p]!]
        Reflect.deleteProperty(target, keys.all[k]!)
        Reflect.defineProperty(target, keys.all[k]!, { value: 1, configurable: false })
        restorePrototypes(asSet(set), before)
        expect(snapshotsEqual(before, snapshotPrototypes(asSet(set)))).toBe(false)
      }),
      fcParams(),
    )
  })

  it('a prototype made non-extensible after a removal keeps the removed property missing', () => {
    fc.assert(
      fc.property(protoArb, fc.constantFrom(0, 1), fc.constantFrom('preventExtensions', 'seal', 'freeze'), (p, k, how) => {
        const keys = makeKeys()
        const set = makeFake(keys)
        const before = snapshotPrototypes(asSet(set))
        const target = set[PROTO_NAMES[p]!]
        Reflect.deleteProperty(target, keys.all[k]!)
        lockDown(target, how)
        restorePrototypes(asSet(set), before)
        expect(snapshotsEqual(before, snapshotPrototypes(asSet(set)))).toBe(false)
        expect(isRestorable(asSet(set))).toBe(false)
      }),
      fcParams(),
    )
  })

  it('a frozen or sealed prototype is reported as not restorable even without a delta', () => {
    fc.assert(
      fc.property(protoArb, fc.constantFrom('preventExtensions', 'seal', 'freeze'), (p, how) => {
        const keys = makeKeys()
        const set = makeFake(keys)
        const before = snapshotPrototypes(asSet(set))
        lockDown(set[PROTO_NAMES[p]!], how)
        restorePrototypes(asSet(set), before)
        expect(isRestorable(asSet(set))).toBe(false)
      }),
      fcParams(),
    )
  })
})

// ---------------------------------------------------------------------------
// Property 5: through the SideRuntime, in process, on the real prototypes
// ---------------------------------------------------------------------------

const PACKAGE_SOURCE = `'use strict'
const PREFIX = '${PREFIX}'
const protos = [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype, Boolean.prototype]
const syms = new Map()
function keyOf(name) {
  if (name.startsWith('sym:')) {
    if (!syms.has(name)) syms.set(name, Symbol(name.slice(4)))
    return syms.get(name)
  }
  return name
}
exports.mutate = function mutate(plan) {
  for (const step of plan) {
    const p = protos[step[0]]
    const kind = step[1]
    const key = keyOf(step[2])
    if (kind === 'add') Object.defineProperty(p, key, { value: step[3], writable: true, enumerable: false, configurable: true })
    else if (kind === 'change') Object.defineProperty(p, key, { value: step[3] + 1, writable: false, enumerable: true, configurable: true })
    else if (kind === 'accessor') Object.defineProperty(p, key, { get() { return 1 }, set(v) {}, enumerable: false, configurable: true })
    else if (kind === 'delete') delete p[key]
  }
  return plan.length
}
exports.probe = function probe() {
  const found = []
  for (const p of protos) {
    for (const k of Reflect.ownKeys(p)) {
      const text = typeof k === 'symbol' ? (k.description || '') : k
      if (text.startsWith(PREFIX)) found.push(text)
    }
  }
  return found
}
`

let packageDir: string

beforeAll(() => {
  packageDir = mkdtempSync(join(tmpdir(), 'gs-p7-'))
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'gs-p7', version: '1.0.0' }))
  writeFileSync(join(packageDir, 'index.js'), PACKAGE_SOURCE)
})

afterAll(() => {
  rmSync(packageDir, { recursive: true, force: true })
})

type Step = [number, 'add' | 'change' | 'accessor' | 'delete', string, number]

const stepArb: fc.Arbitrary<Step> = fc.tuple(
  fc.integer({ min: 0, max: 5 }),
  fc.constantFrom('add', 'change', 'accessor', 'delete'),
  fc.oneof(
    fc.constantFrom('a', 'b', 'c').map((s) => `${PREFIX}${s}`),
    fc.constantFrom('sa', 'sb').map((s) => `sym:${PREFIX}${s}`),
  ),
  fc.integer({ min: 0, max: 5 }),
)

function expectedAfterPlan(plan: Step[]): string[] {
  // The real prototypes hold no `__gs_p7_` key before a call, so every surviving key is `added`.
  const present = new Map<string, boolean>()
  for (const [p, kind, name] of plan) {
    present.set(`${p}|${name}`, kind !== 'delete')
  }
  const out: string[] = []
  for (const [id, on] of present) {
    if (!on) continue
    const [p, ...rest] = id.split('|')
    const name = rest.join('|')
    out.push(`${PROTO_NAMES[Number(p)]}|${name.startsWith('sym:') ? name : `str:${name}`}|added`)
  }
  return out.sort()
}

describe('Feature: proof-of-life-engine, Property 7: Prototype delta and restoration (SideRuntime)', () => {
  it('(5) the call carries the delta, restoreVerified is true, and the next call sees clean prototypes', async () => {
    const runtime = createSideRuntime({ packageDir, entryFile: 'index.js', outputLimitBytes: 1_000_000 })
    expect(runtime.load()).toEqual({ ok: true, value: undefined })
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 0, maxLength: 12 }), async (plan) => {
        try {
          const encoded = encodeValue(plan, { budget: 1_000_000 })
          if (!encoded.ok) throw new Error('plan not encodable')
          const response = await runtime.call({
            fn: 'mutate',
            args: [encoded.node],
            caseSeed: 1,
            properties: [],
            timeoutMs: 0,
          })
          const outcome = response.result.outcome
          expect(outcome.kind).toBe('returned')
          if (outcome.kind !== 'returned') return
          const got = outcome.prototypeDelta
            .map((e) => {
              const key = 's' in e.key ? `str:${e.key.s}` : `sym:${e.key.sym ?? ''}`
              expect(key.includes(PREFIX)).toBe(true)
              return `${e.prototype}|${key}|${e.change}`
            })
            .sort()
          expect(got).toEqual(expectedAfterPlan(plan))
          expect(response.restoreVerified).toBe(true)

          // The next call on the same runtime sees clean prototypes and reports no delta.
          const probe = await runtime.call({ fn: 'probe', args: [], caseSeed: 1, properties: [], timeoutMs: 0 })
          expect(probe.restoreVerified).toBe(true)
          const pOutcome = probe.result.outcome
          expect(pOutcome.kind).toBe('returned')
          if (pOutcome.kind === 'returned') {
            expect(pOutcome.prototypeDelta).toEqual([])
            const empty = encodeValue([], { budget: 1_000_000 })
            expect(empty.ok).toBe(true)
            if (empty.ok) expect(pOutcome.value).toEqual(empty.node)
          }
          expect(realState()).toEqual(originalRealState)
        } finally {
          cleanRealPrototypes()
        }
      }),
      fcParams(),
    )
  })
})

describe('real prototype guard', () => {
  it('the six real prototypes are identical to the snapshot taken before this file ran', () => {
    cleanRealPrototypes()
    const now = snapshotPrototypes(realPrototypes())
    expect(snapshotsEqual(originalRealSnapshot, now)).toBe(true)
    expect(diffPrototypes(originalRealSnapshot, now)).toEqual([])
    expect(realState()).toEqual(originalRealState)
  })
})
