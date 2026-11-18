// Requirements: 7.1, 7.5
// Feature: crypt-ui, Property 2: File_Text renders as inert text
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonText } from "../../../src/ui/components/JsonText";
import { unescapeHtml } from "../helpers/unescapeHtml";

const NUM_RUNS = 100;

const hostile = fc.constantFrom(
  "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "\"><b>", "'><i>", "&lt;b&gt;", "&amp;",
  "</code></pre>", "</td>", "javascript:alert(1)", "<!--", "-->", "<![CDATA[x]]>", "&#60;",
);

const fileText = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.string({ unit: "grapheme" }),
  hostile,
  fc.tuple(fc.string(), hostile, fc.string()).map(([a, b, c]) => a + b + c),
);

/** Markup between the fixed wrapper tags of a component; fails when the wrapper is not there. */
const inner = (markup: string, open: string, close: string): string => {
  expect(markup.startsWith(open)).toBe(true);
  expect(markup.endsWith(close)).toBe(true);
  return markup.slice(open.length, markup.length - close.length);
};

describe("Property 2: File_Text renders as inert text", () => {
  it("a text node has no < or > from the string and unescapes to the string", () => {
    fc.assert(
      fc.property(fileText, (s) => {
        const text = inner(renderToStaticMarkup(createElement("p", null, s)), "<p>", "</p>");
        expect(text).not.toMatch(/[<>]/);
        expect(unescapeHtml(text)).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a table cell has no < or > from the string and unescapes to the string", () => {
    fc.assert(
      fc.property(fileText, (s) => {
        const markup = renderToStaticMarkup(
          createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement("td", null, s)))),
        );
        const text = inner(markup, "<table><tbody><tr><td>", "</td></tr></tbody></table>");
        expect(text).not.toMatch(/[<>]/);
        expect(unescapeHtml(text)).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a JsonText block of a string has no < or > from the string and unescapes to its JSON text", () => {
    fc.assert(
      fc.property(fileText, (s) => {
        const text = inner(renderToStaticMarkup(createElement(JsonText, { value: s })), "<pre><code>", "</code></pre>");
        expect(text).not.toMatch(/[<>]/);
        expect(unescapeHtml(text)).toBe(JSON.stringify(s, null, 2));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a JsonText block of an object with the string as key and value is inert", () => {
    fc.assert(
      fc.property(fileText, fileText, (k, v) => {
        const value = { [k]: [v, { nested: v }] };
        const text = inner(renderToStaticMarkup(createElement(JsonText, { value })), "<pre><code>", "</code></pre>");
        expect(text).not.toMatch(/[<>]/);
        expect(unescapeHtml(text)).toBe(JSON.stringify(value, null, 2));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
