// Canonical form of an encoded node: props sorted by key, Map entries and Set items sorted by
// their canonical JSON, array items sorted by index, JSON written with a fixed key order.
// Sandbox side: self-contained, erasable TypeScript only.

import type { EncodedNode } from './nodes.ts'
import { NODE_KEY_ORDER } from './nodes.ts'
import { compareCodePoints } from './order.ts'

type Rec = Record<string, unknown>

function renderField(x: unknown): string {
  if (Array.isArray(x)) return '[' + x.map(renderField).join(',') + ']'
  if (x !== null && typeof x === 'object') {
    const rec = x as Rec
    if ('t' in rec) return renderNode(rec as unknown as EncodedNode)
    return '{"i":' + renderField(rec['i']) + ',"n":' + renderField(rec['n']) + '}'
  }
  // string, finite number, boolean, null. JSON.stringify escapes lone surrogates, so the
  // output is well-formed and contains only paired surrogates.
  return JSON.stringify(x)
}

/** JSON of a node in the fixed key order. Assumes the node is already canonical. */
export function renderNode(node: EncodedNode): string {
  const rec = node as unknown as Rec
  const parts: string[] = []
  for (const k of NODE_KEY_ORDER[node.t]) parts.push(JSON.stringify(k) + ':' + renderField(rec[k]))
  return '{' + parts.join(',') + '}'
}

function unitKey(c: number): number {
  // Maps UTF-16 units to an order that matches code point order for well-formed text.
  return c >= 0xd800 ? (c >= 0xe000 ? c - 0x800 : c + 0x2000) : c
}

/** Code point order for strings produced by `renderNode` (no lone surrogates), without allocation. */
export function compareRendered(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y) return unitKey(x) < unitKey(y) ? -1 : 1
  }
  return a.length - b.length
}

export function pairJson(k: EncodedNode, v: EncodedNode): string {
  return '[' + renderNode(k) + ',' + renderNode(v) + ']'
}

export function sortByRendered<T>(items: readonly T[], render: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, json: render(item) }))
    .sort((a, b) => compareRendered(a.json, b.json) || a.index - b.index)
    .map((e) => e.item)
}

function canonProps(props: readonly [string, EncodedNode][]): [string, EncodedNode][] {
  return props
    .map(([k, v]): [string, EncodedNode] => [k, canonicalizeNode(v)])
    .sort((a, b) => compareCodePoints(a[0], b[0]))
}

/** Returns a new, canonical node. Idempotent. */
export function canonicalizeNode(node: EncodedNode): EncodedNode {
  switch (node.t) {
    case 'map': {
      const entries = node.entries.map(([k, v]): [EncodedNode, EncodedNode] => [
        canonicalizeNode(k),
        canonicalizeNode(v),
      ])
      return { t: 'map', entries: sortByRendered(entries, ([k, v]) => pairJson(k, v)) }
    }
    case 'set':
      return { t: 'set', items: sortByRendered(node.items.map(canonicalizeNode), renderNode) }
    case 'error':
      return { t: 'error', cls: node.cls, message: node.message, props: canonProps(node.props) }
    case 'array':
      return {
        t: 'array',
        length: node.length,
        items: node.items.map((e) => ({ i: e.i, n: canonicalizeNode(e.n) })).sort((a, b) => a.i - b.i),
        props: canonProps(node.props),
      }
    case 'object':
      return { t: 'object', ctor: node.ctor, props: canonProps(node.props) }
    default:
      return node
  }
}

/** Canonical JSON string of a node: canonicalizes first, then writes keys in NODE_KEY_ORDER. */
export function nodeJson(node: EncodedNode): string {
  return renderNode(canonicalizeNode(node))
}
