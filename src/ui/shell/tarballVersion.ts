// Resurrection_Version read from a resurrection tarball (crypt-ui Requirements 2.9, 2.10).
// The only module under src/ui/ that imports extractTarball. Reads only the bytes of package.json.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, type Result } from "../../pipeline/common/result";
import { DEFAULT_EXTRACT_LIMITS, extractTarball } from "../../proof/shell/tarball/tarballExtractor";
import { versionFromPackageJson } from "../core/resurrectionVersion";

export async function readResurrectionVersion(bytes: Uint8Array): Promise<Result<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "crypt-tgz-"));
  try {
    const extracted = await extractTarball(bytes, dir, DEFAULT_EXTRACT_LIMITS);
    if (!extracted.ok) return err(`tarball cannot be read: ${extracted.error.kind}`);
    const file = extracted.value.find((f) => f.path === "package.json");
    if (file === undefined) return err("tarball has no package.json");
    return versionFromPackageJson(file.bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
