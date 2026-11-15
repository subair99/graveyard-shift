// Sandbox runner: the entry script of one child process (Requirements 5.4, 5.7, 5.8, 5.10).
// Run as `node --permission --allow-fs-read=<child dir> --allow-fs-read=<package dir> runner.ts`
// with `cwd` equal to the package directory. Reads NDJSON protocol messages from stdin, drives one
// SideRuntime and writes NDJSON replies to stdout.
// Sandbox side: self-contained (imports only within child/), erasable TypeScript only.
//
// Output channel (documented exception to the single-emit rule, see sourceScan.test.ts): the
// runner saves the real `process.stdout.write` first, before any package code runs, then replaces
// the write methods of stdout and stderr and every `console` method with no-ops, so ordinary
// package logging cannot corrupt the stream. A package that writes to file descriptor 1 directly
// can still interleave a line; the parent discards lines that are not protocol messages (R5.8).
//
// Behavior:
// - After startup it sends `ready`.
// - `load` creates the side runtime (stubs are installed globally at load, before the package
//   code runs) and answers `loaded`. `exports` answers the listing. `call` answers `result`.
//   A crash outcome carries its stable reason as `outcome.reason`. A property module failure is
//   reported as `fatal` with the call id and a message that starts with `property-error: `.
// - `shutdown` and the end of stdin exit with code 0 once pending output is flushed.
// - Malformed input lines are ignored. After MAX_CONSECUTIVE_MALFORMED malformed lines in a row
//   the runner sends `fatal` and exits with code 3.
// - An uncaught exception or unhandled rejection sends `fatal` (with the id of the call in
//   flight, if any) and exits with code 4, so the parent records a crash for that call.
// - A result line longer than the output limit gives outcome `output-too-large` instead.
// - Messages are handled one at a time in arrival order.
//
// Exit codes: 0 shutdown or stdin closed, 3 too much garbage on stdin, 4 uncaught error in package
// code, 5 internal runner failure. The runner itself uses no network, no child process and writes
// no file.

import type { ExportEntryWire, FatalMessage, JsonValue, ProtocolMessage, ResultMessage, StubFlags } from './protocol.ts'
import { LINE_SLACK_BYTES, ProtocolReader, frameMessage } from './protocol.ts'
import { createSideRuntime } from './sideRuntime.ts'
import type { SideRuntime } from './sideRuntime.ts'

const MAX_CONSECUTIVE_MALFORMED = 1000
const MAX_FATAL_MESSAGE_CHARS = 1000

// Captured before any package code runs.
const realStdoutWrite = process.stdout.write.bind(process.stdout) as (
  chunk: string,
  callback?: (error?: Error | null) => void,
) => boolean
const nodeVersion = process.version
const processExit = process.exit.bind(process)
const byteLength = Buffer.byteLength

function silence(): void {
  const noop = (..._args: unknown[]): boolean => true
  process.stdout.write = noop as typeof process.stdout.write
  process.stderr.write = noop as typeof process.stderr.write
  const target = console as unknown as Record<string, unknown>
  for (const key of Object.keys(target)) {
    if (typeof target[key] === 'function') target[key] = (): void => {}
  }
}

function send(message: ProtocolMessage, then?: () => void): void {
  try {
    realStdoutWrite(frameMessage(message), then === undefined ? undefined : () => then())
  } catch {
    // The parent is gone; the stdin 'end' or 'close' handler ends the process.
    if (then !== undefined) then()
  }
}

function exitAfterFlush(code: number): void {
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    processExit(code)
  }
  try {
    realStdoutWrite('', finish)
  } catch {
    finish()
  }
  // Safety net if the callback never runs.
  setTimeout(finish, 1000).unref()
}

function messageOf(e: unknown): string {
  let text: string
  try {
    text = e instanceof Error ? e.message : String(e)
  } catch {
    text = 'unprintable error'
  }
  return text.length > MAX_FATAL_MESSAGE_CHARS ? text.slice(0, MAX_FATAL_MESSAGE_CHARS) : text
}

let runtime: SideRuntime | undefined
let outputLimitBytes = 1024 * 1024
let currentId: number | undefined
let shuttingDown = false

function fatalAndExit(code: number, message: string, id?: number): void {
  if (shuttingDown) return
  shuttingDown = true
  const fatal: FatalMessage = { gs: 1, t: 'fatal', message }
  if (id !== undefined) fatal.id = id
  send(fatal, () => exitAfterFlush(code))
}

