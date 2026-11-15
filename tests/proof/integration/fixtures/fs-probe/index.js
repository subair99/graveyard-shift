'use strict';
// File system probes for the sandbox denial test (task 18.3). Each function returns
// `{ ok, code, ... }`: `ok: false` carries the error code (ERR_ACCESS_DENIED when the permission
// model denies the call). File contents are never returned, only lengths and names.
const fs = require('node:fs');
const path = require('node:path');

function codeOf(error) {
  return error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

// Reads any file; the test passes a path outside the package directory (must be denied).
exports.readFile = (file) => {
  try {
    return { ok: true, code: null, length: fs.readFileSync(file).length };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};

// Reads package.json from the package directory (must work).
exports.readInside = () => {
  try {
    return { ok: true, code: null, length: fs.readFileSync(path.join(__dirname, 'package.json')).length };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};

// Writes a file; the test passes a path under its own temp dir and expects denial. If the write
// were allowed, only that path is touched.
exports.writeFile = (file) => {
  try {
    fs.writeFileSync(file, 'x');
    return { ok: true, code: null };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};

// Lists the parent of the package directory (must be denied).
exports.listParent = () => {
  try {
    return { ok: true, code: null, count: fs.readdirSync(path.dirname(__dirname)).length };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};

// Lists any directory.
exports.listDir = (dir) => {
  try {
    return { ok: true, code: null, count: fs.readdirSync(dir).length };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};
