'use strict';
// Crash and output-limit probes (tasks 18.12 and 18.13).

// Exits the child with code 9.
exports.die = () => {
  process.exit(9);
};

// Exhausts the heap (the test runs it with a small heap limit).
exports.exhaust = () => {
  const keep = [];
  for (;;) keep.push(new Array(100000).fill(keep.length));
};

// A string of n characters, to pass the output limit.
exports.big = (n) => 'x'.repeat(n);

exports.ok = () => 'ok';

exports.pid = () => process.pid;