async function handle(message: ProtocolMessage): Promise<void> {
  switch (message.t) {
    case 'load': {
      outputLimitBytes = message.outputLimitBytes
      const stubs: StubFlags = message.stubs
      const options: Parameters<typeof createSideRuntime>[0] = {
        packageDir: process.cwd(),
        entryFile: message.entryFile,
        outputLimitBytes: message.outputLimitBytes,
        installStubsGlobally: true,
        stubs,
      }
      if (message.setupModule !== undefined) options.setupModule = message.setupModule
      const created = createSideRuntime(options)
      const loaded = created.load()
      if (loaded.ok) {
        runtime = created
        send({ gs: 1, t: 'loaded', id: message.id, ok: true })
      } else {
        send({ gs: 1, t: 'loaded', id: message.id, ok: false, error: loaded.error.message })
      }
      return
    }
    case 'exports': {
      if ('entries' in message) return
      const entries = runtime === undefined ? [] : runtime.listExports().entries
      send({ gs: 1, t: 'exports', id: message.id, entries: entries as unknown as ExportEntryWire[] })
      return
    }
    case 'call': {
      currentId = message.id
      const response =
        runtime === undefined
          ? undefined
          : await runtime.call({
              fn: message.fn,
              args: message.args as unknown as Parameters<SideRuntime['call']>[0]['args'],
              caseSeed: message.caseSeed,
              stubs: message.stubs,
              properties: message.properties,
              timeoutMs: message.timeoutMs,
            })
      currentId = undefined
      if (response === undefined) {
        send({
          gs: 1,
          t: 'result',
          id: message.id,
          outcome: { kind: 'crash', reason: 'not-loaded' },
          properties: [],
          restoreVerified: true,
        })
        return
      }
      if (response.propertyError !== undefined) {
        send({ gs: 1, t: 'fatal', id: message.id, message: 'property-error: ' + response.propertyError })
        return
      }
      let outcome = response.result.outcome as unknown as ResultMessage['outcome']
      if (response.crashReason !== undefined) {
        outcome = { kind: 'crash', reason: response.crashReason as JsonValue }
      }
      let result: ResultMessage = {
        gs: 1,
        t: 'result',
        id: message.id,
        outcome,
        properties: response.result.properties as unknown as ResultMessage['properties'],
        restoreVerified: response.restoreVerified,
      }
      if (byteLength(frameMessage(result)) > outputLimitBytes + LINE_SLACK_BYTES) {
        result = { ...result, outcome: { kind: 'output-too-large' }, properties: [] }
      }
      send(result)
      return
    }
    case 'shutdown': {
      shuttingDown = true
      exitAfterFlush(0)
      return
    }
    default:
      // Child-to-parent message types are not valid input; ignore them.
      return
  }
}

function main(): void {
  silence()
  process.on('uncaughtException', (e: unknown) => fatalAndExit(4, 'uncaught exception: ' + messageOf(e), currentId))
  process.on('unhandledRejection', (e: unknown) => fatalAndExit(4, 'unhandled rejection: ' + messageOf(e), currentId))

  const reader = new ProtocolReader({ maxLineBytes: outputLimitBytes + LINE_SLACK_BYTES })
  let queue: Promise<void> = Promise.resolve()
  let malformedRun = 0

  const accept = (results: ReturnType<ProtocolReader['feed']>): void => {
    for (const r of results) {
      if (r.kind === 'malformed') {
        malformedRun++
        if (malformedRun >= MAX_CONSECUTIVE_MALFORMED) {
          fatalAndExit(3, 'too many malformed input lines')
          return
        }
        continue
      }
      malformedRun = 0
      const message = r.message
      queue = queue.then(() => handle(message)).catch((e: unknown) => fatalAndExit(5, 'runner error: ' + messageOf(e)))
    }
  }

  process.stdin.on('data', (chunk: Uint8Array) => accept(reader.feed(chunk)))
  process.stdin.on('end', () => {
    queue = queue.then(() => {
      if (!shuttingDown) {
        shuttingDown = true
        exitAfterFlush(0)
      }
    })
  })
  send({ gs: 1, t: 'ready', node: nodeVersion })
}

main()
