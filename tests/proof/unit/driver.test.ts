// Requirements: 7.9, 8.6, 8.7, 8.8, 8.11, 8.12, 8.13, 9.2, 9.3, 11.3, 12.3, 13.9
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_SKIPS_PER_RUN,
  replayPhase,
  runFunction,
  type DriverExecutor,
  type DriverOptions,
  type FunctionRunResult,
} from '../../../src/proof/shell/driver.ts'
import { InProcessExecutor } from '../../../src/proof/shell/executor/inProcessExecutor.ts'
import { createRestartBudget } from '../../../src/proof/shell/executor/types.ts'
import type { CallRequest, SideHandle, SideSpec } from '../../../src/proof/shell/executor/types.ts'
import type { DeclaredDelta, FunctionHarness } from '../../../src/proof/types.ts'

let root: string
let counter = 0
const executors: InProcessExecutor[] = []

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gs-driver-'))
})

afterAll(async () => {
  for (const ex of executors) await ex.dispose()
  rmSync(root, { recursive: true, force: true })
})

function makePackage(source: string): string {
  const dir = join(root, `pkg${counter++}`)
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'synthetic', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), source)
  return dir
}

function spec(side: 'original' | 'resurrection', dir: string, callTimeoutMs = 0): SideSpec {
  return {
    side,
    packageDir: dir,
    entryFile: 'index.js',
    readPaths: [],
    limits: { callTimeoutMs, heapLimitMb: 64, outputLimitBytes: 100000 },
  }
}

interface Opened {
  sides: DriverExecutor
  calls: { n: number }
}

function counting(handle: SideHandle, calls: { n: number }): SideHandle {
  return {
    listExports: () => handle.listExports(),
    call: (request: CallRequest) => {
      calls.n += 1
      return handle.call(request)
    },
    restart: () => handle.restart(),
    counters: () => handle.counters(),
    close: () => handle.close(),
  }
}

async function open(originalSource: string, resurrectionSource: string, callTimeoutMs = 0): Promise<Opened> {
  const ex = new InProcessExecutor({ acknowledgeUnsandboxed: true, restartBudget: createRestartBudget(5) })
  executors.push(ex)
  const o = await ex.open(spec('original', makePackage(originalSource), callTimeoutMs))
  const r = await ex.open(spec('resurrection', makePackage(resurrectionSource), callTimeoutMs))
  if (!o.ok || !r.ok) throw new Error('open failed')
  const calls = { n: 0 }
  return { sides: { original: counting(o.value, calls), resurrection: counting(r.value, calls) }, calls }
}

function options(extra: Partial<DriverOptions> = {}): DriverOptions {
  return { seed: 7, caseCount: 20, shrinkBudget: 500, deltas: [], ...extra }
}

const intArg = fc.tuple(fc.integer({ min: 0, max: 1000 }))

function harness(extra: Partial<FunctionHarness> = {}): FunctionHarness {
  return { args: intArg, ...extra }
}

function firstError(result: FunctionRunResult): string {
  return JSON.stringify(result.harnessErrors)
}

describe('driver: identical packages', () => {
  it('finds no divergence and counts exactly the executed Cases', async () => {
    const src = 'exports.add = (a, b) => a + b'
    const { sides, calls } = await open(src, src)
    const result = await runFunction(
      'add',
      { args: fc.tuple(fc.integer(), fc.integer()), explicitCases: [[1, 2], [0, 0]] },
      sides,
      options(),
    )
    expect(result.harnessErrors).toEqual([])
    expect(result.divergences).toEqual([])
    expect(result.nonDeterministic).toBeNull()
    expect(result.cases).toBe(22)
    expect(result.phases.map((p) => [p.phase, p.cases])).toEqual([['explicit', 2], ['generated', 20]])
    expect(result.unencodable).toEqual({
      function: 'add',
      cases: 22,
      casesWithUnencodable: 0,
      total: 0,
      reasons: { cycle: 0, depth: 0, getter: 0, proxy: 0 },
    })
    // original, repeat, resurrection per Case: the counts are the executed counts.
    expect(calls.n).toBe(66)
  })

  it('counts unencodable nodes of both sides per executed Case', async () => {
    const src = 'exports.cyc = () => { const o = {}; o.self = o; return o }'
    const { sides } = await open(src, src)
    const result = await runFunction('cyc', harness(), sides, options({ caseCount: 5 }))
    expect(result.divergences).toEqual([])
    expect(result.unencodable.cases).toBe(5)
    expect(result.unencodable.casesWithUnencodable).toBe(5)
    expect(result.unencodable.total).toBe(10)
    expect(result.unencodable.reasons.cycle).toBe(10)
  })
})

