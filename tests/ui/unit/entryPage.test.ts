// Requirements: 3.7, 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 4.10, 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.9, 6.4, 6.6, 6.9, 8.4, 8.5, 12.4, 12.10, 12.11, 13.1, 13.2, 13.3, 13.4, 13.6
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EntryView } from "../../../src/ui/components/EntryView";
import { GH_MIN_VERSION, REPO } from "../../../src/pipeline/common/constants";
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
    // R13.1, R13.3: the six column headers, the rows in the order of ledger.json, and the fixed note.
    expect([...section.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1])).toEqual([
      "date",
      "mode",
      "version",
      "exit code",
      "credit before",
      "credit after",
    ]);
    expect(section.indexOf("2026-01-03T10:00:00Z")).toBeGreaterThan(-1);
    expect(section.indexOf("2026-01-03T10:00:00Z")).toBeLessThan(section.indexOf("2026-01-04T10:00:00Z"));
    expect(section).toContain("credit meter readings as typed by the user (the meter shows credits used)");

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
    // R12.4: the run link is exactly https://github.com/<REPO>/actions/runs/<runId>.
    expect(a).toContain(`<a href="https://github.com/${REPO}/actions/runs/1001"`);

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

  /** Text of a markup fragment: inline tags removed, other tags become one space, entities unescaped. */
  const plain = (markup: string): string =>
    unescapeHtml(markup.replace(/<\/?(?:strong|code|a)\b[^>]*>/g, "").replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  const patched = (name: string, change: (e: EntryViewData) => EntryViewData): SiteView => ({
    ...view,
    entries: view.entries.map((e) => (e.name === name ? change(e) : e)),
  });
  const FETCHED = "2026-11-16T15:31:29Z";

  it("eligibility section: eligible, integrity comparison, every rule with its fields, in the order of the file (R4.5)", () => {
    const e = entry("retired-fixture");
    const rules = e.eligibility.rules.map((r, i) =>
      i === 1 ? { ...r, reason: "unverified" as const, missingField: "dependencies" } : r,
    );
    const v = patched("retired-fixture", (x) => ({ ...x, eligibility: { ...x.eligibility, rules } }));
    const t = plain(sectionOf(page("retired-fixture", v), "eligibility"));
    expect(t).toContain("Eligible no");
    expect(t).toContain(`expected ${e.eligibility.integrity.expected}`);
    expect(t).toContain(`computed ${e.eligibility.integrity.computed}`);
    expect(t).toContain("matches yes");
    let from = 0;
    for (const r of rules) {
      const reason = r.reason !== undefined ? `; reason ${r.reason}` : "";
      const missing = r.missingField !== undefined ? `; missing field ${r.missingField}` : "";
      const line = `${r.rule}: holds ${r.holds ? "yes" : "no"}; observed ${JSON.stringify(r.observed)}${reason}${missing}`;
      const at = t.indexOf(line, from);
      expect(at, line).toBeGreaterThanOrEqual(0);
      from = at + line.length;
    }
    expect(rules.map((r) => r.rule)).toEqual([
      "license",
      "dependencies",
      "module-type",
      "line-count",
      "status",
      "causes",
      "open-vulnerability",
    ]);
  });

  it("eligibility section: sources of each rule, 'first N of M sources' and 'no source was recorded' (R4.6)", () => {
    const e = entry("retired-fixture");
    const facts = e.eligibility.facts
      .filter((f) => f.key !== "rule.dependencies")
      .map((f) => (f.key === "rule.license" ? { ...f, provenanceTotal: 25 } : f));
    const v = patched("retired-fixture", (x) => ({ ...x, eligibility: { ...x.eligibility, facts } }));
    const t = plain(sectionOf(page("retired-fixture", v), "eligibility"));
    const rulesText = t.slice(t.indexOf("Rules "), t.indexOf("Failed rules"));
    const part = (from: string, to: string): string => rulesText.slice(rulesText.indexOf(`${from}: holds`), rulesText.indexOf(`${to}: holds`));

    const license = part("license", "dependencies");
    expect(license).toContain("first 1 of 25 sources");
    expect(license).toContain(`Source: https://registry.npmjs.org/inflight/-/inflight-1.0.6.tgz, fetched ${FETCHED}`);
    expect(part("dependencies", "module-type")).toContain("no source was recorded");

    const status = part("status", "causes");
    expect(status.match(/Source: /g)).toHaveLength(7);
    expect(status).toContain(`Source: https://registry.npmjs.org/lru-cache, fetched ${FETCHED}`);
    expect(status).not.toContain("sources");
  });

  it("not-resurrected page: heading, failed rules with observed values and sources, Successor, registry lookup and deprecation message (R4.7)", () => {
    const deprecation = "This package is deprecated. Use lru-cache instead.";
    const v = patched("retired-fixture", (x) => ({
      ...x,
      certificate: {
        ...x.certificate,
        facts: [
          ...x.certificate.facts,
          { key: "deprecation", value: deprecation, provenance: [{ sourceUrl: "https://registry.npmjs.org/inflight", fetchedAt: FETCHED }] },
        ],
      },
    }));
    const markup = page("retired-fixture", v);
    expect(plain(sectionOf(markup, "not-resurrected"))).toBe(
      "Not resurrected Nothing was resurrected, proven or attested for this package.",
    );

    const elig = plain(sectionOf(markup, "eligibility"));
    expect(elig).toContain("Failed rules dependencies, status, open-vulnerability");
    expect(elig).toContain("dependencies: holds no; observed 2");
    expect(elig).toContain('status: holds no; observed "retired-with-successor"');
    expect(elig).toContain("open-vulnerability: holds no; observed 0");
    expect(elig).toContain(`Source: https://registry.npmjs.org/inflight/-/inflight-1.0.6.tgz, fetched ${FETCHED}`);
    expect(elig).toContain("Successor lru-cache");

    const cert = plain(sectionOf(markup, "certificate"));
    expect(cert).toContain("Successor lru-cache");
    expect(cert).toContain('successorLookup:lru-cache { "result": "exists" }');
    expect(cert).toContain(`Source: https://registry.npmjs.org/lru-cache, fetched ${FETCHED}`);
    expect(cert).toContain(`deprecation "${deprecation}"`);
    expect(cert).toContain(`Source: https://registry.npmjs.org/inflight, fetched ${FETCHED}`);
  });

  it("a certificate value marked unavailable is shown as 'unavailable' with the file's reason, not as zero or empty (R4.9)", () => {
    const gone = {
      available: false as const,
      source: "npm" as const,
      attemptedUrl: "https://registry.npmjs.org/alive-fixture",
      attemptedAt: FETCHED,
      reason: "registry unreachable",
    };
    const v = patched("alive-fixture", (x) => ({
      ...x,
      certificate: {
        ...x.certificate,
        timeOfDeath: gone,
        vitalSigns: {
          ...x.certificate.vitalSigns,
          openVulnerabilities: { ...gone, source: "osv" as const, attemptedUrl: "https://api.osv.dev/v1/query" },
        },
      },
    }));
    const t = plain(sectionOf(page("alive-fixture", v), "certificate"));
    expect(t).toContain(
      `Time of death unavailable (reason: registry unreachable; attempted URL: https://registry.npmjs.org/alive-fixture; attempted at: ${FETCHED})`,
    );
    expect(t).toContain(
      `Open vulnerabilities unavailable (reason: registry unreachable; attempted URL: https://api.osv.dev/v1/query; attempted at: ${FETCHED})`,
    );
    expect(t).not.toContain("Open vulnerabilities none");
  });

  it("every Entry_Page links to the GitHub history of its files with a fixed label, and shows no pull request link (R4.10)", () => {
    for (const name of ALL) {
      const markup = unescapeHtml(page(name));
      const href = `https://github.com/${REPO}/commits/main/graveyard/${name}`;
      expect(markup, name).toContain(
        `<a href="${href}" rel="noopener noreferrer">History of this entry's files on GitHub</a>`,
      );
      expect(markup.match(/\/commits\//g), name).toHaveLength(1);
      expect(markup, name).not.toMatch(/\/pull\/|pull request/i);
    }
  });

  it("the Attempts section holds only the heading, the fixed texts, the headers and the ledger values: no computed figure, no 'produced by' statement (R13.4)", () => {
    for (const name of ["alive-fixture", "restless-fixture", "stub-fixture"] as const) {
      const rows = entry(name).attempts;
      expect(rows.length, name).toBeGreaterThan(0);
      const nodes = sectionOf(page(name), "attempts")
        .split(/<[^>]*>/)
        .map((s) => unescapeHtml(s).trim())
        .filter((s) => s !== "");
      expect(nodes, name).toEqual([
        "Attempts",
        "credit meter readings as typed by the user (the meter shows credits used)",
        ATTEMPTS_CAPTION,
        "date",
        "mode",
        "version",
        "exit code",
        "credit before",
        "credit after",
        ...rows.flatMap((r) => [r.date, r.mode, r.version, r.exitCode, r.creditBefore, r.creditAfter]),
      ]);
    }
  });
});
