// Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.9, 13.11, 15.11, 15.12
import { describe, expect, it } from 'vitest'
import { decodeNode } from '../../../src/proof/child/codec/decode.ts'
import { encodeValue } from '../../../src/proof/child/codec/encode.ts'
import { canonicalizeNode, nodeJson } from '../../../src/proof/child/codec/canonical.ts'
import type { EncodedNode } from '../../../src/proof/child/codec/nodes.ts'

const BUDGET = 10_000_000

function enc(value: unknown): EncodedNode {
  const r = encodeValue(value, { budget: BUDGET })
  if (!r.ok) throw new Error('unexpected output-too-large')
  return r.node
}

function roundTrip(value: unknown): unknown {
  return decodeNode(enc(value))
}

describe('Value_Codec: primitives', () => {
  it('encodes undefined, null, boolean, string', () => {
    expect(enc(undefined)).toEqual({ t: 'undefined' })
    expect(enc(null)).toEqual({ t: 'null' })
    expect(enc(true)).toEqual({ t: 'bool', v: true })
    expect(enc('héllo')).toEqual({ t: 'str', v: 'héllo' })
  })

  it('encodes numbers including NaN, Infinity, -Infinity and -0', () => {
    expect(enc(1.5)).toEqual({ t: 'num', v: 1.5 })
    expect(enc(NaN)).toEqual({ t: 'num', v: 'NaN' })
    expect(enc(Infinity)).toEqual({ t: 'num', v: 'Infinity' })
    expect(enc(-Infinity)).toEqual({ t: 'num', v: '-Infinity' })
    expect(enc(-0)).toEqual({ t: 'num', v: '-0' })
    expect(enc(0)).toEqual({ t: 'num', v: 0 })
    expect(Object.is(roundTrip(-0), -0)).toBe(true)
    expect(Object.is(roundTrip(0), 0)).toBe(true)
    expect(roundTrip(NaN)).toBeNaN()
    expect(roundTrip(-Infinity)).toBe(-Infinity)
  })

  it('encodes bigint and symbols by description', () => {
    expect(enc(12345678901234567890n)).toEqual({ t: 'bigint', v: '12345678901234567890' })
    expect(roundTrip(-5n)).toBe(-5n)
    expect(enc(Symbol('d'))).toEqual({ t: 'symbol', v: 'd' })
    expect(enc(Symbol())).toEqual({ t: 'symbol', v: null })
    expect((roundTrip(Symbol('d')) as symbol).description).toBe('d')
    expect((roundTrip(Symbol()) as symbol).description).toBeUndefined()
  })

  it('encodes valid and invalid dates', () => {
    expect(enc(new Date(86400000))).toEqual({ t: 'date', v: 86400000 })
    expect(enc(new Date(NaN))).toEqual({ t: 'date', v: 'invalid' })
    expect((roundTrip(new Date(5)) as Date).getTime()).toBe(5)
    expect(Number.isNaN((roundTrip(new Date(NaN)) as Date).getTime())).toBe(true)
  })

  it('encodes regexps by source and flags', () => {
    expect(enc(/a\/b+/gi)).toEqual({ t: 'regexp', source: 'a\\/b+', flags: 'gi' })
    const back = roundTrip(/a\/b+/gi) as RegExp
    expect(back.source).toBe('a\\/b+')
    expect(back.flags).toBe('gi')
  })
})

