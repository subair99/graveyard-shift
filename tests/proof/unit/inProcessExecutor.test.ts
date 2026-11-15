// Requirements: 5.1, 5.9, 5.10, 5.12
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { EncodedNode } from '../../../src/proof/child/codec/nodes.ts'
import { PROTO_NAMES } from '../../../src/proof/child/prototypes.ts'
import type { PrototypeSet } from '../../../src/proof/child/prototypes.ts'
import { InProcessExecutor } from '../../../src/proof/shell/executor/inProcessExecutor.ts'
import type { InProcessExecutorOptions } from '../../../src/proof/shell/executor/inProcessExecutor.ts'
import { createRestartBudget } from '../../../src/proof/shell/executor/types.ts'
import type { CallRequest, Side, SideHandle, SideSpec } from '../../../src/proof/shell/executor/types.ts'

const POLLUTED = '__gs_test_inProcess_polluted'
const FAKE = '__gs_test_inProcess_fake'

const SOURCE = `
let counter = 0
exports.inc = () => ++counter
exports.peek = () => ({}).${POLLUTED}
exports.pollute = () => { Object.prototype.${POLLUTED} = 'dirty'; return 'polluted' }
exports.boom = () => { throw new TypeError('boom') }
exports.rej = async () => { throw new RangeError('nope') }
exports.never = () => new Promise(() => {})
exports.freeze = () => { Object.freeze(globalThis.${FAKE}); return 1 }
exports.K = 3
`

const num = (v: number): EncodedNode => ({ t: 'num', v })

let root: string
const dirs: Record<string, string> = {}

function makePackage(name: string, source = SOURCE): string {
  const dir = join(root, name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), source)
  return dir
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gs-inProcess-'))
  dirs['a'] = makePackage('a')
  dirs['b'] = makePackage('b')
  dirs['c'] = makePackage('c')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  Reflect.deleteProperty(Object.prototype, POLLUTED)
  Reflect.deleteProperty(globalThis, FAKE)
})

function spec(side: Side, dir: string, callTimeoutMs = 0): SideSpec {
  return {
    side,
    packageDir: dir,
    entryFile: 'index.js',
    readPaths: [],
    limits: { callTimeoutMs, heapLimitMb: 64, outputLimitBytes: 100000 },
  }
}

function request(fn: string, args: EncodedNode[] = []): CallRequest {
  return { fn, args, caseSeed: 1, stubs: { date: true, random: true }, properties: [] }
}

function executor(max = 3, extra: Partial<InProcessExecutorOptions> = {}): InProcessExecutor {
  return new InProcessExecutor({ acknowledgeUnsandboxed: true, restartBudget: createRestartBudget(max), ...extra })
}

async function openOk(ex: InProcessExecutor, s: SideSpec): Promise<SideHandle> {
  const r = await ex.open(s)
  if (!r.ok) throw new Error(`open failed: ${r.error.message}`)
  return r.value
}

