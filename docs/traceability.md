# Traceability

Generated on 2026-11-15 by `npm run trace` (system date; this is documentation, not a measured number).

A citation shows which tests claim to cover a criterion; it does not prove coverage.

One section per spec. Acceptance criteria come from the spec's `requirements.md`; citations are the `// Requirements:` header lines of the test files. Gap classes (class and evidence per gap) for both specs are read from `docs/traceability-gaps.json`. An unclassified gap or a stale classification entry in either spec makes `npm run trace` exit with 1.

Header syntax: `// Requirements: 1.2, 4.3` is a bare list and means the spec the test belongs to (`tests/engine` is autopsy-engine, `tests/proof` is proof-of-life-engine). `// Requirements: proof-of-life-engine 15.5, 15.9` cites criteria of another spec, and groups are separated by semicolons: `// Requirements: 1.2, 4.3; proof-of-life-engine 15.5, 15.9`. A citation credits the criterion in the named spec's table, which shows the citing file path. An unknown spec name or an unknown number is listed under "Cited numbers that do not exist" in the section of the spec the citing file belongs to.

## Spec: autopsy-engine

Requirements: `.kiro/specs/autopsy-engine/requirements.md`. Tests: `tests/engine/**/*.test.ts`.

A citation shows which tests claim to cover a criterion; it does not prove coverage.

### Summary

- Test files scanned: 32
- Acceptance criteria: 107
- Criteria cited by at least one test file: 106
- Criteria with no citing test file (gaps): 1

### Criteria and citing test files

