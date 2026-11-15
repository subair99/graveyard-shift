// Generic ordering helpers, copied from src/engine/serialize/canonicalJson.ts so the
// sandbox side stays self-contained under one read grant. No imports.

type Obj = { [k: string]: unknown }

/** Compares strings by Unicode code point, never by locale or UTF-16 unit. */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const cx = x[i]!.codePointAt(0)!
    const cy = y[i]!.codePointAt(0)!
    if (cx !== cy) return cx < cy ? -1 : 1
  }
  return x.length - y.length
}

/** Stable sort by a chain of comparators; ties keep input order. Returns a new array. */
export function sortBy<T>(items: readonly T[], ...cmps: Array<(a: T, b: T) => number>): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      for (const c of cmps) {
        const r = c(a.item, b.item)
        if (r !== 0) return r
      }
      return a.index - b.index
    })
    .map((e) => e.item)
}

/** Builds a new object with the given keys in the given order. Missing or undefined keys are skipped. */
export function ordered(
  obj: Obj,
  keys: readonly string[],
  map: Readonly<Record<string, (v: unknown) => unknown>> = {},
): Obj {
  const out: Obj = {}
  for (const k of keys) {
    const v = obj[k]
    if (v === undefined) continue
    const f = map[k]
    out[k] = f ? f(v) : v
  }
  return out
}
