// Requirements: 3.7, 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.9, 6.4, 6.9, 8.4, 8.5, 12.10, 12.11, 13.3
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EntryView } from "../../../src/ui/components/EntryView";
import { GH_MIN_VERSION } from "../../../src/pipeline/common/constants";
import { verifyCommands } from "../../../src/pipeline/undertaker/core/verifyCommands";
import { VERIFIED_LABEL_ALIVE, VERIFIED_LABEL_NOT_ALIVE } from "../../../src/ui/core/nightlyLabels";
import { runUrl } from "../../../src/ui/core/site";
import {
  ATTEMPTS_CAPTION,
  NIGHTLY_NO_ENTRY_RESULT,
  NIGHTLY_NONE,
  NOT_ATTESTED_SENTENCE,
  NOT_RECORDED,
  NO_ATTEMPTS_SENTENCE,
  SIGNATURE_MEANING_SENTENCE,
  SITE_NOT_VERIFIED_SENTENCE,
  STUB_SENTENCE,
  ghVersionSentence,
  nightlyReportRejected,
} from "../../../src/ui/core/texts";
import type { EntryView as EntryViewData, SiteView } from "../../../src/ui/core/viewModel";
import { createElement, headingLevels, html, makeFixtureSite, sectionOf, type FixtureSite } from "../helpers/siteView";
import { unescapeHtml } from "../helpers/unescapeHtml";

const DEFERRED = /exhume|lockfile|source diff|custom domain|light theme|vercel|in the browser|functions your code uses/i;
const ALL = [
  "alive-fixture",
  "restless-fixture",
  "inconclusive-fixture",
  "retired-fixture",
  "stub-fixture",
  "lodash.set",
] as const;

