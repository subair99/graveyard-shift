// Throwaway spike (task 1.3): runs under --permission, loads a CommonJS package via createRequire.
import { createRequire } from 'node:module'
import { join } from 'node:path'

interface Outcome {
  readonly ok: boolean
  readonly value?: unknown
  readonly code?: string
  readonly name?: string
  readonly message?: string
}

const packageDir = process.argv[2]
const specifier = process.argv[3]
if (packageDir === undefined || specifier === undefined) {
  throw new Error('usage: runner.ts <packageDir> <specifier>')
}

function load(): Outcome {
  try {
    const req = createRequire(join(packageDir as string, 'package.json'))
    const value: unknown = req(specifier as string)
    return { ok: true, value }
  } catch (error) {
    const e = error as { code?: unknown; name?: unknown; message?: unknown }
    return {
      ok: false,
      code: typeof e.code === 'string' ? e.code : undefined,
      name: typeof e.name === 'string' ? e.name : undefined,
      message: typeof e.message === 'string' ? e.message : String(error),
    }
  }
}

console.log(JSON.stringify(load()))
