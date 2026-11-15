'use strict';
// Timeout probes (task 18.6).

// Synchronous infinite loop: only the parent's hard kill stops it.
exports.spin = () => {
  for (;;) { /* never returns */ }
};

// Async function that never settles: the child answers `timeout` itself.
exports.hang = () => new Promise(() => {});

// A normal function, used to show that the next call works on a fresh child.
exports.ok = () => 'ok';

exports.pid = () => process.pid;