describe('Value_Codec: containers', () => {
  it('sorts object keys by code point and records the constructor name', () => {
    const node = enc({ b: 1, a: 2, '\u{1F600}': 3, '\uFF5E': 4 })
    expect(node).toMatchObject({ t: 'object', ctor: 'Object' })
    const keys = (node as Extract<EncodedNode, { t: 'object' }>).props.map(([k]) => k)
    expect(keys).toEqual(['a', 'b', '\uFF5E', '\u{1F600}'])
  })

  it('records class names and null prototypes', () => {
    class Point {
      x = 1
      y = 2
    }
    expect(enc(new Point())).toMatchObject({ t: 'object', ctor: 'Point' })
    expect(enc(Object.assign(Object.create(null), { k: 1 }))).toMatchObject({ t: 'object', ctor: null })
    const back = roundTrip(new Point()) as { x: number; constructor: { name: string } }
    expect(back.constructor.name).toBe('Point')
    expect(back.x).toBe(1)
  })

  it('distinguishes array holes from undefined', () => {
    const holes = [1, , 3]
    const node = enc(holes) as Extract<EncodedNode, { t: 'array' }>
    expect(node.length).toBe(3)
    expect(node.items.map((e) => e.i)).toEqual([0, 2])
    expect(nodeJson(enc([1, undefined, 3]))).not.toBe(nodeJson(enc(holes)))
    const back = roundTrip(holes) as unknown[]
    expect(back.length).toBe(3)
    expect(1 in back).toBe(false)
  })

  it('keeps non-index array properties', () => {
    const a: unknown[] = [1]
    ;(a as unknown as Record<string, unknown>).index = 7
    const node = enc(a) as Extract<EncodedNode, { t: 'array' }>
    expect(node.props.map(([k]) => k)).toEqual(['index'])
    expect((roundTrip(a) as unknown as Record<string, unknown>).index).toBe(7)
  })

  it('sorts Map entries and Set items regardless of insertion order', () => {
    const m1 = new Map<unknown, unknown>([['b', 1], ['a', 2]])
    const m2 = new Map<unknown, unknown>([['a', 2], ['b', 1]])
    expect(nodeJson(enc(m1))).toBe(nodeJson(enc(m2)))
    expect(enc(m1)).toEqual(enc(m2))
    const s1 = new Set<unknown>([3, 'x', 1])
    const s2 = new Set<unknown>([1, 3, 'x'])
    expect(enc(s1)).toEqual(enc(s2))
    const back = roundTrip(m1) as Map<string, number>
    expect(back.get('a')).toBe(2)
    expect((roundTrip(s1) as Set<unknown>).has('x')).toBe(true)
  })

  it('encodes functions by name and arity only', () => {
    function add(a: number, b: number): number {
      return a + b
    }
    expect(enc(add)).toEqual({ t: 'function', name: 'add', arity: 2 })
    const back = roundTrip(add) as (...args: unknown[]) => unknown
    expect(back.name).toBe('add')
    expect(back.length).toBe(2)
  })
})