describe('driver: a package that differs on one input value', () => {
  const original = 'exports.f = (n) => n * 2'
  const changed = 'exports.f = (n) => (n >= 10 ? n * 2 + 1 : n * 2)'

  it('records one shrunk divergence, counts from executed calls, and replays it', async () => {
    const { sides, calls } = await open(original, changed)
    const opts = options({ caseCount: 100 })
    const result = await runFunction('f', harness(), sides, opts)
    expect(result.harnessErrors).toEqual([])
    expect(result.divergences).toHaveLength(1)
    const d = result.divergences[0]
    if (d === undefined || d.kind === 'api-surface') throw new Error('expected an outcome divergence')
    expect(d.kind).toBe('unexplained')
    expect(d.args).toEqual([{ t: 'num', v: 10 }])
    expect(d.differences.map((x) => x.part)).toEqual(['value'])
    expect(d.replay.phase).toBe('generated')
    const generated = result.phases.find((p) => p.phase === 'generated')
    expect(generated?.counterexample).toEqual([10])
    expect(d.shrink.attempts).toBe(generated?.shrinkAttempts)
    expect(d.shrink.budgetExhausted).toBe(false)
    expect(d.shrink.attempts).toBeGreaterThan(0)
    expect(result.cases).toBe(generated?.cases)
    expect(result.cases).toBeLessThanOrEqual(100)
    // Cases, shrink attempts and the confirmation run each cost three calls; none is counted twice.
    expect(calls.n).toBe(3 * (result.cases + d.shrink.attempts + 1))

    if (d.replay.phase === 'explicit') throw new Error('expected generated replay')
    const replayed = await replayPhase('f', harness(), sides, opts, d.replay)
    expect(replayed.diverged).toBe(true)
    expect(replayed.counterexample).toEqual([10])

    // The recorded parameters also reproduce the same shrunk value on a plain fast-check run.
    const plain = await fc.check(
      fc.asyncProperty(intArg, async ([n]) => n < 10),
      { seed: d.replay.seed, path: d.replay.path },
    )
    expect(plain.failed).toBe(true)
    expect(plain.counterexample).toEqual([[10]])
  })

  it('records a divergence on an explicit Case without shrinking', async () => {
    const { sides } = await open(original, changed)
    const result = await runFunction('f', harness({ explicitCases: [[1], [50], [60]] }), sides, options({ caseCount: 0 }))
    expect(result.divergences).toHaveLength(1)
    const d = result.divergences[0]
    if (d === undefined || d.kind === 'api-surface') throw new Error('expected an outcome divergence')
    expect(d.replay).toEqual({ phase: 'explicit', index: 1 })
    expect(d.args).toEqual([{ t: 'num', v: 50 }])
    expect(d.shrink).toEqual({ attempts: 0, budgetExhausted: false })
    expect(result.cases).toBe(2)
  })

  it('stops shrinking at the attempt budget', async () => {
    const { sides } = await open(original, 'exports.f = (n) => n * 2 + 1')
    const result = await runFunction('f', harness(), sides, options({ shrinkBudget: 0 }))
    const d = result.divergences[0]
    if (d === undefined || d.kind === 'api-surface') throw new Error('expected an outcome divergence')
    expect(d.shrink).toEqual({ attempts: 0, budgetExhausted: true })
  })
})

