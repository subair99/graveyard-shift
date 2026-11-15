'use strict';
// Smallest useful package: one function, one primitive, the process id (task 18.1 self-test and
// the smoke test 18.11).
exports.add = (a, b) => a + b;
exports.answer = 42;
exports.pid = () => process.pid;
