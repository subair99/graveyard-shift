import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { encodeValue } from '../../../src/proof/child/codec/encode.ts'
import type { EncodedNode } from '../../../src/proof/child/codec/nodes.ts'
import { PROTO_NAMES, type PrototypeSet } from '../../../src/proof/child/prototypes.ts'
import { createSideRuntime, type SideCallResponse } from '../../../src/proof/child/sideRuntime.ts'
import { OutcomeSchema } from '../../../src/proof/types.ts'

const POLLUTED = '__gs_test_sideRuntime_polluted'
const CHILD_DIR = resolve(__dirname, '../../../src/proof/child')

let root: string
let pkgDir: string

const enc = (v: unknown): EncodedNode => {
  const r = encodeValue(v, { budget: 100000 })
  if (!r.ok) throw new Error('test value too large')
  return r.node
}

function req(fn: string, args: unknown[] = [], extra: Record<string, unknown> = {}) {
  return { fn, args: args.map(enc), caseSeed: 7, properties: [], timeoutMs: 0, ...extra }
}

const INDEX = `
module.exports = {
  ret: (a, b) => a + b,
  thr: () => { const e = new TypeError('boom'); e.code = 'E_X'; throw e },
  rej: async () => { const e = new RangeError('nope'); e.extra = 1; throw e },
  res: async (x) => x * 2,
  mutate: (o) => { o.a = 2; o.list.push(9) },
  pollute: () => { const o = {}; o['__proto__']['${POLLUTED}'] = 1; return 'done' },
  big: () => 'x'.repeat(5000),
  now: () => [Date.now(), new Date().toISOString(), Math.random(), Math.random()],
  never: () => new Promise(() => {}),
  thenable: () => ({ then(res) { res('from-thenable') } }),
  notThenable: () => ({ then: 5 }),
  self: function () { return this === module.exports },
  K: 3,
  nothing: null,
}
`

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gs-sideRuntime-'))
  pkgDir = join(root, 'pkg')
  mkdirSync(pkgDir)
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'syn', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(pkgDir, 'index.js'), INDEX)
  writeFileSync(join(pkgDir, 'fnexport.js'), 'module.exports = function add(a, b) { return a + b }\nmodule.exports.helper = function h() {}\nmodule.exports.k = 1\n')
  writeFileSync(join(pkgDir, 'broken.js'), 'syntax error here(')
  writeFileSync(
    join(pkgDir, 'prop.js'),
    "exports.check = (ctx) => ({ ok: ctx.prototypeDelta.length === 1, detail: { fn: ctx.functionName, kind: ctx.kind } })\n",
  )
  writeFileSync(join(pkgDir, 'badprop.js'), 'exports.check = () => 5\n')
  writeFileSync(join(pkgDir, 'throwprop.js'), "exports.check = () => { throw new Error('prop failed') }\n")
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  // Safety net: never leave a test property on a real prototype.
  Reflect.deleteProperty(Object.prototype, POLLUTED)
})

function runtime(options: Record<string, unknown> = {}, entry = 'index.js') {
  const rt = createSideRuntime({ packageDir: pkgDir, entryFile: entry, outputLimitBytes: 100000, ...options })
  expect(rt.load()).toEqual({ ok: true, value: undefined })
  return rt
}

function expectValidOutcome(r: SideCallResponse): void {
  expect(OutcomeSchema.safeParse(r.result.outcome).success).toBe(true)
}

