// Throwaway spike (task 1.4, basis of the `env-minimum` integration test, 18.11).
// Logs variable NAMES only; the only value printed is the sentinel presence and SystemRoot-independent facts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runNode } from './lib.ts'

const runnerDir = resolve(import.meta.dirname, 'envChild')
const runner = join(runnerDir, 'runner.ts')
const systemRoot = process.env.SystemRoot
if (systemRoot === undefined) throw new Error('SystemRoot is not set in the parent')

process.env.GS_TEST_SECRET = 'sentinel-value-not-a-real-secret'

const root = mkdtempSync(join(tmpdir(), 'spike-env-'))
try {
  const pkg = join(root, 'pkg')
  mkdirSync(pkg)
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pkg', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(pkg, 'index.js'), "module.exports = { main: 'ok' }\n")
  const granted = join(pkg, 'data.txt')
  writeFileSync(granted, 'hello')

  const SR = { SystemRoot: systemRoot }
  const cases: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['1 {}', {}],
    ['2 {TZ}', { TZ: 'UTC' }],
    ['3 {SystemRoot}', SR],
    ['4 {SystemRoot, TZ}', { ...SR, TZ: 'UTC' }],
    ['5 {SystemRoot, PATH}', { ...SR, PATH: process.env.PATH ?? '' }],
    ['6 {SystemRoot, TEMP, TMP}', { ...SR, TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '' }],
    ['7 {SystemRoot, USERPROFILE, HOME}', { ...SR, USERPROFILE: process.env.USERPROFILE ?? '', HOME: process.env.USERPROFILE ?? '' }],
    ['8 {TEMP, TMP} (no SystemRoot)', { TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '' }],
  ]
  for (const [label, env] of cases) {
    const r = runNode(
      ['--permission', `--allow-fs-read=${runnerDir}`, `--allow-fs-read=${pkg}`, runner, pkg, granted],
      { env, input: 'ping\n', timeoutMs: 30000 },
    )
    console.log(`\n=== ${label}`)
    console.log(`passed names: ${JSON.stringify(Object.keys(env))}`)
    console.log(`exit=${String(r.status)} signal=${String(r.signal)}`)
    console.log(`stdout: ${r.stdout.trim().replaceAll(root, '<tmp-root>')}`)
    console.log(`stderr: ${JSON.stringify(r.stderr.replaceAll(root, '<tmp-root>'))}`)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
