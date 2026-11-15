// Safety test for the temporary-root leak check (Requirements 13.18 to 13.24, 13.23): a root that
// survives anywhere in the serialized report makes buildReport return the fallback report.
// Runs through buildReport with the real canonical serializer.
import { describe, expect, it } from "vitest";
import { identityValuesFromEnv, type Platform } from "../../../src/proof/core/identity";
import { rootForms } from "../../../src/proof/core/normalize";
import { buildReport, containsTempRoot, type RawDivergence, type ReportInput } from "../../../src/proof/core/report";
import { canonicalReportJson } from "../../../src/proof/serialize/canonicalReport";
import { deserializeReport } from "../../../src/proof/serialize/deserialize";
import type { DeltaReport, Outcome } from "../../../src/proof/types";

const WIN_A = "C:\\Users\\x\\gs-abc";
const WIN_B = "C:\\Users\\x\\gs-def";
const POSIX_A = "/tmp/gs-abc";
const POSIX_B = "/tmp/gs-def";

const zero = { cycle: 0, depth: 0, getter: 0, proxy: 0 };

function returned(text: string): Outcome {
  return { kind: "returned", async: false, value: { t: "str", v: text }, args: [], prototypeDelta: [] };
}

function base(platform: Platform, a: string, b: string, overrides: Partial<ReportInput> = {}): ReportInput {
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
    functionsTested: ["pad"],
    casesPerFunction: [{ function: "pad", cases: 100 }],
    unencodableValues: [{ function: "pad", cases: 100, casesWithUnencodable: 0, total: 0, reasons: zero }],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    seed: 42,
    toolVersions: { node: "v22.0.0", fastCheck: "4.10.2" },
    roots: { original: { created: a }, resurrection: { created: b } },
    otherTempRoots: [],
    identity: identityValuesFromEnv({}, platform),
    platform,
    serialize: canonicalReportJson,
    ...overrides,
  };
}

function divergence(overrides: Record<string, unknown> = {}): RawDivergence {
  return {
    function: "pad",
    kind: "unexplained",
    args: [{ t: "str", v: "x" }],
    replay: { phase: "generated", seed: 42, path: "3:0" },
    differences: [{ part: "value", path: "" }],
    original: returned("a"),
    resurrection: returned("b"),
    shrink: { attempts: 5, budgetExhausted: false },
    ...overrides,
  } as RawDivergence;
}

function delta(id: string, fn = "pad"): DeltaReport {
  return { id, function: fn, status: "not-demonstrated", predicateCasesChecked: 10, demonstration: null };
}

