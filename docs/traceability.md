# Traceability: proof-of-life-engine

Generated on 2026-11-15 by `npm run trace` (system date; this is documentation, not a measured number).

A citation shows which tests claim to cover a criterion; it does not prove coverage.

Sources: acceptance criteria from `.kiro/specs/proof-of-life-engine/requirements.md`; citations are the `// Requirements:` header lines of `tests/proof/**/*.test.ts`.

## Summary

- Test files scanned: 67
- Acceptance criteria: 165
- Criteria cited by at least one test file: 132
- Criteria with no citing test file (gaps): 33

## Criteria and citing test files

| Criterion | Test files |
| --- | --- |
| 1.1 | `tests/proof/unit/orchestrator.test.ts` |
| 1.2 | `tests/proof/unit/orchestrator.test.ts` |
| 1.3 | (none) |
| 1.4 | `tests/proof/unit/cli.test.ts` |
| 1.5 | `tests/proof/unit/orchestrator.test.ts` |
| 1.6 | (none) |
| 2.1 | `tests/proof/unit/integrity.test.ts` |
| 2.2 | `tests/proof/unit/integrity.test.ts`<br>`tests/proof/unit/orchestrator.test.ts` |
| 2.3 | `tests/proof/unit/integrity.test.ts`<br>`tests/proof/unit/orchestrator.test.ts` |
| 2.4 | (none) |
| 3.1 | `tests/proof/unit/tarballExtractor.test.ts` |
| 3.2 | `tests/proof/unit/tarballExtractor.test.ts` |
| 3.3 | `tests/proof/unit/tarballExtractor.test.ts` |
| 3.4 | `tests/proof/unit/entry.test.ts` |
| 3.5 | `tests/proof/unit/entry.test.ts`<br>`tests/proof/unit/orchestrator.test.ts` |
| 3.6 | `tests/proof/integration/lodashAlive.integration.test.ts`<br>`tests/proof/integration/lodashBroken.integration.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/workDir.test.ts` |
| 3.7 | (none) |
| 3.8 | (none) |
| 3.9 | `tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 3.10 | `tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/tarballExtractor.test.ts` |
| 3.11 | (none) |
| 4.1 | `tests/proof/property/p04-tree-hash.test.ts` |
| 4.2 | `tests/proof/property/p04-tree-hash.test.ts`<br>`tests/proof/unit/treeHash.test.ts`<br>`tests/proof/unit/workDir.test.ts` |
| 4.3 | `tests/proof/property/p04-tree-hash.test.ts`<br>`tests/proof/unit/treeHash.test.ts` |
| 4.4 | `tests/proof/property/p04-tree-hash.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/treeHash.test.ts` |
| 4.5 | (none) |
| 4.6 | `tests/proof/unit/workDir.test.ts` |
| 5.1 | `tests/proof/unit/inProcessExecutor.test.ts` |
| 5.2 | `tests/proof/integration/fileReadDenied.integration.test.ts`<br>`tests/proof/integration/networkDenied.integration.test.ts`<br>`tests/proof/integration/pathsSpaces.integration.test.ts`<br>`tests/proof/integration/spawnDenied.integration.test.ts`<br>`tests/proof/unit/sandboxCommand.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.3 | `tests/proof/integration/envMinimum.integration.test.ts`<br>`tests/proof/integration/envScrubbed.integration.test.ts`<br>`tests/proof/unit/sandboxCommand.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.4 | `tests/proof/integration/timeoutKill.integration.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 5.5 | `tests/proof/unit/sandboxExecutor.test.ts` |
| 5.6 | `tests/proof/unit/sandboxExecutor.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 5.7 | `tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/runner.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.8 | `tests/proof/unit/protocol.test.ts`<br>`tests/proof/unit/runner.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.9 | `tests/proof/unit/inProcessExecutor.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.10 | `tests/proof/integration/protoIsolation.integration.test.ts`<br>`tests/proof/property/p07-prototype-delta.test.ts`<br>`tests/proof/unit/inProcessExecutor.test.ts`<br>`tests/proof/unit/prototypes.test.ts`<br>`tests/proof/unit/runner.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 5.11 | `tests/proof/integration/protoIsolation.integration.test.ts`<br>`tests/proof/unit/runner.test.ts` |
| 5.12 | `tests/proof/integration/protoIsolation.integration.test.ts`<br>`tests/proof/property/p07-prototype-delta.test.ts`<br>`tests/proof/unit/inProcessExecutor.test.ts`<br>`tests/proof/unit/prototypes.test.ts`<br>`tests/proof/unit/runner.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 5.13 | `tests/proof/integration/protoIsolation.integration.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.14 | `tests/proof/unit/executorTypes.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 5.15 | `tests/proof/integration/protoIsolation.integration.test.ts` |
| 5.16 | `tests/proof/unit/sandboxCommand.test.ts` |
| 5.17 | `tests/proof/integration/pathsSpaces.integration.test.ts`<br>`tests/proof/unit/sandboxCommand.test.ts` |
| 5.18 | `tests/proof/integration/envMinimum.integration.test.ts`<br>`tests/proof/integration/envScrubbed.integration.test.ts`<br>`tests/proof/unit/sandboxCommand.test.ts` |
| 5.19 | `tests/proof/integration/envMinimum.integration.test.ts`<br>`tests/proof/integration/envScrubbed.integration.test.ts` |
| 6.1 | `tests/proof/property/p08-codec-roundtrip.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 6.2 | `tests/proof/property/p08-codec-roundtrip.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 6.3 | `tests/proof/unit/codec.test.ts` |
| 6.4 | `tests/proof/property/p11-strict-comparison.test.ts`<br>`tests/proof/unit/equal.test.ts` |
| 6.5 | `tests/proof/property/p08-codec-roundtrip.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 6.6 | `tests/proof/property/p08-codec-roundtrip.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 6.7 | `tests/proof/property/p08-codec-roundtrip.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 6.8 | (none) |
| 6.9 | `tests/proof/unit/codec.test.ts` |
| 7.1 | `tests/proof/property/p11-strict-comparison.test.ts`<br>`tests/proof/unit/equal.test.ts` |
| 7.2 | `tests/proof/property/p11-strict-comparison.test.ts`<br>`tests/proof/unit/equal.test.ts` |
| 7.3 | `tests/proof/property/p11-strict-comparison.test.ts`<br>`tests/proof/unit/equal.test.ts` |
| 7.4 | `tests/proof/property/p11-strict-comparison.test.ts`<br>`tests/proof/unit/equal.test.ts` |
| 7.5 | `tests/proof/unit/equal.test.ts` |
| 7.6 | `tests/proof/unit/equal.test.ts` |
| 7.7 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts` |
| 7.8 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 7.9 | `tests/proof/unit/driver.test.ts`<br>`tests/proof/unit/equal.test.ts` |
| 7.10 | (none) |
| 8.1 | (none) |
| 8.2 | (none) |
| 8.3 | `tests/proof/unit/orchestrator.test.ts` |
| 8.4 | `tests/proof/unit/orchestrator.test.ts` |
| 8.5 | `tests/proof/unit/seeds.test.ts` |
| 8.6 | `tests/proof/unit/driver.test.ts`<br>`tests/proof/unit/report.test.ts` |
| 8.7 | `tests/proof/integration/lodashBroken.integration.test.ts`<br>`tests/proof/unit/driver.test.ts` |
| 8.8 | `tests/proof/integration/lodashBroken.integration.test.ts`<br>`tests/proof/unit/driver.test.ts` |
| 8.9 | (none) |
| 8.10 | (none) |
| 8.11 | `tests/proof/unit/driver.test.ts`<br>`tests/proof/unit/report.test.ts`<br>`tests/proof/unit/types.test.ts` |
| 8.12 | `tests/proof/unit/driver.test.ts` |
| 8.13 | `tests/proof/unit/driver.test.ts` |
| 8.14 | `tests/proof/unit/lodashHarness.test.ts` |
| 8.15 | (none) |
| 9.1 | `tests/proof/unit/sideRuntime.test.ts`<br>`tests/proof/unit/stubs.test.ts` |
| 9.2 | (none) |
| 9.3 | `tests/proof/property/p25d-flaky-negative-control.test.ts`<br>`tests/proof/unit/driver.test.ts` |
| 9.4 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/property/p25d-flaky-negative-control.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 9.5 | (none) |
| 10.1 | `tests/proof/unit/apiSurface.test.ts`<br>`tests/proof/unit/lodashHarness.test.ts` |
| 10.2 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts`<br>`tests/proof/unit/apiSurface.test.ts` |
| 10.3 | `tests/proof/unit/apiSurface.test.ts` |
| 10.4 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 11.1 | (none) |
| 11.2 | `tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/unit/delta.test.ts` |
| 11.3 | `tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/unit/delta.test.ts`<br>`tests/proof/unit/driver.test.ts` |
| 11.4 | `tests/proof/integration/lodashBroken.integration.test.ts`<br>`tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/unit/delta.test.ts` |
| 11.5 | `tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/unit/delta.test.ts` |
| 11.6 | `tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/delta.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 11.7 | `tests/proof/unit/sideRuntime.test.ts` |
| 11.8 | `tests/proof/integration/lodashAlive.integration.test.ts`<br>`tests/proof/integration/lodashBroken.integration.test.ts` |
| 11.9 | `tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/unit/lodashHarness.test.ts` |
| 11.10 | `tests/proof/property/p20-delta-classification.test.ts`<br>`tests/proof/unit/delta.test.ts` |
| 12.1 | `tests/proof/integration/lodashAlive.integration.test.ts`<br>`tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/property/p25a-alive-directory.test.ts`<br>`tests/proof/property/p25b-alive-tarball.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 12.2 | `tests/proof/integration/lodashBroken.integration.test.ts`<br>`tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 12.3 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/driver.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/report.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 12.4 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 12.5 | (none) |
| 12.6 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 12.7 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/property/p25c-unencodable-inconclusive.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 13.1 | `tests/proof/property/p23b-canonical-permutation.test.ts`<br>`tests/proof/unit/canonicalReport.test.ts` |
| 13.2 | `tests/proof/unit/canonicalReport.test.ts` |
| 13.3 | `tests/proof/property/p23b-canonical-permutation.test.ts`<br>`tests/proof/unit/canonicalReport.test.ts`<br>`tests/proof/unit/report.test.ts` |
| 13.4 | `tests/proof/integration/lodashBroken.integration.test.ts`<br>`tests/proof/property/p24-same-seed-same-bytes.test.ts` |
| 13.5 | (none) |
| 13.6 | `tests/proof/unit/types.test.ts` |
| 13.7 | (none) |
| 13.8 | (none) |
| 13.9 | (none) |
| 13.10 | `tests/proof/unit/normalize.test.ts` |
| 13.11 | `tests/proof/unit/codec.test.ts` |
| 13.12 | `tests/proof/unit/normalize.test.ts` |
| 13.13 | `tests/proof/unit/normalize.test.ts` |
| 13.14 | `tests/proof/unit/normalize.test.ts` |
| 13.15 | (none) |
| 13.16 | `tests/proof/unit/normalize.test.ts` |
| 13.17 | (none) |
| 13.18 | `tests/proof/unit/normalize.test.ts`<br>`tests/proof/unit/report.test.ts` |
| 13.19 | `tests/proof/integration/pathsSpaces.integration.test.ts`<br>`tests/proof/unit/normalize.test.ts` |
| 13.20 | `tests/proof/unit/normalize.test.ts` |
| 13.21 | `tests/proof/unit/normalize.test.ts` |
| 13.22 | `tests/proof/unit/normalize.test.ts` |
| 13.23 | `tests/proof/unit/report.test.ts`<br>`tests/proof/unit/tempRootLeak.test.ts` |
| 13.24 | `tests/proof/unit/normalize.test.ts`<br>`tests/proof/unit/tempRootLeak.test.ts` |
| 13.25 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/identity.test.ts`<br>`tests/proof/unit/identitySafety.test.ts`<br>`tests/proof/unit/redact.test.ts`<br>`tests/proof/unit/report.test.ts`<br>`tests/proof/unit/sourceScan.test.ts` |
| 13.26 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/cli.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/identity.test.ts`<br>`tests/proof/unit/identitySafety.test.ts`<br>`tests/proof/unit/report.test.ts` |
| 13.27 | `tests/proof/unit/identity.test.ts`<br>`tests/proof/unit/identitySafety.test.ts` |
| 13.28 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/cli.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/identitySafety.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/sourceScan.test.ts` |
| 13.29 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/identitySafety.test.ts` |
| 13.30 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/identitySafety.test.ts`<br>`tests/proof/unit/redact.test.ts`<br>`tests/proof/unit/report.test.ts` |
| 14.1 | `tests/proof/unit/fixtureIntegrity.test.ts`<br>`tests/proof/unit/recordTarball.test.ts` |
| 14.2 | `tests/proof/unit/fixtureIntegrity.test.ts` |
| 14.3 | `tests/proof/unit/fixtureIntegrity.test.ts` |
| 14.4 | `tests/proof/unit/fixtureIntegrity.test.ts`<br>`tests/proof/unit/lodashAliveFixture.test.ts` |
| 14.5 | `tests/proof/unit/fixtureIntegrity.test.ts`<br>`tests/proof/unit/lodashBrokenFixture.test.ts` |
| 14.6 | `tests/proof/unit/lodashHarness.test.ts` |
| 14.7 | `tests/proof/integration/lodashAlive.integration.test.ts` |
| 14.8 | `tests/proof/integration/lodashBroken.integration.test.ts` |
| 14.9 | (none) |
| 14.10 | `tests/proof/unit/lodashHarness.test.ts` |
| 14.11 | (none) |
| 15.1 | `tests/proof/integration/helpers.integration.test.ts` |
| 15.2 | `tests/proof/property/p24-same-seed-same-bytes.test.ts`<br>`tests/proof/property/p24b-different-seed-self-consistent.test.ts` |
| 15.3 | `tests/proof/property/p25a-alive-directory.test.ts`<br>`tests/proof/property/p25b-alive-tarball.test.ts`<br>`tests/proof/property/p25c-unencodable-inconclusive.test.ts`<br>`tests/proof/property/p25d-flaky-negative-control.test.ts` |
| 15.4 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts` |
| 15.5 | (none) |
| 15.6 | `tests/proof/integration/envScrubbed.integration.test.ts`<br>`tests/proof/integration/fileReadDenied.integration.test.ts`<br>`tests/proof/integration/networkDenied.integration.test.ts`<br>`tests/proof/integration/spawnDenied.integration.test.ts`<br>`tests/proof/integration/timeoutKill.integration.test.ts` |
| 15.7 | (none) |
| 15.8 | (none) |
| 15.9 | (none) |
| 15.10 | `tests/proof/unit/syntheticPackage.test.ts` |
| 15.11 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 15.12 | `tests/proof/unit/codec.test.ts` |
| 16.1 | (none) |
| 16.2 | `tests/proof/unit/determinismLint.test.ts`<br>`tests/proof/unit/sourceScan.test.ts` |
| 16.3 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/sourceScan.test.ts` |
| 16.4 | `tests/proof/unit/executorTypes.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 16.5 | (none) |
| 16.6 | (none) |

## Gaps

Criteria that no test file cites:

- Requirement 1: 1.3, 1.6
- Requirement 2: 2.4
- Requirement 3: 3.7, 3.8, 3.11
- Requirement 4: 4.5
- Requirement 6: 6.8
- Requirement 7: 7.10
- Requirement 8: 8.1, 8.2, 8.9, 8.10, 8.15
- Requirement 9: 9.2, 9.5
- Requirement 11: 11.1
- Requirement 12: 12.5
- Requirement 13: 13.5, 13.7, 13.8, 13.9, 13.15, 13.17
- Requirement 14: 14.9, 14.11
- Requirement 15: 15.5, 15.7, 15.8, 15.9
- Requirement 16: 16.1, 16.5, 16.6

## Cited numbers that do not exist in requirements.md

none