describe('driver: self-consistency', () => {
  it('flags a flaky Original and records no divergence for it', async () => {
    const flaky = 'let c = 0; exports.f = () => ++c'
    const { sides } = await open(flaky, 'exports.f = () => 1')
    const result = await runFunction('f', harness({ explicitCases: [[1]] }), sides, options())
    expect(result.nonDeterministic?.function).toBe('f')
    expect(result.nonDeterministic?.args).toEqual([{ t: 'num', v: 1 }])
    expect(result.nonDeterministic?.differences.map((x) => x.part)).toEqual(['value'])
    expect(result.divergences).toEqual([])
    expect(result.cases).toBe(0)
    expect(result.harnessErrors).toEqual([])
  })
})

describe('driver: accept and generator exhaustion', () => {
  it('reports generator-exhausted with the driver message when accept never accepts', async () => {
    const src = 'exports.f = (n) => n'
    const { sides, calls } = await open(src, src)
    const result = await runFunction('f', harness({ accept: () => false }), sides, options())
    expect(result.harnessErrors).toHaveLength(1)
    const e = result.harnessErrors[0]
    expect(e?.kind).toBe('generator-exhausted')
    expect(e?.function).toBe('f')
    expect(e?.message).toContain('"f"')
    expect(e?.message).toContain('"generated"')
    expect(e?.message).toContain(String(MAX_SKIPS_PER_RUN))
    expect(result.cases).toBe(0)
    expect(calls.n).toBe(0)
  })

  it('does not count skipped candidates as Cases', async () => {
    const src = 'exports.f = (n) => n'
    const { sides, calls } = await open(src, src)
    const result = await runFunction('f', harness({ accept: (a) => (a[0] as number) % 2 === 0 }), sides, options())
    expect(result.harnessErrors).toEqual([])
    expect(result.cases).toBe(20)
    expect(calls.n).toBe(60)
  })

  it('turns a throwing accept predicate into a harness-config-error', async () => {
    const src = 'exports.f = (n) => n'
    const { sides } = await open(src, src)
    const result = await runFunction(
      'f',
      harness({
        accept: () => {
          throw new Error('bad predicate')
        },
      }),
      sides,
      options(),
    )
    expect(result.harnessErrors[0]?.kind).toBe('harness-config-error')
    expect(firstError(result)).toContain('bad predicate')
  })

  it('turns an argument that cannot be encoded into a harness-config-error', async () => {
    const src = 'exports.f = (n) => n'
    const { sides } = await open(src, src)
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    const result = await runFunction('f', { args: fc.constant([cyclic]) }, sides, options())
    expect(result.harnessErrors[0]?.kind).toBe('harness-config-error')
    expect(result.cases).toBe(0)
  })
})

