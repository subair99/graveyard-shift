// Requirements: 13.12, 14.5, 14.9, 14.14, 15.2, 15.3, 15.4, 15.5, 15.9, 15.10, 15.11, 15.12, 18.1, 18.5, 23.12
import { describe, expect, it } from "vitest";
import {
  ATTESTATION_SCOPE_SENTENCE,
  EXISTING_CI_SENTENCE,
  NOT_ATTESTED_SENTENCE,
  NOT_RESURRECTED_SENTENCE,
  renderPrBody,
  renderPrTitle,
  type NotResurrectedPrInput,
  type PrReport,
  type ResurrectionPrInput,
} from "../../../src/pipeline/undertaker/core/prText";

const RUN = "https://github.com/subair99/graveyard-shift/actions/runs/123";
const identity = { pathValues: [], userName: undefined };

const report: PrReport = {
  seed: 42,
  toolVersions: { node: "26.13.1", fastCheck: "4.0.0", reportSchema: 1 },
  casesPerFunction: [{ function: "set", cases: 200 }],
  deltas: [
    { id: "pollution", function: "set", status: "demonstrated", predicateCasesChecked: 5, demonstration: null },
  ],
  divergences: [],
  harnessErrors: [],
};

const base: ResurrectionPrInput = {
  kind: "resurrection",
  package: "lodash.set",
  version: "4.3.3",
  verdict: "alive",
  report,
  branchCommit: "a".repeat(40),
  subjects: ["lodash.set-4.3.3.tgz", "proof-report.json", "certificate.json"],
  subjectPrefix: "graveyard/lodash.set/",
  runUrl: RUN,
  stub: false,
  identity,
  platform: "posix",
};

