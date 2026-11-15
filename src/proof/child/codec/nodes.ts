// Encoded value tree of the Value_Codec. Sandbox side: self-contained, erasable TypeScript only.

export type ReasonUnencodable = 'cycle' | 'depth' | 'getter' | 'proxy'

export type TypedKind =
  | 'Int8Array'
  | 'Uint8Array'
  | 'Uint8ClampedArray'
  | 'Int16Array'
  | 'Uint16Array'
  | 'Int32Array'
  | 'Uint32Array'
  | 'Float32Array'
  | 'Float64Array'
  | 'BigInt64Array'
  | 'BigUint64Array'
  | 'DataView'
  | 'Buffer'

export type EncodedNode =
  | { t: 'undefined' }
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'str'; v: string }
  | { t: 'num'; v: number | 'NaN' | 'Infinity' | '-Infinity' | '-0' }
  | { t: 'bigint'; v: string }
  | { t: 'symbol'; v: string | null }
  | { t: 'date'; v: number | 'invalid' }
  | { t: 'regexp'; source: string; flags: string }
  | { t: 'map'; entries: [EncodedNode, EncodedNode][] }
  | { t: 'set'; items: EncodedNode[] }
  | { t: 'arraybuffer'; b64: string }
  | { t: 'typed'; kind: TypedKind; b64: string }
  | { t: 'error'; cls: string; message: string; props: [string, EncodedNode][] }
  | {
      t: 'array'
      length: number
      items: { i: number; n: EncodedNode }[]
      props: [string, EncodedNode][]
    }
  | { t: 'object'; ctor: string | null; props: [string, EncodedNode][] }
  | { t: 'function'; name: string; arity: number }
  | { t: 'unencodable'; reason: ReasonUnencodable }

export type NodeTag = EncodedNode['t']

/** Every reason a node can be unencodable, in a fixed order. */
export const UNENCODABLE_REASONS: readonly ReasonUnencodable[] = ['cycle', 'depth', 'getter', 'proxy']

/** Fixed key order per node tag for canonical JSON. `t` always comes first. */
export const NODE_KEY_ORDER: Readonly<Record<NodeTag, readonly string[]>> = {
  undefined: ['t'],
  null: ['t'],
  bool: ['t', 'v'],
  str: ['t', 'v'],
  num: ['t', 'v'],
  bigint: ['t', 'v'],
  symbol: ['t', 'v'],
  date: ['t', 'v'],
  regexp: ['t', 'source', 'flags'],
  map: ['t', 'entries'],
  set: ['t', 'items'],
  arraybuffer: ['t', 'b64'],
  typed: ['t', 'kind', 'b64'],
  error: ['t', 'cls', 'message', 'props'],
  array: ['t', 'length', 'items', 'props'],
  object: ['t', 'ctor', 'props'],
  function: ['t', 'name', 'arity'],
  unencodable: ['t', 'reason'],
}