describe('Value_Codec: binary data', () => {
  it('keeps ArrayBuffer bytes', () => {
    const ab = new Uint8Array([1, 2, 3]).buffer
    expect(enc(ab)).toEqual({ t: 'arraybuffer', b64: 'AQID' })
    expect(new Uint8Array(roundTrip(ab) as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('keeps typed array kind and bytes, only for the viewed range', () => {
    const f = new Float32Array([1.5, -2])
    const node = enc(f) as Extract<EncodedNode, { t: 'typed' }>
    expect(node.kind).toBe('Float32Array')
    const back = roundTrip(f) as Float32Array
    expect(back).toBeInstanceOf(Float32Array)
    expect(Array.from(back)).toEqual([1.5, -2])
    const sub = new Uint8Array([9, 8, 7, 6]).subarray(1, 3)
    expect(enc(sub)).toEqual({ t: 'typed', kind: 'Uint8Array', b64: Buffer.from([8, 7]).toString('base64') })
    expect(roundTrip(new BigInt64Array([-1n]))).toEqual(new BigInt64Array([-1n]))
  })

  it('keeps Buffer as Buffer, DataView as DataView', () => {
    const buf = Buffer.from([1, 2, 3, 255])
    expect(enc(buf)).toMatchObject({ t: 'typed', kind: 'Buffer' })
    const back = roundTrip(buf)
    expect(Buffer.isBuffer(back)).toBe(true)
    expect(Array.from(back as Buffer)).toEqual([1, 2, 3, 255])
    expect(enc(new Uint8Array([1, 2, 3, 255]))).not.toEqual(enc(buf))
    const dv = new DataView(new Uint8Array([4, 5]).buffer)
    expect(enc(dv)).toMatchObject({ t: 'typed', kind: 'DataView' })
    expect((roundTrip(dv) as DataView).getUint8(1)).toBe(5)
  })
})

describe('Value_Codec: errors', () => {
  it('encodes class name, message and own enumerable properties, never stack', () => {
    const e = new TypeError('boom') as TypeError & { code?: string }
    e.code = 'E_BOOM'
    const node = enc(e) as Extract<EncodedNode, { t: 'error' }>
    expect(node.cls).toBe('TypeError')
    expect(node.message).toBe('boom')
    expect(node.props.map(([k]) => k)).toEqual(['code'])
    expect(JSON.stringify(node)).not.toContain('stack')
    const back = roundTrip(e) as TypeError & { code: string }
    expect(back).toBeInstanceOf(TypeError)
    expect(back.message).toBe('boom')
    expect(back.code).toBe('E_BOOM')
  })

  it('uses the constructor name of subclasses and round-trips canonically', () => {
    class MyError extends Error {}
    const node = enc(new MyError('x'))
    expect(node).toMatchObject({ t: 'error', cls: 'MyError', message: 'x' })
    expect(enc(decodeNode(node))).toEqual(node)
  })
})

describe('Value_Codec: cycles and shared references', () => {
  it('encodes a shared reference by value as two independent copies', () => {
    const o = { a: 1 }
    const node = enc([o, o]) as Extract<EncodedNode, { t: 'array' }>
    expect(node.items[0]!.n).toEqual(node.items[1]!.n)
    expect(JSON.stringify(node)).not.toContain('unencodable')
    const back = roundTrip([o, o]) as [object, object]
    expect(back[0]).not.toBe(back[1])
    expect(back[0]).toEqual({ a: 1 })
  })

  it('encodes {a: x, b: x} and a twice-reachable acyclic value without cycle', () => {
    const x = { v: 1 }
    expect(JSON.stringify(enc({ a: x, b: x }))).not.toContain('unencodable')
    const inner = { deep: [1] }
    const mid = { l: inner, r: inner }
    expect(JSON.stringify(enc({ p: mid, q: mid }))).not.toContain('unencodable')
  })

  it('marks a self-reference as unencodable cycle', () => {
    const o: Record<string, unknown> = { n: 1 }
    o.self = o
    const node = enc(o) as Extract<EncodedNode, { t: 'object' }>
    expect(node.props).toEqual([
      ['n', { t: 'num', v: 1 }],
      ['self', { t: 'unencodable', reason: 'cycle' }],
    ])
  })

  it('marks a nested cycle where the ancestor is not the direct parent', () => {
    const root: Record<string, unknown> = {}
    root.child = { list: [root] }
    const node = enc(root)
    expect(JSON.stringify(node)).toContain('{"t":"unencodable","reason":"cycle"}')
    expect(nodeJson(node)).toBe(
      '{"t":"object","ctor":"Object","props":[["child",{"t":"object","ctor":"Object","props":[["list",' +
        '{"t":"array","length":1,"items":[{"i":0,"n":{"t":"unencodable","reason":"cycle"}}],"props":[]}]]}]]}',
    )
  })

  it('detects cycles through Map and Set', () => {
    const m = new Map<unknown, unknown>()
    m.set('self', m)
    expect(JSON.stringify(enc(m))).toContain('"reason":"cycle"')
    const s = new Set<unknown>()
    s.add(s)
    expect(JSON.stringify(enc(s))).toContain('"reason":"cycle"')
  })

  it('does not treat a decoded unencodable node as decodable', () => {
    const o: Record<string, unknown> = {}
    o.self = o
    expect(() => decodeNode(enc(o))).toThrow(/unencodable/)
  })
})

describe('Value_Codec: unencodable reasons', () => {
  it('marks a Proxy whose traps throw as unencodable proxy', () => {
    const p = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap')
        },
      },
    )
    expect(enc(p)).toEqual({ t: 'unencodable', reason: 'proxy' })
    expect(enc({ inner: p })).toMatchObject({ props: [['inner', { t: 'unencodable', reason: 'proxy' }]] })
  })

  it('marks a revoked Proxy as unencodable proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(enc(proxy)).toEqual({ t: 'unencodable', reason: 'proxy' })
  })

  it('encodes a Proxy that does not throw like its target', () => {
    expect(enc(new Proxy({ a: 1 }, {}))).toEqual(enc({ a: 1 }))
  })

  it('marks a throwing getter as unencodable getter and keeps the other properties', () => {
    const o = {
      ok: 1,
      get bad(): number {
        throw new Error('no')
      },
    }
    const node = enc(o) as Extract<EncodedNode, { t: 'object' }>
    expect(node.props).toEqual([
      ['bad', { t: 'unencodable', reason: 'getter' }],
      ['ok', { t: 'num', v: 1 }],
    ])
  })

  it('encodes the value returned by a getter that does not throw', () => {
    const o = {
      get g(): number {
        return 4
      },
    }
    expect(enc(o)).toMatchObject({ props: [['g', { t: 'num', v: 4 }]] })
  })

  function nest(levels: number): unknown {
    let v: unknown = 'leaf'
    for (let i = 0; i < levels; i++) v = [v]
    return v
  }

  function innermost(node: EncodedNode, levels: number): EncodedNode {
    let n = node
    for (let i = 0; i < levels; i++) n = (n as Extract<EncodedNode, { t: 'array' }>).items[0]!.n
    return n
  }

  it('encodes nesting depth 1000 and marks depth 1001 as unencodable depth', () => {
    expect(innermost(enc(nest(1000)), 1000)).toEqual({ t: 'str', v: 'leaf' })
    expect(innermost(enc(nest(1001)), 1000)).toEqual({ t: 'unencodable', reason: 'depth' })
  })

  it('canonicalizes and renders a depth-1000 node without stack overflow', () => {
    const node = enc(nest(1000))
    expect(nodeJson(node).length).toBeGreaterThan(1000)
    expect(nodeJson(canonicalizeNode(node))).toBe(nodeJson(node))
  })

  it('returns output-too-large when the budget is exceeded', () => {
    const r = encodeValue('x'.repeat(10_000), { budget: 100 })
    expect(r).toEqual({ ok: false, reason: 'output-too-large' })
    const big = encodeValue(new Uint8Array(100_000), { budget: 1000 })
    expect(big).toEqual({ ok: false, reason: 'output-too-large' })
  })

  it('reports a DAG with many shared paths as output-too-large', () => {
    let v: unknown = 1
    for (let i = 0; i < 40; i++) v = [v, v]
    expect(encodeValue(v, { budget: 100_000 })).toEqual({ ok: false, reason: 'output-too-large' })
  })
})

