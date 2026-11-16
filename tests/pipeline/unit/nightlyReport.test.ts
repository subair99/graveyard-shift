// Requirements: 16.10, 16.14, 16.15, 23.14
import { describe, expect, it } from "vitest";
import { GH_MIN_VERSION, REPO } from "../../../src/pipeline/common/constants";
import { redactionScanFindsAnything } from "../../../src/pipeline/common/canonical";
import { differingToolFields, type ToolVersions } from "../../../src/pipeline/undertaker/core/nightlyClassify";
import {
  allNotChecked,
  renderNightlyCountLines,
  escapeWorkflowCommandData,
  NO_ENTRIES_TEXT,
  renderNoEntriesNotice,
  renderNotCheckedWarning,
  buildNightlyReport,
  renderNightlyReportJson,
  renderNightlySummary,
  type NightlyEntryInput,
} from "../../../src/pipeline/undertaker/core/nightlyReport";

const identity = { pathValues: [], userName: undefined };
const tools: ToolVersions = { node: "26.13.1", fastCheck: "4.0.0", reportSchema: 1 };

function entry(over: Partial<NightlyEntryInput>): NightlyEntryInput {
  return {
    package: "lodash.set",
    results: ["verified"],
    stub: false,
    committedTools: tools,
    runningTools: tools,
    ...over,
  };
}

function build(entries: NightlyEntryInput[], ghVersion: string | null = "gh version 2.67.0") {
  return buildNightlyReport({ entries, ghVersion, identity, platform: "posix" });
}

