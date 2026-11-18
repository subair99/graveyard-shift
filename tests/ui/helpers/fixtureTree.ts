// Copies the Fixture_Graveyard to a temporary directory and adds the files that are not committed:
// one tarball per Resurrection_Entry (packTarball) and placeholder bundle files for `alive` entries.
// Writes only inside the returned temporary root.

import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleName, ENTRY_FILES } from "../../../src/pipeline/undertaker/core/layout";
import { packTarball } from "../../../src/proof/shell/tarball/tarballExtractor";

export const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const TARBALL_NAME = "resurrection.tgz";

/** Version in the `package.json` of each fixture tarball (the Resurrection_Version of the entry). */
export const RESURRECTION_VERSIONS: Readonly<Record<string, string>> = {
  "alive-fixture": "1.0.1",
  "restless-fixture": "2.0.1",
  "inconclusive-fixture": "3.0.1",
  "stub-fixture": "4.0.1",
  "lodash.set": "4.3.3",
  "hostile-fixture": "5.0.1",
};

export interface FixtureTree {
  /** Temporary root with `graveyard/`, `ledger.json` and, when asked, `.crypt-nightly/`. */
  readonly root: string;
  cleanup(): Promise<void>;
}

export interface FixtureTreeOptions {
  /** Name of a `nightly/<case>` directory copied to `.crypt-nightly/`; none by default. */
  readonly nightly?: string;
  /** Entry names to leave out of the copy. */
  readonly omit?: readonly string[];
}

const enc = new TextEncoder();

export function tarballBytes(name: string, version: string): Uint8Array {
  const packageJson = enc.encode(`${JSON.stringify({ name, version }, null, 2)}\n`);
  const packed = packTarball([
    { path: "package.json", bytes: packageJson },
    { path: "index.js", bytes: enc.encode("module.exports = {};\n") },
  ]);
  if (!packed.ok) throw new Error(`packTarball failed: ${packed.error.kind}`);
  return packed.value;
}

export async function makeFixtureTree(options: FixtureTreeOptions = {}): Promise<FixtureTree> {
  const root = await mkdtemp(join(tmpdir(), "crypt-fixture-"));
  try {
    await cp(join(FIXTURE_ROOT, "graveyard"), join(root, "graveyard"), { recursive: true });
    await cp(join(FIXTURE_ROOT, "ledger.json"), join(root, "ledger.json"));
    for (const name of options.omit ?? []) {
      await rm(join(root, "graveyard", name), { recursive: true, force: true });
    }
    for (const dirent of await readdir(join(root, "graveyard"), { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const dir = join(root, "graveyard", dirent.name);
      const files = await readdir(dir);
      if (!files.includes(ENTRY_FILES.proofReport)) continue;
      const version = RESURRECTION_VERSIONS[dirent.name] ?? "1.0.1";
      await writeFile(join(dir, TARBALL_NAME), tarballBytes(dirent.name, version));
      const report = JSON.parse(await readFile(join(dir, ENTRY_FILES.proofReport), "utf8")) as { verdict: string };
      if (report.verdict === "alive") {
        for (const subject of [TARBALL_NAME, ENTRY_FILES.proofReport, ENTRY_FILES.certificate]) {
          await writeFile(join(dir, bundleName(subject)), `${JSON.stringify({ placeholder: subject })}\n`);
        }
      }
    }
    if (options.nightly !== undefined) {
      await mkdir(join(root, ".crypt-nightly"), { recursive: true });
      await cp(join(FIXTURE_ROOT, "nightly", options.nightly), join(root, ".crypt-nightly"), { recursive: true });
    }
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