describe("Entry_Page markup over the Fixture_Graveyard", () => {
  let site: FixtureSite;
  let view: SiteView;
  const entry = (name: string, v: SiteView = view): EntryViewData => {
    const e = v.entries.find((x) => x.name === name);
    if (e === undefined) throw new Error(`no entry ${name}`);
    return e;
  };
  const page = (name: string, v: SiteView = view): string =>
    html(createElement(EntryView, { entry: entry(name, v), nightlyRun: v.nightlyRun }));
  const text = (name: string, v: SiteView = view): string => unescapeHtml(page(name, v));

  beforeAll(async () => {
    site = await makeFixtureSite();
    view = (await site.read("success")).view;
  });
  afterAll(async () => {
    await site.cleanup();
  });

  it("every page has one h1, headings that skip no level, and no Deferred text", () => {
    for (const name of ALL) {
      const markup = page(name);
      const levels = headingLevels(markup);
      expect(levels.filter((l) => l === 1), name).toHaveLength(1);
      expect(levels[0], name).toBe(1);
      levels.forEach((l, i) => {
        if (i > 0) expect(l, `${name} heading ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
      });
      expect(unescapeHtml(markup), name).not.toMatch(DEFERRED);
    }
  });

  it("alive entry: verify commands from verifyCommands, bundles present, signature meaning, gh version, site-not-verified", () => {
    const t = text("alive-fixture");
    const expected = verifyCommands({
      subjects: [{ name: "resurrection.tgz" }, { name: "proof-report.json" }, { name: "certificate.json" }],
      prefix: "graveyard/alive-fixture/",
    });
    expect(expected).toHaveLength(3);
    for (const c of expected) expect(t).toContain(c);
    expect(t).toContain(SIGNATURE_MEANING_SENTENCE);
    expect(t).toContain(ghVersionSentence(GH_MIN_VERSION));
    expect(t).toContain(SITE_NOT_VERIFIED_SENTENCE);
    for (const f of ["resurrection.tgz", "proof-report.json", "certificate.json"]) {
      expect(t).toContain(`${f}.sigstore.json: present`);
    }
    expect(t).toContain("npm run proof:run");
    expect(t).not.toContain(NOT_ATTESTED_SENTENCE);
    expect(t).toContain("Resurrection version (package.json in resurrection.tgz)");
    expect(t).toContain("1.0.1");
  });

  it("restless, inconclusive and not-resurrected entries: never success, no verification", () => {
    for (const name of ["restless-fixture", "inconclusive-fixture", "retired-fixture"] as const) {
      const markup = page(name);
      const t = unescapeHtml(markup);
      expect(markup, name).not.toContain("outcome-alive");
      expect(t, name).not.toContain("gh attestation verify");
      expect(t, name).not.toContain(SIGNATURE_MEANING_SENTENCE);
      expect(t, name).not.toContain(SITE_NOT_VERIFIED_SENTENCE);
      expect(t, name).not.toContain("Verification commands");
      const h1 = /<h1>[\s\S]*?<\/h1>/.exec(markup)?.[0] ?? "";
      expect(h1, name).not.toMatch(/alive|success/i);
      expect(h1, name).toContain(entry(name).outcomeLabel);
    }
    for (const name of ["restless-fixture", "inconclusive-fixture"] as const) {
      expect(text(name)).toContain(NOT_ATTESTED_SENTENCE);
    }
    const retired = text("retired-fixture");
    expect(retired).toContain("Not resurrected");
    expect(retired).toContain("Nothing was resurrected, proven or attested for this package.");
    expect(retired).not.toContain("Proof of Life");
  });

  it("restless entry lists problems before other proof detail", () => {
    const proof = sectionOf(page("restless-fixture"), "proof");
    const pos = (s: string): number => proof.indexOf(s);
    expect(pos("Divergences")).toBeGreaterThan(-1);
    expect(pos("Divergences")).toBeLessThan(pos("Functions tested"));
    expect(pos("Declared deltas not demonstrated")).toBeLessThan(pos("Functions tested"));
    expect(pos("Harness errors")).toBeLessThan(pos("Functions tested"));
  });

  it("stub label and sentence appear only for the stub entry", () => {
    const stub = page("stub-fixture");
    expect(/<h1>[\s\S]*?<\/h1>/.exec(stub)?.[0]).toContain("stub run");
    expect(unescapeHtml(stub)).toContain(STUB_SENTENCE);
    for (const name of ALL.filter((n) => n !== "stub-fixture")) {
      const markup = page(name);
      expect(markup, name).not.toContain("stub-run");
      expect(unescapeHtml(markup), name).not.toContain(STUB_SENTENCE);
    }
  });

  it("the two meanings of alive stay distinct: Package status is never styled or placed as an outcome", () => {
    const base = view.entries.find((e) => e.name === "restless-fixture");
    expect(base).toBeDefined();
    const altered: SiteView = {
      ...view,
      entries: view.entries.map((e) =>
        e.name === "restless-fixture" ? { ...e, certificate: { ...e.certificate, status: "alive" as never } } : e,
      ),
    };
    const markup = page("restless-fixture", altered);
    expect(markup).toContain('<span class="label package-status">Package status: alive</span>');
    expect(markup).not.toContain("outcome-alive");
    const h1 = /<h1>[\s\S]*?<\/h1>/.exec(markup)?.[0] ?? "";
    expect(h1).not.toMatch(/alive/);
    // On the alive entry the two labels carry different class families and different words.
    const alive = page("alive-fixture");
    expect(alive).toContain('class="label outcome outcome-alive">alive</span>');
    expect(alive).toContain('class="label package-status">Package status: dead</span>');
  });

  it("Attempts table: caption, header cells, one row per matching Ledger entry as typed; empty sentence otherwise", () => {
    const alive = page("alive-fixture");
    const section = sectionOf(alive, "attempts");
    expect(section).toContain(`<caption>${ATTEMPTS_CAPTION}</caption>`);
    expect(section.match(/<th scope="col">/g)).toHaveLength(6);
    const rows = section.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g);
    expect(rows).toHaveLength(2);
    expect(section).toContain("<td>not provided</td><td>not provided</td>");
    expect(section).toContain("<td>100.5</td><td>102</td>");

    const stub = sectionOf(page("stub-fixture"), "attempts");
    expect(stub).toContain(`<td>stub</td><td>4.0.0</td><td>${NOT_RECORDED}</td><td>${NOT_RECORDED}</td><td>${NOT_RECORDED}</td>`);

    const none = sectionOf(page("inconclusive-fixture"), "attempts");
    expect(none).toContain(NO_ATTEMPTS_SENTENCE);
    expect(none).not.toContain("<table>");
  });

  it("nightly section, accepted report: code, label and reason together; verified label depends on the Verdict", () => {
    const a = unescapeHtml(sectionOf(page("alive-fixture"), "nightly"));
    expect(a).toContain("Last nightly re-verification");
    expect(a).toContain(`<code>verified</code>: ${VERIFIED_LABEL_ALIVE}`);
    expect(a).toContain("reason: Replay identical and attestations verified.");
    expect(a).toContain(runUrl(1001));

    const r = unescapeHtml(sectionOf(page("restless-fixture"), "nightly"));
    expect(r).toContain(`<code>verified</code>: ${VERIFIED_LABEL_NOT_ALIVE}`);
    expect(r).toContain("reason: Replay identical; no attestation expected.");
    expect(r).not.toContain(VERIFIED_LABEL_ALIVE);
    expect(r).not.toMatch(/attested|attestations verified/);

    const i = unescapeHtml(sectionOf(page("inconclusive-fixture"), "nightly"));
    expect(i).toContain("<code>replay-mismatch</code>");
    expect(i).toContain("first difference at: $.verdict");

    const s = sectionOf(page("stub-fixture"), "nightly");
    expect(s).toContain('<a href="https://api.osv.dev/v1/query"');
    expect(unescapeHtml(s)).toContain("fetched 2026-01-07T03:00:00Z");
  });

  it("nightly section, other states: the sentence, never a result", async () => {
    const noLine = (await site.read("success")).view;
    const missing: SiteView = { ...noLine, entries: noLine.entries.map((e) => ({ ...e, nightly: { kind: "no-line" } })) };
    expect(unescapeHtml(sectionOf(page("alive-fixture", missing), "nightly"))).toContain(NIGHTLY_NO_ENTRY_RESULT);

    const rejected = (await site.read("malformed-report-success")).view;
    const run = rejected.nightlyRun;
    const rs = unescapeHtml(sectionOf(page("alive-fixture", rejected), "nightly"));
    expect(rs).toContain(nightlyReportRejected(runUrl(run?.runId ?? 0), "2026-01-07T03:17:42Z", "success"));
    expect(rs).not.toContain("<code>");

    const none = unescapeHtml(sectionOf(page("alive-fixture", (await site.read(null)).view), "nightly"));
    expect(none).toContain(NIGHTLY_NONE);
    expect(none).not.toContain("<code>");
  });
});
