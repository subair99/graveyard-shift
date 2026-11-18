// Requirements: 2.7, 2.8
// Feature: crypt-ui, Property 6: Entry order and view data are deterministic
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJsonText } from "../../../src/pipeline/common/canonical";
import { buildSiteView } from "../../../src/ui/core/viewModel";
import { readSite, type SiteFs } from "../../../src/ui/shell/readSite";
import { readResurrectionVersion } from "../../../src/ui/shell/tarballVersion";
import { makeFixtureTree } from "../helpers/fixtureTree";

const NUM_RUNS = 100;
const ROOT = "/repo";

type Kind = "file" | "directory" | "symlink" | "other";

/** Fixture tree contents, read once: posix path below ROOT to bytes. */
const contents = new Map<string, Uint8Array>();
let entryNames: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

/** Fake fs over the cached contents, limited to the chosen entries, listing them in the given order. */
function fakeFs(chosen: readonly string[], reverseFiles: boolean): SiteFs {
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of contents) {
    const m = /^\/repo\/graveyard\/([^/]+)\//.exec(path);
    if (m === null || chosen.includes(m[1]!)) files.set(path, bytes);
  }
  return {
    listDirs(dir) {
      if (dir !== `${ROOT}/graveyard`) return null;
      return chosen.length === 0 ? null : [...chosen];
    },
    listEntries(dir) {
      const prefix = `${dir}/`;
      const out: { name: string; kind: Kind }[] = [];
      for (const path of files.keys()) {
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
          out.push({ name: path.slice(prefix.length), kind: "file" });
        }
      }
      return reverseFiles ? out.reverse() : out;
    },
    readBytes: (file) => files.get(file) ?? null,
  };
}

// The real extractor runs once per tarball (the cached byte arrays are reused across runs).
const versionCache = new WeakMap<Uint8Array, ReturnType<typeof readResurrectionVersion>>();
function cachedVersion(bytes: Uint8Array): ReturnType<typeof readResurrectionVersion> {
  let hit = versionCache.get(bytes);
  if (hit === undefined) {
    hit = readResurrectionVersion(bytes);
    versionCache.set(bytes, hit);
  }
  return hit;
}

async function viewJson(chosen: readonly string[], reverseFiles: boolean): Promise<{ names: string[]; json: string }> {
  const r = await readSite({ root: ROOT, fs: fakeFs(chosen, reverseFiles), resurrectionVersion: cachedVersion, warn: () => {} });
  if (!r.ok) throw new Error(`readSite failed: ${r.error.message}`);
  return { names: r.value.entries.map((e) => e.name), json: canonicalJsonText(buildSiteView(r.value)) };
}

describe("Property 6: Entry order and view data are deterministic", () => {
  let cleanup: () => Promise<void> = async () => {};
  beforeAll(async () => {
    const tree = await makeFixtureTree();
    cleanup = tree.cleanup;
    for (const file of walk(tree.root)) {
      contents.set(`${ROOT}/${relative(tree.root, file).split("\\").join("/")}`, new Uint8Array(readFileSync(file)));
    }
    entryNames = readdirSync(join(tree.root, "graveyard"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    // Warm the version cache so no run pays for the temporary-directory extraction.
    for (const [path, bytes] of contents) if (path.endsWith("/resurrection.tgz")) await cachedVersion(bytes);
  });
  afterAll(async () => {
    await cleanup();
  });

  it("returns entries in ascending code-point order and equal canonical JSON for equal files, whatever the listing order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(entryNames, { minLength: 0 }).chain((a) => fc.tuple(fc.constant(a), fc.shuffledSubarray(a, { minLength: a.length, maxLength: a.length }))),
        fc.boolean(),
        async ([chosen, otherOrder], reverseFiles) => {
          const first = await viewJson(chosen, false);
          const second = await viewJson(otherOrder, reverseFiles);
          const sorted = [...chosen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          expect(first.names).toEqual(sorted);
          expect(second.names).toEqual(sorted);
          expect(second.json).toBe(first.json);
          expect((await viewJson(chosen, false)).json).toBe(first.json);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
