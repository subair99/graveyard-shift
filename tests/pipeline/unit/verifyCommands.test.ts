// Requirements: 17.1, 17.5, 18.1, 18.6
import { describe, expect, it } from "vitest";
import { PREDICATE_TYPE, REPO, SIGNER_WORKFLOW } from "../../../src/pipeline/common/constants";
import { verifyCommand, verifyCommands } from "../../../src/pipeline/undertaker/core/verifyCommands";

describe("verifyCommands", () => {
  it("builds the exact command for each subject", () => {
    const cmds = verifyCommands({ subjects: [{ name: "a.tgz" }, { name: "proof-report.json" }] });
    expect(cmds).toEqual([
      `gh attestation verify a.tgz --repo ${REPO} --predicate-type ${PREDICATE_TYPE} --signer-workflow ${SIGNER_WORKFLOW} --format json`,
      `gh attestation verify proof-report.json --repo ${REPO} --predicate-type ${PREDICATE_TYPE} --signer-workflow ${SIGNER_WORKFLOW} --format json`,
    ]);
  });

  it("puts the prefix before each name and gives the signer workflow without a ref", () => {
    const [cmd] = verifyCommands({ subjects: [{ name: "certificate.json" }], prefix: "graveyard/ip/" });
    expect(cmd).toContain("gh attestation verify graveyard/ip/certificate.json ");
    expect(cmd).toContain("--signer-workflow subair99/graveyard-shift/.github/workflows/resurrect.yml ");
    expect(cmd).not.toContain("@");
  });

  it("returns no commands for no subjects and quotes unsafe names", () => {
    expect(verifyCommands({ subjects: [] })).toEqual([]);
    expect(verifyCommand("a b;c.json")).toContain("verify 'a b;c.json' --repo");
  });
});
