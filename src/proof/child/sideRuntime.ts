// SideRuntime: loads one package and runs the per-call protocol (Requirements 5.4, 5.6, 5.10 to
// 5.12, 8.9, 9.1, 11.7). Shared by the child runner and the InProcess_Executor.
// Sandbox side: self-contained (imports only within child/ and node:module, node:path, node:util),
// erasable TypeScript only.
//
// Per call, in order: reseed the stubs, decode the arguments, look up the export, take the
// Prototype_Snapshot, call (a synchronous call is not interrupted; an async result is awaited
// with the timeout), take the snapshot again and diff it (this also happens after a throw or a
// rejection), restore the prototypes and verify the restoration, encode value, argument post-state
// and delta, then run the property modules on the raw data of the same call. Encoding happens
// after restoration so the codec never runs on prototypes the package polluted.
//
// Thenables: a returned value is awaited only when it is a native Promise, or an object or
// function whose `then` is callable. Anything else is a plain return value. A native Promise is
// subscribed to with the `then` captured at load time, so a polluted `Promise.prototype.then` is
// not called. A non-native thenable is subscribed to with its own `then`. The first of its two
// callbacks decides; later calls are ignored. If reading `then` throws, the call is `rejected`.
//
// Timeouts: the parent enforces the real per-call timeout by killing the child. The in-runtime
// timeout (`timeoutMs` > 0) is best-effort: it bounds the wait for an async result only. A
// synchronous call that never returns cannot be interrupted here. A late settlement after a
// timeout is ignored. A timeout outcome carries the delta seen at that moment, then the
// prototypes are restored.
//
// `call` never throws. An internal failure gives outcome `crash` and a stable `crashReason`:
// `not-loaded`, `argument-decode-failed`, `function-not-found`, `export-access-failed`,
// `internal-error`. The Outcome shape of the parent has no reason field, so the reason travels
// next to it in the response.
//
// Property modules (`CallRequest.properties`) run only for completed calls (`returned`, `threw`,
// `rejected`), after restoration, on the raw delta of the same call. A module that throws or
// returns a malformed result gives `propertyError` and no property results. Prototypes are
// verified again after the modules ran, so `restoreVerified` covers their changes too.

import { createRequire } from 'node:module'
import { resolve as resolvePath } from 'node:path'
import { types } from 'node:util'
import { decodeNode } from './codec/decode.ts'
import { encodeValue } from './codec/encode.ts'
import type { EncodedNode } from './codec/nodes.ts'
import { compareCodePoints } from './codec/order.ts'
import type { PropertyRefWire, StubFlags } from './protocol.ts'
import {
  diffPrototypes,
  isRestorable,
  realPrototypes,
  restorePrototypes,
  snapshotPrototypes,
  snapshotsEqual,
} from './prototypes.ts'
import type { PrototypeSet, PrototypeSnapshot, RawDeltaEntry } from './prototypes.ts'
import { installStubs } from './stubs.ts'
import type { StubHandle } from './stubs.ts'

// ---------------------------------------------------------------------------
// Types (structurally the same as src/proof/types.ts; that file is parent side and not imported)
// ---------------------------------------------------------------------------

export interface EncodedDescriptor {
  value?: EncodedNode
  get?: EncodedNode
  set?: EncodedNode
  writable?: boolean
  enumerable: boolean
  configurable: boolean
}

export interface DeltaEntry {
  prototype: RawDeltaEntry['prototype']
  key: { s: string } | { sym: string | null }
  change: 'added' | 'changed' | 'removed'
  before?: EncodedDescriptor
  after?: EncodedDescriptor
}

interface CompletedFields {
  value: EncodedNode
  args: EncodedNode[]
  prototypeDelta: DeltaEntry[]
}

export type SideOutcome =
  | ({ kind: 'returned'; async: boolean } & CompletedFields)
  | ({ kind: 'threw'; async: false } & CompletedFields)
  | ({ kind: 'rejected'; async: true } & CompletedFields)
  | { kind: 'timeout'; prototypeDelta?: DeltaEntry[] }
  | { kind: 'crash' }
  | { kind: 'output-too-large' }

export interface SidePropertyResult {
  id: string
  ok: boolean
  detail?: EncodedNode
}

export interface ExportEntry {
  name: string
  type: string
  fnName?: string
  arity?: number
  primitive?: EncodedNode
}

