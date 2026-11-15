// Plain script (not a test suite): node spikes/kiro-agent/hooks/run-cases.mjs
// Feeds each case to pre-tool-write-guard.mjs as a hook event on stdin, in a throwaway temp project.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, 'pre-tool-write-guard.mjs');
const spec = JSON.parse(readFileSync(join(here, 'pre-tool-write-guard.test-cases.json'), 'utf8'));

const base = realpathSync(mkdtempSync(join(tmpdir(), 'medium-guard-')));
const root = join(base, 'root');
mkdirSync(root);
for (const d of spec.setup.dirs) mkdirSync(join(root, d), { recursive: true });
mkdirSync(join(base, 'outside'), { recursive: true });
for (const f of spec.setup.files) {
  const target = f.startsWith('outside/') ? join(base, f) : join(root, f);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'fixture\n');
}
let symlinksOk = true;
for (const s of spec.setup.symlinks) {
  try {
    symlinkSync(s.target, join(root, s.link), s.type === 'dir' ? 'dir' : 'file');
  } catch (err) {
    symlinksOk = false;
    console.log('note: cannot create symlinks here (' + (err && err.code) + '); symlink cases are skipped');
    break;
  }
}

let pass = 0;
let fail = 0;
let skip = 0;
for (const c of spec.cases) {
  if ((c.needs === 'symlink' && !symlinksOk) || (c.needs === 'posix' && process.platform === 'win32')) {
    skip++;
    console.log('SKIP  ' + c.id);
    continue;
  }
  const toolInput = {};
  if (!c.omitPath) toolInput.path = String(c.path).replaceAll('{ROOT}', root);
  const event = {
    hook_event_name: 'preToolUse',
    cwd: root,
    session_id: 'run-cases',
    tool_name: c.tool ?? 'fs_write',
    tool_input: toolInput,
  };
  const r = spawnSync(process.execPath, [guard], { input: JSON.stringify(event), encoding: 'utf8' });
  const got = r.status === 0 ? 'allow' : r.status === 2 ? 'deny' : 'error(' + r.status + ')';
  const ok = got === c.expect;
  ok ? pass++ : fail++;
  const reason = (r.stderr || '').trim().split('\n')[0];
  console.log((ok ? 'PASS  ' : 'FAIL  ') + c.id + '  expected=' + c.expect + ' got=' + got + (reason ? '  | ' + reason : ''));
}

// Event that is not JSON must also be refused (fail closed).
const bad = spawnSync(process.execPath, [guard], { input: 'not json', encoding: 'utf8' });
const badOk = bad.status === 2;
badOk ? pass++ : fail++;
console.log((badOk ? 'PASS  ' : 'FAIL  ') + 'deny-invalid-json-event  expected=deny got=' + (bad.status === 2 ? 'deny' : 'status ' + bad.status));

rmSync(base, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail === 0 ? 0 : 1);
