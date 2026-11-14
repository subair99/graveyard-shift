# Kiro journal

Project rule: never state a number, metric or result that was not measured. Every measurement
is logged here with the command, date and environment. Statements marked "qualitative" are not
measurements.

## Autopsy engine: test and build measurements

Date: 2026-11-14

Environment: Microsoft Windows NT 10.0.26300.0, Node.js v26.13.1, next 16.4.6, vitest 5.1.0,
fast-check 4.10.2 (versions from `node_modules/<package>/package.json`).

Run from the repository root in PowerShell. Wall-clock time comes from `Measure-Command`;
"vitest duration" is the figure vitest prints. Each command was run once per row.

| Command | Result | Duration |
| --- | --- | --- |
| `npm test` (run 1) | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 8.69s; wall 9.67s |
| `npm test` (run 2) | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 9.45s; wall 10.39s |
| `npm test` (run 3) | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 9.13s; wall 10.03s |
| `$env:FC_SEED=12345; npm test` | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 10.64s; wall 11.62s |
| `npm run typecheck` | exit 0 | wall 0.87s |
| `npm run lint` | exit 0, no output from eslint | wall 2.73s |
| `npm run build` | exit 0; Next.js reported "Compiled successfully in 385ms" | wall 5.25s |

Notes:
- File and test counts (32 files, 302 tests) match the earlier report.
- Earlier reports gave runs of about 7.3 to 7.5 s. The runs above took 8.69 to 9.45 s (vitest) without
  a seed and 10.64 s with `FC_SEED=12345`. The figures above are the ones measured for this entry.
  The cause of the difference was not investigated (different machine load is one possibility, not tested).
- Only one run was made with `FC_SEED=12345`, so no conclusion about seed effect on duration is drawn.
- Next.js also reported "Finished TypeScript in 873ms" and "Generating static pages using 4 workers
  (3/3) in 608ms" during the build.

## Fixtures

Date: 2026-11-14. Method: counted files in each directory under `tests/engine/fixtures/`
with `Get-ChildItem <dir> -File`, and the total with `Get-ChildItem tests/engine/fixtures -Recurse -File`.

| Directory | Files |
| --- | --- |
| `inflight` | 7 |
| `ip` | 6 |
| `lodash.set` | 6 |
| Total | 19 |

## Open items (not measured)

Qualitative statements, not measurements:

- Requirement 11.6 is checked by a wrapper in the test file and is not implemented in the engine.
- The wording of requirements 10.1 and 10.2 differs from the orchestrator's behavior, which reads
  the clock once for the default Analysis_Date.
- Of the 26 design properties, only four have property tests: P9, P18, P23 and P25. This was
  verified by listing `tests/engine/property`, which holds four files:
  `p09-fact-provenance.test.ts`, `p18-risk-monotonicity.test.ts`, `p23-idempotence.test.ts`,
  `p25-serialization-roundtrip.test.ts`. The other properties are optional and not written.
- No test covers the 10 s timeout error for a package name given without a version (1.11).
- No test uses a 1,000-package lockfile (9.9).