export interface ExportsInfo {
  entries: ExportEntry[]
}

export interface SideCallRequest {
  /** Export name, or `default`. */
  fn: string
  args: readonly EncodedNode[]
  /** int32 seed for `Math.random` in this call. */
  caseSeed: number
  stubs?: StubFlags
  properties: readonly PropertyRefWire[]
  /** Best-effort in-runtime wait limit for an async result. 0 or less: no limit. */
  timeoutMs: number
}

export type CrashReason =
  | 'not-loaded'
  | 'argument-decode-failed'
  | 'function-not-found'
  | 'export-access-failed'
  | 'internal-error'

export interface SideCallResponse {
  result: { outcome: SideOutcome; properties: SidePropertyResult[] }
  restoreVerified: boolean
  /** Set when the outcome is `crash`. */
  crashReason?: CrashReason
  /** Set when a property module threw or returned a malformed result (executor error `property-error`). */
  propertyError?: string
}

export type LoadResult = { ok: true; value: undefined } | { ok: false; error: { message: string } }

export interface SideRuntimeOptions {
  packageDir: string
  entryFile: string
  setupModule?: string
  outputLimitBytes: number
  /** Default: the six real prototypes. Tests inject fakes. */
  prototypes?: PrototypeSet
  /** True in the child (stubs installed at load), false in-process (installed per call). */
  installStubsGlobally?: boolean
  /** Which stubs the global installation uses. Default: both. */
  stubs?: StubFlags
}

export interface SideRuntime {
  load(): LoadResult
  listExports(): ExportsInfo
  /** Same as `listExports`; the name used by the design. */
  exports(): ExportsInfo
  call(request: SideCallRequest): Promise<SideCallResponse>
}

// ---------------------------------------------------------------------------
// Intrinsics captured when this module loads
// ---------------------------------------------------------------------------

const reflectApply = Reflect.apply
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor
const ownKeys = Reflect.ownKeys
const jsonStringify = JSON.stringify
const byteLength = Buffer.byteLength
const setTimeoutFn = setTimeout
const clearTimeoutFn = clearTimeout
const PromiseCtor = Promise
const promiseThen = Promise.prototype.then
const isPromise = types.isPromise
const arrayPush = Array.prototype.push
const arraySort = Array.prototype.sort
const stringCtor = String
const numberIsFinite = Number.isFinite
const isArray = Array.isArray

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class OutputTooLarge {}

type Settled = { ok: boolean; value: unknown }
const TIMED_OUT: unique symbol = Symbol('timed-out')

type Raw =
  | { tag: 'completed'; kind: 'returned' | 'threw' | 'rejected'; async: boolean; value: unknown; delta: RawDeltaEntry[] }
  | { tag: 'timeout'; delta: RawDeltaEntry[] }
  | { tag: 'crash'; reason: CrashReason }

function errorMessage(e: unknown): string {
  try {
    if (typeof e === 'object' && e !== null) {
      const d = getOwnPropertyDescriptor(e, 'message')
      if (d !== undefined && typeof d.value === 'string') return d.value
    }
    return stringCtor(e)
  } catch {
    return 'unprintable error'
  }
}

function isObjectLike(v: unknown): v is object {
  return (typeof v === 'object' && v !== null) || typeof v === 'function'
}

/** Reads an own data property, or calls an own getter. Throws what the getter throws. */
function readOwn(obj: object, key: string): { found: boolean; value: unknown } {
  const d = getOwnPropertyDescriptor(obj, key)
  if (d === undefined) return { found: false, value: undefined }
  if ('value' in d) return { found: true, value: d.value }
  if (d.get === undefined) return { found: true, value: undefined }
  return { found: true, value: reflectApply(d.get, obj, []) }
}

function waitFor(thenable: Promise<Settled>, timeoutMs: number): Promise<Settled | typeof TIMED_OUT> {
  if (!(timeoutMs > 0) || !numberIsFinite(timeoutMs)) return thenable
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new PromiseCtor<typeof TIMED_OUT>((res) => {
    timer = setTimeoutFn(() => res(TIMED_OUT), timeoutMs)
  })
  const clear = (): void => {
    if (timer !== undefined) clearTimeoutFn(timer)
  }
  return new PromiseCtor<Settled | typeof TIMED_OUT>((res) => {
    reflectApply(promiseThen, thenable, [
      (s: Settled) => {
        clear()
        res(s)
      },
    ])
    reflectApply(promiseThen, timeout, [(t: typeof TIMED_OUT) => res(t)])
  })
}

