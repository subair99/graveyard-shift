// Requirements: 8.3, 8.4, 12.2
import { describe, it } from "vitest";
import { computeRisk } from "../../../src/engine/core/risk";
import type { CauseOfDeath, Maybe, VitalSigns, Vulnerability } from "../../../src/engine/types";
import { fc, fcParams } from "../helpers/fc";

// Feature: autopsy-engine, Property 18: Risk score monotonicity
// **Validates: Requirements 8.3, 8.4, 12.2**

const ALL_CAUSES: readonly CauseOfDeath[] = [
  "maintainer-gone",
  "repo-archived",
  "unpatched-cve",
  "runtime-rot",
];

function unavailable<T>(): Maybe<T> {
  return {
    available: false,
    source: "npm",
    attemptedUrl: "https://registry.npmjs.org/x",
    attemptedAt: "2026-01-01T00:00:00.000Z",
    reason: "test",
  };
}

/** Each sign is available (with the given value) or unavailable. */
function maybeArb<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Maybe<T>> {
  return fc.oneof(
    value.map((v): Maybe<T> => ({ available: true, value: v })),
    fc.constant(unavailable<T>()),
  );
}

const vulnArb: fc.Arbitrary<Vulnerability> = fc.record({
  id: fc.stringMatching(/^[A-Z]{2,4}-[0-9]{1,4}$/),
  aliases: fc.constant([] as string[]),
  summary: fc.constant("s"),
});

/** Vulnerability lists with distinct ids. */
const vulnListArb = fc.uniqueArray(vulnArb, { selector: (v) => v.id, maxLength: 8 });

/** Scorecard: available number, available null, or unavailable. */
const scorecardArb = maybeArb(
  fc.oneof(fc.integer({ min: 0, max: 100 }).map((n) => n / 10), fc.constant(null)),
);

const otherSignsArb = fc.record({
  maintainers: maybeArb(fc.array(fc.string(), { maxLength: 3 })),
  scorecard: scorecardArb,
  dependents: maybeArb(fc.nat()),
  weeklyDownloads: maybeArb(fc.nat()),
});

const causesArb = fc.subarray([...ALL_CAUSES]);

describe("Property 18: Risk score monotonicity", () => {
  it("adding one vulnerability not already present never lowers the Risk_Score", () => {
    // Adding to an unavailable list is not a defined input change, so the base
    // list is always available (possibly empty). Every other sign and cause is
    // generated freely, including unavailable ones.
    fc.assert(
      fc.property(
        causesArb,
        otherSignsArb,
        vulnListArb,
        vulnArb,
        (causes, others, vulns, extra) => {
          fc.pre(!vulns.some((v) => v.id === extra.id));
          const before: VitalSigns = {
            ...others,
            openVulnerabilities: { available: true, value: vulns },
          };
          const after: VitalSigns = {
            ...others,
            openVulnerabilities: { available: true, value: [...vulns, extra] },
          };
          return computeRisk({ causes, vitalSigns: after }).riskScore >=
            computeRisk({ causes, vitalSigns: before }).riskScore;
        },
      ),
      fcParams(),
    );
  });

  it("adding one cause not already present never lowers the Risk_Score", () => {
    fc.assert(
      fc.property(
        causesArb,
        fc.constantFrom(...ALL_CAUSES),
        otherSignsArb,
        maybeArb(vulnListArb),
        (causes, extra, others, openVulnerabilities) => {
          fc.pre(!causes.includes(extra));
          const vitalSigns: VitalSigns = { ...others, openVulnerabilities };
          return computeRisk({ causes: [...causes, extra], vitalSigns }).riskScore >=
            computeRisk({ causes, vitalSigns }).riskScore;
        },
      ),
      fcParams(),
    );
  });
});
