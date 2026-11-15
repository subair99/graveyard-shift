// PreToolUse guard for the Medium agent (SPIKE, draft). Pure Node, no dependencies.
// Protocol (https://kiro.dev/docs/hooks/types/ and /actions/, fetched 2026-11-15): the hook event is JSON on stdin
// ({hook_event_name, cwd, session_id, tool_name, tool_input}). Exit 0 allows; exit 2 blocks and sends stderr to the model.
// Any failure here also exits 2 (fail closed).
// Allowed targets (relative to the event's cwd): resurrection/**, deltas.json, harness.json.
// Optional: set GUARD_LOG_FILE to append one line per decision (no file contents are logged).
import { appendFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const WRITE_TOOLS = new Set([
  'fs_write', 'fs_append', 'str_replace', 'delete_file',
  'write', 'fsWrite', 'fsAppend', 'strReplace', 'deleteFile',
]);
const PATH_KEYS = ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'filename', 'file'];
const ALLOWED_FILES = ['deltas.json', 'harness.json'];
const ALLOWED_DIR = 'resurrection';
const FORBIDDEN_SEGMENTS = new Set(['.kiro', '.github', '.git']);
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function norm(p) {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

function logLine(text) {
  const file = process.env.GUARD_LOG_FILE;
  if (!file) return;
  try {
    appendFileSync(file, new Date().toISOString() + ' ' + text + '\n');
  } catch {
    /* logging must never change the decision */
  }
}

function deny(reason, extra = '') {
  process.stderr.write('write-guard: blocked: ' + reason + '\n');
  logLine('DENY ' + reason + (extra ? ' [' + extra + ']' : ''));
  process.exit(2);
}

function allow(note) {
  logLine('ALLOW ' + note);
  process.exit(0);
}

// Resolve symlinks for the longest existing prefix, then append the missing tail.
// A dangling symlink in the chain is refused, because its target is unknown.
function realResolve(abs) {
  let cur = abs;
  const tail = [];
  for (;;) {
    let st = null;
    try {
      st = lstatSync(cur);
    } catch (err) {
      if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) throw err;
    }
    if (st) {
      let base;
      try {
        base = realpathSync(cur);
      } catch {
        throw new Error('dangling or unreadable symlink in path');
      }
      return tail.length ? join(base, ...tail) : base;
    }
    const parent = dirname(cur);
    if (parent === cur) return tail.length ? join(cur, ...tail) : cur;
    tail.unshift(basename(cur));
    cur = parent;
  }
}

function extractPaths(input) {
  if (input === null || typeof input !== 'object') return [];
  const out = [];
  for (const key of PATH_KEYS) {
    if (input[key] !== undefined) out.push(input[key]);
  }
  if (Array.isArray(input.paths)) out.push(...input.paths);
  return out;
}

function checkPath(raw, root) {
  if (typeof raw !== 'string' || raw.length === 0) return 'target path is missing or not a string';
  if (raw.includes('\0')) return 'path contains a NUL byte';
  if (raw.includes('\\')) return 'backslash paths are not accepted';
  if (/^[A-Za-z]:/.test(raw)) return 'Windows drive path';
  if (raw.startsWith('//') || raw.startsWith('~')) return 'UNC or home-relative path';
  const abs = resolve(root, raw);
  let real;
  try {
    real = realResolve(abs);
  } catch (err) {
    return String(err && err.message);
  }
  const rel = relative(root, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return 'outside the working directory';
  const parts = rel.split(sep);
  if (parts.some((p) => FORBIDDEN_SEGMENTS.has(norm(p)))) return '.kiro, .github and .git are never writable';
  const first = norm(parts[0]);
  if (parts.length === 1 && ALLOWED_FILES.map(norm).includes(first)) return null;
  if (parts.length >= 2 && first === norm(ALLOWED_DIR)) return null;
  return 'not under resurrection/ and not deltas.json or harness.json';
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return deny('hook event is not valid JSON');
  }
  if (event === null || typeof event !== 'object') return deny('hook event is not an object');
  const tool = String(event.tool_name ?? '');
  if (!WRITE_TOOLS.has(tool)) return allow('not a write tool: ' + tool);
  const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd();
  let root;
  try {
    root = realpathSync(resolve(cwd));
  } catch {
    return deny('cannot resolve the working directory');
  }
  const paths = extractPaths(event.tool_input);
  if (paths.length === 0) return deny('write tool call has no recognizable target path');
  for (const p of paths) {
    const reason = checkPath(p, root);
    if (reason) return deny(reason + ' (' + tool + ')', String(p).slice(0, 200));
  }
  return allow(tool + ' ' + paths.map((p) => String(p).slice(0, 200)).join(','));
}

try {
  main();
} catch (err) {
  deny('internal error: ' + String(err && err.message));
}