/** A promise that settles with `{ok, value}` for a thenable; never rejects. `undefined` for a non-thenable. */
function subscribe(value: unknown): Promise<Settled> | undefined {
  if (!isObjectLike(value)) return undefined
  let then: unknown
  if (isPromise(value)) {
    then = promiseThen
  } else {
    try {
      then = (value as { then?: unknown }).then
    } catch (e) {
      return new PromiseCtor<Settled>((res) => res({ ok: false, value: e }))
    }
    if (typeof then !== 'function') return undefined
  }
  const fn = then as (...a: unknown[]) => unknown
  return new PromiseCtor<Settled>((res) => {
    try {
      reflectApply(fn, value, [(v: unknown) => res({ ok: true, value: v }), (e: unknown) => res({ ok: false, value: e })])
    } catch (e) {
      res({ ok: false, value: e })
    }
  })
}

function enc(value: unknown, budget: number): EncodedNode {
  const r = encodeValue(value, { budget })
  if (!r.ok) throw new OutputTooLarge()
  return r.node
}

function encodeDescriptor(d: PropertyDescriptor, budget: number): EncodedDescriptor {
  const out: EncodedDescriptor = { enumerable: d.enumerable === true, configurable: d.configurable === true }
  if ('get' in d || 'set' in d) {
    if (d.get !== undefined) out.get = enc(d.get, budget)
    if (d.set !== undefined) out.set = enc(d.set, budget)
  } else {
    out.value = enc(d.value, budget)
    out.writable = d.writable === true
  }
  return out
}

function encodeDelta(delta: readonly RawDeltaEntry[], budget: number): DeltaEntry[] {
  const out: DeltaEntry[] = []
  for (let i = 0; i < delta.length; i++) {
    const e = delta[i]!
    const key = typeof e.key === 'symbol' ? { sym: e.key.description ?? null } : { s: e.key }
    const entry: DeltaEntry = { prototype: e.prototype, key, change: e.change }
    if (e.before !== undefined) entry.before = encodeDescriptor(e.before, budget)
    if (e.after !== undefined) entry.after = encodeDescriptor(e.after, budget)
    arrayPush.call(out, entry)
  }
  return out
}

function primitiveKind(v: unknown): boolean {
  return v === null || (typeof v !== 'object' && typeof v !== 'function')
}

function exportEntry(name: string, value: unknown, budget: number): ExportEntry {
  if (typeof value === 'function') {
    const entry: ExportEntry = { name, type: 'function' }
    const n = getOwnPropertyDescriptor(value, 'name')
    if (n !== undefined && typeof n.value === 'string') entry.fnName = n.value
    const l = getOwnPropertyDescriptor(value, 'length')
    if (l !== undefined && typeof l.value === 'number') entry.arity = l.value
    return entry
  }
  const entry: ExportEntry = { name, type: typeof value }
  if (primitiveKind(value)) entry.primitive = enc(value, budget)
  return entry
}

