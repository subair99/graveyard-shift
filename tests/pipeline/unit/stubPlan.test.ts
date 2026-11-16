// Requirements: 23.2, 23.17, 21.10
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planStubCopy, type StubListEntry } from "../../../src/pipeline/local/core/stubPlan";

const GOOD: StubListEntry[] = [
  { path: "harness.json", type: "file" },
  { path: "resurrection", type: "directory" },
  { path: "resurrection/package.json", type: "file" },
  { path: "resurrection/lib/a.js", type: "file" },
  { path: "deltas.json", type: "file" },
];

describe("planStubCopy", () => {
  it("plans a plain sorted copy on POSIX paths", () => {
    const r = planStubCopy("tests/pipeline/fixtures/stub/x", "/home/u/gs", GOOD, path.posix);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.map((i) => i.relative)).toEqual([
      "deltas.json",
      "harness.json",
      "resurrection",
      "resurrection/lib/a.js",
      "resurrection/package.json",
    ]);
    expect(r.value[3]).toEqual({
      relative: "resurrection/lib/a.js",
      from: "tests/pipeline/fixtures/stub/x/resurrection/lib/a.js",
      to: "/home/u/gs/resurrection/lib/a.js",
      type: "file",
    });
  });

  it("plans on Windows paths and accepts backslash entries", () => {
    const entries = GOOD.map((e) => ({ ...e, path: e.path.replace(/\//g, "\\") }));
    const r = planStubCopy("tests\\proof\\fixtures\\x", "C:\\dev\\gs", entries, path.win32);
    if (!r.ok) throw new Error(r.error.message);
    const item = r.value.find((i) => i.relative === "resurrection/package.json");
    expect(item?.from).toBe("tests\\proof\\fixtures\\x\\resurrection\\package.json");
    expect(item?.to).toBe("C:\\dev\\gs\\resurrection\\package.json");
  });

  it("rejects any other entry, naming it", () => {
    const r = planStubCopy("d", "/r", [...GOOD, { path: "README.md", type: "file" }], path.posix);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("README.md");
  });

  it("rejects a missing entry, a wrong type and a non-regular entry", () => {
    expect(planStubCopy("d", "/r", GOOD.filter((e) => e.path !== "deltas.json"), path.posix).ok).toBe(false);
    expect(planStubCopy("d", "/r", GOOD.map((e) => (e.path === "deltas.json" ? { ...e, type: "directory" as const } : e)), path.posix).ok).toBe(false);
    expect(planStubCopy("d", "/r", [...GOOD, { path: "resurrection/link", type: "other" }], path.posix).ok).toBe(false);
    expect(planStubCopy("d", "/r", [...GOOD, { path: "deltas.json/x", type: "file" }], path.posix).ok).toBe(false);
  });
});
