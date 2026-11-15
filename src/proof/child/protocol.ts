// Wire protocol between the parent shell and the sandbox runner: newline-delimited JSON, one
// message per line, every message carries `gs: 1` and a type tag `t`.
//
// Pure string and byte functions only (no node:fs, no network, no npm packages), so the same code
// serves the in-process executor and the stdio transport. The parent shell imports this file
// directly (the design lists no second copy), the same way it imports child/codec.
// Sandbox side: self-contained, erasable TypeScript only.
//
// Payloads that the codec owns (encoded nodes, the Outcome with its Prototype_Delta) are checked
// here only for their outer shape. The parent validates them in depth with its zod schemas.

export const PROTOCOL_VERSION = 1
/** Parent slack added to the output limit before a line counts as too long (design: 64 KiB). */
export const LINE_SLACK_BYTES = 64 * 1024
export const DEFAULT_MAX_LINE_BYTES = 1024 * 1024

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface StubFlags {
  date: boolean
  random: boolean
}

export interface ExportEntryWire {
  name: string
  type: string
  fnName?: string
  arity?: number
  primitive?: JsonValue
}

export interface PropertyResultWire {
  id: string
  ok: boolean
  detail?: JsonValue
}

export interface PropertyRefWire {
  id: string
  modulePath: string
}

export const OUTCOME_KINDS = ['returned', 'threw', 'resolved', 'rejected', 'timeout', 'crash', 'output-too-large'] as const

// child to parent
export interface ReadyMessage {
  gs: 1
  t: 'ready'
  node: string
}
export interface LoadedMessage {
  gs: 1
  t: 'loaded'
  id: number
  ok: boolean
  error?: string
}
/** Answer to an ExportsRequest; carries `entries`. */
export interface ExportsResponse {
  gs: 1
  t: 'exports'
  id: number
  entries: ExportEntryWire[]
}
export interface ResultMessage {
  gs: 1
  t: 'result'
  id: number
  outcome: { kind: string; [key: string]: JsonValue }
  properties: PropertyResultWire[]
  restoreVerified: boolean
}
export interface FatalMessage {
  gs: 1
  t: 'fatal'
  id?: number
  message: string
}

// parent to child
export interface LoadMessage {
  gs: 1
  t: 'load'
  id: number
  entryFile: string
  setupModule?: string
  outputLimitBytes: number
  stubs: StubFlags
}
/** Request to list exports; has no `entries`. */
export interface ExportsRequest {
  gs: 1
  t: 'exports'
  id: number
}
export interface CallMessage {
  gs: 1
  t: 'call'
  id: number
  fn: string
  args: JsonValue[]
  caseSeed: number
  stubs: StubFlags
  properties: PropertyRefWire[]
  timeoutMs: number
}
export interface ShutdownMessage {
  gs: 1
  t: 'shutdown'
}

export type ChildMessage = ReadyMessage | LoadedMessage | ExportsResponse | ResultMessage | FatalMessage
export type ParentMessage = LoadMessage | ExportsRequest | CallMessage | ShutdownMessage
export type ProtocolMessage = ChildMessage | ParentMessage

export const MESSAGE_TYPES = ['ready', 'load', 'loaded', 'exports', 'call', 'result', 'shutdown', 'fatal'] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

export type MalformedReason =
  | 'line-too-long'
  | 'buffer-overflow'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'not-an-object'
  | 'wrong-version'
  | 'unknown-type'
  | 'wrong-shape'

export type ParseResult =
  | { kind: 'message'; message: ProtocolMessage }
  | { kind: 'malformed'; reason: MalformedReason }

type Rec = Record<string, unknown>

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
function isId(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
}
function isNonNegInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
}
function isInt32(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= -0x80000000 && x <= 0x7fffffff
}
function isStr(x: unknown): x is string {
  return typeof x === 'string'
}
function optStr(x: unknown): boolean {
  return x === undefined || typeof x === 'string'
}
function isStubs(x: unknown): x is StubFlags {
  return isRec(x) && typeof x['date'] === 'boolean' && typeof x['random'] === 'boolean'
}
function isArrayOf(x: unknown, test: (item: unknown) => boolean): boolean {
  if (!Array.isArray(x)) return false
  for (const item of x as unknown[]) if (!test(item)) return false
  return true
}
function isExportEntry(x: unknown): boolean {
  return (
    isRec(x) &&
    isStr(x['name']) &&
    isStr(x['type']) &&
    optStr(x['fnName']) &&
    (x['arity'] === undefined || isNonNegInt(x['arity']))
  )
}
function isPropertyResult(x: unknown): boolean {
  return isRec(x) && isStr(x['id']) && typeof x['ok'] === 'boolean'
}
function isPropertyRef(x: unknown): boolean {
  return isRec(x) && isStr(x['id']) && isStr(x['modulePath'])
}
function isOutcome(x: unknown): boolean {
  return isRec(x) && isStr(x['kind']) && (OUTCOME_KINDS as readonly string[]).includes(x['kind'])
}