describe('SideRuntime.call', () => {
  it('returns a value with the argument post-state', async () => {
    const r = await runtime().call(req('ret', [2, 3]))
    expectValidOutcome(r)
    expect(r.restoreVerified).toBe(true)
    expect(r.result.outcome).toEqual({
      kind: 'returned',
      async: false,
      value: enc(5),
      args: [enc(2), enc(3)],
      prototypeDelta: [],
    })
  })

  it('encodes a thrown error by class, message and own properties, without a stack', async () => {
    const r = await runtime().call(req('thr'))
    expectValidOutcome(r)
    const o = r.result.outcome
    expect(o.kind).toBe('threw')
    if (o.kind !== 'threw') return
    expect(o.async).toBe(false)
    expect(o.value).toEqual({ t: 'error', cls: 'TypeError', message: 'boom', props: [['code', enc('E_X')]] })
    expect(JSON.stringify(o)).not.toContain('stack')
  })

  it('reports a rejected promise as rejected with async true', async () => {
    const r = await runtime().call(req('rej'))
    expectValidOutcome(r)
    const o = r.result.outcome
    expect(o.kind).toBe('rejected')
    if (o.kind !== 'rejected') return
    expect(o.async).toBe(true)
    expect(o.value).toEqual({ t: 'error', cls: 'RangeError', message: 'nope', props: [['extra', enc(1)]] })
  })

  it('awaits a resolved promise and marks it async', async () => {
    const r = await runtime().call(req('res', [21]))
    expectValidOutcome(r)
    expect(r.result.outcome).toMatchObject({ kind: 'returned', async: true, value: enc(42) })
  })

  it('awaits a thenable with a callable then, and keeps an object with a non-callable then as a value', async () => {
    const rt = runtime()
    expect((await rt.call(req('thenable'))).result.outcome).toMatchObject({
      kind: 'returned',
      async: true,
      value: enc('from-thenable'),
    })
    expect((await rt.call(req('notThenable'))).result.outcome).toMatchObject({ kind: 'returned', async: false })
  })

  it('encodes the post-state of a mutated argument', async () => {
    const r = await runtime().call(req('mutate', [{ a: 1, list: [1] }]))
    expect(r.result.outcome).toMatchObject({
      kind: 'returned',
      value: enc(undefined),
      args: [enc({ a: 2, list: [1, 9] })],
    })
  })

  it('records a pollution through __proto__ in the delta, restores it and verifies', async () => {
    const r = await runtime().call(req('pollute'))
    expectValidOutcome(r)
    expect(r.restoreVerified).toBe(true)
    expect(Reflect.ownKeys(Object.prototype)).not.toContain(POLLUTED)
    const o = r.result.outcome
    expect(o.kind).toBe('returned')
    if (o.kind !== 'returned') return
    expect(o.prototypeDelta).toHaveLength(1)
    expect(o.prototypeDelta[0]).toMatchObject({
      prototype: 'Object.prototype',
      key: { s: POLLUTED },
      change: 'added',
      after: { value: enc(1), writable: true, enumerable: true, configurable: true },
    })
  })

  it('runs property modules after restoration on the delta of the same call', async () => {
    const r = await runtime().call(
      req('pollute', [], { properties: [{ id: 'p1', modulePath: join(pkgDir, 'prop.js') }] }),
    )
    expect(r.propertyError).toBeUndefined()
    expect(r.result.properties).toEqual([
      { id: 'p1', ok: true, detail: enc({ fn: 'pollute', kind: 'returned' }) },
    ])
    expect(r.restoreVerified).toBe(true)
  })

  it('reports a throwing or malformed property module as propertyError', async () => {
    const rt = runtime()
    const a = await rt.call(req('ret', [1, 2], { properties: [{ id: 'x', modulePath: join(pkgDir, 'throwprop.js') }] }))
    expect(a.propertyError).toContain('prop failed')
    expect(a.result.properties).toEqual([])
    const b = await rt.call(req('ret', [1, 2], { properties: [{ id: 'y', modulePath: join(pkgDir, 'badprop.js') }] }))
    expect(b.propertyError).toContain('malformed')
  })

  it('returns output-too-large when the encoded outcome exceeds the limit', async () => {
    const r = await runtime({ outputLimitBytes: 1000 }).call(req('big'))
    expect(r.result.outcome).toEqual({ kind: 'output-too-large' })
    expect(OutcomeSchema.safeParse(r.result.outcome).success).toBe(true)
  })

  it('stubs Date and Math.random per call and restores them afterwards', async () => {
    const realDate = globalThis.Date
    const realRandom = Math.random
    const rt = runtime()
    const a = await rt.call(req('now', [], { caseSeed: 11 }))
    const b = await rt.call(req('now', [], { caseSeed: 11 }))
    const c = await rt.call(req('now', [], { caseSeed: 12 }))
    expect(globalThis.Date).toBe(realDate)
    expect(Math.random).toBe(realRandom)
    expect(a.result.outcome).toEqual(b.result.outcome)
    expect(a.result.outcome).not.toEqual(c.result.outcome)
    const o = a.result.outcome
    if (o.kind !== 'returned') throw new Error('expected returned')
    expect(JSON.stringify(o.value)).toContain('946684800000')
    expect(JSON.stringify(o.value)).toContain('2000-01-01T00:00:00.000Z')
  })

  it('returns timeout for a never-settling promise and keeps the runtime usable', async () => {
    const rt = runtime()
    const r = await rt.call(req('never', [], { timeoutMs: 30 }))
    expect(r.result.outcome).toEqual({ kind: 'timeout', prototypeDelta: [] })
    expect(OutcomeSchema.safeParse(r.result.outcome).success).toBe(true)
    expect((await rt.call(req('ret', [1, 1]))).result.outcome.kind).toBe('returned')
  })

  it('binds this to the exports object for named exports', async () => {
    const r = await runtime().call(req('self'))
    expect(r.result.outcome).toMatchObject({ kind: 'returned', value: enc(true) })
  })

  it('turns an internal error into a crash with a stable reason', async () => {
    const fakes = {} as Record<(typeof PROTO_NAMES)[number], object>
    for (const n of PROTO_NAMES) fakes[n] = {}
    let armed = false
    fakes['Object.prototype'] = new Proxy(
      {},
      {
        ownKeys(t) {
          if (armed) throw new Error('trap')
          return Reflect.ownKeys(t)
        },
      },
    )
    const rt = runtime({ prototypes: fakes as PrototypeSet })
    armed = true
    const r = await rt.call(req('ret', [1, 2]))
    expect(r.result.outcome).toEqual({ kind: 'crash' })
    expect(r.crashReason).toBe('internal-error')
  })

  it('crashes with stable reasons for unknown function, undecodable argument and missing load', async () => {
    const rt = runtime()
    const a = await rt.call(req('nope'))
    expect(a.result.outcome).toEqual({ kind: 'crash' })
    expect(a.crashReason).toBe('function-not-found')
    const b = await rt.call({ ...req('ret'), args: [{ t: 'unencodable', reason: 'cycle' } as EncodedNode] })
    expect(b.crashReason).toBe('argument-decode-failed')
    const unloaded = createSideRuntime({ packageDir: pkgDir, entryFile: 'index.js', outputLimitBytes: 1000 })
    const c = await unloaded.call(req('ret'))
    expect(c.crashReason).toBe('not-loaded')
    expect(c.restoreVerified).toBe(true)
  })
})

