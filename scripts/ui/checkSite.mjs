// Site_Check_Script (crypt-ui Requirement 10.5, design Component 5): checks a built Site_Output.
// Dependency-free: `node:` imports only. Run from the repository root after `npm run build`:
//   node scripts/ui/checkSite.mjs [--out <export dir, default out>] [--root <repository root, default cwd>]
// Reads the export directory and the committed graveyard/ only; nothing from the nightly input is required.
// One line per problem on standard error, exit 1 when any. JavaScript files are not scanned for URLs
// (design Component 5); the Site source is covered by the source scan of Requirement 10.6.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASE_PATH = "/graveyard-shift";
const BASE_PREFIX = `${BASE_PATH}/`;
// Equal to EMPTY_CRYPT_PARAM of src/ui/core/site.ts (a test checks it); this file imports no project code.
export const EMPTY_CRYPT_PARAM = "_empty";

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
const FORBIDDEN_TAGS = new Set(["iframe", "object", "embed", "form", "base"]);

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** Decodes the character references that matter for URL checks (named: amp lt gt quot apos nbsp; numeric). */
export function decodeEntities(text) {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));?/g, (whole, hex, dec, name) => {
    if (name !== undefined) return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

/** Value as a browser reads a URL: references decoded, leading and trailing controls and spaces removed, tabs and newlines dropped. */
function urlText(value) {
  return decodeEntities(value).replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SLASHES = /^[/\\]{2}/;

/** True for a relative reference, or one that starts with the base path; false for a scheme, `//` or another root path. */
export function isLocalReference(value) {
  const v = urlText(value);
  if (v === "") return true;
  if (HAS_SCHEME.test(v) || SLASHES.test(v)) return false;
  if (v.startsWith("/")) return v.startsWith(BASE_PREFIX);
  if (v.startsWith("\\")) return false;
  return true;
}

/** True for an absolute http or https URL, a path under the base path, or a fragment. */
export function isAllowedAnchorHref(value) {
  const v = urlText(value);
  if (/^https?:/i.test(v)) return true;
  if (SLASHES.test(v)) return false;
  return v.startsWith(BASE_PREFIX) || v.startsWith("#");
}

function parseAttributes(text) {
  const attrs = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? "" });
  }
  return attrs;
}

/** Problems of one HTML document (rule group 2). `file` names the page in each message. */
export function checkHtml(file, html) {
  const problems = [];
  const add = (text) => problems.push(`${file}: ${text}`);
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = tag.exec(html)) !== null) {
    if (m[2] === undefined) continue; // comment, declaration or CDATA
    const name = m[2].toLowerCase();
    if (m[1] === "/") continue;
    if (RAW_TEXT_TAGS.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, tag.lastIndex);
      if (close === -1) tag.lastIndex = html.length;
      else tag.lastIndex = close;
    }
    const attrs = parseAttributes(m[3]);
    const get = (n) => attrs.find((a) => a.name === n)?.value;
    if (FORBIDDEN_TAGS.has(name)) add(`<${name}> is not allowed`);
    if (name === "meta" && (get("http-equiv") ?? "").trim().toLowerCase() === "refresh") add('<meta http-equiv="refresh"> is not allowed');
    for (const a of attrs) {
      if (/^on/.test(a.name)) add(`attribute ${a.name} is not allowed on <${name}>`);
      if (a.name === "src" && !isLocalReference(a.value)) add(`<${name}> src is not relative or under ${BASE_PREFIX}: ${a.value}`);
      if (a.name === "srcset") {
        for (const candidate of a.value.split(",")) {
          const url = candidate.trim().split(/\s+/)[0] ?? "";
          if (!isLocalReference(url)) add(`<${name}> srcset is not relative or under ${BASE_PREFIX}: ${url}`);
        }
      }
      if (name === "link" && a.name === "href" && !isLocalReference(a.value)) add(`<link> href is not relative or under ${BASE_PREFIX}: ${a.value}`);
      if (name === "a" && a.name === "href" && !isAllowedAnchorHref(a.value)) {
        add(`<a> href is not an http(s) URL, a path under ${BASE_PREFIX} or a fragment: ${a.value}`);
      }
    }
    if (name === "a" && (get("target") ?? "").trim().toLowerCase() === "_blank") {
      const rel = (get("rel") ?? "").toLowerCase().split(/\s+/);
      if (!(rel.includes("noopener") && rel.includes("noreferrer"))) add('<a target="_blank"> needs rel with noopener and noreferrer');
    }
  }
  return problems;
}

/** Problems of one stylesheet (rule group 3). */
export function checkCss(file, css) {
  const problems = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import/i.test(text)) problems.push(`${file}: @import is not allowed`);
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = urlText(m[1] ?? m[2] ?? m[3] ?? "");
    if (HAS_SCHEME.test(value) || SLASHES.test(value)) problems.push(`${file}: url() with a scheme or "//": ${value}`);
  }
  return problems;
}

