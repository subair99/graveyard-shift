// Requirements: 13.1, 13.6, 13.7, 13.11, 23.9, 23.10
import { describe, expect, it } from "vitest";
import { PREDICATE_TYPE } from "../../../src/pipeline/common/constants";
import {
  buildPredicate,
  parsePredicate,
  PREDICATE_KEY_ORDER,
  printPredicate,
} from "../../../src/pipeline/undertaker/core/predicate";
import type { PredicateInput } from "../../../src/pipeline/undertaker/core/predicate";

const sri = `sha512-${"A".repeat(86)}==`;
const hex = "a".repeat(64);

const input: PredicateInput = {
  package: { name: "lodash.set", version: "4.3.2" },
  original: { integrity: sri },
  resurrection: { name: "@graveyard-shift/lodash.set", version: "4.3.3", treeHash: sri },
  digests: { tarball: hex, proofReport: hex, certificate: hex },
  verdict: "alive",
  seed: 42,
  toolVersions: { node: "26.0.0", fastCheck: "4.0.0", reportSchema: 1 },
  branchCommit: "b".repeat(40),
  run: { id: "123", attempt: "1" },
  medium: { mode: "local" },
};

function built() {
  const r = buildPredicate(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("buildPredicate", () => {
  it("returns the predicate type from common and a schemaVersion 1 predicate", () => {
    const v = built();
    expect(v.predicateType).toBe(PREDICATE_TYPE);
    expect(v.predicate.schemaVersion).toBe(1);
  });

  it("names verdict for a non-alive verdict", () => {
    const r = buildPredicate({ ...input, verdict: "restless" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("verdict");
  });

  it("names medium.mode for an unknown mode", () => {
    const r = buildPredicate({ ...input, medium: { mode: "cloud" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("medium.mode");
  });
});

describe("parsePredicate and printPredicate", () => {
  it("prints keys in PREDICATE_KEY_ORDER and round-trips", () => {
    const { predicate } = built();
    const text = printPredicate(predicate);
    expect(Object.keys(JSON.parse(text))).toEqual([...PREDICATE_KEY_ORDER.predicate]);
    const back = parsePredicate(text);
    expect(back).toEqual({ ok: true, value: predicate });
    if (back.ok) expect(printPredicate(back.value)).toBe(text);
  });

  it("names verdict when parsing a non-alive verdict", () => {
    const doc = { ...JSON.parse(printPredicate(built().predicate)), verdict: "restless" };
    const r = parsePredicate(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("verdict");
  });

  it("names medium.mode when parsing an unknown mode", () => {
    const doc = JSON.parse(printPredicate(built().predicate));
    doc.medium.mode = "remote";
    const r = parsePredicate(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("medium.mode");
  });

  it("names an unknown key and reports malformed JSON at the root", () => {
    const doc = { ...JSON.parse(printPredicate(built().predicate)), extra: 1 };
    const r = parsePredicate(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("extra");
    const bad = parsePredicate("{");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.field).toBe("(root)");
  });
});
