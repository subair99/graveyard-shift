// Dependency-free MCP stdio server (SPIKE, draft). One read-only tool: get_certificate.
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout; logs go to stderr only.
// Framing source: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports (fetched 2026-11-15).
import { fstatSync, lstatSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ALLOWLIST = ['spikes/kiro-agent/fixtures/certificate.sample.json'];
const DEFAULT_PATH = ALLOWLIST[0];
const MAX_BYTES = 64 * 1024;
const MAX_LINE = 1024 * 1024;
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOL = {
  name: 'get_certificate',
  description:
    'Read-only. Returns the text of one allowlisted Death Certificate JSON file. The only allowed path is ' +
    DEFAULT_PATH + ' (also the default).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository-relative path of the certificate. Optional.' },
    },
    additionalProperties: false,
  },
};

function log(...parts) {
  process.stderr.write('[mcp-stub] ' + parts.join(' ') + '\n');
}

function send(msg) {
  // One JSON object per line; JSON.stringify never emits a raw newline.
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function toolError(id, text) {
  send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } });
}

const allowedReal = new Set();
for (const rel of ALLOWLIST) {
  try {
    allowedReal.add(realpathSync(resolve(ROOT, rel)));
  } catch (err) {
    log('allowlist entry missing:', rel, String(err && err.code));
  }
}

// Returns {ok:true,text} or {ok:false,reason}. No write, no network.
function readCertificate(requested) {
  if (typeof requested !== 'string' || requested.length === 0 || requested.length > 512) {
    return { ok: false, reason: 'path must be a non-empty string of at most 512 characters' };
  }
  if (requested.includes('\0')) return { ok: false, reason: 'path contains a NUL byte' };
  let real;
  try {
    const candidate = resolve(ROOT, requested);
    lstatSync(candidate);
    real = realpathSync(candidate); // follows symlinks; compared to the allowlist below
  } catch {
    return { ok: false, reason: 'path not found or not allowed' };
  }
  if (!allowedReal.has(real)) return { ok: false, reason: 'path not found or not allowed' };
  let fd;
  try {
    fd = openSync(real, 'r');
    const st = fstatSync(fd);
    if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
    if (st.size > MAX_BYTES) return { ok: false, reason: 'file larger than ' + MAX_BYTES + ' bytes' };
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { ok: true, text: buf.subarray(0, off).toString('utf8') };
  } catch (err) {
    return { ok: false, reason: 'read failed: ' + String(err && err.code) };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function handle(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return rpcError(msg && msg.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined;
  if (typeof method !== 'string') {
    // A response from the client (no method): this server sends no requests, so ignore it.
    return;
  }
  switch (method) {
    case 'initialize': {
      if (isNotification) return;
      const asked = params && params.protocolVersion;
      const protocolVersion = SUPPORTED.includes(asked) ? asked : SUPPORTED[0];
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'medium-stub', version: '0.0.1-spike' },
        },
      });
    }
    case 'notifications/initialized':
      return; // notification: no response
    case 'ping':
      return isNotification ? undefined : send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      if (isNotification) return;
      return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
    case 'tools/call': {
      if (isNotification) return;
      if (!params || params.name !== TOOL.name) return rpcError(id, -32602, 'Unknown tool');
      const args = params.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'arguments must be an object');
      const result = readCertificate(args.path === undefined ? DEFAULT_PATH : args.path);
      if (!result.ok) return toolError(id, result.reason);
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result.text }] } });
    }
    default:
      if (isNotification) return;
      return rpcError(id, -32601, 'Method not found');
  }
}

function onLine(line) {
  if (line.trim() === '') return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }
  try {
    handle(msg);
  } catch (err) {
    log('internal error:', String(err && err.message));
    rpcError(msg && msg.id, -32603, 'Internal error');
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    onLine(line);
  }
  if (buffer.length > MAX_LINE) {
    log('line too long; exiting');
    process.exit(1);
  }
});
process.stdin.on('end', () => process.exit(0));
log('started; root =', ROOT);
