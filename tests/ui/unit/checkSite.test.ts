// Requirements: 1.2, 10.5
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_CRYPT_PARAM as EMPTY_CRYPT_PARAM_SCRIPT,
  checkCss,
  checkHtml,
  checkSite,
  isAllowedAnchorHref,
  isLocalReference,
  runCheck,
} from "../../../scripts/ui/checkSite.mjs";
import { EMPTY_CRYPT_PARAM } from "../../../src/ui/core/site";
import { makeFixtureTree, type FixtureTree } from "../helpers/fixtureTree";

const repoRoot = join(__dirname, "..", "..", "..");
const script = join(repoRoot, "scripts", "ui", "checkSite.mjs");

const GOOD_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>Crypt</title>
<link rel="stylesheet" href="/graveyard-shift/_next/static/css/a.css"/>
<script src="/graveyard-shift/_next/static/chunks/a.js" async=""></script></head>
<body><main><a href="/graveyard-shift/crypt/">Crypt</a> <a href="#main">skip</a>
<a href="https://github.com/o/r" rel="noopener noreferrer" target="_blank">repo</a>
<script>self.__next_f.push([1,"<a href=\\"javascript:x\\">fetch(\\"u\\")</a>"])</script></main></body></html>`;

let tree: FixtureTree;
let outDir: string;

function put(rel: string, text: string): void {
  const abs = join(outDir, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function names(): string[] {
  return readdirSync(join(tree.root, "graveyard"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

beforeEach(async () => {
  tree = await makeFixtureTree();
  outDir = join(tree.root, "out");
  put("index.html", GOOD_PAGE);
  put("crypt/index.html", GOOD_PAGE);
  for (const n of names()) put(`crypt/${n}/index.html`, GOOD_PAGE);
  put("_next/static/css/a.css", "body{color:#fff;background:url(/graveyard-shift/x.png)}");
  cpSync(join(tree.root, "graveyard"), join(outDir, "graveyard"), { recursive: true });
});

afterEach(async () => {
  await tree.cleanup();
});

function child(): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [script, "--out", outDir, "--root", tree.root], { encoding: "utf8", cwd: tree.root });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("checkSite.mjs as a child process", () => {
  it("knows lodash.set among the entries", () => {
    expect(names()).toContain("lodash.set");
  });

  it("passes a complete export without any nightly input", () => {
    const r = child();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("fails naming a missing page, including the entry with a dot", () => {
    rmSync(join(outDir, "crypt", "lodash.set", "index.html"));
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("out/crypt/lodash.set/index.html: page is missing");
  });

  it("fails on a missing home page", () => {
    rmSync(join(outDir, "index.html"));
    expect(child().stderr).toContain("out/index.html: page is missing");
  });

  it("fails on an external script", () => {
    put("crypt/index.html", GOOD_PAGE.replace("/graveyard-shift/_next/static/chunks/a.js", "https://cdn.example/x.js"));
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("out/crypt/index.html");
    expect(r.stderr).toContain("src");
  });

  it("fails on a javascript: link", () => {
    put("index.html", GOOD_PAGE.replace('href="#main"', 'href="javascript:alert(1)"'));
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("out/index.html");
  });

  it("fails on an on* attribute", () => {
    put("index.html", GOOD_PAGE.replace("<main>", '<main onclick="x()">'));
    expect(child().stderr).toContain("attribute onclick");
  });

  it("fails on a changed copied byte, naming the file", () => {
    appendFileSync(join(outDir, "graveyard", "lodash.set", "certificate.json"), " ");
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("out/graveyard/lodash.set/certificate.json: sha256 differs");
  });

  it("fails on a missing copied file", () => {
    rmSync(join(outDir, "graveyard", "lodash.set", "certificate.json"));
    expect(child().stderr).toContain("out/graveyard/lodash.set/certificate.json: copied file is missing");
  });

  it("fails on an extra copied file", () => {
    put("graveyard/lodash.set/extra.txt", "x");
    expect(child().stderr).toContain("out/graveyard/lodash.set/extra.txt: file has no source");
  });

  it("fails on a stylesheet import and a remote url()", () => {
    put("_next/static/css/a.css", '@import "x.css"; a{background:url(//evil.example/a.png)}');
    const r = child();
    expect(r.stderr).toContain("out/_next/static/css/a.css: @import");
    expect(r.stderr).toContain("out/_next/static/css/a.css: url()");
  });

  it("fails on a page directory without an entry", () => {
    put("crypt/ghost/index.html", GOOD_PAGE);
    expect(child().stderr).toContain("out/crypt/ghost: page has no entry in graveyard/");
  });

  it("fails on a stray _empty page when the graveyard has entries", () => {
    put("crypt/_empty/index.html", GOOD_PAGE);
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("out/crypt/_empty: page has no entry in graveyard/");
  });

  it("empty graveyard: passes with the _empty page and fails without it", () => {
    for (const n of names()) {
      rmSync(join(tree.root, "graveyard", n), { recursive: true, force: true });
      rmSync(join(outDir, "graveyard", n), { recursive: true, force: true });
      rmSync(join(outDir, "crypt", n), { recursive: true, force: true });
    }
    const missing = child();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("out/crypt/_empty/index.html: page is missing");
    put("crypt/_empty/index.html", GOOD_PAGE);
    const ok = child();
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
  });

  it("does not treat directories without index.html as pages (Next.js __next.crypt artifacts)", () => {
    put("crypt/__next.crypt/__PAGE__.txt", "x");
    put("crypt/__next._full.txt", "x");
    put("crypt/__next._tree.txt", "x");
    const r = child();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("still fails on out/crypt/<name>/index.html without an entry", () => {
    put("crypt/__next.crypt/__PAGE__.txt", "x");
    put("crypt/stray/index.html", GOOD_PAGE);
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("out/crypt/stray: page has no entry in graveyard/");
    expect(r.stderr).not.toContain("__next.crypt");
  });

  it("no graveyard/ directory counts as zero entries: passes with _empty and fails without it", () => {
    const entryNames = names();
    rmSync(join(tree.root, "graveyard"), { recursive: true, force: true });
    rmSync(join(outDir, "graveyard"), { recursive: true, force: true });
    for (const n of entryNames) rmSync(join(outDir, "crypt", n), { recursive: true, force: true });
    const missing = child();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("out/crypt/_empty/index.html: page is missing");
    expect(missing.stderr).not.toContain("directory not found");
    put("crypt/_empty/index.html", GOOD_PAGE);
    const ok = child();
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
  });

  it("fails when graveyard exists as a regular file, naming the path", () => {
    rmSync(join(tree.root, "graveyard"), { recursive: true, force: true });
    writeFileSync(join(tree.root, "graveyard"), "x");
    const r = child();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${join(tree.root, "graveyard")}: graveyard exists but is not a directory`);
  });

  it("keeps EMPTY_CRYPT_PARAM equal to the one of site.ts", () => {
    expect(EMPTY_CRYPT_PARAM_SCRIPT).toBe(EMPTY_CRYPT_PARAM);
  });

  it("fails when the export directory does not exist", () => {
    const r = spawnSync(process.execPath, [script, "--out", join(tree.root, "nope"), "--root", tree.root], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export directory not found");
  });
});