describe("nightlyReport", () => {
  it("writes one line per package in code point order with results, reason and both Tool_Versions", () => {
    const report = build([entry({ package: "ip" }), entry({ package: "Zed" }), entry({ package: "lodash.set" })]);
    expect(report.entries.map((e) => e.package)).toEqual(["Zed", "ip", "lodash.set"]);
    const lines = renderNightlySummary(report)
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("ip: verified");
    expect(lines[1]).toContain("reason: Replay identical and attestations verified.");
    expect(lines[1]).toContain("committed Tool_Versions: node 26.13.1, fast-check 4.0.0, report schema 1");
    expect(lines[1]).toContain("running Tool_Versions: node 26.13.1, fast-check 4.0.0, report schema 1");
    expect(lines[1]).not.toContain("stub run");
  });

  it("marks a stub run and shows the gh version and the minimum", () => {
    const text = renderNightlySummary(build([entry({ stub: true })]));
    expect(text).toContain("stub run");
    expect(text).toContain(`gh version: gh version 2.67.0 (minimum ${GH_MIN_VERSION})`);
    expect(renderNightlySummary(build([], null))).toContain("gh version: unknown");
  });

  it("shows differing Tool_Versions and the first differing path of a mismatch", () => {
    const running = { ...tools, node: "26.14.0" };
    const report = build([
      entry({ results: ["tool-versions-changed"], runningTools: running }),
      entry({ package: "ip", results: ["replay-mismatch"], firstDiffPath: "$.divergences[0].function" }),
    ]);
    expect(report.entries[1]?.differingToolFields).toEqual(["node"]);
    expect(report.entries[0]?.firstDiffPath).toBe("$.divergences[0].function");
    const text = renderNightlySummary(report);
    expect(text).toContain("running Tool_Versions: node 26.14.0");
    expect(text).toContain("first differing path: $.divergences[0].function");
  });

  it("lists no differing Tool_Versions field when there is no committed record (nothing to compare)", () => {
    const report = build([entry({ package: "inflight", results: ["not-resurrected"], committedTools: null })]);
    expect(report.entries[0]?.differingToolFields).toEqual([]);
    expect(renderNightlySummary(report)).toContain("committed Tool_Versions: none recorded");
    // Classification is unchanged: the exported helper still counts a missing record as differing in every field.
    expect(differingToolFields(null, tools)).toEqual(["node", "fastCheck", "reportSchema"]);
  });

  it("renders the count lines shared by the summary and the log", () => {
    expect(renderNightlyCountLines(build([entry({ results: ["not-resurrected"] })]))).toEqual(["Entries: 1 total, 0 not-checked."]);
    expect(renderNightlyCountLines(build([entry({ results: ["not-checked"] })]))).toEqual([
      "Entries: 1 total, 1 not-checked.",
      "All 1 entries not-checked: nothing was verified tonight.",
    ]);
  });

  it("carries Source_URL and Fetch_Date of a fact in the JSON and the line", () => {
    const fact = { text: "GHSA-xxxx-yyyy-zzzz is new", sourceUrl: "https://api.osv.dev/v1/vulns/GHSA-xxxx-yyyy-zzzz", fetchedAt: "2026-11-20" };
    const report = build([entry({ results: ["new-advisory"], facts: [fact] })]);
    expect(report.entries[0]?.facts).toEqual([fact]);
    expect(renderNightlySummary(report)).toContain(`(source: ${fact.sourceUrl}, fetched 2026-11-20)`);
  });

  it("writes canonical JSON with the repository and a final newline, and is deterministic", () => {
    const report = build([entry({})]);
    const json = renderNightlyReportJson(report);
    expect(json.endsWith("\n")).toBe(true);
    expect(json).toBe(renderNightlyReportJson(build([entry({})])));
    const parsed = JSON.parse(json) as { repo: string; ghMinVersion: string };
    expect(parsed.repo).toBe(REPO);
    expect(parsed.ghMinVersion).toBe(GH_MIN_VERSION);
  });

  it("counts total, checkable and not-checked entries, in the JSON after ghMinVersion and before entries", () => {
    const report = build([
      entry({ package: "a", results: ["not-checked"] }),
      entry({ package: "b", results: ["verified"] }),
      entry({ package: "c", results: ["not-resurrected"] }),
      entry({ package: "d", results: ["new-advisory", "not-checked"] }),
    ]);
    expect(report.counts).toEqual({ total: 4, checkable: 3, notChecked: 2 });
    expect(Object.keys(report)).toEqual(["repo", "ghVersion", "ghMinVersion", "counts", "entries"]);
    expect(Object.keys(report.counts)).toEqual(["total", "checkable", "notChecked"]);
    const summary = renderNightlySummary(report);
    expect(summary).toContain("Entries: 4 total, 2 not-checked.");
    expect(summary).not.toContain("nothing was verified tonight");
    expect(renderNightlyReportJson(report)).toContain('"counts":{"total":4,"checkable":3,"notChecked":2}');
  });

  it("says nothing was verified when every checkable entry is not-checked", () => {
    const report = build([
      entry({ package: "a", results: ["not-checked"] }),
      entry({ package: "b", results: ["tool-versions-changed", "not-checked"] }),
      entry({ package: "c", results: ["not-resurrected"] }),
    ]);
    expect(allNotChecked(report.counts)).toBe(true);
    expect(renderNightlySummary(report)).toContain("All 2 entries not-checked: nothing was verified tonight.");
  });

  it("does not say it for an empty graveyard or when only not-resurrected entries exist", () => {
    for (const report of [build([]), build([entry({ results: ["not-resurrected"] })])]) {
      expect(allNotChecked(report.counts)).toBe(false);
      expect(renderNightlySummary(report)).not.toContain("nothing was verified tonight");
    }
  });

  it("says there is nothing to verify for an empty graveyard and renders a redacted ::notice::", () => {
    expect(renderNightlySummary(build([]))).toContain(NO_ENTRIES_TEXT);
    expect(renderNoEntriesNotice({ pathValues: [], userName: undefined }, "posix")).toBe(
      "::notice::No entries in the graveyard: nothing to verify.",
    );
  });

  it("escapes %, CR and LF of workflow command data and nothing else", () => {
    expect(escapeWorkflowCommandData("100% a\r\nb\nc")).toBe("100%25 a%0D%0Ab%0Ac");
    expect(escapeWorkflowCommandData("a:b,c")).toBe("a:b,c");
    expect(escapeWorkflowCommandData("%0A")).toBe("%250A");
  });

  it("renders a redacted, escaped warning naming package, path and reason", () => {
    const id = { pathValues: [], userName: "Alice Smith" };
    const line = renderNotCheckedWarning("ip", "graveyard/ip", "Coroner failed for Alice Smith\n50% at /home/alice/x", id, "posix");
    expect(line.startsWith("::warning::ip not-checked (graveyard/ip): ")).toBe(true);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("Alice Smith");
    expect(line).not.toContain("/home/alice");
    expect(line).toContain("%0A50%25");
  });

  it("redacts identity values, credentials and absolute paths in JSON and summary", () => {
    const id = { pathValues: [], userName: "Alice Smith" };
    const report = buildNightlyReport({
      entries: [
        entry({
          reason: "failed for Alice Smith with Bearer abc123 at /home/alice/work/x and ghp_abcdefghijklmnopqrstuvwxyz0123456789",
          firstDiffPath: "C:\\Users\\Alice\\x",
        }),
      ],
      ghVersion: "gh version 2.67.0",
      identity: id,
      platform: "posix",
    });
    for (const text of [renderNightlyReportJson(report), renderNightlySummary(report)]) {
      expect(redactionScanFindsAnything(text, id, "posix")).toBe(false);
      expect(text).not.toContain("Alice Smith");
      expect(text).not.toContain("ghp_");
    }
  });
});
