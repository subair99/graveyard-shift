// Spike (task 1.6): package paths with special characters under --permission.
// Basis of the integration test `paths-spaces` (18.11). Prints one JSON line.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDir = process.argv[2]
const deniedFile = process.argv[3]
if (packageDir === undefined || deniedFile === undefined) {
  throw new Error('usage: runner.ts <packageDir> <deniedFile>')
}

interface Probe {
  ok: boolean
  value?: unknown
  code?: string
  message?: string
}

function describe(error: unknown): Probe {
  const e = error as { code?: unknown; message?: unknown }
  return {
    ok: false,
    code: typeof e.code === 'string' ? e.code : undefined,
    message: typeof e.message === 'string' ? e.message : String(error),
  }
}

function probe(fn: () => unknown): Probe {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return describe(error)
  }
}

async function probeAsync(fn: () => Promise<unknown>): Promise<Probe> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return describe(error)
  }
}

const req = createRequire(join(packageDir, 'package.json'))
const report = {
  cwd: probe(() => process.cwd()),
  loadPackage: probe(() => req('.') as unknown),
  // Mechanism A: ESM import of a file URL that does not exist.
  esmImportMissingFileUrl: await probeAsync(() => import(pathToFileURL(join(packageDir, 'missing.mjs')).href)),
  // Mechanism B: ESM module inside the package imports a missing relative file.
  esmRelativeImportMissing: await probeAsync(() => import(pathToFileURL(join(packageDir, 'esm.mjs')).href)),
  // Mechanism F: JSON import without an import attribute (Node message names the module URL).
  esmJsonWithoutAttribute: await probeAsync(() => import(pathToFileURL(join(packageDir, 'data.json')).href)),
  // Mechanism G: directory import.
  esmDirectoryImport: await probeAsync(() => import(pathToFileURL(join(packageDir, 'sub')).href)),
  // Mechanism H: unknown file extension.
  esmUnknownExtension: await probeAsync(() => import(pathToFileURL(join(packageDir, 'file.foo')).href)),
  // Mechanism C: CommonJS require of a missing relative file.
  requireMissing: probe(() => req('./nope.js') as unknown),
  // Mechanism D: constructed values (no thrown error): what pathToFileURL and new URL produce.
  pathToFileUrlOfPackageDir: pathToFileURL(packageDir).href,
  newUrlRelative: new URL('./x.js', pathToFileURL(packageDir + sep)).href,
  // Mechanism E: Node's own error that embeds a file URL: reading a URL-addressed file that is missing.
  readFileUrlMissing: probe(() => readFileSync(new URL('./nope.txt', pathToFileURL(packageDir + sep)), 'utf8')),
  // Denied reads (path outside every grant), by native path and by file URL.
  deniedReadNative: probe(() => readFileSync(deniedFile, 'utf8')),
  deniedReadUrl: probe(() => readFileSync(pathToFileURL(deniedFile), 'utf8')),
  deniedEsmImport: await probeAsync(() => import(pathToFileURL(deniedFile).href)),
}
console.log(JSON.stringify(report))
