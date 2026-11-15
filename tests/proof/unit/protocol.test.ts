// Requirements: 5.8
import { describe, expect, it } from 'vitest'
import {
  ProtocolReader,
  frameMessage,
  isChildMessage,
  isParentMessage,
  parseLine,
  parseProtocolLine,
  serializeMessage,
  type ParseResult,
  type ProtocolMessage,
} from '../../../src/proof/child/protocol.ts'

const stubs = { date: true, random: false }

const samples: ProtocolMessage[] = [
  { gs: 1, t: 'ready', node: 'v22.0.0' },
  { gs: 1, t: 'load', id: 1, entryFile: 'C:\\x\\index.js', setupModule: 's.mjs', outputLimitBytes: 1000, stubs },
  { gs: 1, t: 'loaded', id: 1, ok: false, error: 'boom' },
  { gs: 1, t: 'exports', id: 2 },
  { gs: 1, t: 'exports', id: 2, entries: [{ name: 'a', type: 'function', fnName: 'a', arity: 2 }, { name: 'b', type: 'string' }] },
  {
    gs: 1,
    t: 'call',
    id: 3,
    fn: 'default',
    args: [{ t: 'number', v: 1 }],
    caseSeed: -5,
    stubs,
    properties: [{ id: 'p', modulePath: '/m.mjs' }],
    timeoutMs: 2000,
  },
  {
    gs: 1,
    t: 'result',
    id: 3,
    outcome: { kind: 'returned', value: { t: 'undefined' } },
    properties: [{ id: 'p', ok: true }],
    restoreVerified: true,
  },
  { gs: 1, t: 'shutdown' },
  { gs: 1, t: 'fatal', id: 4, message: 'bad' },
  { gs: 1, t: 'fatal', message: 'bad' },
]

function messages(results: ParseResult[]): ProtocolMessage[] {
  return results.flatMap((r) => (r.kind === 'message' ? [r.message] : []))
}
function reasons(results: ParseResult[]): string[] {
  return results.flatMap((r) => (r.kind === 'malformed' ? [r.reason] : []))
}

describe('protocol: round trip', () => {
  it.each(samples.map((m, i) => [i, m] as const))('message %i survives serialize and parse', (_i, m) => {
    const line = serializeMessage(m)
    expect(line).not.toMatch(/[\r\n]/)
    expect(parseProtocolLine(line)).toEqual(m)
  })

  it('writes top-level keys in the fixed order and skips undefined fields', () => {
    const line = serializeMessage({ t: 'loaded', ok: true, id: 7, gs: 1, error: undefined })
    expect(line).toBe('{"gs":1,"t":"loaded","id":7,"ok":true}')
  })

  it('frameMessage ends with exactly one newline', () => {
    expect(frameMessage({ gs: 1, t: 'shutdown' })).toBe('{"gs":1,"t":"shutdown"}\n')
  })

  it('classifies the two exports directions', () => {
    const req = samples[3] as ProtocolMessage
    const res = samples[4] as ProtocolMessage
    expect(isParentMessage(req) && !isChildMessage(req)).toBe(true)
    expect(isChildMessage(res) && !isParentMessage(res)).toBe(true)
  })

  it('escapes raw newlines inside strings', () => {
    const line = serializeMessage({ gs: 1, t: 'fatal', message: 'a\nb\r\nc' })
    expect(line).not.toMatch(/[\r\n]/)
    expect(parseProtocolLine(line)).toMatchObject({ message: 'a\nb\r\nc' })
  })
})

