// Requirements: 5.5
// Feature: resurrection-pipeline, Property 10: Compilation is deterministic

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { compileHarness } from "../../../src/pipeline/harness/core/compiler";
import type { CompileInput } from "../../../src/pipeline/harness/core/compiler";
import type { Delta } from "../../../src/pipeline/harness/core/deltas";
import type { HarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const RUNS = 150;

const HARNESS: HarnessFile = {
  schemaVersion: 1,
  package: "lodash.set",
  functions: { default: { preset: "lodash-set" } },
};

const deltaId = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,10}$/);

// Mostly valid deltas; some name a function that is not selected, so error lists are compared too.
const deltaList = fc
  .uniqueArray(deltaId, { minLength: 1, maxLength: 6 })
  .chain((ids) =>
    fc
      .array(fc.constantFrom("default", "other"), { minLength: ids.length, maxLength: ids.length })
      .map((fns): Delta[] =>
        ids.map((id, i) => ({
          kind: "prototype-unchanged",
          id,
          function: fns[i] ?? "default",
          advisory: "GHSA-p6mc-m468-83gw",
        })),
      ),
  );

function inputOf(deltas: Delta[]): CompileInput {
  return {
    deltas: { schemaVersion: 1, package: "lodash.set", deltas },
    harness: HARNESS,
    certificate: LODASH_SET_CERT,
  };
}

describe("Property 10: Compilation is deterministic", () => {
  it("compiling the same input twice gives equal results", () => {
    fc.assert(
      fc.property(deltaList, (deltas) => {
        expect(compileHarness(inputOf(deltas))).toEqual(compileHarness(inputOf(deltas)));
      }),
      { numRuns: RUNS },
    );
  });

  it("the order of the input deltas does not change the result", () => {
    fc.assert(
      fc.property(
        deltaList.chain((deltas) =>
          fc
            .shuffledSubarray(deltas, { minLength: deltas.length, maxLength: deltas.length })
            .map((shuffled) => ({ deltas, shuffled })),
        ),
        ({ deltas, shuffled }) => {
          const a = compileHarness(inputOf(deltas));
          const b = compileHarness(inputOf(shuffled));
          if (a.ok && b.ok) {
            expect(b.value.config.deltas.map((d) => d.id)).toEqual(
              [...b.value.config.deltas.map((d) => d.id)].sort(),
            );
          }
          if (a.ok && b.ok) expect(b).toEqual(a);
          expect(a.ok).toBe(b.ok);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