/** Relative paths (with "/") of every file under `dir`, sorted; [] when `dir` does not exist. */
export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(join(abs, e.name), childRel);
      else if (e.isFile()) out.push(childRel);
    }
  };
  walk(dir, "");
  return out.sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Runs the four check groups. `outDir` is the export directory, `root` the repository root (its graveyard/ is read).
 * Returns `{ problems }`, one string per problem.
 */
export function checkSite({ outDir, root }) {
  const problems = [];
  const graveyardDir = join(root, "graveyard");

  // 1. Expected pages.
  // A missing graveyard/ counts as zero entries (amended 2026-11-18); one that exists but is not a directory is a problem.
  let names = [];
  let graveyardIsDir = false;
  if (existsSync(graveyardDir)) {
    graveyardIsDir = statSync(graveyardDir).isDirectory();
    if (graveyardIsDir) {
      names = readdirSync(graveyardDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } else {
      problems.push(`${graveyardDir}: graveyard exists but is not a directory`);
    }
  }
  const pages = ["index.html", "crypt/index.html", ...names.map((n) => `crypt/${n}/index.html`)];
  // The placeholder page exists exactly when the graveyard has no entry (crypt-ui Requirement 1.6, amended 2026-11-18).
  const emptyPage = `crypt/${EMPTY_CRYPT_PARAM}/index.html`;
  if (names.length === 0) pages.push(emptyPage);
  for (const page of pages) {
    const abs = join(outDir, ...page.split("/"));
    if (!existsSync(abs) || !statSync(abs).isFile()) problems.push(`out/${page}: page is missing`);
  }
  // No page directory under out/crypt/ without a matching entry (the placeholder only in the empty case).
  // A page directory is a directory that contains index.html; others (such as __next.crypt) are not pages.
  const cryptDir = join(outDir, "crypt");
  if (existsSync(cryptDir)) {
    const known = new Set(names.length === 0 ? [EMPTY_CRYPT_PARAM] : names);
    for (const e of readdirSync(cryptDir, { withFileTypes: true })) {
      if (!e.isDirectory() || known.has(e.name)) continue;
      const index = join(cryptDir, e.name, "index.html");
      if (existsSync(index) && statSync(index).isFile()) problems.push(`out/crypt/${e.name}: page has no entry in graveyard/`);
    }
  }

  // 2 and 3. Every HTML and CSS file of the export.
  for (const rel of listFiles(outDir)) {
    const abs = join(outDir, ...rel.split("/"));
    if (rel.endsWith(".html")) problems.push(...checkHtml(`out/${rel}`, readFileSync(abs, "utf8")));
    else if (rel.endsWith(".css")) problems.push(...checkCss(`out/${rel}`, readFileSync(abs, "utf8")));
  }

  // 4. Copied files: same set, same sha256.
  // A missing or non-directory graveyard/ has no source files; out/graveyard/ must then hold no file.
  const sources = graveyardIsDir ? listFiles(graveyardDir) : [];
  const copies = listFiles(join(outDir, "graveyard"));
  const copySet = new Set(copies);
  const sourceSet = new Set(sources);
  for (const rel of sources) {
    if (!copySet.has(rel)) {
      problems.push(`out/graveyard/${rel}: copied file is missing`);
      continue;
    }
    if (sha256(join(graveyardDir, ...rel.split("/"))) !== sha256(join(outDir, "graveyard", ...rel.split("/")))) {
      problems.push(`out/graveyard/${rel}: sha256 differs from graveyard/${rel}`);
    }
  }
  for (const rel of copies) {
    if (!sourceSet.has(rel)) problems.push(`out/graveyard/${rel}: file has no source in graveyard/`);
  }
  return { problems };
}

function parseArgs(argv, cwd) {
  const opts = { outDir: resolve(cwd, "out"), root: cwd };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === "--out" || flag === "--root") && value !== undefined) {
      if (flag === "--out") opts.outDir = resolve(cwd, value);
      else opts.root = resolve(cwd, value);
      i += 1;
    } else {
      return { error: `unknown or incomplete argument: ${flag}` };
    }
  }
  return opts;
}

/** Entry logic without process access: returns the lines for standard output and error and the exit code. */
export function runCheck(argv, cwd) {
  const opts = parseArgs(argv, cwd);
  if ("error" in opts) return { exitCode: 2, stdout: [], stderr: [opts.error] };
  if (!existsSync(opts.outDir)) return { exitCode: 1, stderr: [`${opts.outDir}: export directory not found (run npm run build first)`], stdout: [] };
  const { problems } = checkSite(opts);
  if (problems.length > 0) return { exitCode: 1, stdout: [], stderr: [...problems, `Site check failed: ${problems.length} problem(s).`] };
  return { exitCode: 0, stdout: ["Site check passed."], stderr: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCheck(process.argv.slice(2), process.cwd());
  for (const line of result.stdout) process.stdout.write(`${line}\n`);
  for (const line of result.stderr) process.stderr.write(`${line}\n`);
  process.exitCode = result.exitCode;
}