/** Every text form of a root, built independently of src/proof/core/normalize.ts. */
function allForms(root: string, win: boolean): string[] {
  const forward = root.replace(/\\/g, "/");
  const back = root.replace(/\//g, "\\");
  const forms = [root, forward, back, back.replace(/\\/g, "\\\\")];
  if (win) {
    forms.push("\\\\?\\" + back, "\\\\\\\\?\\\\" + back.replace(/\\/g, "\\\\"));
    forms.push("file:///" + forward.replace(/ /g, "%20"));
  } else {
    forms.push("file://" + forward);
  }
  return forms;
}

function expectNoRoot(text: string, roots: string[], win: boolean): void {
  const hay = win ? text.toLowerCase() : text;
  for (const root of roots) {
    for (const form of allForms(root, win)) {
      expect(hay.includes(win ? form.toLowerCase() : form), `form ${form}`).toBe(false);
    }
  }
}

type Where = (root: string) => Partial<ReportInput>;

// Each entry puts a surviving root in a place that the report carries and the normalizer does not walk.
const PLACES: [string, Where][] = [
  ["harness error message", (r) => ({ harnessErrors: [{ kind: "unloadable-module", message: `cannot load ${r}\\index.js` }] })],
  [
    "harness error function name",
    (r) => ({ harnessErrors: [{ kind: "harness-config-error", function: `${r}\\f`, message: "bad" }] }),
  ],
  ["function name", (r) => ({ functionsTested: ["pad", `${r}\\fn`], casesPerFunction: [{ function: "pad", cases: 1 }] })],
  ["exclusion reason", (r) => ({ excludedFunctions: [{ function: "pad", reason: `needs ${r}\\data` }] })],
  ["delta id", (r) => ({ deltas: [delta(`d-${r}`)] })],
  ["delta description via function", (r) => ({ deltas: [delta("d1", `${r}\\g`)] })],
  ["divergence difference path", (r) => ({ divergences: [divergence({ differences: [{ part: "value", path: `${r}\\p` }] })] })],
  ["divergence replay path", (r) => ({ divergences: [divergence({ replay: { phase: "generated", seed: 1, path: `${r}` } })] })],
  ["divergence delta id", (r) => ({ divergences: [divergence({ deltaId: `${r}` })] })],
  [
    "non-deterministic difference path",
    (r) => ({
      nonDeterministicFunctions: [{ function: "pad", args: [{ t: "str", v: "q" }], differences: [{ part: "value", path: r }] }],
    }),
  ],
  ["other temp root in an error", () => ({ otherTempRoots: ["C:\\work\\gs-w1"], harnessErrors: [{ kind: "unloadable-module", message: "in C:/work/gs-w1/x" }] })],
  // Double-escaped: the string holds the JSON-escaped form of the root, so the serialized text holds it escaped twice.
  [
    "double-escaped root in a path",
    (r) => ({ divergences: [divergence({ differences: [{ part: "value", path: r.replace(/\\/g, "\\\\") }] })] }),
  ],
];

describe("temp-root leak check, Windows roots", () => {
  for (const [label, where] of PLACES) {
    for (const [side, root] of [["original", WIN_A], ["resurrection", WIN_B]] as const) {
      it(`${label}: ${side} root yields the fallback report`, () => {
        const input = base("win32", WIN_A, WIN_B, where(root));
        const report = buildReport(input);
        expect(report.verdict).toBe("inconclusive");
        expect(report.harnessErrors.some((e) => e.kind === "temp-root-leak")).toBe(true);
        expect(report.divergences).toEqual([]);
        expect(report.deltas).toEqual([]);
        for (const n of report.nonDeterministicFunctions) {
          expect(n.args).toEqual([]);
          expect(n.differences).toEqual([]);
        }
        const text = canonicalReportJson(report);
        expectNoRoot(text, [WIN_A, WIN_B, "C:\\work\\gs-w1"], true);
        expect(containsTempRoot(text, [WIN_A, WIN_B, "C:\\work\\gs-w1"], true)).toBe(false);
        // The fallback is deterministic and passes the schema.
        expect(canonicalReportJson(buildReport(base("win32", WIN_A, WIN_B, where(root))))).toBe(text);
        const parsed = deserializeReport(text);
        expect(parsed.ok).toBe(true);
      });
    }
  }

  it("catches every non-escaped form of a root in a surviving string", () => {
    for (const root of [WIN_A, WIN_B]) {
      for (const form of allForms(root, true)) {
        const report = buildReport(
          base("win32", WIN_A, WIN_B, { harnessErrors: [{ kind: "unloadable-module", message: `at ${form}/x` }] }),
        );
        expect(report.harnessErrors.some((e) => e.kind === "temp-root-leak"), form).toBe(true);
      }
    }
  });

  it("matches case-insensitively on Windows", () => {
    const report = buildReport(
      base("win32", WIN_A, WIN_B, { harnessErrors: [{ kind: "unloadable-module", message: WIN_A.toUpperCase() }] }),
    );
    expect(report.harnessErrors.some((e) => e.kind === "temp-root-leak")).toBe(true);
  });
});

describe("temp-root leak check, POSIX roots", () => {
  for (const [label, where] of [
    ["harness error message", (r: string) => ({ harnessErrors: [{ kind: "unloadable-module" as const, message: `cannot load ${r}/index.js` }] })],
    ["exclusion reason", (r: string) => ({ excludedFunctions: [{ function: "pad", reason: `needs ${r}/data` }] })],
    ["divergence difference path", (r: string) => ({ divergences: [divergence({ differences: [{ part: "value", path: `${r}/p` }] })] })],
    ["file URL", (r: string) => ({ harnessErrors: [{ kind: "unloadable-module" as const, message: `file://${r}/x.js` }] })],
  ] as const) {
    for (const root of [POSIX_A, POSIX_B]) {
      it(`${label}: ${root} yields the fallback report`, () => {
        const report = buildReport(base("posix", POSIX_A, POSIX_B, where(root)));
        expect(report.verdict).toBe("inconclusive");
        expect(report.harnessErrors.some((e) => e.kind === "temp-root-leak")).toBe(true);
        const text = canonicalReportJson(report);
        expectNoRoot(text, [POSIX_A, POSIX_B], false);
        expect(deserializeReport(text).ok).toBe(true);
      });
    }
  }

  it("containsTempRoot is case-sensitive on POSIX and applies the boundary rule", () => {
    expect(containsTempRoot("x /tmp/gs-abc/y", [POSIX_A], false)).toBe(true);
    expect(containsTempRoot("x /TMP/GS-ABC/y", [POSIX_A], false)).toBe(false);
    expect(containsTempRoot("x /tmp/gs-abc1/y", [POSIX_A], false)).toBe(false);
    expect(rootForms(POSIX_A).some((f) => f.url)).toBe(true);
  });
});

describe("temp-root leak check, negative controls", () => {
  it("does not trigger on a sibling directory that shares a prefix with the root", () => {
    const report = buildReport(
      base("win32", WIN_A, WIN_B, {
        excludedFunctions: [{ function: "pad", reason: `C:\\Users\\x\\gs-abc1\\f.js and ${WIN_B}2/y` }],
      }),
    );
    expect(report.harnessErrors).toEqual([]);
    expect(report.verdict).toBe("alive");
    expect(report.excludedFunctions[0]?.reason).toContain("gs-abc1");
  });

  it("does not trigger on the <package> placeholder, and normalization replaces roots in values", () => {
    const report = buildReport(
      base("win32", WIN_A, WIN_B, {
        excludedFunctions: [{ function: "pad", reason: "<package>/index.js" }],
        divergences: [divergence({ original: returned(`${WIN_A}\\index.js`), resurrection: returned(`${WIN_B}\\index.js`) })],
      }),
    );
    expect(report.harnessErrors).toEqual([]);
    expect(report.verdict).toBe("restless");
    expect(report.divergences).toHaveLength(1);
    expect(canonicalReportJson(report)).toContain("<package>");
  });

  it("containsTempRoot is false on the placeholder and on a different directory", () => {
    expect(containsTempRoot("<package>\\index.js", [WIN_A, WIN_B], true)).toBe(false);
    expect(containsTempRoot("C:\\Users\\x\\gs-abc1", [WIN_A], true)).toBe(false);
    expect(containsTempRoot("C:\\Users\\x\\gs-ab", [WIN_A], true)).toBe(false);
    expect(containsTempRoot("C:\\Users\\x\\gs-abc", [WIN_A], true)).toBe(true);
  });

  it("a test double that never finds a root would be caught: the leak is really in the serialized text", () => {
    const input = base("win32", WIN_A, WIN_B, {
      harnessErrors: [{ kind: "unloadable-module", message: `at ${WIN_A}\\x` }],
    });
    // The same string without the check: serialize the report the builder would have returned.
    const naive = canonicalReportJson({
      ...buildReport(base("win32", WIN_A, WIN_B)),
      harnessErrors: input.harnessErrors.map((e) => ({ ...e })),
    });
    expect(containsTempRoot(naive, [WIN_A], true)).toBe(true);
    expect(buildReport(input).harnessErrors.some((e) => e.kind === "temp-root-leak")).toBe(true);
  });
});
