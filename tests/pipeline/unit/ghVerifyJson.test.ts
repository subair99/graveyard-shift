// Requirements: 16.9, 16.10, 16.13
// SAMPLE OF UNVERIFIED FIELD NAMES. The JSON below is the shape documented in spikes/attest/DECISION.md (from the
// `gh attestation verify` manual), not a recording: the user has pasted no `--format json` output yet. It stays
// unverified until M8 (second run, task 16.2). If the real output differs, the parser is fixed, not this sample.
import { describe, expect, it } from "vitest";
import { GH_MIN_VERSION, PREDICATE_TYPE, REPO, SIGNER_WORKFLOW } from "../../../src/pipeline/common/constants";
import {
  ghVerifyArgv,
  ghVersionAtLeast,
  parseGhVerifyJson,
  parseGhVersion,
  verifyAttestation,
  type GhResult,
} from "../../../src/pipeline/undertaker/shell/nightly";
import { sha256Hex } from "../../../scripts/ci/lib/stepSupport";

const HEX = "20c719271a03263ac82c7a4f64de88462e4c3b9763b77794711125b172c059ac";

const SAMPLE_UNVERIFIED = JSON.stringify([
  {
    attestation: { bundle: { note: "Sigstore bundle" } },
    verificationResult: {
      signature: { certificate: { sourceRepositoryURI: `https://github.com/${REPO}` } },
      verifiedTimestamps: [{}],
      statement: {
        subject: [{ name: "proof-report.json", digest: { sha256: HEX } }],
        predicateType: PREDICATE_TYPE,
        predicate: { verdict: "alive" },
      },
    },
  },
]);

describe("parseGhVerifyJson (field names unverified until M8)", () => {
  it("reads statement.subject[].digest.sha256 from the documented shape", () => {
    expect(parseGhVerifyJson(SAMPLE_UNVERIFIED)).toEqual({ ok: true, value: [HEX] });
  });

  it("also accepts a statement directly on the result and upper-case hex", () => {
    const text = JSON.stringify({ statement: { subject: [{ digest: { sha256: HEX.toUpperCase() } }] } });
    expect(parseGhVerifyJson(text)).toEqual({ ok: true, value: [HEX] });
  });

  it.each([
    ["not JSON", "Verification succeeded!"],
    ["an empty array", "[]"],
    ["no statement", JSON.stringify([{ verificationResult: {} }])],
    ["no subject", JSON.stringify([{ verificationResult: { statement: {} } }])],
    ["no sha256 digest", JSON.stringify([{ verificationResult: { statement: { subject: [{ digest: { sha512: "x" } }] } } }])],
    ["a short digest", JSON.stringify([{ statement: { subject: [{ digest: { sha256: "abcd" } }] } }])],
    [
      "another predicate type",
      JSON.stringify([{ statement: { predicateType: "https://example.com/other", subject: [{ digest: { sha256: HEX } }] } }]),
    ],
  ])("fails closed on %s", (_label, text) => {
    expect(parseGhVerifyJson(text).ok).toBe(false);
  });
});

describe("ghVerifyArgv", () => {
  it("is the verifyCommands form of task 10.4 without --bundle", () => {
    expect(ghVerifyArgv("proof-report.json")).toEqual([
      "attestation",
      "verify",
      "proof-report.json",
      "--repo",
      REPO,
      "--predicate-type",
      PREDICATE_TYPE,
      "--signer-workflow",
      SIGNER_WORKFLOW,
      "--format",
      "json",
    ]);
  });

  it("returns null for a name that needs shell quoting", () => {
    expect(ghVerifyArgv("a b.tgz")).toBeNull();
  });
});

describe("gh version", () => {
  it("parses the first line", () => {
    expect(parseGhVersion("gh version 2.104.0 (2026-01-01)\nhttps://x")).toEqual([2, 104, 0]);
    expect(parseGhVersion("nothing")).toBeNull();
  });

  it("accepts the minimum and above, rejects below and unreadable", () => {
    expect(ghVersionAtLeast(`gh version ${GH_MIN_VERSION}`)).toBe(true);
    expect(ghVersionAtLeast("gh version 2.104.0")).toBe(true);
    expect(ghVersionAtLeast("gh version 3.0.0")).toBe(true);
    expect(ghVersionAtLeast("gh version 2.66.9")).toBe(false);
    expect(ghVersionAtLeast("gh version 1.99.0")).toBe(false);
    expect(ghVersionAtLeast("unknown")).toBe(false);
  });
});

describe("verifyAttestation", () => {
  const bytes = new TextEncoder().encode("committed file");
  const digest = sha256Hex(bytes);
  const fs = { listDirs: () => [], listFiles: () => [], readBytes: () => bytes, writeText: () => undefined };
  const json = (hex: string): string => JSON.stringify([{ verificationResult: { statement: { subject: [{ digest: { sha256: hex } }] } } }]);
  const run = (result: GhResult) =>
    verifyAttestation({ fs, sha256: sha256Hex, runGh: async () => result }, "graveyard/x", "proof-report.json");

  it("succeeds when a signed digest equals the committed file's", async () => {
    expect((await run({ code: 0, stdout: json(digest), stderr: "" })).ok).toBe(true);
  });

  it("fails when the digest differs, when gh exits non-zero, and when the output is not JSON", async () => {
    expect((await run({ code: 0, stdout: json(HEX), stderr: "" })).ok).toBe(false);
    expect((await run({ code: 1, stdout: json(digest), stderr: "no attestations found" })).ok).toBe(false);
    expect((await run({ code: 0, stdout: "Verification succeeded!", stderr: "" })).ok).toBe(false);
  });
});
