/**
 * Prints the pinned values of tests/proof/unit/fixtureIntegrity.test.ts so they can be
 * refreshed after a deliberate fixture change:
 *
 *   npx tsx scripts/printFixtureHashes.ts
 *
 * Reads committed fixture files only. No network, no environment variables.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeSri } from "../src/proof/shell/integrity";
import { extractTarball } from "../src/proof/shell/tarball/tarballExtractor";
import { computeDirectoryTreeHash } from "../src/proof/shell/treeHash";

const FIXTURES = resolve(process.cwd(), "tests", "proof", "fixtures");

async function listFiles(dir: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function main(): Promise<void> {
  const files = (await listFiles(FIXTURES, "")).sort();
  console.log("// Fixture bytes (sha512 SRI), keyed by path relative to tests/proof/fixtures");
  for (const rel of files) {
    const bytes = await readFile(join(FIXTURES, ...rel.split("/")));
    console.log(`  "${rel}": "${computeSri(bytes)}",`);
  }

  const tgz = await readFile(join(FIXTURES, "lodash.set", "lodash.set-4.3.2.tgz"));
  const dir = await mkdtemp(join(tmpdir(), "fixture-hashes-"));
  try {
    const extracted = await extractTarball(tgz, dir);
    if (!extracted.ok) throw new Error(`Extraction failed: ${extracted.error.kind}`);
    const tree = await computeDirectoryTreeHash(dir);
    if (!tree.ok) throw new Error(`Tree hash failed: ${tree.error.kind}`);
    console.log("// Tree_Hash of the extracted original");
    console.log(`const ORIGINAL_TREE_HASH = "${tree.value}";`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exitCode = 1;
});
