// Default time and random stubs of the sandbox runner (Requirement 9.1, assumption A6).
// Sandbox side: self-contained, erasable TypeScript only, no file system and no network.
//
// This file is deliberately outside the ESLint determinism scope, because it replaces `Date`
// and `Math.random` by design.
//
// - `Date`: replaced by a Proxy around the real `Date`. `new Date()` and `Date.now()` return the
//   frozen time; `new Date(x)`, `Date.UTC`, `Date.parse`, the prototype, subclassing and
//   `instanceof` keep working because the Proxy forwards everything else to the real `Date`.
//   `Date()` called as a function returns the string of the frozen time.
// - `Math.random`: replaced by mulberry32. `reseed(seed)` restarts the sequence; the side runtime
//   calls it before every call with the case seed from the request.
// - `performance.now` and `process.hrtime` are not stubbed (the design lists only Date and
//   Math.random).
// - Each stub is installed independently and only once. A second `installStubs` call installs
//   only what is not installed yet, and never wraps a stub twice. `restore` of any handle puts the
//   originals back.
// - `Date.prototype` is not one of the six prototypes of `prototypes.ts`, and the Proxy leaves it
//   untouched, so the prototype snapshot is not affected.

/** 2000-01-01T00:00:00.000Z in milliseconds since the epoch. */
export const FROZEN_TIME_MS = 946684800000

export interface StubOptions {
  /** Freeze `Date`. Default true. */
  readonly date?: boolean
  /** Replace `Math.random` with a seeded PRNG. Default true. */
  readonly random?: boolean
  /** Frozen time in milliseconds since the epoch. Default `FROZEN_TIME_MS`. */
  readonly frozenTimeMs?: number
  /** Initial seed (int32) of the PRNG. Default 0. */
  readonly seed?: number
}

export interface StubHandle {
  /** Restart the `Math.random` sequence from `seed`. No effect when the random stub is not installed. */
  reseed(seed: number): void
  /** Put the original `Date` and `Math.random` back. Safe to call more than once. */
  restore(): void
}

interface Installed {
  originalDate: DateConstructor
  originalRandom: () => number
  dateStub?: DateConstructor
  randomStub?: () => number
}

let installed: Installed | undefined
let state = 0

function mulberry32Next(): number {
  state = (state + 0x6d2b79f5) | 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function makeFrozenDate(real: DateConstructor, frozenTimeMs: number): DateConstructor {
  const frozenNow = (): number => frozenTimeMs
  return new Proxy(real, {
    construct(target, args: unknown[], newTarget): object {
      if (args.length === 0) {
        return Reflect.construct(target, [frozenTimeMs], newTarget)
      }
      return Reflect.construct(target, args, newTarget)
    },
    apply(): string {
      return new real(frozenTimeMs).toString()
    },
    get(target, key, receiver): unknown {
      if (key === 'now') return frozenNow
      return Reflect.get(target, key, receiver)
    },
  })
}

export function installStubs(options: StubOptions = {}): StubHandle {
  const wantDate = options.date ?? true
  const wantRandom = options.random ?? true
  const current: Installed = installed ?? {
    originalDate: globalThis.Date,
    originalRandom: Math.random,
  }
  installed = current

  if (wantDate && current.dateStub === undefined) {
    current.dateStub = makeFrozenDate(current.originalDate, options.frozenTimeMs ?? FROZEN_TIME_MS)
    globalThis.Date = current.dateStub
  }
  if (wantRandom && current.randomStub === undefined) {
    state = (options.seed ?? 0) | 0
    current.randomStub = mulberry32Next
    Math.random = current.randomStub
  }

  return {
    reseed(seed: number): void {
      if (installed?.randomStub !== undefined) state = seed | 0
    },
    restore(): void {
      const inst = installed
      if (inst === undefined) return
      globalThis.Date = inst.originalDate
      Math.random = inst.originalRandom
      installed = undefined
    },
  }
}
