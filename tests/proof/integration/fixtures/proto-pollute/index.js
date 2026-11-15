'use strict';
// A tiny vulnerable path setter, like the old lodash.set (task 18.7): it follows `__proto__`
// segments, so `set({}, '__proto__.polluted', 'yes')` adds a property to Object.prototype.
exports.set = (obj, path, value) => {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] === undefined || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
  return obj;
};

// Reads a key from a fresh object; shows whether Object.prototype is clean in this child.
exports.probe = (key) => ({})[key] === undefined ? 'clean' : 'dirty';

exports.pid = () => process.pid;
