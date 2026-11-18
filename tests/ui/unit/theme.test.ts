// Requirements: 8.1, 8.2, 8.3, 8.6
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_RATIO, PAIRS, PALETTE, contrastRatio } from "../../../src/ui/core/theme";
import type { PaletteName } from "../../../src/ui/core/theme";

const APP_DIR = join(__dirname, "..", "..", "..", "src", "app");
const css = readFileSync(join(APP_DIR, "globals.css"), "utf8");
const layout = readFileSync(join(APP_DIR, "layout.tsx"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Declarations of the top-level rule whose selector list contains `selector` (exact item match). */
function declarationsOf(selector: string): string {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of cssNoComments.matchAll(re)) {
    const items = (m[1] as string).split(",").map((s) => s.trim());
    if (items.includes(selector)) out.push(m[2] as string);
  }
  return out.join(";");
}

function usesVar(selector: string, property: string, name: PaletteName): boolean {
  const decls = declarationsOf(selector);
  const re = new RegExp(`(^|[;\\s])${property}\\s*:[^;]*var\\(--${kebab(name)}\\)`);
  return re.test(decls);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? sourceFiles(p) : [p];
  });
}

/** Where each pair is realised in the stylesheet: [selector, property, palette name] for foreground and background. */
const FOREGROUND_USE: Record<string, [string, string]> = {
  text: ["body", "color"],
  "text-on-surface": ["body", "color"],
  muted: ["footer", "color"],
  "muted-on-surface": ["caption", "color"],
  link: ["a", "color"],
  "link-on-surface": ["a", "color"],
  "outcome-alive": [".outcome-alive", "color"],
  "outcome-restless": [".outcome-restless", "color"],
  "outcome-inconclusive": [".outcome-inconclusive", "color"],
  "outcome-not-resurrected": [".outcome-not-resurrected", "color"],
  "package-status": [".package-status", "color"],
  boundary: ["header", "border-bottom"],
  "boundary-on-surface": ["section", "border"],
  "focus-outline": ["a:focus-visible", "outline"],
  "focus-outline-on-surface": ["a:focus-visible", "outline"],
};

const BACKGROUND_USE: Record<string, [string, string]> = {
  background: ["body", "background"],
  surface: ["section", "background"],
};

describe("theme stylesheet (Requirement 8.1)", () => {
  it("custom properties of :root equal PALETTE exactly", () => {
    const root = declarationsOf(":root");
    const found = new Map<string, string>();
    for (const m of root.matchAll(/--([a-z-]+)\s*:\s*([^;]+)/g)) {
      found.set(m[1] as string, (m[2] as string).trim());
    }
    const expected = new Map(Object.entries(PALETTE).map(([k, v]) => [kebab(k), v]));
    expect(Object.fromEntries(found)).toEqual(Object.fromEntries(expected));
  });

  it("uses no hex colour outside :root", () => {
    const outside = cssNoComments.replace(/:root\s*\{[^}]*\}/, "");
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("colour pairs (Requirement 8.2)", () => {
  it("every pair meets its minimum ratio", () => {
    for (const pair of PAIRS) {
      const ratio = contrastRatio(PALETTE[pair.foreground], PALETTE[pair.background]);
      expect(ratio, pair.id).toBeGreaterThanOrEqual(MIN_RATIO[pair.kind]);
    }
  });

  it("the stylesheet applies the pair's colours through the palette variables", () => {
    for (const pair of PAIRS) {
      const fg = FOREGROUND_USE[pair.id];
      expect(fg, `no stylesheet mapping for ${pair.id}`).toBeDefined();
      const [selector, property] = fg as [string, string];
      expect(usesVar(selector, property, pair.foreground), `${pair.id}: ${selector} ${property}`).toBe(true);
    }
    for (const [name, [selector, property]] of Object.entries(BACKGROUND_USE)) {
      expect(usesVar(selector, property, name as PaletteName), `${selector} ${property}`).toBe(true);
    }
  });

  it("every background named by a pair is a mapped background", () => {
    for (const pair of PAIRS) {
      if (pair.kind === "normal") expect(Object.keys(BACKGROUND_USE)).toContain(pair.background);
    }
  });
});

describe("focus, motion and isolation (Requirements 8.3, 8.6)", () => {
  it("has a :focus-visible outline in the focus colour", () => {
    expect(css).toContain(":focus-visible");
    expect(usesVar("a:focus-visible", "outline", "focus")).toBe(true);
  });

  it("has a prefers-reduced-motion block that disables animation and transition", () => {
    const m = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(cssNoComments.trim());
    expect(m).not.toBeNull();
    const block = (m as RegExpExecArray)[1] as string;
    expect(block).toMatch(/animation:\s*none/);
    expect(block).toMatch(/transition:\s*none/);
  });

  it("has no @import, url() or external reference", () => {
    expect(cssNoComments).not.toMatch(/@import/i);
    expect(cssNoComments).not.toMatch(/url\s*\(/i);
    expect(cssNoComments).not.toMatch(/https?:\/\/|\/\/[a-z0-9.-]+\./i);
    expect(cssNoComments).not.toMatch(/@font-face/i);
  });

  it("is dark only", () => {
    expect(cssNoComments).toMatch(/color-scheme:\s*dark\s*;/);
    expect(cssNoComments).not.toMatch(/color-scheme:[^;]*light/i);
    expect(cssNoComments).not.toMatch(/prefers-color-scheme/i);
  });
});

describe("layout landmarks (Requirement 8.3)", () => {
  it("has lang, a skip link to main, a nav and a main landmark", () => {
    expect(layout).toMatch(/<html\s+lang="en"/);
    expect(layout).toMatch(/<a\s+className="skip-link"\s+href="#main"/);
    expect(layout).toMatch(/<nav[\s>]/);
    expect(layout).toMatch(/<main\s+id="main"/);
  });

  it("the skip link is the first element of body", () => {
    const body = layout.slice(layout.indexOf("<body>") + "<body>".length);
    expect(body.trimStart().startsWith("<a ")).toBe(true);
  });

  it("has no 'use client' anywhere in src/app", () => {
    for (const file of sourceFiles(APP_DIR)) {
      if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["']use client["']/);
    }
  });
});