| Criterion | Test files |
| --- | --- |
| 1.1 | `tests/engine/unit/inputParser.test.ts` |
| 1.2 | `tests/engine/unit/inputParser.test.ts` |
| 1.3 | `tests/engine/unit/inputParser.test.ts` |
| 1.4 | `tests/engine/unit/versionResolver.test.ts` |
| 1.5 | `tests/engine/unit/versionResolver.test.ts` |
| 1.6 | `tests/engine/unit/versionResolver.test.ts` |
| 1.7 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/versionResolver.test.ts` |
| 1.8 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/inputParser.test.ts`<br>`tests/engine/unit/versionResolver.test.ts` |
| 1.9 | `tests/engine/unit/inputParser.test.ts` |
| 1.10 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/inputParser.test.ts`<br>`tests/engine/unit/publicApi.test.ts` |
| 1.11 | `tests/engine/unit/versionResolver.test.ts` |
| 2.1 | `tests/engine/unit/npmClient.test.ts` |
| 2.2 | `tests/engine/unit/osvAffectedFilter.test.ts`<br>`tests/engine/unit/osvClient.test.ts` |
| 2.3 | `tests/engine/unit/depsDevClient.test.ts` |
| 2.4 | `tests/engine/unit/githubClient.test.ts` |
| 2.5 | `tests/engine/unit/npmClient.test.ts` |
| 2.6 | `tests/engine/unit/githubClient.test.ts` |
| 2.7 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/githubClient.test.ts`<br>`tests/engine/unit/recordFixtures.test.ts` |
| 2.8 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/fixtureSecrets.test.ts`<br>`tests/engine/unit/githubClient.test.ts`<br>`tests/engine/unit/http.test.ts`<br>`tests/engine/unit/recordFixtures.test.ts` |
| 2.9 | `tests/engine/unit/depsDevClient.test.ts`<br>`tests/engine/unit/http.test.ts`<br>`tests/engine/unit/osvClient.test.ts` |
| 2.10 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/npmClient.test.ts` |
| 2.11 | `tests/engine/unit/depsDevClient.test.ts`<br>`tests/engine/unit/githubClient.test.ts`<br>`tests/engine/unit/http.test.ts`<br>`tests/engine/unit/osvClient.test.ts` |
| 2.12 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/githubClient.test.ts`<br>`tests/engine/unit/npmClient.test.ts` |
| 3.1 | `tests/engine/property/p09-fact-provenance.test.ts`<br>`tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/types.test.ts` |
| 3.2 | `tests/engine/unit/http.test.ts` |
| 3.3 | `tests/engine/unit/http.test.ts` |
| 3.4 | `tests/engine/property/p09-fact-provenance.test.ts`<br>`tests/engine/unit/certificate.test.ts` |
| 3.5 | `tests/engine/unit/certificate.test.ts` |
| 3.6 | `tests/engine/property/p09-fact-provenance.test.ts`<br>`tests/engine/unit/certificate.test.ts` |
| 4.1 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/inflightSuccessor.test.ts`<br>`tests/engine/unit/status.test.ts` |
| 4.2 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/inflightSuccessor.test.ts`<br>`tests/engine/unit/npmClient.test.ts` |
| 4.3 | `tests/engine/unit/successor.test.ts` |
| 4.4 | `tests/engine/unit/successor.test.ts` |
| 4.5 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/inflightSuccessor.test.ts`<br>`tests/engine/unit/successor.test.ts` |
| 4.6 | `tests/engine/unit/successor.test.ts` |
| 4.7 | `tests/engine/unit/successor.test.ts` |
| 4.8 | `tests/engine/unit/inflightSuccessor.test.ts`<br>`tests/engine/unit/successor.test.ts` |
| 4.9 | `tests/engine/unit/successor.test.ts` |
| 4.10 | `tests/engine/unit/status.test.ts` |
| 4.11 | `tests/engine/unit/status.test.ts` |
| 4.12 | `tests/engine/unit/status.test.ts` |
| 4.13 | `tests/engine/unit/status.test.ts` |
| 4.14 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/status.test.ts` |
| 4.15 | `tests/engine/unit/status.test.ts`<br>`tests/engine/unit/types.test.ts` |
| 5.1 | `tests/engine/unit/causes.test.ts` |
| 5.2 | `tests/engine/unit/causes.test.ts` |
| 5.3 | `tests/engine/unit/causes.test.ts`<br>`tests/engine/unit/osvAffectedFilter.test.ts` |
| 5.4 | `tests/engine/unit/causes.test.ts` |
| 5.5 | `tests/engine/unit/causes.test.ts` |
| 5.6 | `tests/engine/unit/causes.test.ts` |
| 5.7 | `tests/engine/unit/causes.test.ts`<br>`tests/engine/unit/osvAffectedFilter.test.ts` |
| 5.8 | `tests/engine/unit/causes.test.ts` |
| 5.9 | `tests/engine/unit/causes.test.ts` |
| 6.1 | `tests/engine/unit/timeOfDeath.test.ts` |
| 6.2 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/timeOfDeath.test.ts` |
| 6.3 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/timeOfDeath.test.ts` |
| 6.4 | `tests/engine/unit/certificate.test.ts` |
| 6.5 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/timeOfDeath.test.ts` |
| 7.1 | `tests/engine/unit/certificate.test.ts` |
| 7.2 | `tests/engine/unit/certificate.test.ts` |
| 7.3 | `tests/engine/unit/certificate.test.ts` |
| 7.4 | `tests/engine/unit/certificate.test.ts` |
| 7.5 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/osvClient.test.ts` |
| 7.6 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/osvClient.test.ts` |
| 7.7 | `tests/engine/unit/osvClient.test.ts` |
| 7.8 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/depsDevClient.test.ts` |
| 7.9 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/depsDevClient.test.ts` |
| 7.10 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/depsDevClient.test.ts` |
| 8.1 | `tests/engine/unit/risk.test.ts`<br>`tests/engine/unit/types.test.ts` |
| 8.2 | `tests/engine/property/p23-idempotence.test.ts`<br>`tests/engine/unit/risk.test.ts` |
| 8.3 | `tests/engine/property/p18-risk-monotonicity.test.ts`<br>`tests/engine/unit/risk.test.ts` |
| 8.4 | `tests/engine/property/p18-risk-monotonicity.test.ts`<br>`tests/engine/unit/risk.test.ts` |
| 8.5 | `tests/engine/unit/risk.test.ts` |
| 8.6 | `tests/engine/unit/risk.test.ts` |
| 8.7 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/risk.test.ts` |
| 8.8 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/risk.test.ts` |
| 8.9 | `tests/engine/unit/certificate.test.ts`<br>`tests/engine/unit/risk.test.ts` |
| 9.1 | `tests/engine/unit/http.test.ts` |
| 9.2 | `tests/engine/unit/http.test.ts` |
| 9.3 | `tests/engine/unit/http.test.ts` |
| 9.4 | `tests/engine/unit/http.test.ts` |
| 9.5 | `tests/engine/unit/cache.test.ts`<br>`tests/engine/unit/http.test.ts` |
| 9.6 | `tests/engine/unit/cache.test.ts`<br>`tests/engine/unit/fixtureSecrets.test.ts`<br>`tests/engine/unit/http.test.ts`<br>`tests/engine/unit/recordFixtures.test.ts` |
| 9.7 | `tests/engine/unit/cache.test.ts` |
| 9.8 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/cache.test.ts` |
| 9.9 | `tests/engine/unit/http.test.ts` |
| 10.1 | `tests/engine/unit/networkGuard.test.ts` |
| 10.2 | `tests/engine/unit/defaultAnalysisDate.test.ts`<br>`tests/engine/unit/determinismLint.test.ts` |
| 10.3 | `tests/engine/property/p23-idempotence.test.ts` |
| 10.4 | `tests/engine/unit/autopsy.test.ts`<br>`tests/engine/unit/serializer.test.ts` |
| 10.5 | `tests/engine/unit/serializer.test.ts` |
| 10.6 | `tests/engine/property/p25-serialization-roundtrip.test.ts`<br>`tests/engine/unit/serializer.test.ts` |
| 10.7 | `tests/engine/unit/serializer.test.ts` |
| 11.1 | `tests/engine/unit/fixtures.test.ts` |
| 11.2 | `tests/engine/unit/fixtures.test.ts` |
| 11.3 | `tests/engine/unit/fixtures.test.ts`<br>`tests/engine/unit/inflightSuccessor.test.ts` |
| 11.4 | `tests/engine/unit/fixtureSecrets.test.ts`<br>`tests/engine/unit/fixtures.test.ts`<br>`tests/engine/unit/networkGuard.test.ts`<br>`tests/engine/unit/recordFixtures.test.ts`<br>`tests/engine/unit/replayFetch.test.ts` |
| 11.5 | `tests/engine/unit/fixtures.test.ts` |
| 11.6 | `tests/engine/unit/fixtures.test.ts`<br>`tests/engine/unit/replayFetch.test.ts` |
| 11.7 | `tests/engine/property/p23-idempotence.test.ts`<br>`tests/engine/unit/fixtures.test.ts` |
| 12.1 | `tests/engine/property/p23-idempotence.test.ts` |
| 12.2 | `tests/engine/property/p18-risk-monotonicity.test.ts` |
| 12.3 | `tests/engine/property/p25-serialization-roundtrip.test.ts` |
| 12.4 | `tests/engine/property/p09-fact-provenance.test.ts` |
| 12.5 | `tests/engine/helpers/fc.test.ts` |
| 12.6 | `tests/engine/helpers/fc.test.ts` |
| 12.7 | (none) |