function shapeOk(t: MessageType, m: Rec): boolean {
  switch (t) {
    case 'ready':
      return isStr(m['node'])
    case 'load':
      return (
        isId(m['id']) &&
        isStr(m['entryFile']) &&
        optStr(m['setupModule']) &&
        isNonNegInt(m['outputLimitBytes']) &&
        isStubs(m['stubs'])
      )
    case 'loaded':
      return isId(m['id']) && typeof m['ok'] === 'boolean' && optStr(m['error'])
    case 'exports':
      return isId(m['id']) && (m['entries'] === undefined || isArrayOf(m['entries'], isExportEntry))
    case 'call':
      return (
        isId(m['id']) &&
        isStr(m['fn']) &&
        Array.isArray(m['args']) &&
        isInt32(m['caseSeed']) &&
        isStubs(m['stubs']) &&
        isArrayOf(m['properties'], isPropertyRef) &&
        typeof m['timeoutMs'] === 'number' &&
        Number.isFinite(m['timeoutMs']) &&
        m['timeoutMs'] >= 0
      )
    case 'result':
      return (
        isId(m['id']) &&
        isOutcome(m['outcome']) &&
        isArrayOf(m['properties'], isPropertyResult) &&
        typeof m['restoreVerified'] === 'boolean'
      )
    case 'shutdown':
      return true
    case 'fatal':
      return (m['id'] === undefined || isId(m['id'])) && isStr(m['message'])
  }
}

/** Validates an already parsed JSON value. Never throws. */
export function validateMessage(value: unknown): ParseResult {
  if (!isRec(value)) return { kind: 'malformed', reason: 'not-an-object' }
  if (value['gs'] !== PROTOCOL_VERSION) return { kind: 'malformed', reason: 'wrong-version' }
  const t = value['t']
  if (typeof t !== 'string' || !(MESSAGE_TYPES as readonly string[]).includes(t)) {
    return { kind: 'malformed', reason: 'unknown-type' }
  }
  if (!shapeOk(t as MessageType, value)) return { kind: 'malformed', reason: 'wrong-shape' }
  return { kind: 'message', message: value as unknown as ProtocolMessage }
}

/** Parses one line (without its terminator). Never throws. */
export function parseLine(line: string): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { kind: 'malformed', reason: 'invalid-json' }
  }
  return validateMessage(value)
}

/** The design's `parseProtocolLine`: the message, or `undefined` for anything else. */
export function parseProtocolLine(line: string): ProtocolMessage | undefined {
  const r = parseLine(line)
  return r.kind === 'message' ? r.message : undefined
}

