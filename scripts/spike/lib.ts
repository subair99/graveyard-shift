// Throwaway spike helper (task 1.1). Deleted in 1.15 unless a later kept script needs it.
import { spawnSync } from 'node:child_process'

export interface SpikeResult {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export interface SpikeOptions {
  env?: Readonly<Record<string, string>>
  cwd?: string
  input?: string
  timeoutMs?: number
}

/** Runs `process.execPath <args...>` with shell:false so each path is one argv element. */
export function runNode(args: readonly string[], options: SpikeOptions = {}): SpikeResult {
  const result = spawnSync(process.execPath, [...args], {
    shell: false,
    // Next's type augmentation makes NODE_ENV required in ProcessEnv; the spike passes exact env sets.
    env: { ...(options.env ?? {}) } as NodeJS.ProcessEnv,
    cwd: options.cwd,
    input: options.input,
    timeout: options.timeoutMs,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}
