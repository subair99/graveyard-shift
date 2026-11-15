import { describe, expect, it } from "vitest";
import {
  DivergenceSchema,
  EncodedNodeSchema,
  HarnessErrorKindSchema,
  HarnessErrorSchema,
  ProofReportSchema,
  UnencodableCountSchema,
} from "../../../src/proof/types";

function validReport(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    package: { name: "p", version: "1.0.0" },
    original: { integrity: "sha512-AAAA", verified: true },
    resurrection: { source: "directory", treeHash: null },
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
    functionsTested: ["f"],
    casesPerFunction: [{ function: "f", cases: 3 }],
    unencodableValues: [
      {
        function: "f",
        cases: 3,
        casesWithUnencodable: 0,
        total: 0,
        reasons: { cycle: 0, depth: 0, getter: 0, proxy: 0 },
      },
    ],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    verdict: "alive",
    seed: 1,
    toolVersions: { node: "v26.0.0", fastCheck: "4.10.2", reportSchema: 1 },
  };
}

function divergence(): Record<string, unknown> {
  const returned = {
    kind: "returned",
    async: false,
    value: { t: "num", v: 1 },
    args: [],
    prototypeDelta: [],
  };
  return {
    function: "f",
    kind: "unexplained",
    args: [{ t: "str", v: "a" }],
    replay: { phase: "generated", seed: 5, path: "0" },
    differences: [{ part: "value", path: "value" }],
    original: returned,
    resurrection: { ...returned, value: { t: "num", v: 2 } },
    shrink: { attempts: 2, budgetExhausted: false },
    redactionMaskedDifference: false,
  };
}

describe("proof report schema", () => {
  it("parses a valid report", () => {
    expect(ProofReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it("rejects a report with a missing required field", () => {
    const report = validReport();
    delete report.verdict;
    expect(ProofReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects an unknown extra key (strict)", () => {
    expect(ProofReportSchema.safeParse({ ...validReport(), extra: 1 }).success).toBe(false);
  });
});

describe("UnencodableCount cross-field rules", () => {
  const base = {
    function: "f",
    cases: 2,
    casesWithUnencodable: 1,
    total: 3,
    reasons: { cycle: 1, depth: 1, getter: 1, proxy: 0 },
  };

  it("accepts consistent counts", () => {
    expect(UnencodableCountSchema.safeParse(base).success).toBe(true);
  });

  it("rejects casesWithUnencodable > cases", () => {
    expect(UnencodableCountSchema.safeParse({ ...base, casesWithUnencodable: 3 }).success).toBe(
      false,
    );
  });

  it("rejects total different from the sum of reasons", () => {
    expect(UnencodableCountSchema.safeParse({ ...base, total: 4 }).success).toBe(false);
  });

  it("rejects reasons without exactly the four keys", () => {
    expect(
      UnencodableCountSchema.safeParse({ ...base, reasons: { cycle: 1, depth: 1, getter: 1 } })
        .success,
    ).toBe(false);
    expect(
      UnencodableCountSchema.safeParse({
        ...base,
        reasons: { cycle: 1, depth: 1, getter: 1, proxy: 0, extra: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("Divergence schema", () => {
  it("accepts a divergence with the boolean flag", () => {
    expect(DivergenceSchema.safeParse(divergence()).success).toBe(true);
  });

  it("requires redactionMaskedDifference", () => {
    const d = divergence();
    delete d.redactionMaskedDifference;
    expect(DivergenceSchema.safeParse(d).success).toBe(false);
  });

  it("rejects a non-boolean redactionMaskedDifference", () => {
    expect(DivergenceSchema.safeParse({ ...divergence(), redactionMaskedDifference: "no" }).success).toBe(
      false,
    );
  });

  it("requires the flag on api-surface entries too", () => {
    const entry = {
      function: "g",
      kind: "api-surface",
      apiSurface: { export: "g", original: { type: "function" }, resurrection: null },
    };
    expect(DivergenceSchema.safeParse(entry).success).toBe(false);
    expect(DivergenceSchema.safeParse({ ...entry, redactionMaskedDifference: false }).success).toBe(
      true,
    );
  });
});

describe("harness errors", () => {
  it("accepts every kind required by Requirement 12.3", () => {
    for (const kind of [
      "invalid-archive",
      "generator-exhausted",
      "generator-violates-predicate",
      "identity-leak",
      "harness-config-error",
      "property-error",
      "irreproducible-divergence",
      "no-functions-tested",
    ]) {
      expect(HarnessErrorKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(HarnessErrorSchema.safeParse({ kind: "made-up", message: "m" }).success).toBe(false);
  });
});

describe("EncodedNode schema", () => {
  it("parses a nested node and rejects an unknown tag", () => {
    const nested = {
      t: "object",
      ctor: "Object",
      props: [["a", { t: "array", length: 1, items: [{ i: 0, n: { t: "bool", v: true } }], props: [] }]],
    };
    expect(EncodedNodeSchema.safeParse(nested).success).toBe(true);
    expect(EncodedNodeSchema.safeParse({ t: "nope" }).success).toBe(false);
    expect(EncodedNodeSchema.safeParse({ t: "null", extra: 1 }).success).toBe(false);
  });
});