describe('protocol: reader framing', () => {
  it('reads every message type through one reader', () => {
    const r = new ProtocolReader()
    const out = messages(r.feed(samples.map(frameMessage).join('')))
    expect(out).toEqual(samples)
  })

  it('assembles a message from partial chunks, one byte at a time', () => {
    const r = new ProtocolReader()
    const bytes = new TextEncoder().encode(frameMessage(samples[5] as ProtocolMessage))
    const got: ParseResult[] = []
    for (const b of bytes) got.push(...r.feed(new Uint8Array([b])))
    expect(messages(got)).toEqual([samples[5]])
    expect(r.bufferedBytes).toBe(0)
  })

  it('splits several messages in one chunk and keeps the tail', () => {
    const r = new ProtocolReader()
    const a = frameMessage({ gs: 1, t: 'shutdown' })
    const b = frameMessage({ gs: 1, t: 'ready', node: 'v1' })
    const first = r.feed(a + b + b.slice(0, 5))
    expect(messages(first)).toHaveLength(2)
    expect(messages(r.feed(b.slice(5)))).toEqual([{ gs: 1, t: 'ready', node: 'v1' }])
  })

  it('accepts CRLF terminators and ignores empty lines', () => {
    const r = new ProtocolReader()
    const out = r.feed('\n\r\n{"gs":1,"t":"shutdown"}\r\n\n')
    expect(messages(out)).toEqual([{ gs: 1, t: 'shutdown' }])
    expect(reasons(out)).toEqual([])
  })

  it('reads a very long message split across many chunks', () => {
    const big = 'x'.repeat(500_000) + 'é€😀'
    const line = frameMessage({ gs: 1, t: 'fatal', message: big })
    const bytes = new TextEncoder().encode(line)
    const r = new ProtocolReader({ maxLineBytes: 2_000_000 })
    const got: ParseResult[] = []
    for (let i = 0; i < bytes.length; i += 4093) got.push(...r.feed(bytes.subarray(i, i + 4093)))
    expect(messages(got)).toEqual([{ gs: 1, t: 'fatal', message: big }])
  })

  it('does not split on U+2028 or U+2029 inside strings', () => {
    const text = 'a\u2028b\u2029c'
    const r = new ProtocolReader()
    const line = frameMessage({ gs: 1, t: 'fatal', message: text })
    expect(line.endsWith('\n') && line.indexOf('\n') === line.length - 1).toBe(true)
    expect(messages(r.feed(line))).toEqual([{ gs: 1, t: 'fatal', message: text }])
    // Also when the separators arrive raw inside the JSON text and the chunk is cut between them.
    const raw = '{"gs":1,"t":"fatal","message":"a\u2028b\u2029c"}\n'
    const mid = raw.indexOf('\u2028') + 1
    const got = [...r.feed(raw.slice(0, mid)), ...r.feed(raw.slice(mid))]
    expect(messages(got)).toEqual([{ gs: 1, t: 'fatal', message: text }])
  })

  it('reports a line over the limit once, drops it, and recovers on the next line', () => {
    const r = new ProtocolReader({ maxLineBytes: 100 })
    const got = [
      ...r.feed('{"gs":1,"t":"fatal","message":"' + 'y'.repeat(300)),
      ...r.feed('y'.repeat(300)),
      ...r.feed('"}\n{"gs":1,"t":"shutdown"}\n'),
    ]
    expect(reasons(got)).toEqual(['line-too-long'])
    expect(messages(got)).toEqual([{ gs: 1, t: 'shutdown' }])
    expect(r.bufferedBytes).toBe(0)
  })

  it('accepts a line of exactly the limit and rejects one byte more', () => {
    const line = '{"gs":1,"t":"shutdown"}'
    const ok = new ProtocolReader({ maxLineBytes: line.length }).feed(line + '\n')
    expect(messages(ok)).toHaveLength(1)
    const bad = new ProtocolReader({ maxLineBytes: line.length - 1 }).feed(line + '\n')
    expect(reasons(bad)).toEqual(['line-too-long'])
  })

  it('caps buffered bytes with its own reason when that limit is smaller', () => {
    const r = new ProtocolReader({ maxLineBytes: 1000, maxBufferedBytes: 10 })
    expect(reasons(r.feed('0123456789ABC'))).toEqual(['buffer-overflow'])
    expect(r.bufferedBytes).toBe(0)
  })

  it('end() flags an unfinished line and is silent when nothing is pending', () => {
    const r = new ProtocolReader()
    r.feed('{"gs":1')
    expect(reasons(r.end())).toEqual(['invalid-json'])
    expect(r.end()).toEqual([])
  })
})