function enumerableStringKeys(obj: object): string[] {
  const out: string[] = []
  const keys = ownKeys(obj)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    if (typeof k !== 'string') continue
    const d = getOwnPropertyDescriptor(obj, k)
    if (d !== undefined && d.enumerable === true) arrayPush.call(out, k)
  }
  return out
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSideRuntime(options: SideRuntimeOptions): SideRuntime {
  const protos: PrototypeSet = options.prototypes ?? realPrototypes()
  const limit = options.outputLimitBytes
  const globalStubs = options.installStubsGlobally === true
  let requireFn: ((id: string) => unknown) | undefined
  let moduleExports: unknown
  let loaded = false
  let globalHandle: StubHandle | undefined

  function listExports(): ExportsInfo {
    const entries: ExportEntry[] = []
    if (!loaded) return { entries }
    try {
      const mod = moduleExports
      if (typeof mod === 'function') {
        arrayPush.call(entries, exportEntry('default', mod, limit))
      } else if (primitiveKind(mod)) {
        if (mod !== undefined && mod !== null) arrayPush.call(entries, exportEntry('default', mod, limit))
        return { entries }
      }
      const obj = mod as object
      const keys = enumerableStringKeys(obj)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        let value: unknown
        try {
          value = readOwn(obj, key).value
        } catch {
          // A getter that throws is listed with type `accessor` (not for a function export).
          if (typeof mod !== 'function') arrayPush.call(entries, { name: key, type: 'accessor' } satisfies ExportEntry)
          continue
        }
        // A function export lists only its own function-valued properties.
        if (typeof mod === 'function' && typeof value !== 'function') continue
        arrayPush.call(entries, exportEntry(key, value, limit))
      }
    } catch {
      // A listing failure leaves the entries found so far.
    }
    arraySort.call(entries, (a: ExportEntry, b: ExportEntry) => compareCodePoints(a.name, b.name))
    return { entries }
  }

  function load(): LoadResult {
    if (loaded) return { ok: true, value: undefined }
    try {
      if (globalStubs && globalHandle === undefined) {
        const flags = options.stubs ?? { date: true, random: true }
        globalHandle = installStubs({ date: flags.date, random: flags.random })
      }
      const req = createRequire(resolvePath(options.packageDir, 'package.json'))
      requireFn = req
      if (options.setupModule !== undefined) req(options.setupModule)
      moduleExports = req(resolvePath(options.packageDir, options.entryFile))
      loaded = true
      return { ok: true, value: undefined }
    } catch (e) {
      return { ok: false, error: { message: errorMessage(e) } }
    }
  }

  function lookup(fn: string): { fn: unknown; self: unknown } | CrashReason {
    const mod = moduleExports
    try {
      if (fn === 'default') {
        if (typeof mod === 'function') return { fn: mod, self: undefined }
        if (isObjectLike(mod)) {
          const r = readOwn(mod, 'default')
          if (r.found) return { fn: r.value, self: undefined }
        }
        return 'function-not-found'
      }
      if (!isObjectLike(mod)) return 'function-not-found'
      const r = readOwn(mod, fn)
      return r.found ? { fn: r.value, self: mod } : 'function-not-found'
    } catch {
      return 'export-access-failed'
    }
  }

  async function call(request: SideCallRequest): Promise<SideCallResponse> {
    // `execute` assigns these; the casts keep TypeScript from narrowing them to `undefined`.
    let before = undefined as PrototypeSnapshot | undefined
    let decodedArgs: unknown[] = []
    let perCall = undefined as StubHandle | undefined
    let raw: Raw
    try {
      raw = await execute()
    } catch {
      raw = { tag: 'crash', reason: 'internal-error' }
    }

    async function execute(): Promise<Raw> {
      if (!loaded) return { tag: 'crash', reason: 'not-loaded' }
      if (globalStubs) {
        globalHandle?.reseed(request.caseSeed)
      } else {
        const flags = request.stubs ?? { date: true, random: true }
        perCall = installStubs({ date: flags.date, random: flags.random, seed: request.caseSeed })
        perCall.reseed(request.caseSeed)
      }
      try {
        for (let i = 0; i < request.args.length; i++) arrayPush.call(decodedArgs, decodeNode(request.args[i]!))
      } catch {
        decodedArgs = []
        return { tag: 'crash', reason: 'argument-decode-failed' }
      }
      const target = lookup(request.fn)
      if (typeof target === 'string') return { tag: 'crash', reason: target }
      if (typeof target.fn !== 'function') return { tag: 'crash', reason: 'function-not-found' }

      before = snapshotPrototypes(protos)
      const snap = before
      let kind: 'returned' | 'threw' | 'rejected' = 'returned'
      let isAsync = false
      let value: unknown
      try {
        const returned = reflectApply(target.fn as (...a: unknown[]) => unknown, target.self, decodedArgs)
        const pending = subscribe(returned)
        if (pending === undefined) {
          value = returned
        } else {
          isAsync = true
          const r = await waitFor(pending, request.timeoutMs)
          if (r === TIMED_OUT) {
            perCall?.restore()
            return { tag: 'timeout', delta: diffPrototypes(snap, snapshotPrototypes(protos)) }
          }
          kind = r.ok ? 'returned' : 'rejected'
          value = r.value
        }
      } catch (e) {
        kind = 'threw'
        isAsync = false
        value = e
      }
      perCall?.restore()
      return completed(snap, kind, isAsync, value)
    }

    function completed(snap: PrototypeSnapshot, kind: 'returned' | 'threw' | 'rejected', async: boolean, value: unknown): Raw {
      return { tag: 'completed', kind, async, value, delta: diffPrototypes(snap, snapshotPrototypes(protos)) }
    }

    // Restore and verify (also after a crash that happened once the package code had run).
    let restoreVerified = true
    try {
      perCall?.restore()
      if (before !== undefined) {
        restorePrototypes(protos, before)
        restoreVerified = snapshotsEqual(before, snapshotPrototypes(protos)) && isRestorable(protos)
      }
    } catch {
      restoreVerified = false
    }

    let outcome: SideOutcome
    let properties: SidePropertyResult[] = []
    let crashReason: CrashReason | undefined
    let propertyError: string | undefined
    try {
      if (raw.tag === 'crash') {
        outcome = { kind: 'crash' }
        crashReason = raw.reason
      } else if (raw.tag === 'timeout') {
        outcome = { kind: 'timeout', prototypeDelta: encodeDelta(raw.delta, limit) }
      } else {
        const args: EncodedNode[] = []
        for (let i = 0; i < decodedArgs.length; i++) arrayPush.call(args, enc(decodedArgs[i], limit))
        const fields: CompletedFields = {
          value: enc(raw.value, limit),
          args,
          prototypeDelta: encodeDelta(raw.delta, limit),
        }
        if (raw.kind === 'returned') outcome = { kind: 'returned', async: raw.async, ...fields }
        else if (raw.kind === 'threw') outcome = { kind: 'threw', async: false, ...fields }
        else outcome = { kind: 'rejected', async: true, ...fields }
        if (byteLength(jsonStringify(outcome)) > limit) throw new OutputTooLarge()
      }
    } catch (e) {
      if (e instanceof OutputTooLarge) {
        outcome = { kind: 'output-too-large' }
      } else {
        outcome = { kind: 'crash' }
        crashReason = 'internal-error'
      }
    }

    if (raw.tag === 'completed' && outcome.kind !== 'crash' && outcome.kind !== 'output-too-large') {
      const ran = runProperties(request.properties, request.fn, raw)
      if (ran.error !== undefined) propertyError = ran.error
      else if (ran.tooLarge) outcome = { kind: 'output-too-large' }
      else properties = ran.results
      if (request.properties.length > 0 && before !== undefined) {
        try {
          if (!snapshotsEqual(before, snapshotPrototypes(protos))) {
            restorePrototypes(protos, before)
            restoreVerified = snapshotsEqual(before, snapshotPrototypes(protos)) && isRestorable(protos)
          }
        } catch {
          restoreVerified = false
        }
      }
    }

    const response: SideCallResponse = { result: { outcome, properties }, restoreVerified }
    if (crashReason !== undefined) response.crashReason = crashReason
    if (propertyError !== undefined) response.propertyError = propertyError
    return response
  }

  function runProperties(
    refs: readonly PropertyRefWire[],
    fnName: string,
    raw: Extract<Raw, { tag: 'completed' }>,
  ): { results: SidePropertyResult[]; error?: string; tooLarge?: boolean } {
    const results: SidePropertyResult[] = []
    if (refs.length === 0 || requireFn === undefined) return { results }
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!
      try {
        const mod = requireFn(ref.modulePath)
        const check = isObjectLike(mod) ? readOwn(mod, 'check').value : undefined
        if (typeof check !== 'function') {
          return { results: [], error: `property ${ref.id}: module has no check function` }
        }
        const ctx = { functionName: fnName, kind: raw.kind, prototypeDelta: raw.delta, result: raw.value }
        const res: unknown = reflectApply(check as (...a: unknown[]) => unknown, mod, [ctx])
        if (!isObjectLike(res) || typeof res === 'function' || isArray(res) || isPromise(res)) {
          return { results: [], error: `property ${ref.id}: malformed result` }
        }
        const ok = readOwn(res, 'ok')
        if (!ok.found || typeof ok.value !== 'boolean') {
          return { results: [], error: `property ${ref.id}: malformed result` }
        }
        const entry: SidePropertyResult = { id: ref.id, ok: ok.value }
        const detail = readOwn(res, 'detail')
        if (detail.found && detail.value !== undefined) entry.detail = enc(detail.value, limit)
        arrayPush.call(results, entry)
      } catch (e) {
        if (e instanceof OutputTooLarge) return { results: [], tooLarge: true }
        return { results: [], error: `property ${ref.id}: ${errorMessage(e)}` }
      }
    }
    return { results }
  }

  return { load, listExports, exports: listExports, call }
}
