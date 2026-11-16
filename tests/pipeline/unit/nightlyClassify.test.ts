// Requirements: 16.3, 16.4, 16.5, 16.7, 16.8, 16.9, 16.11, 16.12, 16.13, 16.16, 16.18, 16.22, 16.23
import { describe, expect, it } from "vitest";
import {
  classifyEntry,
  differingToolFields,
  nightlyOrder,
  type NightlyInput,
  type ToolVersions,
} from "../../../src/pipeline/undertaker/core/nightlyClassify";

const TOOLS: ToolVersions = { node: "26.13.1", fastCheck: "4.0.0", reportSchema: 1 };

function input(over: Partial<NightlyInput> = {}): NightlyInput {
  return {
    kind: "resurrection",
    stub: false,
    verdict: "alive",
    committedTools: TOOLS,
    runningTools: TOOLS,
    replay: { status: "identical" },
    bundlesPresent: true,
    attestations: ["ok", "ok", "ok"],
    newAdvisoryIds: [],
    ...over,
  };
}

describe("classifyEntry, resurrection", () => {
  it("verified when everything matches", () => {
    expect(classifyEntry(input())).toEqual({ results: ["verified"], fails: false });
  });

  it("tool-versions-changed is primary, does not fail, and hides nothing else", () => {
    const r = classifyEntry(
      input({
        runningTools: { ...TOOLS, node: "26.14.0" },
        replay: { status: "different" },
        attestations: ["ok", "failed", "ok"],
        newAdvisoryIds: ["GHSA-x"],
      }),
    );
    expect(r.results).toEqual(["tool-versions-changed", "attestation-failed", "new-advisory"]);
    expect(r.fails).toBe(true);
  });

  it("tool-versions-changed alone does not fail", () => {
    expect(classifyEntry(input({ runningTools: { ...TOOLS, fastCheck: "4.1.0" }, replay: { status: "not-run" } }))).toEqual({
      results: ["tool-versions-changed"],
      fails: false,
    });
  });

  it("a missing committed record counts as differing", () => {
    expect(classifyEntry(input({ committedTools: null })).results[0]).toBe("tool-versions-changed");
    expect(differingToolFields(null, TOOLS)).toEqual(["node", "fastCheck", "reportSchema"]);
    expect(differingToolFields(TOOLS, { ...TOOLS, node: "x" })).toEqual(["node"]);
  });

  it("replay different is replay-mismatch and fails", () => {
    expect(classifyEntry(input({ replay: { status: "different", firstDiffPath: "$.seed" } }))).toEqual({
      results: ["replay-mismatch"],
      fails: true,
    });
  });

  it("replay fetch-failed is not-checked and does not fail", () => {
    expect(classifyEntry(input({ replay: { status: "fetch-failed", reason: "digest" } }))).toEqual({
      results: ["not-checked"],
      fails: false,
    });
  });

  it("alive: failed, short, or not-applicable attestations give attestation-failed", () => {
    for (const attestations of [["ok", "ok", "failed"], ["ok", "ok"], [], "not-applicable"] as const) {
      expect(classifyEntry(input({ attestations })).results).toEqual(["attestation-failed"]);
    }
  });

  it("alive: exactly three results are required; four, two or zero give attestation-failed (R16.9)", () => {
    // Counterexample of Property 28 in CI (seed 1719806211, path "206:0:0:0:8:8:8").
    const fourResults = classifyEntry({
      kind: "resurrection",
      stub: false,
      verdict: "alive",
      committedTools: null,
      runningTools: { node: "26.0.0", fastCheck: "4.1.0", reportSchema: 1 },
      replay: { status: "identical" },
      bundlesPresent: false,
      attestations: ["ok", "ok", "ok", "ok"],
      newAdvisoryIds: [],
    });
    expect(fourResults.results).toEqual(["tool-versions-changed", "attestation-failed"]);
    expect(fourResults.fails).toBe(true);

    for (const attestations of [["ok", "ok"], []] as const) {
      expect(classifyEntry(input({ attestations }))).toEqual({ results: ["attestation-failed"], fails: true });
    }
  });

  it("restless or inconclusive with a bundle gives unexpected-attestation; without one it is verified", () => {
    for (const verdict of ["restless", "inconclusive"] as const) {
      expect(classifyEntry(input({ verdict, attestations: "not-applicable" }))).toEqual({
        results: ["unexpected-attestation"],
        fails: true,
      });
      expect(classifyEntry(input({ verdict, bundlesPresent: false, attestations: "not-applicable" })).results).toEqual([
        "verified",
      ]);
    }
  });

  it("new-advisory does not fail and follows the fixed order", () => {
    expect(classifyEntry(input({ newAdvisoryIds: ["A"] }))).toEqual({ results: ["new-advisory"], fails: false });
    const r = classifyEntry(
      input({ replay: { status: "different" }, attestations: ["failed", "ok", "ok"], newAdvisoryIds: ["A"] }),
    );
    expect(r.results).toEqual(["attestation-failed", "replay-mismatch", "new-advisory"]);
  });

  it("stub flag does not change the classification", () => {
    expect(classifyEntry(input({ stub: true }))).toEqual(classifyEntry(input({ stub: false })));
  });
});

describe("classifyEntry, not-resurrected", () => {
  const base = (over: Partial<NightlyInput> = {}) =>
    input({
      kind: "not-resurrected",
      verdict: null,
      committedTools: null,
      replay: { status: "not-run" },
      bundlesPresent: false,
      attestations: "not-applicable",
      ...over,
    });

  it("not-resurrected only when nothing else applies", () => {
    expect(classifyEntry(base())).toEqual({ results: ["not-resurrected"], fails: false });
  });

  it("a bundle gives unexpected-attestation and fails", () => {
    expect(classifyEntry(base({ bundlesPresent: true }))).toEqual({ results: ["unexpected-attestation"], fails: true });
  });

  it("new advisories give new-advisory, together with unexpected-attestation in order", () => {
    expect(classifyEntry(base({ newAdvisoryIds: ["A"] }))).toEqual({ results: ["new-advisory"], fails: false });
    expect(classifyEntry(base({ newAdvisoryIds: ["A"], bundlesPresent: true })).results).toEqual([
      "unexpected-attestation",
      "new-advisory",
    ]);
  });

  it("never attestation-failed, replay-mismatch, tool-versions-changed or not-checked", () => {
    const r = classifyEntry(
      base({ replay: { status: "different" }, runningTools: { ...TOOLS, node: "0" }, attestations: ["failed"] }),
    );
    expect(r.results).toEqual(["not-resurrected"]);
  });
});

describe("nightlyOrder", () => {
  it("sorts by code point, not locale", () => {
    expect(nightlyOrder(["b", "B", "a", "_x", "-y", "ab", "a"])).toEqual(["-y", "B", "_x", "a", "a", "ab", "b"]);
  });

  it("does not modify its input", () => {
    const names = ["b", "a"];
    nightlyOrder(names);
    expect(names).toEqual(["b", "a"]);
  });
});
