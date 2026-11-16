// Requirements: 1.6, 13.8
import { describe, expect, it } from "vitest";
import {
  ALLOWED_MEDIUM_PATHS,
  CREDIT_CEILING,
  GH_MIN_VERSION,
  INTAKE_LIMITS,
  PINNED_NODE_VERSION,
  PREDICATE_TYPE,
  REPO,
  SIGNER_WORKFLOW,
} from "../../../src/pipeline/common/constants";

describe("pipeline constants", () => {
  it("have the values of the design", () => {
    expect(PREDICATE_TYPE).toBe("https://github.com/subair99/graveyard-shift/attestation/resurrection/v1");
    expect(REPO).toBe("subair99/graveyard-shift");
    expect(SIGNER_WORKFLOW).toBe("subair99/graveyard-shift/.github/workflows/resurrect.yml");
    expect(PINNED_NODE_VERSION).toBe("26.13.1");
    expect(GH_MIN_VERSION).toBe("2.67.0");
    expect(CREDIT_CEILING).toBe(150);
    expect(INTAKE_LIMITS).toEqual({
      maxFiles: 200,
      maxFileBytes: 1_048_576,
      maxTotalBytes: 5_242_880,
      maxDepth: 8,
      maxControlFileBytes: 65_536,
    });
    expect([...ALLOWED_MEDIUM_PATHS]).toEqual(["resurrection/", "deltas.json", "harness.json"]);
  });
});
