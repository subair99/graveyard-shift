// Requirements: 8.6, 8.11, 12.3, 13.3, 13.18, 13.23, 13.25, 13.26, 13.30
import { describe, expect, it } from "vitest";
import { identityValuesFromEnv } from "../../../src/proof/core/identity";
import { buildReport, type RawDivergence, type ReportInput } from "../../../src/proof/core/report";
import type { Outcome, ProofReport } from "../../../src/proof/types";

const ROOT_A = "/tmp/gs-original-1";
const ROOT_B = "/tmp/gs-resurrection-2";

const zero = { cycle: 0, depth: 0, getter: 0, proxy: 0 };

function returned(text: string): Outcome {
  return { kind: "returned", async: false, value: { t: "str", v: text }, args: [], prototypeDelta: [] };
}

function base(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    package: { name: "left-pad", version: "1.3.0" },
    original: { integrity: "sha512-AAAA", verified: true },
    resurrection: { source: "directory", treeHash: "sha512-BBBB" },
    sandbox: {
      mechanism: "in-process",
      restartEvents: { original: 0, resurrection: 0 },
      otherRestarts: { original: 0, resurrection: 0 },
      limits: {
        callTimeoutMs: 1000,
        heapLimitMb: 256,
        outputLimitBytes: 1048576,
        maxRestarts: 20,
        casesRequested: 100,
        shrinkBudget: 500,
      },
    },
    functionsTested: ["pad", "default"],
    casesPerFunction: [
      { function: "pad", cases: 100 },
      { function: "default", cases: 100 },
    ],
    unencodableValues: [
      { function: "pad", cases: 100, casesWithUnencodable: 3, total: 4, reasons: { ...zero, cycle: 4 } },
      { function: "default", cases: 100, casesWithUnencodable: 0, total: 0, reasons: zero },
    ],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    seed: 42,
    toolVersions: { node: "v22.0.0", fastCheck: "4.10.2" },
    roots: { original: { created: ROOT_A }, resurrection: { created: ROOT_B } },
    otherTempRoots: [],
    identity: identityValuesFromEnv({}, "posix"),
    platform: "posix",
    serialize: (r: ProofReport) => JSON.stringify(r),
    ...overrides,
  };
}

function divergence(a: string, b: string, fn = "pad", args = "x"): RawDivergence {
  return {
    function: fn,
    kind: "unexplained",
    args: [{ t: "str", v: args }],
    replay: { phase: "generated", seed: 42, path: "3:0" },
    differences: [{ part: "value", path: "" }],
    original: returned(a),
    resurrection: returned(b),
    shrink: { attempts: 5, budgetExhausted: false },
  };
}