describe("renderPrText", () => {
  it("alive: title, fields, three verify commands, checks, D3 and A12", () => {
    expect(renderPrTitle(base)).toBe("lodash.set 4.3.3: alive");
    const body = renderPrBody(base);
    for (const s of ["Verdict: alive", "Seed: 42", "node 26.13.1", "a".repeat(40), RUN, "- set: 200", "- pollution (set): demonstrated"]) {
      expect(body).toContain(s);
    }
    expect(body.match(/gh attestation verify /g)).toHaveLength(3);
    expect(body).toContain("- typecheck: passed");
    expect(body).toContain("- lint: passed");
    expect(body).toContain("- full test suite: passed");
    expect(body).toContain(EXISTING_CI_SENTENCE);
    expect(body).toContain(ATTESTATION_SCOPE_SENTENCE);
    expect(body).not.toContain(NOT_ATTESTED_SENTENCE);
    expect(body.startsWith("stub run")).toBe(false);
  });

  it("restless: not attested, lists divergence, undemonstrated delta and harness error, no commands", () => {
    const i: ResurrectionPrInput = {
      ...base,
      verdict: "restless",
      report: {
        ...report,
        deltas: [{ id: "d1", function: "set", status: "not-demonstrated", predicateCasesChecked: 0, demonstration: null }],
        divergences: [
          {
            function: "set",
            kind: "unexplained",
            args: [],
            replay: { phase: "explicit", index: 0 },
            differences: [{ part: "value", path: "$.a" }],
            original: { kind: "timeout" } as never,
            resurrection: { kind: "timeout" } as never,
            shrink: { attempts: 0, budgetExhausted: false },
            redactionMaskedDifference: false,
          },
        ],
        harnessErrors: [{ kind: "property-error", function: "set", message: "boom" }],
      },
    };
    expect(renderPrTitle(i)).toBe("lodash.set 4.3.3: restless");
    const body = renderPrBody(i);
    expect(body).toContain(NOT_ATTESTED_SENTENCE);
    expect(body).toContain("Divergence in set: unexplained (value at $.a)");
    expect(body).toContain("Delta d1 (set) was not demonstrated");
    expect(body).toContain("Harness error property-error in set: boom");
    expect(body).not.toContain("gh attestation verify");
    expect(body).toContain(EXISTING_CI_SENTENCE);
  });

  it("inconclusive: not attested", () => {
    const i: ResurrectionPrInput = { ...base, verdict: "inconclusive" };
    expect(renderPrTitle(i)).toBe("lodash.set 4.3.3: inconclusive");
    const body = renderPrBody(i);
    expect(body).toContain(NOT_ATTESTED_SENTENCE);
    expect(body).not.toContain("gh attestation verify");
  });

  it("not-resurrected: failed rules with source and date, run link, nothing attested", () => {
    const i: NotResurrectedPrInput = {
      kind: "not-resurrected",
      package: "left-pad",
      version: "1.3.0",
      failedRules: [
        {
          rule: "license",
          observed: "GPL-3.0",
          sources: [{ sourceUrl: "https://registry.npmjs.org/left-pad", fetchedAt: "2026-11-15T10:00:00Z" }],
        },
      ],
      runUrl: RUN,
      stub: false,
      identity,
      platform: "posix",
    };
    expect(renderPrTitle(i)).toBe("left-pad 1.3.0: not resurrected");
    const body = renderPrBody(i);
    expect(body).toContain("- license: observed GPL-3.0 (source: https://registry.npmjs.org/left-pad, fetched 2026-11-15T10:00:00Z)");
    expect(body).toContain(RUN);
    expect(body).toContain(NOT_RESURRECTED_SENTENCE);
    expect(body).toContain(EXISTING_CI_SENTENCE);
    expect(body).not.toContain("Verdict:");
  });

  it("not-resurrected: every source of a rule, an unverified rule and a rule with no source", () => {
    const i: NotResurrectedPrInput = {
      kind: "not-resurrected",
      package: "ip",
      version: "2.0.1",
      failedRules: [
        {
          rule: "status",
          observed: "alive",
          sources: [
            { sourceUrl: "https://api.github.com/repos/indutny/node-ip", fetchedAt: "2026-11-15T19:03:19Z" },
            { sourceUrl: "https://registry.npmjs.org/ip?t=ghp_abc123", fetchedAt: "2026-11-15T19:03:20Z" },
          ],
        },
        { rule: "open-vulnerability", observed: null, missingField: "openVulnerabilities", sources: [] },
        { rule: "causes", observed: 0, sources: [] },
      ],
      runUrl: RUN,
      stub: false,
      identity,
      platform: "posix",
    };
    const body = renderPrBody(i);
    expect(body).toContain(
      "- status: observed alive (source: https://api.github.com/repos/indutny/node-ip, fetched 2026-11-15T19:03:19Z; source: https://registry.npmjs.org/ip?t=",
    );
    expect(body).toContain("fetched 2026-11-15T19:03:20Z)");
    expect(body).not.toContain("ghp_abc123");
    expect(body).toContain(
      "- open-vulnerability: unverified, field openVulnerabilities could not be read (source: none recorded)",
    );
    expect(body).not.toContain("open-vulnerability: observed");
    expect(body).toContain("- causes: observed 0 (source: none recorded)");
  });

  it("stub: title ends with stub run and the first body line says so", () => {
    const i: ResurrectionPrInput = { ...base, stub: true };
    expect(renderPrTitle(i)).toBe("lodash.set 4.3.3: alive (stub run)");
    expect(renderPrTitle(i).endsWith("stub run)")).toBe(true);
    const first = renderPrBody(i).split("\n")[0]!;
    expect(first).toContain("stub run");
    expect(first).toContain("committed fixture");
    expect(first).toContain("not by the Medium");
  });

  it("redacts credentials, absolute paths and identity values", () => {
    const i: ResurrectionPrInput = {
      ...base,
      verdict: "restless",
      identity: { pathValues: [], userName: "zeldaquux" },
      report: {
        ...report,
        harnessErrors: [{ kind: "property-error", message: "ghp_abc123 at C:\\Users\\zeldaquux\\x and /home/bob/y" }],
      },
    };
    const body = renderPrBody(i);
    expect(body).not.toMatch(/ghp_|zeldaquux|C:\\|\/home\//);
  });
});