describe('SideRuntime.load and listExports', () => {
  it('returns loaded false with the message for any exception while loading', () => {
    const rt = createSideRuntime({ packageDir: pkgDir, entryFile: 'broken.js', outputLimitBytes: 1000 })
    const r = rt.load()
    expect(r.ok).toBe(false)
    const missing = createSideRuntime({ packageDir: pkgDir, entryFile: 'missing.js', outputLimitBytes: 1000 }).load()
    expect(missing.ok).toBe(false)
  })

  it('lists exports sorted by name with arity, name and primitives', () => {
    const { entries } = runtime().listExports()
    const names = entries.map((e) => e.name)
    expect(names).toEqual([...names].sort())
    expect(entries.find((e) => e.name === 'ret')).toEqual({ name: 'ret', type: 'function', fnName: 'ret', arity: 2 })
    expect(entries.find((e) => e.name === 'K')).toEqual({ name: 'K', type: 'number', primitive: enc(3) })
    expect(entries.find((e) => e.name === 'nothing')).toEqual({ name: 'nothing', type: 'object', primitive: enc(null) })
  })

  it('lists a function export as default plus its own function properties, and calls default with this undefined', async () => {
    const rt = runtime({}, 'fnexport.js')
    expect(rt.listExports().entries).toEqual([
      { name: 'default', type: 'function', fnName: 'add', arity: 2 },
      { name: 'helper', type: 'function', fnName: 'h', arity: 0 },
    ])
    expect((await rt.call(req('default', [1, 2]))).result.outcome).toMatchObject({ kind: 'returned', value: enc(3) })
  })
})

describe('restoration that cannot be verified (spawned child under --permission)', () => {
  it('reports restoreVerified false when the package freezes Array.prototype', () => {
    const dir = join(root, 'freeze')
    mkdirSync(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'freezer', version: '1.0.0' }))
    writeFileSync(join(dir, 'index.js'), 'exports.freeze = () => { Object.freeze(Array.prototype); return 1 }\n')
    const script = join(dir, 'run.mjs')
    const url = pathToFileURL(join(CHILD_DIR, 'sideRuntime.ts')).href
    writeFileSync(
      script,
      `import { createSideRuntime } from ${JSON.stringify(url)}
const rt = createSideRuntime({ packageDir: ${JSON.stringify(dir)}, entryFile: 'index.js', outputLimitBytes: 1000000 })
const l = rt.load()
const r = await rt.call({ fn: 'freeze', args: [], caseSeed: 1, properties: [], timeoutMs: 0 })
process.stdout.write(JSON.stringify({ loaded: l.ok, kind: r.result.outcome.kind, restoreVerified: r.restoreVerified }))
`,
    )
    const real = (p: string): string => realpathSync.native(p)
    const run = spawnSync(
      process.execPath,
      ['--permission', `--allow-fs-read=${real(CHILD_DIR)}`, `--allow-fs-read=${real(dir)}`, script],
      { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'test' } },
    )
    expect(dirname(script)).toBe(dir)
    expect(run.stderr).toBe('')
    expect(JSON.parse(run.stdout)).toEqual({ loaded: true, kind: 'returned', restoreVerified: false })
  })
})
