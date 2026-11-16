// Atomic file write: temp file in the same directory, then rename (R7.8).
// If any step fails, the previous file stays intact and the temp file is removed.

import { promises as fsp } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface AtomicFs {
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export const nodeAtomicFs: AtomicFs = {
  writeFile: (p, d) => fsp.writeFile(p, d, { encoding: "utf8" }),
  rename: (a, b) => fsp.rename(a, b),
  rm: (p) => fsp.rm(p, { force: true }),
};

/** `suffix` makes the temp name unique; the caller supplies it so the helper stays deterministic. */
export async function writeFileAtomic(
  path: string,
  text: string,
  suffix: string = String(process.pid),
  fs: AtomicFs = nodeAtomicFs,
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${suffix}.tmp`);
  try {
    await fs.writeFile(temp, text);
    await fs.rename(temp, path);
  } catch (e) {
    await fs.rm(temp).catch(() => undefined);
    throw e;
  }
}
