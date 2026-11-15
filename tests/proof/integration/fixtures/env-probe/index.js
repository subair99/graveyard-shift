'use strict';
// Environment and permission probes (tasks 18.3 and 18.5).

// Names of the environment variables the child sees, sorted. Values are never returned.
exports.envKeys = () => Object.keys(process.env).sort();

// The value of the sentinel variable the test sets in the parent (undefined in a scrubbed child).
exports.secret = () => process.env.GS_TEST_SECRET;

// Whether the variable with the given name exists in the child.
exports.hasVar = (name) => Object.prototype.hasOwnProperty.call(process.env, name);

// What the permission model grants to this child, by scope.
exports.permissions = () => {
  const has = (scope) => {
    try {
      return process.permission.has(scope);
    } catch (e) {
      return 'error:' + (e && e.code ? e.code : 'UNKNOWN');
    }
  };
  return {
    enabled: typeof process.permission === 'object' && process.permission !== null,
    write: has('fs.write'),
    net: has('net'),
    child: has('child'),
    worker: has('worker'),
  };
};
