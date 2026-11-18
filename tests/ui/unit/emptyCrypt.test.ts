// Requirements: 1.6, 3.7
// Amended 2026-11-18 after open question 5 (user-run): placeholder route for an empty graveyard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CryptIndexView } from "../../../src/ui/components/CryptIndexView";
import { EmptyCryptView } from "../../../src/ui/components/EmptyCryptView";
import { EntryView } from "../../../src/ui/components/EntryView";
import { HomeView } from "../../../src/ui/components/HomeView";
import { EMPTY_CRYPT_PARAM, entryRoute, sitePath } from "../../../src/ui/core/site";
import { staticParamsFor } from "../../../src/ui/core/staticParams";
import { EMPTY_CRYPT_PAGE_SENTENCE } from "../../../src/ui/core/texts";
import type { SiteView } from "../../../src/ui/core/viewModel";
import { supportedPackageNameProblem } from "../../../src/pipeline/common/packageNames";
import { createElement, html, makeFixtureSite, type FixtureSite } from "../helpers/siteView";

describe("EMPTY_CRYPT_PARAM", () => {
  it("is not a valid package name, so no entry can have it", () => {
    // A leading underscore is never a valid npm package name; the reader rejects such a directory name.
    expect(EMPTY_CRYPT_PARAM).toBe("_empty");
    expect(supportedPackageNameProblem("_empty")).not.toBeNull();
  });
});

describe("staticParamsFor", () => {
  it("gives the placeholder parameter for a site without entries", () => {
    expect(staticParamsFor({ entries: [] })).toEqual([{ name: "_empty" }]);
  });

  it("gives the entry names only, in order, otherwise", () => {
    expect(staticParamsFor({ entries: [{ name: "a" }, { name: "lodash.set" }] })).toEqual([{ name: "a" }, { name: "lodash.set" }]);
  });
});

describe("placeholder and links", () => {
  let site: FixtureSite;
  let view: SiteView;
  beforeAll(async () => {
    site = await makeFixtureSite();
    view = (await site.read("success")).view;
  });
  afterAll(async () => {
    await site.cleanup();
  });

  it("the empty view shows the fixed sentence and one anchor back to the Crypt_Index", () => {
    const markup = html(createElement(EmptyCryptView));
    expect(markup).toContain(EMPTY_CRYPT_PAGE_SENTENCE);
    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain(`<a href="${sitePath("/crypt/")}">`);
  });

  it("the fixture entries are not routed to the placeholder", () => {
    expect(staticParamsFor(view).map((p) => p.name)).toEqual(view.entries.map((e) => e.name));
    expect(view.entries.map((e) => entryRoute(e.name))).not.toContain(entryRoute(EMPTY_CRYPT_PARAM));
  });

  it("no link to /crypt/_empty/ in home, index (with and without entries) or any entry page", () => {
    const markups = [
      html(createElement(HomeView)),
      html(createElement(CryptIndexView, { view })),
      html(createElement(CryptIndexView, { view: { ...view, entries: [] } })),
      ...view.entries.map((entry) => html(createElement(EntryView, { entry, nightlyRun: view.nightlyRun }))),
    ];
    for (const m of markups) expect(m).not.toContain(EMPTY_CRYPT_PARAM);
  });
});
