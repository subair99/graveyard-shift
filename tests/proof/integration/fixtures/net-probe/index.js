'use strict';
// Network probes for the sandbox denial test (task 18.2). Every function resolves to
// `{ ok, code }` and never hangs: a short timer ends each attempt. `ok: true` means the network
// call worked, which the sandbox must not allow. `code` is the error code of the failure
// (for example ERR_ACCESS_DENIED), or 'TIMEOUT' when nothing answered in time.
const net = require('node:net');
const dns = require('node:dns');

const TIMEOUT_MS = 1500;

function codeOf(error) {
  return error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
}

// Tries a TCP connection to host:port.
exports.connect = (host, port) =>
  new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket && socket.destroy(); } catch (e) { /* ignore */ }
      resolve(value);
    };
    let socket;
    const timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), TIMEOUT_MS);
    try {
      socket = net.connect({ host, port });
      socket.on('connect', () => finish({ ok: true, code: null }));
      socket.on('error', (e) => finish({ ok: false, code: codeOf(e) }));
    } catch (e) {
      finish({ ok: false, code: codeOf(e) });
    }
  });

// Tries an HTTP request with the global fetch.
exports.fetchUrl = (url) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), TIMEOUT_MS);
    try {
      fetch(url).then(
        () => { clearTimeout(timer); resolve({ ok: true, code: null }); },
        (e) => { clearTimeout(timer); resolve({ ok: false, code: codeOf(e.cause || e) }); },
      );
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });

// Tries a DNS lookup of a name (a local name such as 'localhost' or an external one).
exports.lookup = (name) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), TIMEOUT_MS);
    try {
      dns.lookup(name, (e) => {
        clearTimeout(timer);
        resolve(e ? { ok: false, code: codeOf(e) } : { ok: true, code: null });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, code: codeOf(e) });
    }
  });
