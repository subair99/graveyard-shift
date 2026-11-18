// Requirements: 2.2
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  buildNightlyReport,
  NightlyReportSchema,
  renderNightlyReportJson,
  VERIFIED_REASON_NOT_ALIVE,
  type NightlyEntryInput,
  type NightlyReport,
} from "../../../src/pipeline/undertaker/core/nightlyReport";
import { buildStubMarker, StubMarkerSchema, type StubMarker } from "../../../src/pipeline/undertaker/core/layout";
import type { ToolVersions } from "../../../src/pipeline/undertaker/core/nightlyClassify";

const tools: ToolVersions = { node: "26.13.1", fastCheck: "4.0.0", reportSchema: 1 };
const identity = { pathValues: [], userName: undefined };

function entry(over: Partial<NightlyEntryInput>): NightlyEntryInput {
  return { package: "ip", results: ["verified"], stub: false, committedTools: tools, runningTools: tools, ...over };
}

const report = buildNightlyReport({
  entries: [
    entry({ package: "alive-one" }),
    entry({ package: "restless-one", reason: VERIFIED_REASON_NOT_ALIVE }),
    entry({
      package: "dead-one",
      results: ["not-resurrected"],
      committedTools: null,
      facts: [
        {
          text: "An advisory is listed.",
          sourceUrl: "https://api.osv.dev/v1/vulns/GHSA-0000-0000-0000",
          fetchedAt: "2026-11-17T10:00:00Z",
        },
      ],
    }),
  ],
  ghVersion: "gh version 2.67.0",
  identity,
  platform: "posix",
});

describe("StubMarkerSchema", () => {
  it("parses buildStubMarker() and rejects other shapes", () => {
    expect(StubMarkerSchema.parse(buildStubMarker())).toEqual(buildStubMarker());
    expect(StubMarkerSchema.safeParse({ ...buildStubMarker(), extra: 1 }).success).toBe(false);
    expect(StubMarkerSchema.safeParse({ ...buildStubMarker(), schemaVersion: 2 }).success).toBe(false);
  });
});

describe("NightlyReportSchema", () => {
  it("parses the written report for an alive, a restless and a not-resurrected entry", () => {
    const parsed = NightlyReportSchema.safeParse(JSON.parse(renderNightlyReportJson(report)));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(report);
  });

  it("is strict and rejects an unknown result and a bad fact", () => {
    const json = JSON.parse(renderNightlyReportJson(report)) as Record<string, unknown>;
    expect(NightlyReportSchema.safeParse({ ...json, extra: 1 }).success).toBe(false);
    const entries = json.entries as Record<string, unknown>[];
    const badResult = { ...json, entries: [{ ...entries[0], results: ["nope"] }] };
    expect(NightlyReportSchema.safeParse(badResult).success).toBe(false);
    const badFact = { ...json, entries: [{ ...entries[0], facts: [{ text: "x", sourceUrl: "nope", fetchedAt: "now" }] }] };
    expect(NightlyReportSchema.safeParse(badFact).success).toBe(false);
  });
});

// Type-level checks: each inferred type is assignable to the existing type and back.
// `results` is `string[]` in NightlyReportEntry, so the way back narrows it to the enum.
type InferredReport = z.infer<typeof NightlyReportSchema>;
type NarrowedReport = Omit<NightlyReport, "entries"> & {
  entries: (Omit<NightlyReport["entries"][number], "results"> & { results: InferredReport["entries"][number]["results"] })[];
};

describe("schema types", () => {
  it("match the existing types in both directions", () => {
    const stubForward = StubMarkerSchema.parse(buildStubMarker()) satisfies StubMarker;
    const stubBack: z.infer<typeof StubMarkerSchema> = buildStubMarker();
    const reportForward = NightlyReportSchema.parse(report) satisfies NightlyReport;
    const narrowed = report as NarrowedReport;
    const reportBack: InferredReport = narrowed;
    expect(stubForward).toEqual(stubBack);
    expect(reportForward).toEqual(reportBack);
  });
});
