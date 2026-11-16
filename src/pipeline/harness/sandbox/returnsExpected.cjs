'use strict';
// Template of the delta property module of one `returns-expected` delta (compiler.ts renders one
// file per delta from this text; parent: ../core/compiler.ts).
//
// Contract (SideRuntime): the child calls `require(modulePath).check(ctx)` with
//   ctx = { functionName, kind, prototypeDelta, result }
// and expects `{ ok: boolean, detail?: JSON-safe }`. The context carries no arguments, so the
// expected value is embedded as data: the compiler replaces the string literal below with a JSON
// string literal of the delta's expected value, and this module parses it when it loads. The value
// is never spliced into the code as an expression. The compiler guarantees that every case of the
// delta has this same expected value.
//
// The property: the call returned (or resolved) and its result equals the expected value. A call
// that threw or rejected does not satisfy it. The module requires nothing, not even node built-ins.

const EXPECTED = JSON.parse("__EXPECTED_JSON__");

const hasOwn = Object.prototype.hasOwnProperty;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!hasOwn.call(b, key) || !deepEqual(a[key], b[key])) return false;
  }
  return true;
}

exports.check = function check(ctx) {
  if (ctx === null || typeof ctx !== 'object') {
    return { ok: false, detail: 'no context was given' };
  }
  if (ctx.kind !== 'returned') {
    return { ok: false, detail: 'the call did not return a value (' + String(ctx.kind) + ')' };
  }
  if (deepEqual(ctx.result, EXPECTED)) {
    return { ok: true };
  }
  return { ok: false, detail: 'the result is not the expected value' };
};