### Gaps

Criteria that no test file cites, with the class and evidence from `docs/traceability-gaps.json`:

- 12.7: needs a test. No test or budget covers the 120 s limit for the engine project: README.md (test projects table) lists the engine project with target none, and tests/proof/helpers/budgetReporter.ts sets targets only for the proof-property, proof-heavy and proof-integration projects. design.md (Test strategy) states the limit and docs/kiro-journal.md has no engine-project timing. A test or budget would measure the wall-clock of the tests/engine property files and fail above 120 s.

Gaps per class:

- needs a test: 1
- documentation only: 0
- covered, header missing: 0

### Classification check

- Unclassified gaps: none
- Classified criteria that do not exist in requirements.md: none
- Stale classification entries (no longer gaps): none
- Duplicate classification entries: none

### Cited numbers that do not exist in requirements.md

none

## Spec: proof-of-life-engine

Requirements: `.kiro/specs/proof-of-life-engine/requirements.md`. Tests: `tests/proof/**/*.test.ts`.

A citation shows which tests claim to cover a criterion; it does not prove coverage.

### Summary

- Test files scanned: 68
- Acceptance criteria: 165
- Criteria cited by at least one test file: 149
- Criteria with no citing test file (gaps): 16

### Criteria and citing test files

| Criterion | Test files |
| --- | --- |
| 1.1 | `tests/proof/unit/orchestrator.test.ts` |
| 1.2 | `tests/proof/unit/orchestrator.test.ts` |
| 1.3 | `tests/proof/integration/lodashAlive.integration.test.ts` |
| 1.4 | `tests/proof/unit/cli.test.ts` |
| 1.5 | `tests/proof/unit/orchestrator.test.ts` |
| 1.6 | `tests/proof/unit/sourceScan.test.ts` |
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
| 3.8 | `tests/proof/unit/sourceScan.test.ts` |
| 3.9 | `tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
| 3.10 | `tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/tarballExtractor.test.ts` |
| 3.11 | (none) |
| 4.1 | `tests/proof/property/p04-tree-hash.test.ts` |
| 4.2 | `tests/proof/property/p04-tree-hash.test.ts`<br>`tests/proof/unit/treeHash.test.ts`<br>`tests/proof/unit/workDir.test.ts` |
| 4.3 | `tests/proof/property/p04-tree-hash.test.ts`<br>`tests/proof/unit/treeHash.test.ts` |
| 4.4 | `tests/proof/property/p04-tree-hash.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/treeHash.test.ts` |
| 4.5 | `tests/proof/unit/orchestrator.test.ts` |
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
| 8.1 | `tests/proof/unit/orchestrator.test.ts` |
| 8.2 | `tests/proof/integration/lodashAlive.integration.test.ts`<br>`tests/proof/unit/sideRuntime.test.ts` |
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
| 9.2 | `tests/proof/unit/driver.test.ts` |
| 9.3 | `tests/proof/property/p25d-flaky-negative-control.test.ts`<br>`tests/proof/unit/driver.test.ts` |
| 9.4 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/property/p25d-flaky-negative-control.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 9.5 | `tests/proof/property/p25d-flaky-negative-control.test.ts` |
| 10.1 | `tests/proof/unit/apiSurface.test.ts`<br>`tests/proof/unit/lodashHarness.test.ts` |
| 10.2 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts`<br>`tests/proof/unit/apiSurface.test.ts` |
| 10.3 | `tests/proof/unit/apiSurface.test.ts` |
| 10.4 | `tests/proof/property/p21-verdict.test.ts`<br>`tests/proof/unit/orchestrator.test.ts`<br>`tests/proof/unit/verdict.test.ts` |
| 11.1 | `tests/proof/integration/lodashAlive.integration.test.ts`<br>`tests/proof/unit/lodashHarness.test.ts` |
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
| 13.7 | `tests/proof/property/p23b-canonical-permutation.test.ts` |
| 13.8 | (none) |
| 13.9 | `tests/proof/unit/driver.test.ts` |
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
| 14.9 | `tests/proof/integration/lodashAlive.integration.test.ts` |
| 14.10 | `tests/proof/unit/lodashHarness.test.ts` |
| 14.11 | (none) |
| 15.1 | `tests/proof/integration/helpers.integration.test.ts` |
| 15.2 | `tests/proof/property/p24-same-seed-same-bytes.test.ts`<br>`tests/proof/property/p24b-different-seed-self-consistent.test.ts` |
| 15.3 | `tests/proof/property/p25a-alive-directory.test.ts`<br>`tests/proof/property/p25b-alive-tarball.test.ts`<br>`tests/proof/property/p25c-unencodable-inconclusive.test.ts`<br>`tests/proof/property/p25d-flaky-negative-control.test.ts` |
| 15.4 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts` |
| 15.5 | `tests/engine/helpers/fc.test.ts` |
| 15.6 | `tests/proof/integration/envScrubbed.integration.test.ts`<br>`tests/proof/integration/fileReadDenied.integration.test.ts`<br>`tests/proof/integration/networkDenied.integration.test.ts`<br>`tests/proof/integration/spawnDenied.integration.test.ts`<br>`tests/proof/integration/timeoutKill.integration.test.ts` |
| 15.7 | `tests/proof/unit/budgetReporter.test.ts` |
| 15.8 | `tests/proof/unit/budgetReporter.test.ts` |
| 15.9 | `tests/engine/helpers/fc.test.ts`<br>`tests/engine/unit/networkGuard.test.ts` |
| 15.10 | `tests/proof/unit/syntheticPackage.test.ts` |
| 15.11 | `tests/proof/property/p26-injected-changes.test.ts`<br>`tests/proof/property/p26b-declared-delta.test.ts`<br>`tests/proof/unit/codec.test.ts` |
| 15.12 | `tests/proof/unit/codec.test.ts` |
| 16.1 | `tests/proof/unit/sourceScan.test.ts` |
| 16.2 | `tests/proof/unit/determinismLint.test.ts`<br>`tests/proof/unit/sourceScan.test.ts` |
| 16.3 | `tests/proof/integration/lodashIdentity.integration.test.ts`<br>`tests/proof/unit/endToEndIdentity.test.ts`<br>`tests/proof/unit/sourceScan.test.ts` |
| 16.4 | `tests/proof/unit/executorTypes.test.ts`<br>`tests/proof/unit/sandboxExecutor.test.ts` |
| 16.5 | (none) |
| 16.6 | (none) |

### Gaps

Criteria that no test file cites, with the class and evidence from `docs/traceability-gaps.json`:

- 2.4: needs a test. tests/proof/unit/orchestrator.test.ts asserts original.verified and original.integrity, but no test asserts that report.package holds the Original name and exact version. A test would run runProofOfLife and compare report.package with the request's original name and version.
- 3.7: documentation only. PREEXISTING.md lists tar 7.5.23 with chownr, minipass, yallist, @isaacs/fs-minipass and minizlib, each with license and source URL, and the D9 note on BlueOak-1.0.0. A grep of src and scripts shows only src/proof/shell/tarball/tarballExtractor.ts imports tar; no test enforces it (see 3.8).
- 3.11: documentation only. README.md 'Known limitations' states that ESM is not supported and describes the undetected case (L12). design.md 'unloadable-module detection' states that R3.11 forbids claiming ES module support. A package with type module is rejected as unloadable-module (tests/proof/unit/orchestrator.test.ts, 'type module' case).
- 6.8: documentation only. design.md section 'Known limitations', item L1 (reference identity), states the consequence for argument aliasing and for functions that return their arguments. README.md 'Known limitations' repeats L1 in short form.
- 7.10: needs a test. src/proof/core/equal.ts imports only the codec and types, and the determinism lint (tests/proof/unit/determinismLint.test.ts, cited 16.2) bans Date.now, new Date() and Math.random in core, but no test checks that the comparison modules import no node:fs or clock. A test would scan the imports of src/proof/core/equal.ts and its codec dependencies for node:fs and clock access.
- 8.9: needs a test. No test runs a setup module before the package loads. orchestrator.test.ts only validates that setupModule is an absolute path, and protocol.test.ts only round-trips the load message. A test would give a harness a setupModule that stubs a value, open both sides through a real executor and check that the package sees the stub on each side.
- 8.10: needs a test. The ip harness is out of scope (16.6) and nothing replaces os.networkInterfaces through a setup module in any test or harness. The same setup-module test as 8.9, with a setup module that replaces os.networkInterfaces, would show it applied identically to both sides.
- 8.15: documentation only. README.md 'Known limitations' states that an unbounded .filter hangs the run and cannot be detected (L13), and gives the rule for harness authors. The criterion itself says the rule is enforced by code review and the runner timeout, so no engine behavior is tested.
- 12.5: needs a test. tests/proof/integration/lodashBroken.integration.test.ts asserts Replay_Parameters, both Outcomes and the shrink fields of a divergence, and tests/proof/unit/report.test.ts asserts redactionMaskedDifference, but no test asserts that report.seed equals the harness Seed. A test would run runProofOfLife with a fixed seed and compare report.seed.
- 13.5: needs a test. tests/proof/unit/report.test.ts only passes injected toolVersions through buildReport and checks reportSchema 1. No test asserts that defaultProofDeps() reads process.version and the fast-check version at run time. A test would compare defaultProofDeps().toolVersions with process.version and the installed fast-check version.
- 13.8: documentation only. docs/proof-of-life-ordering.md: sections 'Key order' (top level and nested tables, position of unencodableValues), 'List ordering', 'Divergence sort' (redacted counterexample), 'Divergence shape and redactionMaskedDifference' and 'Unencodable reasons' (code point order of reasons keys).
- 13.15: needs a test. tests/proof/unit/normalize.test.ts and tempRootLeak.test.ts exercise the redaction, and tempRootLeak.test.ts loops over both sides, but no test states that the Path_Redactor is a pure function of text and roots or that both sides get the same treatment. A test would call it twice on equal inputs (inputs unchanged, equal outputs) and compare the output for the Original and Resurrection with swapped roots.
- 13.17: needs a test. tests/proof/unit/tempRootLeak.test.ts (serialized report and temp roots) and endToEndIdentity.test.ts (home path) cover two of the three. No test builds a serialized report from an error message holding the Node installation directory and checks the text; normalize.test.ts checks the Node directory only on redactErrorText. A test would run the report builder with such a message and assert the serialized text lacks the directory.
- 14.11: documentation only. PREEXISTING.md lists tar with chownr, minipass, yallist, @isaacs/fs-minipass and minizlib, and the lodash.set@4.3.2 tarball (section 'Third-party material in test fixtures'), with license and source. .kiro/steering/necromancy-laws.md states that the MIT/ISC/BSD/Apache-2.0 list applies to resurrected packages and that project dependencies may use BlueOak-1.0.0.
- 16.5: needs a test. Scope exclusions (no attestation signing, pull requests, Kiro agents, native addons) have no test; a grep of src/proof found no such code. Cycles stay unencodable (codec.test.ts cites 6.x) and a type module package is rejected as unloadable-module (orchestrator.test.ts). A source scan test, extending the one for 1.6 and 16.1, would fail on imports of an attestation or GitHub client, Kiro, or a .node addon load.
- 16.6: documentation only. design.md: the ProofRequest comment 'Reserved for D4 (read-only dependency root)' (the strict schema rejects a dependencyRoot key), the ip harness section naming SideSpec.readPaths as the extension point, and the 'Deliberately not tested' list ('The ip harness (design hook only)'). src/proof contains no dependency root or ip harness.

Gaps per class:

- needs a test: 9
- documentation only: 7
- covered, header missing: 0

### Classification check

- Unclassified gaps: none
- Classified criteria that do not exist in requirements.md: none
- Stale classification entries (no longer gaps): none
- Duplicate classification entries: none

### Cited numbers that do not exist in requirements.md

none
