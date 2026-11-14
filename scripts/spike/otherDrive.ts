// Spike (task 1.7): the 1.3 CommonJS package load from a directory on another drive.
// Kept as the basis of the conditional integration test `other-drive` (18.11).
// Runs only when PROOF_TEST_OTHER_DRIVE (a writable directory on another drive) is set or another
// writable drive letter exists. Otherwise prints "other drive not available" and exits 0.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { runNode } from './lib.ts'

const runnerDir = resolve(import.meta.dirname, 'cjsChild')
const runner = join(runnerDir, 'runner.ts')

function driveOf(path: string): string {
  return parse(resolve(path)).root.toUpperCase()
}

const repoDrive = driveOf(process.cwd())
const tmpDrive = driveOf(tmpdir())
console.log(`date: ${new Date().toISOString().slice(0, 10)}`)
console.log(`node: ${process.version}`)
console.log(`repository drive: ${repoDrive}`)
console.log(`os.tmpdir(): ${tmpdir()} (drive ${tmpDrive})`)

/** Returns a writable base directory on a drive other than the repository drive, or null. */
function findOtherBase(): { readonly base: string; readonly source: string } | null {
  const fromEnv = process.env['PROOF_TEST_OTHER_DRIVE']
  if (fromEnv !== undefined && fromEnv !== '') {
    if (driveOf(fromEnv) === repoDrive) {
      console.log(`PROOF_TEST_OTHER_DRIVE=${fromEnv} is on the repository drive ${repoDrive}; ignored`)
    } else {
      return { base: fromEnv, source: 'PROOF_TEST_OTHER_DRIVE' }
    }
  }
  if (process.platform !== 'win32') return null
  const present: string[] = []
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`
    if (root !== repoDrive && existsSync(root)) present.push(root)
  }
  console.log(`other drive letters present: ${present.length === 0 ? '(none)' : present.join(' ')}`)
  for (const root of present) {
    try {
      const probe = mkdtempSync(join(root, 'spike-probe-'))
      rmSync(probe, { recursive: true, force: true })
      return { base: root, source: `writable drive ${root}` }
    } catch {
      console.log(`${root} is not writable`)
    }
  }
  return null
}

const other = findOtherBase()
if (other === null) {
  console.log('other drive not available')
  process.exit(0)
}

const root = mkdtempSync(join(other.base, 'spike-otherdrive-'))
console.log(`package root (${other.source}): ${root} (drive ${driveOf(root)})`)
try {
  const dir = join(root, 'pkg')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pkg', version: '1.0.0', main: 'entry.js' }))
  writeFileSync(join(dir, 'entry.js'), "const x = require('./lib/x.js')\nmodule.exports = { main: 'ok', x: x.x }\n")
  writeFileSync(join(dir, 'lib', 'x.js'), "module.exports = { x: 'from-x' }\n")
  const args = ['--permission', `--allow-fs-read=${runnerDir}`, `--allow-fs-read=${dir}`, runner, dir, '.']
  const r = runNode(args, { cwd: dir })
  console.log(`runner dir: ${runnerDir} (drive ${driveOf(runnerDir)})`)
  console.log(`exit=${String(r.status)} signal=${String(r.signal)}`)
  console.log(`stdout: ${JSON.stringify(r.stdout)}`)
  console.log(`stderr: ${JSON.stringify(r.stderr)}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
