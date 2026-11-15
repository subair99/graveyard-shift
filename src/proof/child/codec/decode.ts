// Value_Codec decoder: builds fresh values on every call. Sandbox side: self-contained,
// erasable TypeScript only.

import type { EncodedNode, TypedKind } from './nodes.ts'

type Ctor = new () => object
type TypedCtor = new (buffer: ArrayBuffer) => ArrayBufferView

const standIns = new Map<string, Ctor>()
const errorStandIns = new Map<string, ErrorConstructor>()

const BUILTIN_ERRORS: Readonly<Record<string, ErrorConstructor>> = {
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  EvalError,
  ReferenceError,
  URIError,
}

const TYPED_CTORS: Readonly<Record<Exclude<TypedKind, 'DataView' | 'Buffer'>, TypedCtor>> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
}

function standInClass(name: string): Ctor {
  let c = standIns.get(name)
  if (c === undefined) {
    c = { [name]: class {} }[name] as Ctor
    standIns.set(name, c)
  }
  return c
}

function standInError(name: string): ErrorConstructor {
  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_ERRORS, name) ? BUILTIN_ERRORS[name] : undefined
  if (builtin !== undefined) return builtin
  let c = errorStandIns.get(name)
  if (c === undefined) {
    c = { [name]: class extends Error {} }[name] as ErrorConstructor
    errorStandIns.set(name, c)
  }
  return c
}

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

function defineAll(target: object, props: readonly [string, EncodedNode][]): void {
  for (const [k, n] of props) define(target, k, decodeNode(n))
}

function freshBuffer(b64: string): ArrayBuffer {
  const bytes = Buffer.from(b64, 'base64')
  const ab = new ArrayBuffer(bytes.length)
  new Uint8Array(ab).set(bytes)
  return ab
}

/** Builds a fresh value from a node. Throws on an `unencodable` node. */
export function decodeNode(node: EncodedNode): unknown {
  switch (node.t) {
    case 'undefined':
      return undefined
    case 'null':
      return null
    case 'bool':
    case 'str':
      return node.v
    case 'num':
      switch (node.v) {
        case 'NaN':
          return NaN
        case 'Infinity':
          return Infinity
        case '-Infinity':
          return -Infinity
        case '-0':
          return -0
        default:
          return node.v
      }
    case 'bigint':
      return BigInt(node.v)
    case 'symbol':
      return node.v === null ? Symbol() : Symbol(node.v)
    case 'date':
      return new Date(node.v === 'invalid' ? NaN : node.v)
    case 'regexp':
      return new RegExp(node.source, node.flags)
    case 'map': {
      const m = new Map<unknown, unknown>()
      for (const [k, v] of node.entries) m.set(decodeNode(k), decodeNode(v))
      return m
    }
    case 'set': {
      const s = new Set<unknown>()
      for (const i of node.items) s.add(decodeNode(i))
      return s
    }
    case 'arraybuffer':
      return freshBuffer(node.b64)
    case 'typed': {
      if (node.kind === 'Buffer') return Buffer.from(Buffer.from(node.b64, 'base64'))
      const ab = freshBuffer(node.b64)
      if (node.kind === 'DataView') return new DataView(ab)
      return new TYPED_CTORS[node.kind](ab)
    }
    case 'error': {
      const e = new (standInError(node.cls))(node.message)
      defineAll(e, node.props)
      return e
    }
    case 'array': {
      const a: unknown[] = new Array<unknown>(node.length)
      for (const { i, n } of node.items) define(a, String(i), decodeNode(n))
      defineAll(a, node.props)
      return a
    }
    case 'object': {
      const o: object =
        node.ctor === null
          ? Object.create(null)
          : node.ctor === 'Object'
            ? {}
            : Object.create(standInClass(node.ctor).prototype)
      defineAll(o, node.props)
      return o
    }
    case 'function': {
      const f = function () {}
      Object.defineProperty(f, 'name', { value: node.name, configurable: true })
      Object.defineProperty(f, 'length', { value: node.arity, configurable: true })
      return f
    }
    case 'unencodable':
      throw new Error(`Cannot decode an unencodable node (reason: ${node.reason})`)
  }
}