describe('driver: Declared_Delta phase', () => {
  const setSource = `
exports.set = (obj, path, value) => {
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (cur[k] === undefined) cur[k] = {}
    cur = cur[k]
  }
  cur[path[path.length - 1]] = value
  return obj
}`
  const fixedSource = `
const bad = new Set(['__proto__', 'constructor', 'prototype'])
exports.set = (obj, path, value) => {
  if (path.some((k) => bad.has(k))) return obj
  let cur = obj
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (cur[k] === undefined) cur[k] = {}
    cur = cur[k]
  }
  cur[path[path.length - 1]] = value
  return obj
}`

  function propertyModule(): string {
    const file = join(root, `prop${counter++}.cjs`)
    writeFileSync(file, 'exports.check = (ctx) => ({ ok: ctx.prototypeDelta.length === 0 })')
    return file
  }

  const safeSegments = fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 3 })
  const setHarness: FunctionHarness = {
    args: fc.tuple(fc.constant({}), safeSegments.map((s) => [...s, 'x']), fc.integer()),
  }

  function delta(generator: DeclaredDelta['generator']): DeclaredDelta {
    return {
      id: 'no-proto-pollution',
      function: 'set',
      predicate: (args) => (args[1] as string[]).includes('__proto__'),
      propertyModule: propertyModule(),
      explicitCases: [[{}, ['__proto__', 'polluted'], 1]],
      ...(generator === undefined ? {} : { generator }),
    }
  }

  const dangerous = fc
    .tuple(safeSegments, fc.nat())
    .map(([segs, i]): readonly unknown[] => {
      const path: string[] = [...segs]
      path.splice(i % segs.length, 0, '__proto__')
      return [{}, [...path, 'polluted'], 1]
    })

  it('demonstrates the delta on the explicit and generated delta Cases without a divergence', async () => {
    const { sides } = await open(setSource, fixedSource)
    const result = await runFunction('set', setHarness, sides, options({ deltas: [delta(dangerous)], caseCount: 10 }))
    expect(result.harnessErrors).toEqual([])
    expect(result.divergences).toEqual([])
    expect(result.phases.map((p) => [p.phase, p.cases])).toEqual([
      ['explicit', 1],
      ['generated', 10],
      ['delta:no-proto-pollution', 10],
    ])
    expect(result.cases).toBe(21)
    expect(result.deltas).toHaveLength(1)
    const d = result.deltas[0]
    expect(d?.status).toBe('demonstrated')
    expect(d?.predicateCasesChecked).toBe(11)
    expect(d?.demonstration?.original.ok).toBe(false)
    expect(d?.demonstration?.resurrection.ok).toBe(true)
  })

  it('reports a delta-violation when the Resurrection property fails', async () => {
    const { sides } = await open(setSource, setSource)
    const result = await runFunction('set', setHarness, sides, options({ deltas: [delta(dangerous)], caseCount: 5 }))
    expect(result.harnessErrors).toEqual([])
    expect(result.divergences.length).toBeGreaterThan(0)
    expect(result.divergences.every((d) => d.kind === 'delta-violation')).toBe(true)
    expect(result.deltas[0]?.status).toBe('not-demonstrated')
  })

  it('reports generator-violates-predicate when the constructive generator leaves the predicate', async () => {
    const { sides } = await open(setSource, fixedSource)
    const outside = fc.constant<readonly unknown[]>([{}, ['a', 'x'], 1])
    const d = { ...delta(outside), explicitCases: [] }
    const result = await runFunction('set', setHarness, sides, options({ deltas: [d], caseCount: 5 }))
    expect(result.harnessErrors[0]?.kind).toBe('generator-violates-predicate')
    expect(result.harnessErrors[0]?.message).toContain('no-proto-pollution')
  })
})

describe('driver: timeouts and crash outcomes', () => {
  const hang = 'exports.f = () => new Promise(() => {})'

  it('treats equal timeouts as equal', async () => {
    const { sides } = await open(hang, hang, 40)
    const result = await runFunction('f', { args: fc.constant([]), explicitCases: [[]] }, sides, options({ caseCount: 0 }))
    expect(result.harnessErrors).toEqual([])
    expect(result.nonDeterministic).toBeNull()
    expect(result.divergences).toEqual([])
    expect(result.cases).toBe(1)
  })

  it('reports a kind difference when only the Original times out', async () => {
    const { sides } = await open(hang, 'exports.f = () => 1', 40)
    const result = await runFunction('f', { args: fc.constant([]), explicitCases: [[]] }, sides, options({ caseCount: 0 }))
    const d = result.divergences[0]
    if (d === undefined || d.kind === 'api-surface') throw new Error('expected an outcome divergence')
    expect(d.differences).toEqual([{ part: 'kind', path: 'kind' }])
    expect(d.original.kind).toBe('timeout')
    expect(d.resurrection.kind).toBe('returned')
  })
})

describe('driver: never throws', () => {
  it('returns a typed harness error when an executor side fails', async () => {
    const src = 'exports.f = (n) => n'
    const { sides } = await open(src, src)
    const broken: DriverExecutor = {
      original: sides.original,
      resurrection: {
        ...sides.resurrection,
        call: () => {
          throw new Error('side exploded')
        },
      },
    }
    const result = await runFunction('f', harness({ explicitCases: [[1]] }), broken, options())
    expect(result.harnessErrors[0]?.kind).toBe('runner-protocol-error')
    expect(result.harnessErrors[0]?.function).toBe('f')
    expect(result.cases).toBe(0)
  })
})
