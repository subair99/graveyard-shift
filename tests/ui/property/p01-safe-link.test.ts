// Requirements: 7.2, 7.3, 7.6
// Feature: crypt-ui, Property 1: Safe_Link renders an anchor exactly for absolute http(s) URLs
// This file tests safeHref and the SafeLink static markup.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeHref } from "../../../src/ui/core/safeHref";
import { SafeLink } from "../../../src/ui/components/SafeLink";
import { unescapeHtml } from "../helpers/unescapeHtml";

const NUM_RUNS = 100;

const validUrl = fc.oneof(
  fc.webUrl({ validSchemes: ["http", "https"] }),
  fc.webUrl({ validSchemes: ["http", "https"], withQueryParameters: true, withFragments: true }),
);

const mixedCase = (s: string, mask: boolean[]): string =>
  [...s].map((c, i) => (mask[i % mask.length] ? c.toUpperCase() : c)).join("");

// Mixed letter case applies to the scheme and the host (the part before the first "/" after "//").
const mixedCaseUrl = fc
  .tuple(validUrl, fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }))
  .map(([url, mask]) => {
    const authorityEnd = url.indexOf("/", url.indexOf("//") + 2);
    const head = authorityEnd === -1 ? url : url.slice(0, authorityEnd);
    const tail = authorityEnd === -1 ? "" : url.slice(authorityEnd);
    return mixedCase(head, mask) + tail;
  });

const badChar = fc.constantFrom(
  "\u0000", "\t", "\n", "\r", "\u000B", "\u000C", " ", "\u007F", "\u0001", "\u001F",
  "\u00A0", "\u2028", "\u2029", "\u3000", "\u2003",
);

/** A valid URL with at least one whitespace or control character inserted anywhere (padding, embedded). */
const urlWithBadChar = fc
  .tuple(validUrl, badChar, fc.nat())
  .map(([url, c, n]) => url.slice(0, n % (url.length + 1)) + c + url.slice(n % (url.length + 1)));

const otherSchemeUrl = fc.constantFrom(
      "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)",
      "file:///etc/passwd", "blob:https://example.com/uuid", "ftp://example.com/", "mailto:a@b.c",
      "javascript://example.com/%0aalert(1)", "%68ttp://example.com/", "%68ttps://example.com/",
      "http%3A//example.com/", "https%3A%2F%2Fexample.com", "//example.com/path", "example.com/path",
      "www.example.com", "/relative/path", "#fragment", "", "http:", "https:", "http://", "https://",
      "http:/example.com", "http:example.com", "httpx://example.com", "xhttp://example.com",
      "http://?q=1", "http://#x", "<a href=x>", "<script>alert(1)</script>",
);

const mixedInput = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.string({ unit: "grapheme" }),
  validUrl,
  mixedCaseUrl,
  urlWithBadChar,
  otherSchemeUrl,
  fc.tuple(fc.constantFrom(" ", "\t", "\n", "\u0000"), validUrl).map(([c, u]) => c + u),
  fc.tuple(validUrl, fc.constantFrom(" ", "\t", "\n", "\u007F")).map(([u, c]) => u + c),
);

const hasBadChar = (s: string): boolean => /[\u0000-\u0020\u007F\s]/u.test(s);

describe("Property 1 (safeHref half): anchors exactly for absolute http(s) URLs", () => {
  it("accepts valid http and https URLs, also in mixed letter case, and returns the string unchanged", () => {
    fc.assert(
      fc.property(fc.oneof(validUrl, mixedCaseUrl), (url) => {
        expect(safeHref(url)).toBe(url);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a URL with whitespace or a control character anywhere in it", () => {
    fc.assert(
      fc.property(urlWithBadChar, (value) => {
        expect(safeHref(value)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects other schemes, percent-encoded schemes, scheme-less and protocol-relative strings", () => {
    fc.assert(
      fc.property(otherSchemeUrl, (value) => {
        expect(safeHref(value)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("for any mixed input, a non-null result is the input itself, an absolute http(s) URL without whitespace or control characters", () => {
    fc.assert(
      fc.property(mixedInput, (value) => {
        const href = safeHref(value);
        if (href === null) return;
        expect(href).toBe(value);
        expect(value).toMatch(/^https?:\/\//i);
        expect(hasBadChar(value)).toBe(false);
        const url = new URL(value);
        expect(["http:", "https:"]).toContain(url.protocol);
        expect(url.hostname).not.toBe("");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("for any mixed input that is an absolute http(s) URL without bad characters and with a host, the result is the string", () => {
    fc.assert(
      fc.property(mixedInput, (value) => {
        let expected: string | null = null;
        if (!hasBadChar(value) && /^https?:\/\//i.test(value)) {
          try {
            const url = new URL(value);
            if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "") expected = value;
          } catch {
            expected = null;
          }
        }
        expect(safeHref(value)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("SafeLink markup has an anchor if and only if safeHref returns the string", () => {
    fc.assert(
      fc.property(mixedInput, (value) => {
        const markup = renderToStaticMarkup(createElement(SafeLink, { value }));
        if (safeHref(value) !== null) {
          const m = /^<a href="([^"]*)" rel="noopener noreferrer">([\s\S]*)<\/a>$/.exec(markup);
          expect(m).not.toBeNull();
          expect(unescapeHtml(m?.[1] ?? "")).toBe(value);
          expect(unescapeHtml(m?.[2] ?? "")).toBe(value);
          expect(markup).not.toContain("target=");
        } else {
          expect(markup).not.toContain("<a");
          expect(markup).not.toContain("<");
          expect(unescapeHtml(markup)).toBe(value);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("handles the named hostile examples", () => {
    for (const bad of [
      "javascript:alert(1)", " https://example.com", "https://example.com ", "https://exa\tmple.com",
      "https://example.com/\u0000", "https://example.com/\u007F", "//example.com", "example.com",
      "data:text/html,x", "vbscript:x", "file:///x", "blob:https://example.com/x", "%68ttps://example.com",
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
    expect(safeHref("HTTPS://Example.COM/Path?q=1#f")).toBe("HTTPS://Example.COM/Path?q=1#f");
  });
});
