'use strict';
// Forces a non-restorable prototype state (tasks 18.12 and 18.13). A frozen prototype cannot be
// restored by the runner, so the call reports `restoreVerified: false` and the executor restarts
// the child (a Restart_Event). The child is killed afterwards, so the freeze never leaks.
exports.freezeArray = () => {
  Object.freeze(Array.prototype);
  return 'frozen';
};

exports.freezeObject = () => {
  Object.freeze(Object.prototype);
  return 'frozen';
};

exports.ok = () => 'ok';

exports.pid = () => process.pid;

// Added for task 18.7: report whether the prototypes of this child are frozen.
exports.frozenState = () => ({
  array: Object.isFrozen(Array.prototype),
  object: Object.isFrozen(Object.prototype),
});
