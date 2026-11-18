// Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.10, 6.4, 6.9, 8.4, 8.5, 12.10, 12.11
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CryptIndexView } from "../../../src/ui/components/CryptIndexView";
import { HomeView } from "../../../src/ui/components/HomeView";
import { runUrl } from "../../../src/ui/core/site";
import {
  ATTESTATION_SENTENCE,
  LLM_SENTENCE,
  NEVER_HIDDEN_SENTENCE,
  NIGHTLY_NONE,
  OUTCOME_DEFINITIONS,
  ROLES,
  STUB_EXPLANATION,
  nightlyNoReport,
  nightlyReportRejected,
} from "../../../src/ui/core/texts";
import type { SiteView } from "../../../src/ui/core/viewModel";
import { createElement, headingLevels, html, makeFixtureSite, type FixtureSite } from "../helpers/siteView";
import { unescapeHtml } from "../helpers/unescapeHtml";

const DEFERRED = /exhume|lockfile|source diff|custom domain|light theme|vercel|in the browser|functions your code uses/i;

describe("home and Crypt_Index markup over the Fixture_Graveyard", () => {
  let site: FixtureSite;
  let view: SiteView;
  const index = (v: SiteView): string => html(createElement(CryptIndexView, { view: v }));
  const text = (markup: string): string => unescapeHtml(markup);

  beforeAll(async () => {
    site = await makeFixtureSite();
    view = (await site.read("success")).view;
  });
  afterAll(async () => {
    await site.cleanup();
  });

  it("home page: roles, LLM sentence, four outcome definitions, reading rules, heading structure, no Deferred text", () => {
    const markup = html(createElement(HomeView));
    const t = text(markup);
    for (const r of ROLES) expect(t).toContain(r.name);
    for (const s of [LLM_SENTENCE, ATTESTATION_SENTENCE, NEVER_HIDDEN_SENTENCE, STUB_EXPLANATION]) expect(t).toContain(s);
    for (const d of Object.values(OUTCOME_DEFINITIONS)) expect(t).toContain(d);
    const levels = headingLevels(markup);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels).toEqual([1, 2, 2, 2]);
    expect(t).not.toMatch(DEFERRED);
  });

  it("index: caption, th cells, one row per entry in order, outcome and stub labels", () => {
    const markup = index(view);
    expect(markup).toContain("<caption>Graveyard entries</caption>");
    expect(markup).toContain('<th scope="col">');
    expect(markup).toContain('<th scope="col">Analysed</th>');
    expect(markup).not.toContain('<th scope="col">analysed</th>');
    expect(markup.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(view.entries.length);
    expect(headingLevels(markup)).toEqual([1]);
    expect(text(markup)).not.toMatch(DEFERRED);
    // Exactly the stub entry carries the stub label.
    expect(markup.match(/class="label stub-run"/g)).toHaveLength(1);
    const rowOf = (name: string): string => {
      const m = new RegExp(`<tr><th scope="row"><a [^>]*>${name.replace(".", "\\.")}</a></th>[\\s\\S]*?</tr>`).exec(markup);
      if (m === null) throw new Error(`no row ${name}`);
      return m[0];
    };
    expect(rowOf("alive-fixture")).toContain("outcome-alive");
    expect(rowOf("restless-fixture")).toContain("outcome-restless");
    expect(rowOf("inconclusive-fixture")).toContain("outcome-inconclusive");
    expect(rowOf("retired-fixture")).toContain("outcome-not-resurrected");
    expect(rowOf("retired-fixture")).toContain("not resurrected");
    expect(rowOf("retired-fixture")).toContain("Successor: lru-cache");
    expect(rowOf("stub-fixture")).toContain("stub run");
    expect(rowOf("restless-fixture")).not.toContain("outcome-alive");
    expect(rowOf("restless-fixture")).not.toContain("stub run");
  });

  it("nightly line, state results: run link, start time, conclusion and the commit note", () => {
    const t = text(index(view));
    const run = view.nightlyRun;
    expect(run?.state).toBe("results");
    expect(t).toContain(runUrl(1001));
    expect(t).toContain("run started 2026-01-07T03:17:42Z");
    expect(t).toContain("run conclusion success");
    expect(t).toContain("this site was built from commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("nightly line, state ended without report (documented and undocumented conclusions)", async () => {
    for (const [name, id, conclusion] of [
      ["failure-no-report", 1002, "failure"],
      ["undocumented-conclusion", 1003, "startup_failure"],
    ] as const) {
      const t = text(index((await site.read(name)).view));
      expect(t).toContain(nightlyNoReport(runUrl(id), "2026-01-07T03:17:42Z", conclusion));
      expect(t).not.toContain(NIGHTLY_NONE);
    }
  });

  it("nightly line, state report rejected: the sentence does not depend on the conclusion", async () => {
    for (const [name, id, conclusion] of [
      ["malformed-report-failure", 1005, "failure"],
      ["malformed-report-success", null, "success"],
    ] as const) {
      const read = await site.read(name);
      const run = read.view.nightlyRun;
      expect(run?.state).toBe("report-rejected");
      const t = text(index(read.view));
      expect(t).toContain(nightlyReportRejected(runUrl(run?.runId ?? id ?? 0), "2026-01-07T03:17:42Z", conclusion));
      expect(t).toContain("its report did not pass validation");
      expect(t).not.toContain(NIGHTLY_NONE);
    }
  });

  it("nightly line, no nightly input: the fixed sentence only", async () => {
    const t = text(index((await site.read(null)).view));
    expect(t).toContain(NIGHTLY_NONE);
    expect(t).not.toContain("run conclusion");
  });
});
