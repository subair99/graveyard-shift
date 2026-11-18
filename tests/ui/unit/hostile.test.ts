// Requirements: 7.1, 7.2, 7.3, 7.6, 7.7, 7.8, 10.4
// Renders the home page, the Crypt_Index and every Entry_Page of the Fixture_Graveyard (Hostile_Fixture, its
// ledger rows and its nightly case included) to static markup, parses the markup with a small tokenizer and
// checks that no element or attribute comes from File_Text.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CryptIndexView } from "../../../src/ui/components/CryptIndexView";
import { EntryView } from "../../../src/ui/components/EntryView";
import { HomeView } from "../../../src/ui/components/HomeView";
import { BASE_PATH } from "../../../src/ui/core/site";
import type { SiteView } from "../../../src/ui/core/viewModel";
import { createElement, html, makeFixtureSite, type FixtureSite } from "../helpers/siteView";
import { unescapeHtml } from "../helpers/unescapeHtml";

interface Tag {
  name: string;
  closing: boolean;
  attrs: Map<string, string | null>;
}

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>\/=]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTR = /\s+([^\s"'<>\/=]+)(?:="([^"]*)")?/g;

/** Tags and attributes of React's static markup, plus the text that remains once the tags are removed. */
function parseMarkup(markup: string): { tags: Tag[]; rest: string } {
  const tags: Tag[] = [];
  const rest = markup.replace(TAG, (_m, slash: string, name: string, attrText: string) => {
    const attrs = new Map<string, string | null>();
    for (const a of attrText.matchAll(ATTR)) attrs.set(a[1]!.toLowerCase(), a[2] === undefined ? null : unescapeHtml(a[2]));
    tags.push({ name: name.toLowerCase(), closing: slash === "/", attrs });
    return "";
  });
  return { tags, rest };
}

const FORBIDDEN_TAGS = new Set([
  "script", "style", "iframe", "img", "object", "embed", "form", "base", "meta", "link", "svg", "math", "input", "button", "video", "audio", "source", "frame", "frameset",
]);
const FORBIDDEN_SCHEME = /^[\s\u0000-\u001f]*(javascript|data|vbscript|file|blob):/i;

const HOSTILE_TEXTS = [
  "<script>alert('xss')</script>",
  '"><img src=x onerror=alert(1)>',
  "<style>body{display:none}</style>",
  "mathias</script><script>alert(2)</script>",
];

describe("hostile fixture markup (Requirement 7.8)", () => {
  let site: FixtureSite;
  const pages = new Map<string, string>();

  beforeAll(async () => {
    site = await makeFixtureSite();
    for (const nightly of ["hostile", "success", null] as const) {
      const view: SiteView = (await site.read(nightly)).view;
      const key = nightly ?? "none";
      pages.set(`home/${key}`, html(createElement(HomeView)));
      pages.set(`index/${key}`, html(createElement(CryptIndexView, { view })));
      for (const entry of view.entries) {
        pages.set(`entry/${entry.name}/${key}`, html(createElement(EntryView, { entry, nightlyRun: view.nightlyRun })));
      }
    }
  });
  afterAll(async () => {
    await site.cleanup();
  });

  it("renders the home page, the index and every entry for each nightly case", () => {
    expect(pages.has("entry/hostile-fixture/hostile")).toBe(true);
    expect(pages.has("entry/alive-fixture/none")).toBe(true);
    expect(pages.size).toBeGreaterThanOrEqual(3 * (2 + 7));
  });

  it("has no element that File_Text could add and no unescaped '<' outside a tag", () => {
    for (const [key, markup] of pages) {
      const { tags, rest } = parseMarkup(markup);
      expect(
        tags.filter((t) => FORBIDDEN_TAGS.has(t.name)).map((t) => t.name),
        key,
      ).toEqual([]);
      expect(rest.includes("<"), `${key}: '<' left in text`).toBe(false);
    }
  });

  it("has no on* attribute, style or target attribute, and no id or class built from File_Text", () => {
    for (const [key, markup] of pages) {
      for (const tag of parseMarkup(markup).tags) {
        for (const [name, value] of tag.attrs) {
          expect(name.startsWith("on"), `${key}: ${tag.name} ${name}`).toBe(false);
          expect(["style", "target", "srcdoc", "srcset", "src", "formaction", "action"], `${key}: ${name}`).not.toContain(name);
          if (name === "id" || name === "class") expect(value, `${key}: ${name}`).toMatch(/^[A-Za-z][A-Za-z0-9_-]*( [A-Za-z][A-Za-z0-9_-]*)*$/);
        }
      }
    }
  });

  it("renders every anchor as a Base_Path link or as an http(s) link with rel noopener noreferrer", () => {
    let external = 0;
    let internal = 0;
    for (const [key, markup] of pages) {
      for (const tag of parseMarkup(markup).tags) {
        if (tag.closing || tag.name !== "a") continue;
        const href = tag.attrs.get("href");
        expect(typeof href, `${key}: anchor without href`).toBe("string");
        const h = href as string;
        expect(h, key).not.toMatch(FORBIDDEN_SCHEME);
        expect(h, `${key}: ${h}`).not.toMatch(/[\s\u0000-\u001f\u007f]/);
        if (h.startsWith("/")) {
          internal++;
          expect(h.startsWith(`${BASE_PATH}/`), `${key}: ${h}`).toBe(true);
          expect(h.startsWith("//"), `${key}: ${h}`).toBe(false);
        } else {
          external++;
          expect(h, key).toMatch(/^https?:\/\//i);
          expect(tag.attrs.get("rel"), `${key}: ${h}`).toBe("noopener noreferrer");
        }
      }
    }
    expect(internal).toBeGreaterThan(0);
    expect(external).toBeGreaterThan(0);
  });

  it("never turns a hostile source URL into an anchor", () => {
    const hrefs = [...pages.entries()].flatMap(([key, markup]) =>
      key.includes("hostile-fixture") ? parseMarkup(markup).tags.filter((t) => t.name === "a" && !t.closing).map((t) => t.attrs.get("href") ?? "") : [],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((h) => FORBIDDEN_SCHEME.test(h) || h.startsWith("//") || !/^(https?:\/\/|\/graveyard-shift\/)/i.test(h))).toEqual([]);
    expect(hrefs.filter((h) => h.includes("evil.example:8080"))).toEqual([]);
    expect(hrefs.every((h) => !/evil\.example\/path\s/.test(h))).toBe(true);
  });

  it("shows hostile strings only as escaped text", () => {
    const markup = pages.get("entry/hostile-fixture/hostile")!;
    const text = unescapeHtml(markup);
    for (const s of HOSTILE_TEXTS) {
      expect(markup.includes(s), `raw copy of ${s}`).toBe(false);
      expect(text.includes(s), `escaped copy of ${s}`).toBe(true);
    }
    expect(markup).toContain("&lt;script&gt;alert(");
    for (const markupOfPage of pages.values()) {
      expect(markupOfPage).not.toMatch(/<\/?(script|style|iframe|img)[\s>\/]/i);
    }
  });

  it("keeps the nightly hostile facts and reason as text", () => {
    const markup = pages.get("entry/hostile-fixture/hostile")!;
    expect(unescapeHtml(markup)).toContain("<style>body{display:none}</style>");
    expect(unescapeHtml(pages.get("index/hostile")!)).not.toContain("<script");
  });
});
