// Production wiring of readSite (node:fs, process.cwd()), memoized per process, then buildSiteView.
// Any read error throws, which fails `next build` (crypt-ui Requirements 1.6, 2.5; design Error Handling).

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { buildSiteView, type SiteView } from "../core/viewModel";
import { readSite, type SiteFs } from "./readSite";
import { readResurrectionVersion } from "./tarballVersion";

export const nodeSiteFs: SiteFs = {
  listDirs(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  listEntries(dir) {
    return readdirSync(dir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      kind: d.isSymbolicLink() ? "symlink" : d.isDirectory() ? "directory" : d.isFile() ? "file" : "other",
    }));
  },
  readBytes(file) {
    try {
      if (!lstatSync(file).isFile()) return null;
      return new Uint8Array(readFileSync(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
};

let memo: Promise<SiteView> | null = null;

export function loadSite(): Promise<SiteView> {
  memo ??= (async () => {
    const read = await readSite({
      root: process.cwd(),
      fs: nodeSiteFs,
      resurrectionVersion: readResurrectionVersion,
      warn: (line) => console.warn(line),
    });
    if (!read.ok) throw new Error(read.error.message);
    return buildSiteView(read.value);
  })();
  return memo;
}
