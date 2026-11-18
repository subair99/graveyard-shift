// Builds the Fixture_Graveyard tree once and reads it with the production reader (readSite) into a SiteView.
// The nightly input is swapped in `.crypt-nightly/` between reads; the tree and its tarballs are built once.

import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSiteView, type SiteInput, type SiteView } from "../../../src/ui/core/viewModel";
import { nodeSiteFs } from "../../../src/ui/shell/loadSite";
import { readSite } from "../../../src/ui/shell/readSite";
import { readResurrectionVersion } from "../../../src/ui/shell/tarballVersion";
import { FIXTURE_ROOT, makeFixtureTree, type FixtureTree } from "./fixtureTree";

export interface FixtureSite {
  /** Reads the tree with the nightly case (a `tests/ui/fixtures/nightly/<case>` name) or without one (null). */
  read(nightly: string | null): Promise<{ input: SiteInput; view: SiteView; warnings: string[] }>;
  cleanup(): Promise<void>;
}

export async function makeFixtureSite(): Promise<FixtureSite> {
  const tree: FixtureTree = await makeFixtureTree();
  return {
    async read(nightly) {
      const dir = join(tree.root, ".crypt-nightly");
      await rm(dir, { recursive: true, force: true });
      if (nightly !== null) {
        await mkdir(dir, { recursive: true });
        await cp(join(FIXTURE_ROOT, "nightly", nightly), dir, { recursive: true });
      }
      const warnings: string[] = [];
      const r = await readSite({
        root: tree.root,
        fs: nodeSiteFs,
        resurrectionVersion: readResurrectionVersion,
        warn: (line) => warnings.push(line),
      });
      if (!r.ok) throw new Error(r.error.message);
      return { input: r.value, view: buildSiteView(r.value), warnings };
    },
    cleanup: tree.cleanup,
  };
}

export function html(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export { createElement };

/** Heading levels in document order. */
export function headingLevels(markup: string): number[] {
  return [...markup.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
}

/** The markup of the section whose heading id is `id` (the components do not nest sections). */
export function sectionOf(markup: string, id: string): string {
  const m = new RegExp(`<section aria-labelledby="${id}">[\\s\\S]*?</section>`).exec(markup);
  if (m === null) throw new Error(`no section ${id}`);
  return m[0];
}