describe('Value_Codec: decode and canonicalization', () => {
  it('decodes to independent copies on every call', () => {
    const node = enc({ list: [1, { k: 'v' }], m: new Map([['a', new Set([1])]]) })
    const a = decodeNode(node) as { list: [number, { k: string }] }
    const b = decodeNode(node) as { list: [number, { k: string }] }
    expect(a).not.toBe(b)
    expect(a.list).not.toBe(b.list)
    a.list[1].k = 'changed'
    expect(b.list[1].k).toBe('v')
  })

  it('round-trips a mixed encodable value to an equal canonical encoding', () => {
    const value = {
      n: [1, -0, NaN, 2n, 'é'],
      d: new Date(0),
      r: /x/g,
      m: new Map<unknown, unknown>([[{ k: 1 }, [1, , 2]]]),
      s: new Set(['a', 'b']),
      b: Buffer.from('hi'),
      t: new Int16Array([1, -1]),
      e: Object.assign(new RangeError('r'), { extra: 1 }),
      f: function named(a: number) {
        return a
      },
      u: undefined,
      z: null,
    }
    const node = enc(value)
    expect(enc(decodeNode(node))).toEqual(node)
    expect(nodeJson(enc(decodeNode(node)))).toBe(nodeJson(node))
  })

  it('canonical JSON does not depend on key insertion order', () => {
    const a = { x: 1, y: { p: 1, q: 2 }, z: new Set([1, 2]) }
    const b = { z: new Set([2, 1]), y: { q: 2, p: 1 }, x: 1 }
    expect(nodeJson(enc(a))).toBe(nodeJson(enc(b)))
  })

  it('canonicalizeNode sorts a shuffled node and is idempotent', () => {
    const shuffled: EncodedNode = {
      t: 'object',
      ctor: 'Object',
      props: [
        ['b', { t: 'set', items: [{ t: 'num', v: 2 }, { t: 'num', v: 1 }] }],
        ['a', { t: 'num', v: 0 }],
      ],
    }
    const c = canonicalizeNode(shuffled)
    expect(c).toEqual({
      t: 'object',
      ctor: 'Object',
      props: [
        ['a', { t: 'num', v: 0 }],
        ['b', { t: 'set', items: [{ t: 'num', v: 1 }, { t: 'num', v: 2 }] }],
      ],
    })
    expect(canonicalizeNode(c)).toEqual(c)
    expect(nodeJson(shuffled)).toBe(nodeJson(c))
  })

  it('writes keys in the fixed node key order', () => {
    expect(nodeJson({ t: 'regexp', flags: 'g', source: 'a' })).toBe('{"t":"regexp","source":"a","flags":"g"}')
    expect(nodeJson({ t: 'function', arity: 1, name: 'f' })).toBe('{"t":"function","name":"f","arity":1}')
  })
})
