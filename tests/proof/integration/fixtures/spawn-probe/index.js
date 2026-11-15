'use strict';
// Child process and worker thread probes (task 18.4). Each returns `{ ok, code }`; the sandbox
// must deny both (`ok: false`, code ERR_ACCESS_DENIED). The commands only print a word, so a
// failed denial does no harm.
const childProcess = require('node:child_process');
const { Worker } = require('node:worker_threads');

function codeOf(error) {
  return error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

// Synchronous spawn of the running node executable.
exports.spawnSync = () => {
  try {
    const r = childProcess.spawnSync(process.execPath, ['-e', '0'], { timeout: 2000 });
    if (r.error) return { ok: false, code: codeOf(r.error) };
    return { ok: true, code: null };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};

// Asynchronous exec of a shell command.
exports.exec = () =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 2000);
    try {
      childProcess.exec('echo gs', { timeout: 1500 }, (e) => {
        clearTimeout(timer);
        resolve(e ? { ok: false, code: codeOf(e) } : { ok: true, code: null });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

// Creates a worker thread that exits at once.
exports.worker = () =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 2000);
    try {
      const w = new Worker('0', { eval: true });
      w.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: codeOf(e) }); });
      w.on('exit', () => { clearTimeout(timer); resolve({ ok: true, code: null }); });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

// Marker variants. A successful spawn would run node and create the marker file. The sandbox
// flags are not inherited by a grandchild, so a marker proves a breach.
const MARKER_CODE = "require('fs').writeFileSync(process.argv[1],'x')";

function markerArgs(marker) {
  return ['-e', MARKER_CODE, marker];
}

exports.markerSpawnSync = (marker) => {
  try {
    const r = childProcess.spawnSync(process.execPath, markerArgs(marker), { timeout: 3000 });
    if (r.error) return { ok: false, code: codeOf(r.error) };
    return { ok: true, code: null };
  } catch (e) {
    return { ok: false, code: codeOf(e) };
  }
};

exports.markerExec = (marker) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 3000);
    try {
      const cmd = '"' + process.execPath + '" -e "' + MARKER_CODE + '" "' + marker + '"';
      childProcess.exec(cmd, { timeout: 2500 }, (e) => {
        clearTimeout(timer);
        resolve(e ? { ok: false, code: codeOf(e) } : { ok: true, code: null });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

exports.markerExecFile = (marker) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 3000);
    try {
      childProcess.execFile(process.execPath, markerArgs(marker), { timeout: 2500 }, (e) => {
        clearTimeout(timer);
        resolve(e ? { ok: false, code: codeOf(e) } : { ok: true, code: null });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

// fork() runs a script; the script writes the marker.
exports.markerFork = (marker) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 3000);
    try {
      const p = childProcess.fork(require.resolve('./writeMarker.js'), [marker], { silent: true });
      p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: codeOf(e) }); });
      p.on('exit', () => { clearTimeout(timer); resolve({ ok: true, code: null }); });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

// A worker thread that tries to write the marker.
exports.markerWorker = (marker) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 3000);
    try {
      const w = new Worker(MARKER_CODE.replace('argv[1]', 'argv[2]'), { eval: true, argv: [marker] });
      w.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: codeOf(e) }); });
      w.on('exit', () => { clearTimeout(timer); resolve({ ok: true, code: null }); });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

exports.pid = () => process.pid;