describe('InProcessExecutor', () => {
  it('reports mechanism in-process, probes fine and requires the acknowledgement', async () => {
    const ex = executor()
    expect(ex.mechanism).toBe('in-process')
    expect(await ex.probe()).toEqual({ ok: true, value: undefined })
    const untyped = { restartBudget: createRestartBudget(1) } as unknown as InProcessExecutorOptions
    expect(() => new InProcessExecutor(untyped)).toThrow(/acknowledgeUnsandboxed/)
    await ex.dispose()
  })

  it('lists exports and calls a function on each side', async () => {
    const ex = executor()
    const orig = await openOk(ex, spec('original', dirs['a']!))
    const res = await openOk(ex, spec('resurrection', dirs['b']!))
    const listed = await orig.listExports()
    expect(listed.ok && listed.value.entries.map((e) => e.name)).toEqual([
      'K',
      'boom',
      'freeze',
      'inc',
      'never',
      'peek',
      'pollute',
      'rej',
    ])
    for (const side of [orig, res]) {
      const r = await side.call(request('inc'))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.restoreVerified).toBe(true)
      expect(r.value.outcome).toMatchObject({ kind: 'returned', async: false, value: num(1) })
    }
    await ex.dispose()
  })

  it('gives each side its own module instance even for identical source', async () => {
    const ex = executor()
    const orig = await openOk(ex, spec('original', dirs['a']!))
    const res = await openOk(ex, spec('resurrection', dirs['b']!))
    const values: unknown[] = []
    for (const [side, n] of [
      [orig, 3],
      [res, 1],
    ] as const) {
      let last: unknown
      for (let i = 0; i < n; i++) {
        const r = await side.call(request('inc'))
        if (r.ok && r.value.outcome.kind === 'returned') last = r.value.outcome.value
      }
      values.push(last)
    }
    expect(values).toEqual([num(3), num(1)])
    await ex.dispose()
  })

  it('refuses to open a directory twice or a side twice', async () => {
    const ex = executor()
    await openOk(ex, spec('original', dirs['a']!))
    const sameDir = await ex.open(spec('resurrection', dirs['a']!))
    expect(sameDir.ok).toBe(false)
    const sameSide = await ex.open(spec('original', dirs['b']!))
    expect(sameSide.ok).toBe(false)
    await ex.dispose()
  })

  it('restores prototype pollution of one side before the other side runs', async () => {
    const ex = executor()
    const orig = await openOk(ex, spec('original', dirs['a']!))
    const res = await openOk(ex, spec('resurrection', dirs['b']!))
    // Fire both without awaiting between them: the executor queue keeps them sequential.
    const [a, b] = await Promise.all([orig.call(request('pollute')), res.call(request('peek'))])
    expect(a.ok && a.value.restoreVerified).toBe(true)
    if (!a.ok) return
    expect(a.value.outcome.kind).toBe('returned')
    if (a.value.outcome.kind === 'returned') {
      expect(a.value.outcome.prototypeDelta).toHaveLength(1)
      expect(a.value.outcome.prototypeDelta[0]).toMatchObject({ prototype: 'Object.prototype', change: 'added' })
    }
    expect(b.ok && b.value.outcome).toMatchObject({ kind: 'returned', value: { t: 'undefined' } })
    expect(Reflect.has(Object.prototype, POLLUTED)).toBe(false)
    await ex.dispose()
  })

  it('reports a thrown error and a rejected promise', async () => {
    const ex = executor()
    const side = await openOk(ex, spec('original', dirs['a']!))
    const t = await side.call(request('boom'))
    expect(t.ok && t.value.outcome).toMatchObject({ kind: 'threw', async: false, value: { t: 'error', cls: 'TypeError' } })
    const r = await side.call(request('rej'))
    expect(r.ok && r.value.outcome).toMatchObject({ kind: 'rejected', async: true, value: { t: 'error', cls: 'RangeError' } })
    await ex.dispose()
  })

  it('bounds the wait for an async call that never settles (best-effort timeout)', async () => {
    const ex = executor()
    const side = await openOk(ex, spec('original', dirs['a']!, 50))
    const r = await side.call(request('never'))
    expect(r.ok && r.value.outcome.kind).toBe('timeout')
    await ex.dispose()
  })

  it('reports an unloadable module and a missing function as results, not exceptions', async () => {
    const bad = makePackage('bad', 'syntax error here(')
    const ex = executor()
    const r = await ex.open(spec('original', bad))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('unloadable-module')
    const side = await openOk(ex, spec('original', dirs['a']!))
    const missing = await side.call(request('nope'))
    expect(missing.ok && missing.value.outcome.kind).toBe('crash')
    await ex.dispose()
  })

  it('counts a Restart_Event and recreates the module when restoration cannot be verified', async () => {
    const fakes = {} as Record<(typeof PROTO_NAMES)[number], object>
    for (const n of PROTO_NAMES) fakes[n] = {}
    Reflect.set(globalThis, FAKE, fakes['Array.prototype'])
    const budget = createRestartBudget(1)
    const ex = new InProcessExecutor({
      acknowledgeUnsandboxed: true,
      restartBudget: budget,
      prototypes: fakes as PrototypeSet,
    })
    const side = await openOk(ex, spec('original', dirs['c']!))
    // Module state is reset by the restart.
    await side.call(request('inc'))
    const second = await side.call(request('inc'))
    expect(second.ok && second.value.outcome).toMatchObject({ value: num(2) })

    const first = await side.call(request('freeze'))
    expect(first.ok && first.value.restoreVerified).toBe(false)
    expect(side.counters()).toEqual({ restartEvents: 1, otherRestarts: 0 })
    expect(budget.restartEvents()).toBe(1)
    const afterRestart = await side.call(request('inc'))
    // The fake stays frozen, so this call also reports an unverified restoration, and the
    // budget (max 1) is used up: the executor returns the too-many-crashes error.
    expect(afterRestart.ok).toBe(false)
    if (!afterRestart.ok) expect(afterRestart.error.kind).toBe('too-many-crashes')
    expect(budget.used()).toBe(1)
    await ex.dispose()
  })

  it('restarts explicitly with a fresh module instance, counted as a Restart_Event', async () => {
    const budget = createRestartBudget(2)
    const ex = new InProcessExecutor({ acknowledgeUnsandboxed: true, restartBudget: budget })
    const side = await openOk(ex, spec('original', dirs['a']!))
    await side.call(request('inc'))
    expect(await side.restart()).toEqual({ ok: true, value: undefined })
    const r = await side.call(request('inc'))
    expect(r.ok && r.value.outcome).toMatchObject({ value: num(1) })
    expect(side.counters().restartEvents).toBe(1)
    expect(budget.restartEvents()).toBe(1)
    await ex.dispose()
  })

  it('dispose closes every side and leaves nothing behind', async () => {
    const ex = executor()
    const orig = await openOk(ex, spec('original', dirs['a']!))
    await ex.dispose()
    const r = await orig.call(request('inc'))
    expect(r.ok).toBe(false)
    const reopened = await ex.open(spec('original', dirs['a']!))
    expect(reopened.ok).toBe(false)
    // A new executor can load the same directory again with fresh state.
    const ex2 = executor()
    const again = await openOk(ex2, spec('original', dirs['a']!))
    const c = await again.call(request('inc'))
    expect(c.ok && c.value.outcome).toMatchObject({ value: num(1) })
    await ex2.dispose()
    expect(Reflect.has(Object.prototype, POLLUTED)).toBe(false)
  })
})