describe("checkSite pure functions", () => {
  it("checkSite and runCheck agree on a good tree", () => {
    expect(checkSite({ outDir, root: tree.root })).toEqual({ problems: [] });
    expect(runCheck(["--out", outDir, "--root", tree.root], tree.root).exitCode).toBe(0);
  });

  it("reference rules", () => {
    expect(isLocalReference("a/b.js")).toBe(true);
    expect(isLocalReference("/graveyard-shift/a.js")).toBe(true);
    expect(isLocalReference("/other/a.js")).toBe(false);
    expect(isLocalReference("//cdn.example/a.js")).toBe(false);
    expect(isLocalReference("https://cdn.example/a.js")).toBe(false);
    expect(isLocalReference("jav&#x61;script:x")).toBe(false);
    expect(isAllowedAnchorHref("https://example.org/x")).toBe(true);
    expect(isAllowedAnchorHref("HTTP://example.org/x")).toBe(true);
    expect(isAllowedAnchorHref("/graveyard-shift/crypt/")).toBe(true);
    expect(isAllowedAnchorHref("#a")).toBe(true);
    expect(isAllowedAnchorHref("mailto:a@b.c")).toBe(false);
    expect(isAllowedAnchorHref("  javascript:x")).toBe(false);
    expect(isAllowedAnchorHref("java\tscript:x")).toBe(false);
    expect(isAllowedAnchorHref("../x")).toBe(false);
    expect(isAllowedAnchorHref("//evil.example")).toBe(false);
  });

  it("flags forbidden elements, refresh, srcset and unsafe target=_blank", () => {
    const html = [
      '<iframe src="a"></iframe><object></object><embed><form></form><base href="/">',
      '<meta http-equiv="refresh" content="0;url=x">',
      '<img srcset="a.png 1x, https://x.example/b.png 2x">',
      '<a href="https://e.example" target="_blank" rel="noopener">x</a>',
    ].join("");
    const text = checkHtml("p.html", html).join("\n");
    for (const part of ["<iframe>", "<object>", "<embed>", "<form>", "<base>", "refresh", "srcset", "noopener and noreferrer"]) {
      expect(text).toContain(part);
    }
  });

  it("ignores text inside script and comments", () => {
    expect(checkHtml("p.html", '<!-- <a href="javascript:x"> --><script>"<a href=javascript:x onclick=1>"</script>')).toEqual([]);
  });

  it("accepts a stylesheet with local urls only", () => {
    expect(checkCss("a.css", "/* @import x */ a{background:url('/graveyard-shift/a.png')}")).toEqual([]);
    expect(checkCss("a.css", "a{background:url(data:image/png;base64,AA)}")).toHaveLength(1);
  });
});
