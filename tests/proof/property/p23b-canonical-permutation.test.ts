import { describe, expect, it } from 'vitest';
import { canonicalReport, canonicalizeReport } from '../../../src/proof/serialize/canonicalReport';
import { deserializeReport } from '../../../src/proof/serialize/deserialize';
import { fc, fcParams } from '../../engine/helpers/fc';
import { permuteReport, tiedReportArb } from '../helpers/reportArb';

// Feature: proof-of-life-engine, Property 23: Canonical ordering
// Reports with many entries that tie on every documented sort key and differ only in content.
describe('Feature: proof-of-life-engine, Property 23: Canonical ordering (permutations of tied entries)', () => {
  it('gives identical bytes for every permutation of the sortable lists and round trips', () => {
    // **Validates: Requirements 13.1, 13.3**
    fc.assert(
      fc.property(
        tiedReportArb,
        fc.array(fc.array(fc.nat(), { minLength: 1, maxLength: 8 }), { minLength: 11, maxLength: 11 }),
        fc.array(fc.array(fc.nat(), { minLength: 1, maxLength: 8 }), { minLength: 11, maxLength: 11 }),
        (report, keysA, keysB) => {
          const bytes = canonicalReport(report);
          expect(canonicalReport(permuteReport(report, keysA))).toBe(bytes);
          expect(canonicalReport(permuteReport(report, keysB))).toBe(bytes);

          const parsed = deserializeReport(bytes);
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;
          expect(parsed.value).toEqual(canonicalizeReport(report));
          expect(canonicalReport(parsed.value)).toBe(bytes);
        },
      ),
      fcParams(),
    );
  });
});
