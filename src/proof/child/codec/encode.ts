// Value_Codec encoder. Sandbox side: self-contained, erasable TypeScript only.
// Type tests use util.types and internal-slot readers, never instanceof, so values from
// another realm are encoded the same way.
//
// Recursion: encodeNode -> encodeContainer -> encodeNode, two frames per nesting level, so
// the default Node stack holds the depth limit of 1,000 levels.

import { types } from 'node:util'
import type { EncodedNode, TypedKind } from './nodes.ts'
import { pairJson, renderNode, sortByRendered } from './canonical.ts'
import { compareCodePoints } from './order.ts'

export type EncodeOptions = { budget: number; maxDepth?: number }
export type EncodeResult = { ok: true; node: EncodedNode } | { ok: false; reason: 'output-too-large' }

const DEFAULT_MAX_DEPTH = 1000
const NODE_COST = 8

class BudgetExceeded {}

type Prop = [string, EncodedNode]
type Ctx = { remaining: number; maxDepth: number; ancestors: Set<object> }

/** Returned by `readValue` when a getter throws. */
const GETTER_THREW: unique symbol = Symbol('getter-threw')

const TYPED_KINDS: ReadonlySet<string> = new Set<TypedKind>([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
])

const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  Symbol.toStringTag,
)!.get as (this: unknown) => unknown
const regExpSourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get as (this: unknown) => unknown
const regExpFlagsGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags')!.get as (this: unknown) => unknown

function charge(ctx: Ctx, extra: number): void {
  ctx.remaining -= NODE_COST + extra
  if (ctx.remaining <= 0) throw new BudgetExceeded()
}

function leaf(ctx: Ctx, node: EncodedNode, extra: number = 0): EncodedNode {
  charge(ctx, extra)
  return node
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

function dataString(obj: object, key: string): string | null {
  const d = Reflect.getOwnPropertyDescriptor(obj, key)
  return d !== undefined && typeof d.value === 'string' ? d.value : null
}

/** Constructor name found through the prototype chain without calling any getter. `null` for a null prototype. */
function constructorName(v: object): string | null {
  let o: object | null = Reflect.getPrototypeOf(v)
  if (o === null) return null
  for (; o !== null; o = Reflect.getPrototypeOf(o)) {
    const d = Reflect.getOwnPropertyDescriptor(o, 'constructor')
    if (d === undefined) continue
    if (typeof d.value === 'function') {
      const name = dataString(d.value as object, 'name')
      if (name !== null) return name
    }
    return 'Object'
  }
  return 'Object'
}

function inheritedString(obj: object, key: string): string | null {
  for (let o: object | null = obj; o !== null; o = Reflect.getPrototypeOf(o)) {
    const d = Reflect.getOwnPropertyDescriptor(o, key)
    if (d !== undefined) return typeof d.value === 'string' ? d.value : null
  }
  return null
}

/** Value of a property: the data value, or the result of the getter. Non-recursive. */
function readValue(obj: object, desc: PropertyDescriptor): unknown {
  if ('value' in desc) return desc.value
  if (desc.get === undefined) return undefined
  try {
    return Reflect.apply(desc.get, obj, [])
  } catch {
    return GETTER_THREW
  }
}

function ownStringKeys(obj: object): string[] {
  const out: string[] = []
  for (const k of Reflect.ownKeys(obj)) {
    if (typeof k !== 'string') continue
    const d = Reflect.getOwnPropertyDescriptor(obj, k)
    if (d !== undefined && d.enumerable === true) out.push(k)
  }
  return out
}

function isArrayIndex(key: string): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false
  return Number(key) < 4294967295
}

function typedKindOf(v: object): string | null {
  const tag = typedArrayTagGetter.call(v)
  return typeof tag === 'string' ? tag : null
}

