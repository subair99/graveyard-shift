// Requirements: 10.7
// R10.7: the CI_Workflow leaves the public API check to the API-surface check of the Proof_Engine and treats an
// API-surface Divergence as a Verdict `restless` result. The pipeline owns the exit code mapping and the attest gate.
import { describe, expect, it } from "vitest";
import { compareApiSurface, type ExportEntry } from "../../../src/proof/core/apiSurface";
import { computeVerdict, type RunFacts } from "../../../src/proof/core/verdict";
import { attestDecision, publishGate } from "../../../src/pipeline/undertaker/core/gates";
import { mapExitCode } from "../../../src/pipeline/undertaker/core/proveExit";

const original: ExportEntry[] = [{ name: "isPublic", type: "function", fnName: "isPublic", arity: 1 }];
const changedArity: ExportEntry[] = [{ name: "isPublic", type: "function", fnName: "isPublic", arity: 2 }];

function factsWith(divergences: RunFacts["divergences"]): RunFacts {
  return {
    harnessErrors: [],
    divergences,
    deltas: [],
    nonDeterministic: [],
    functionsTested: ["isPublic"],
    unencodable: [
      { function: "isPublic", cases: 100, casesWithUnencodable: 0, total: 0, reasons: { cycle: 0, depth: 0, getter: 0, proxy: 0 } },
    ],
  };
}

describe("an API-surface Divergence gives restless in the CI path (R10.7)", () => {
  it("the Proof_Engine reports a changed arity as an api-surface Divergence and the verdict is restless", () => {
    const divergences = compareApiSurface(original, changedArity);
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe("api-surface");
    expect(computeVerdict(factsWith(divergences))).toEqual({
      verdict: "restless",
      reasons: ["divergence:api-surface:isPublic"],
    });
  });

  it("identical export tables give no Divergence and the verdict alive (control)", () => {
    const divergences = compareApiSurface(original, original);
    expect(divergences).toEqual([]);
    expect(computeVerdict(factsWith(divergences)).verdict).toBe("alive");
  });

  it("a removed export is also an api-surface Divergence and restless", () => {
    const divergences = compareApiSurface(original, []);
    expect(divergences.map((d) => d.kind)).toEqual(["api-surface"]);
    expect(computeVerdict(factsWith(divergences)).verdict).toBe("restless");
  });

  it("the pipeline maps the engine exit code 1 to restless and never attests it", () => {
    const { verdict } = mapExitCode(1);
    expect(verdict).toBe("restless");
    const decision = attestDecision({
      checks: "success",
      prove: "success",
      verdict,
      reportParsed: true,
      treeHashEqual: true,
      integrityEqual: true,
    });
    expect(decision).toBe("skip");
  });

  it("a restless verdict is still published, without attestation", () => {
    expect(
      publishGate({ intake: "success", checks: "success", prove: "success", attest: "skipped", kind: "resurrection", verdict: "restless" }),
    ).toBe("publish");
  });
});
