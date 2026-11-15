'use strict';
// Delta property module for lodash.set-prototype-pollution (parent: ../config.ts).
//
// Contract (SideRuntime, design "Delta property modules"): the child calls
// `require(modulePath).check(ctx)` with
//   ctx = { functionName, kind, prototypeDelta, result }
// where `prototypeDelta` is the raw delta of the same call: an array of
//   { prototype, key (string | symbol), change: 'added' | 'changed' | 'removed', before?, after? }
// and returns `{ ok: boolean, detail?: JSON-safe }`.
//
// The property: the call left Object.prototype, Array.prototype, Function.prototype and the other
// tracked prototypes unmodified, so the delta is empty. The module reads only the given delta. It
// does not receive the call's arguments, and it does not inspect live prototypes: the runtime has
// already restored them before the module runs, so a live check such as `({}).polluted` would
// always pass and prove nothing. It requires nothing, not even node built-ins.

function describeKey(key) {
  return String(key);
}

exports.check = function check(ctx) {
  const delta = ctx !== null && typeof ctx === 'object' ? ctx.prototypeDelta : undefined;
  if (!Array.isArray(delta)) {
    return { ok: false, detail: 'no prototype delta was given' };
  }
  if (delta.length === 0) {
    return { ok: true };
  }
  const changes = [];
  for (let i = 0; i < delta.length; i++) {
    const entry = delta[i];
    changes.push(entry.prototype + '.' + describeKey(entry.key) + ' ' + entry.change);
  }
  return { ok: false, detail: changes };
};
