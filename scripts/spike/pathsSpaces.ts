// Spike (task 1.6): package directory names with a space, non-ASCII, '#' and '%'.
// Kept as the basis of the integration test `paths-spaces` (18.11); the journal records the results.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runNode } from './lib.ts'

const runnerDir = resolve(import.meta.dirname, 'spacesChild')
const runner = join(runnerDir, 'runner.ts')

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'spike-spaces-')))
console.log(`root (realpath.native): ${root}`)

function makePackage(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), "module.exports = { x: 'from-index' }\n")
  writeFileSync(join(dir, 'esm.mjs'), "import './nope.mjs'\n")
  writeFileSync(join(dir, 'data.json'), '{"a":1}\n')
  writeFileSync(join(dir, 'file.foo'), 'x\n')
  mkdirSync(join(dir, 'sub'))
}

try {
  const denied = join(root, 'denied')
  mkdirSync(denied)
  const deniedFile = join(denied, 'secret.txt')
  writeFileSync(deniedFile, 'secret')

  const names = ['gs space', 'gs-\u00fcn\u00ef-\u00e9', 'gs#hash', 'gs%pct', 'gs%20pct']
  for (const name of names) {
    const pkg = join(root, name, 'pkg')
    try {
      makePackage(pkg)
    } catch (e) {
      console.log(`\n=== ${name}: not tested, creation failed: ${String(e)}`)
      continue
    }
    const args = ['--permission', `--allow-fs-read=${runnerDir}`, `--allow-fs-read=${pkg}`, runner, pkg, deniedFile]
    const r = runNode(args, { cwd: pkg })
    console.log(`\n=== ${name}`)
    console.log(`package dir: ${pkg}`)
    console.log(`argv[2] (grant): ${JSON.stringify(args[2])}`)
    console.log(`exit=${String(r.status)} signal=${String(r.signal)}`)
    console.log(`stderr: ${JSON.stringify(r.stderr)}`)
    const line = r.stdout.trim()
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed)) {
        console.log(`${key}: ${JSON.stringify(value)}`)
      }
    } catch {
      console.log(`stdout (unparsed): ${JSON.stringify(r.stdout)}`)
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