describe("buildReport", () => {
  it("reports alive with per-function counts and no harness error", () => {
    const report = buildReport(base());
    expect(report.verdict).toBe("alive");
    expect(report.harnessErrors).toEqual([]);
    expect(report.functionsTested).toEqual(["default", "pad"]);
    expect(report.casesPerFunction.map((c) => c.function)).toEqual(["default", "pad"]);
    expect(report.toolVersions).toEqual({ node: "v22.0.0", fastCheck: "4.10.2", reportSchema: 1 });
    expect(report.resurrection.treeHash).toBe("sha512-BBBB");
  });

  it("keeps unencodable counts per function, sorted by function", () => {
    const report = buildReport(base());
    expect(report.unencodableValues.map((u) => [u.function, u.casesWithUnencodable, u.total])).toEqual([
      ["default", 0, 0],
      ["pad", 3, 4],
    ]);
  });

  it("reports restless with a divergence and sorts by redacted counterexample", () => {
    const report = buildReport(
      base({ divergences: [divergence("a", "b", "pad", "z"), divergence("a", "c", "pad", "b")] }),
    );
    expect(report.verdict).toBe("restless");
    expect(report.divergences).toHaveLength(2);
    expect(report.divergences.map((d) => (d.kind === "api-surface" ? "" : JSON.stringify(d.args)))).toEqual([
      JSON.stringify([{ t: "str", v: "b" }]),
      JSON.stringify([{ t: "str", v: "z" }]),
    ]);
    expect(report.divergences.every((d) => d.redactionMaskedDifference === false)).toBe(true);
  });

  it("normalizes a side's own root to <package> before reporting", () => {
    const report = buildReport(base({ divergences: [divergence(`${ROOT_A}/index.js`, `${ROOT_B}/x.js`)] }));
    const d = report.divergences[0];
    expect(d?.kind).toBe("unexplained");
    expect(JSON.stringify(report)).not.toContain("gs-original");
    expect(JSON.stringify(report)).toContain("<package>/index.js");
  });

  it("redacts an Identity_Value in the counterexample and keeps the report restless", () => {
    const identity = identityValuesFromEnv({ USERNAME: "alice" }, "posix");
    const report = buildReport(
      base({ identity, divergences: [divergence("/home/alice/x", "/home/bob/x", "pad", "/home/alice/in")] }),
    );
    expect(report.verdict).toBe("restless");
    const d = report.divergences[0];
    if (d === undefined || d.kind === "api-surface") throw new Error("expected a value divergence");
    expect(d.args).toEqual([{ t: "str", v: "/home/<user>/in" }]);
    expect(d.original).toMatchObject({ value: { v: "/home/<user>/x" } });
    expect(d.resurrection).toMatchObject({ value: { v: "/home/bob/x" } });
    expect(d.redactionMaskedDifference).toBe(false);
    expect(JSON.stringify(report)).not.toContain("alice");
  });

  it("sets redactionMaskedDifference when redaction hides the whole difference", () => {
    const identity = identityValuesFromEnv({ USERPROFILE: "C:\\Users\\alice" }, "win32");
    const report = buildReport(
      base({
        identity,
        platform: "win32",
        roots: { original: { created: "C:\\gs\\a" }, resurrection: { created: "C:\\gs\\b" } },
        divergences: [divergence("C:\\Users\\alice", "c:\\users\\ALICE")],
      }),
    );
    const d = report.divergences[0];
    expect(d?.redactionMaskedDifference).toBe(true);
    expect(report.verdict).toBe("restless");
    expect(d).toMatchObject({ original: { value: { v: "<user-home>" } }, resurrection: { value: { v: "<user-home>" } } });
  });

  it("returns the fallback report with temp-root-leak when a root survives in a field the normalizer does not walk", () => {
    const report = buildReport(
      base({
        divergences: [divergence("a", "b")],
        harnessErrors: [{ kind: "unloadable-module", message: `cannot load ${ROOT_A}/index.js` }],
      }),
    );
    expect(report.verdict).toBe("inconclusive");
    expect(report.divergences).toEqual([]);
    expect(report.deltas).toEqual([]);
    expect(report.harnessErrors.map((e) => e.kind).sort()).toEqual(["temp-root-leak", "unloadable-module"]);
    expect(report.harnessErrors.find((e) => e.kind === "unloadable-module")?.message).toBe("<withheld>");
    expect(JSON.stringify(report)).not.toContain("gs-original");
  });

  it("drops recorded cases of non-deterministic functions in the fallback", () => {
    const report = buildReport(
      base({
        nonDeterministicFunctions: [
          { function: "pad", args: [{ t: "str", v: "q" }], differences: [{ part: "value", path: "" }] },
        ],
        otherTempRoots: ["/tmp/work-9"],
        harnessErrors: [{ kind: "unloadable-module", message: "in /tmp/work-9/x" }],
      }),
    );
    expect(report.nonDeterministicFunctions).toEqual([{ function: "pad", args: [], differences: [] }]);
  });

  it("returns identity-leak when the backstop finds an Identity_Value in the serialized text", () => {
    const identity = identityValuesFromEnv({ USERNAME: "alice" }, "posix");
    const report = buildReport(
      base({ identity, serialize: (r) => `${JSON.stringify(r)}/home/alice/x` }),
    );
    expect(report.verdict).toBe("inconclusive");
    expect(report.harnessErrors.map((e) => e.kind)).toEqual(["identity-leak"]);
  });

  it("returns normalization-collision when identity redaction makes two keys equal", () => {
    const identity = identityValuesFromEnv({ USERNAME: "alice" }, "posix");
    const d: RawDivergence = {
      ...divergence("a", "b"),
      original: {
        kind: "returned",
        async: false,
        value: {
          t: "object",
          ctor: "Object",
          props: [
            ["/home/alice/k", { t: "num", v: 1 }],
            ["/home/<user>/k", { t: "num", v: 2 }],
          ],
        },
        args: [],
        prototypeDelta: [],
      },
    } as RawDivergence;
    const report = buildReport(base({ identity, divergences: [d] }));
    expect(report.verdict).toBe("inconclusive");
    expect(report.divergences).toEqual([]);
    expect(report.harnessErrors[0]).toMatchObject({ kind: "normalization-collision", function: "pad" });
  });

  it("is deterministic for the same input", () => {
    const input = base({ divergences: [divergence("a", "b"), divergence("c", "d", "default")] });
    expect(JSON.stringify(buildReport(input))).toBe(JSON.stringify(buildReport(input)));
  });
});