/** Direction filters. `exports` is one tag for both directions; `entries` marks the answer. */
export function isChildMessage(m: ProtocolMessage): m is ChildMessage {
  if (m.t === 'exports') return 'entries' in m
  return m.t === 'ready' || m.t === 'loaded' || m.t === 'result' || m.t === 'fatal'
}
export function isParentMessage(m: ProtocolMessage): m is ParentMessage {
  if (m.t === 'exports') return !('entries' in m)
  return m.t === 'load' || m.t === 'call' || m.t === 'shutdown'
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

const KEY_ORDER: Readonly<Record<MessageType, readonly string[]>> = {
  ready: ['gs', 't', 'node'],
  load: ['gs', 't', 'id', 'entryFile', 'setupModule', 'outputLimitBytes', 'stubs'],
  loaded: ['gs', 't', 'id', 'ok', 'error'],
  exports: ['gs', 't', 'id', 'entries'],
  call: ['gs', 't', 'id', 'fn', 'args', 'caseSeed', 'stubs', 'properties', 'timeoutMs'],
  result: ['gs', 't', 'id', 'outcome', 'properties', 'restoreVerified'],
  shutdown: ['gs', 't'],
  fatal: ['gs', 't', 'id', 'message'],
}

/**
 * Serializes a message to one line without terminator. Top-level keys are written in the fixed
 * order above, `undefined` fields are skipped; nested values keep the key order they have (the
 * codec already produces its nodes in canonical order). Throws only on a caller bug (a value that
 * JSON cannot represent, or a line containing a raw line break, which JSON.stringify never makes).
 */
export function serializeMessage(message: ProtocolMessage): string {
  const rec = message as unknown as Rec
  const order = KEY_ORDER[message.t]
  const parts: string[] = []
  for (const k of order) {
    const v = rec[k]
    if (v === undefined) continue
    const json = JSON.stringify(v)
    if (json === undefined) throw new TypeError('unserializable value for key ' + k)
    parts.push(JSON.stringify(k) + ':' + json)
  }
  const line = '{' + parts.join(',') + '}'
  if (line.includes('\n') || line.includes('\r')) throw new RangeError('protocol line contains a raw line break')
  return line
}

/** The line as written to a stream: serialized message plus the terminator. */
export function frameMessage(message: ProtocolMessage): string {
  return serializeMessage(message) + '\n'
}

// ---------------------------------------------------------------------------
// Line-framed reader
// ---------------------------------------------------------------------------

export interface ReaderOptions {
  /** Longest accepted line in bytes, terminator excluded. */
  maxLineBytes?: number
  /** Most bytes held for an unfinished line. The effective line limit is the smaller of the two. */
  maxBufferedBytes?: number
}

/**
 * Splits a byte or string stream into lines on 0x0A only (U+2028 and U+2029 are ordinary text),
 * parses each line and reports a message or a typed malformed result. A line over the limit is
 * reported once and dropped through its terminator. Empty lines are ignored. Never throws.
 */
export class ProtocolReader {
  #maxLine: number
  #pieces: Uint8Array[] = []
  #pending = 0
  #discarding = false
  #decoder = new TextDecoder('utf-8', { fatal: true })
  #encoder = new TextEncoder()
  #overflowReason: MalformedReason

  constructor(options: ReaderOptions = {}) {
    const line = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
    const buf = options.maxBufferedBytes
    const useBuf = buf !== undefined && buf < line
    this.#maxLine = Math.max(0, useBuf ? buf : line)
    this.#overflowReason = useBuf ? 'buffer-overflow' : 'line-too-long'
  }

  /** Bytes currently held for an unfinished line. */
  get bufferedBytes(): number {
    return this.#pending
  }

  feed(chunk: string | Uint8Array): ParseResult[] {
    const bytes = typeof chunk === 'string' ? this.#encoder.encode(chunk) : chunk
    const out: ParseResult[] = []
    let start = 0
    for (;;) {
      const nl = bytes.indexOf(0x0a, start)
      const end = nl === -1 ? bytes.length : nl
      if (end > start) this.#append(bytes.subarray(start, end), out)
      if (nl === -1) return out
      this.#finishLine(out)
      start = nl + 1
    }
  }

  /** Call at end of stream. An unfinished line is malformed unless it is empty. */
  end(): ParseResult[] {
    const out: ParseResult[] = []
    if (!this.#discarding && this.#pending > 0) {
      this.#clear()
      out.push({ kind: 'malformed', reason: 'invalid-json' })
    }
    this.#clear()
    this.#discarding = false
    return out
  }

  #append(piece: Uint8Array, out: ParseResult[]): void {
    if (this.#discarding) return
    if (this.#pending + piece.length > this.#maxLine) {
      this.#clear()
      this.#discarding = true
      out.push({ kind: 'malformed', reason: this.#overflowReason })
      return
    }
    // Copy: the caller may reuse its buffer.
    this.#pieces.push(piece.slice())
    this.#pending += piece.length
  }

  #finishLine(out: ParseResult[]): void {
    if (this.#discarding) {
      this.#discarding = false
      return
    }
    const total = this.#pending
    if (total === 0) return
    const joined = new Uint8Array(total)
    let at = 0
    for (const p of this.#pieces) {
      joined.set(p, at)
      at += p.length
    }
    this.#clear()
    let text: string
    try {
      text = this.#decoder.decode(joined)
    } catch {
      out.push({ kind: 'malformed', reason: 'invalid-utf8' })
      return
    }
    if (text.endsWith('\r')) text = text.slice(0, -1)
    if (text.length === 0) return
    out.push(parseLine(text))
  }

  #clear(): void {
    this.#pieces = []
    this.#pending = 0
  }
}