/** Encodes values that have no children. Returns null for a container. Non-recursive. */
function encodeLeafObject(v: object, ctx: Ctx): EncodedNode | null {
  if (types.isDate(v)) {
    const time = Date.prototype.getTime.call(v)
    return leaf(ctx, { t: 'date', v: Number.isNaN(time) ? 'invalid' : time })
  }
  if (types.isRegExp(v)) {
    const source = String(regExpSourceGetter.call(v))
    const flags = String(regExpFlagsGetter.call(v))
    return leaf(ctx, { t: 'regexp', source, flags }, source.length + flags.length)
  }
  if (types.isArrayBuffer(v)) {
    charge(ctx, Math.ceil((v.byteLength * 4) / 3))
    return { t: 'arraybuffer', b64: bytesToB64(new Uint8Array(v)) }
  }
  if (types.isDataView(v)) {
    charge(ctx, Math.ceil((v.byteLength * 4) / 3))
    return { t: 'typed', kind: 'DataView', b64: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  }
  if (types.isTypedArray(v)) {
    const kind = Buffer.isBuffer(v) ? 'Buffer' : typedKindOf(v)
    if (kind !== null && (kind === 'Buffer' || TYPED_KINDS.has(kind))) {
      charge(ctx, Math.ceil((v.byteLength * 4) / 3))
      return {
        t: 'typed',
        kind: kind as TypedKind,
        b64: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
      }
    }
  }
  return null
}

function encodeFunction(v: object, ctx: Ctx): EncodedNode {
  const name = dataString(v, 'name') ?? ''
  const lenDesc = Reflect.getOwnPropertyDescriptor(v, 'length')
  const arity = lenDesc !== undefined && typeof lenDesc.value === 'number' ? lenDesc.value : 0
  return leaf(ctx, { t: 'function', name, arity }, name.length)
}

function encodeContainer(v: object, ctx: Ctx, level: number): EncodedNode {
  if (ctx.ancestors.has(v)) return leaf(ctx, { t: 'unencodable', reason: 'cycle' })
  const myLevel = level + 1
  if (myLevel > ctx.maxDepth) return leaf(ctx, { t: 'unencodable', reason: 'depth' })
  ctx.ancestors.add(v)
  try {
    charge(ctx, 0)
    const isArray = Array.isArray(v)
    const isMap = !isArray && types.isMap(v)
    const isSet = !isArray && !isMap && types.isSet(v)
    const isError = !isArray && !isMap && !isSet && types.isNativeError(v)

    const items: { i: number; n: EncodedNode }[] = []
    const entries: [EncodedNode, EncodedNode][] = []
    const setItems: EncodedNode[] = []
    const keys: string[] = []

    if (isMap) {
      for (const [k, val] of Map.prototype.entries.call(v) as IterableIterator<[unknown, unknown]>) {
        entries.push([encodeNode(k, ctx, myLevel), encodeNode(val, ctx, myLevel)])
      }
    } else if (isSet) {
      for (const item of Set.prototype.values.call(v) as IterableIterator<unknown>) {
        setItems.push(encodeNode(item, ctx, myLevel))
      }
    } else {
      for (const k of ownStringKeys(v)) {
        if (isArray && isArrayIndex(k)) {
          const desc = Reflect.getOwnPropertyDescriptor(v, k)
          if (desc === undefined) continue
          charge(ctx, 0)
          const got = readValue(v, desc)
          items.push({
            i: Number(k),
            n: got === GETTER_THREW ? leaf(ctx, { t: 'unencodable', reason: 'getter' }) : encodeNode(got, ctx, myLevel),
          })
        } else if (!(isError && k === 'stack')) keys.push(k)
      }
    }

    const props: Prop[] = []
    keys.sort(compareCodePoints)
    for (const k of keys) {
      const desc = Reflect.getOwnPropertyDescriptor(v, k)
      if (desc === undefined) continue
      charge(ctx, k.length)
      const got = readValue(v, desc)
      props.push([
        k,
        got === GETTER_THREW ? leaf(ctx, { t: 'unencodable', reason: 'getter' }) : encodeNode(got, ctx, myLevel),
      ])
    }

    if (isArray) {
      items.sort((a, b) => a.i - b.i)
      return { t: 'array', length: v.length, items, props }
    }
    if (isMap) return { t: 'map', entries: sortByRendered(entries, ([k, val]) => pairJson(k, val)) }
    if (isSet) return { t: 'set', items: sortByRendered(setItems, renderNode) }
    const ctor = constructorName(v)
    if (isError) {
      const cls = ctor !== null && ctor !== '' ? ctor : (inheritedString(v, 'name') ?? 'Error')
      const message = inheritedString(v, 'message') ?? ''
      charge(ctx, cls.length + message.length)
      return { t: 'error', cls, message, props }
    }
    charge(ctx, ctor === null ? 0 : ctor.length)
    return { t: 'object', ctor, props }
  } finally {
    ctx.ancestors.delete(v)
  }
}

function encodeNode(value: unknown, ctx: Ctx, level: number): EncodedNode {
  switch (typeof value) {
    case 'undefined':
      return leaf(ctx, { t: 'undefined' })
    case 'boolean':
      return leaf(ctx, { t: 'bool', v: value })
    case 'string':
      return leaf(ctx, { t: 'str', v: value }, value.length)
    case 'number': {
      if (Number.isNaN(value)) return leaf(ctx, { t: 'num', v: 'NaN' })
      if (value === Infinity) return leaf(ctx, { t: 'num', v: 'Infinity' })
      if (value === -Infinity) return leaf(ctx, { t: 'num', v: '-Infinity' })
      if (Object.is(value, -0)) return leaf(ctx, { t: 'num', v: '-0' })
      return leaf(ctx, { t: 'num', v: value })
    }
    case 'bigint': {
      const s = value.toString()
      return leaf(ctx, { t: 'bigint', v: s }, s.length)
    }
    case 'symbol': {
      const d = value.description
      return leaf(ctx, { t: 'symbol', v: d === undefined ? null : d }, d === undefined ? 0 : d.length)
    }
    case 'function':
    case 'object': {
      if (value === null) return leaf(ctx, { t: 'null' })
      const ref: object = value
      try {
        const done = typeof ref === 'function' ? encodeFunction(ref, ctx) : encodeLeafObject(ref, ctx)
        return done ?? encodeContainer(ref, ctx, level)
      } catch (e) {
        // A trap of a Proxy threw. Any other failure is not ours to hide.
        if (e instanceof BudgetExceeded || !types.isProxy(ref)) throw e
        return leaf(ctx, { t: 'unencodable', reason: 'proxy' })
      }
    }
    default:
      return leaf(ctx, { t: 'undefined' })
  }
}

/**
 * Encodes a value into a canonical node tree. Only true cycles (an object that is its own
 * ancestor) are `unencodable`; a shared reference is encoded again by value. Reference
 * identity is not recorded (limitation L1). A DAG with many shared paths expands into a tree
 * and reaches the budget (limitation L2). The budget counts UTF-16 units plus a constant per node.
 */
export function encodeValue(value: unknown, options: EncodeOptions): EncodeResult {
  const ctx: Ctx = {
    remaining: options.budget,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    ancestors: new Set<object>(),
  }
  try {
    return { ok: true, node: encodeNode(value, ctx, 0) }
  } catch (e) {
    if (e instanceof BudgetExceeded) return { ok: false, reason: 'output-too-large' }
    throw e
  }
}