describe('protocol: garbage never throws', () => {
  it('reports binary garbage as malformed and keeps reading', () => {
    const r = new ProtocolReader()
    const junk = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0x01, 0x02])
    const tail = new TextEncoder().encode('\n' + frameMessage({ gs: 1, t: 'shutdown' }))
    const all = new Uint8Array(junk.length + tail.length)
    all.set(junk)
    all.set(tail, junk.length)
    const got = r.feed(all)
    expect(reasons(got)).toEqual(['invalid-utf8'])
    expect(messages(got)).toEqual([{ gs: 1, t: 'shutdown' }])
  })

  it('survives random bytes', () => {
    const r = new ProtocolReader({ maxLineBytes: 64 })
    let x = 12345
    const buf = new Uint8Array(20_000)
    for (let i = 0; i < buf.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0
      buf[i] = x >>> 24
    }
    expect(() => r.feed(buf)).not.toThrow()
    expect(r.bufferedBytes).toBeLessThanOrEqual(64)
  })

  it.each([
    ['not json', 'hello world', 'invalid-json'],
    ['truncated json', '{"gs":1,"t":"shu', 'invalid-json'],
    ['array', '[1,2]', 'not-an-object'],
    ['null', 'null', 'not-an-object'],
    ['number', '5', 'not-an-object'],
    ['missing gs', '{"t":"shutdown"}', 'wrong-version'],
    ['wrong gs', '{"gs":2,"t":"shutdown"}', 'wrong-version'],
    ['string gs', '{"gs":"1","t":"shutdown"}', 'wrong-version'],
    ['unknown type', '{"gs":1,"t":"explode"}', 'unknown-type'],
    ['missing type', '{"gs":1}', 'unknown-type'],
    ['inherited type name', '{"gs":1,"t":"constructor"}', 'unknown-type'],
    ['ready without node', '{"gs":1,"t":"ready"}', 'wrong-shape'],
    ['call with float seed', '{"gs":1,"t":"call","id":1,"fn":"f","args":[],"caseSeed":1.5,"stubs":{"date":true,"random":true},"properties":[],"timeoutMs":1}', 'wrong-shape'],
    ['call with bad property', '{"gs":1,"t":"call","id":1,"fn":"f","args":[],"caseSeed":1,"stubs":{"date":true,"random":true},"properties":[{"id":1}],"timeoutMs":1}', 'wrong-shape'],
    ['result with unknown outcome', '{"gs":1,"t":"result","id":1,"outcome":{"kind":"nope"},"properties":[],"restoreVerified":true}', 'wrong-shape'],
    ['loaded with negative id', '{"gs":1,"t":"loaded","id":-1,"ok":true}', 'wrong-shape'],
    ['exports with bad entries', '{"gs":1,"t":"exports","id":1,"entries":[{"name":1}]}', 'wrong-shape'],
  ])('%s', (_name, line, reason) => {
    expect(parseLine(line)).toEqual({ kind: 'malformed', reason })
    expect(parseProtocolLine(line)).toBeUndefined()
    const r = new ProtocolReader()
    expect(reasons(r.feed(line + '\n'))).toEqual([reason])
  })

  it('ignores package log lines mixed with real messages', () => {
    const r = new ProtocolReader()
    const got = r.feed('console noise\n' + frameMessage({ gs: 1, t: 'shutdown' }) + '{"other":1}\n')
    expect(messages(got)).toEqual([{ gs: 1, t: 'shutdown' }])
    expect(reasons(got)).toEqual(['invalid-json', 'wrong-version'])
  })
})

describe('protocol: writer', () => {
  it('rejects a value JSON cannot represent', () => {
    expect(() => serializeMessage({ gs: 1, t: 'call', id: 1, fn: 'f', args: [1n as never], caseSeed: 0, stubs, properties: [], timeoutMs: 1 })).toThrow()
  })
})
