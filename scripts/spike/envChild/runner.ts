// Throwaway spike (task 1.4): runs under --permission and reports what the scrubbed environment allows.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const packageDir = process.argv[2]
const grantedFile = process.argv[3]
if (packageDir === undefined || grantedFile === undefined) {
  throw new Error('usage: runner.ts <packageDir> <grantedFile>')
}

function probe(fn: () => unknown): unknown {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown }
    return {
      ok: false,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: typeof e.message === 'string' ? e.message.slice(0, 120) : String(error),
    }
  }
}

const report = {
  envKeys: Object.keys(process.env).sort(),
  tzOffsetMinutes: new Date().getTimezoneOffset(),
  loadPackage: probe(() => createRequire(join(packageDir, 'package.json'))('.') as unknown),
  readGrantedFile: probe(() => readFileSync(grantedFile, 'utf8').length),
  tmpdir: probe(() => tmpdir()),
  homedir: probe(() => homedir()),
  message: probe(() => readFileSync(0, 'utf8').trim()),
}
console.log(JSON.stringify(report))
