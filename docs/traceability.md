# Traceability

Generated on 2026-11-17 by `npm run trace` (system date; this is documentation, not a measured number).

A citation shows which tests claim to cover a criterion; it does not prove coverage.

One section per spec. Acceptance criteria come from the spec's `requirements.md`; citations are the `// Requirements:` header lines of the test files. Gap classes (class and evidence per gap) for every spec are read from `docs/traceability-gaps.json`. An unclassified gap or a stale classification entry in any spec makes `npm run trace` exit with 1.

Header syntax: `// Requirements: 1.2, 4.3` is a bare list and means the spec the test belongs to (`tests/engine` is autopsy-engine, `tests/proof` is proof-of-life-engine, `tests/pipeline` is resurrection-pipeline, `tests/medium` is medium-agent). `// Requirements: proof-of-life-engine 15.5, 15.9` cites criteria of another spec, and groups are separated by semicolons: `// Requirements: 1.2, 4.3; proof-of-life-engine 15.5, 15.9`. A citation credits the criterion in the named spec's table, which shows the citing file path. An unknown spec name or an unknown number is listed under "Cited numbers that do not exist" in the section of the spec the citing file belongs to.

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
- manual: 0
- optional, skipped in first pass: 0

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

- Test files scanned: 69
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
- manual: 0
- optional, skipped in first pass: 0

### Classification check

- Unclassified gaps: none
- Classified criteria that do not exist in requirements.md: none
- Stale classification entries (no longer gaps): none
- Duplicate classification entries: none

### Cited numbers that do not exist in requirements.md

none

## Spec: resurrection-pipeline

Requirements: `.kiro/specs/resurrection-pipeline/requirements.md`. Tests: `tests/pipeline/**/*.test.ts`.

A citation shows which tests claim to cover a criterion; it does not prove coverage.

### Summary

- Test files scanned: 78
- Acceptance criteria: 307
- Criteria cited by at least one test file: 252
- Criteria with no citing test file (gaps): 55

### Criteria and citing test files

| Criterion | Test files |
| --- | --- |
| 1.1 | (none) |
| 1.2 | `tests/pipeline/unit/sourceScan.test.ts` |
| 1.3 | `tests/pipeline/unit/untrustedMediumOutput.test.ts` |
| 1.4 | `tests/pipeline/property/p22-attest-decision.test.ts`<br>`tests/pipeline/unit/gates.test.ts` |
| 1.5 | `tests/pipeline/unit/sourceScan.test.ts` |
| 1.6 | `tests/pipeline/unit/constants.test.ts`<br>`tests/pipeline/unit/determinismLint.test.ts`<br>`tests/pipeline/unit/packageNames.test.ts` |
| 2.1 | `tests/pipeline/unit/gravedigger.test.ts` |
| 2.2 | `tests/pipeline/unit/gravedigger.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts` |
| 2.3 | `tests/pipeline/unit/gravediggerRecord.test.ts`<br>`tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.4 | `tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.5 | `tests/pipeline/unit/gravediggerRecord.test.ts`<br>`tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.6 | `tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts`<br>`tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.7 | `tests/pipeline/unit/gravedigger.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts` |
| 2.8 | `tests/pipeline/unit/gravedigger.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts`<br>`tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.9 | `tests/pipeline/property/p01-eligibility-roundtrip.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts` |
| 2.10 | `tests/pipeline/property/p01-eligibility-roundtrip.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts` |
| 2.11 | `tests/pipeline/unit/gravedigger.test.ts`<br>`tests/pipeline/unit/gravediggerRecord.test.ts` |
| 2.12 | `tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.13 | `tests/pipeline/unit/gravediggerRules.test.ts` |
| 2.14 | `tests/pipeline/unit/gravediggerRecord.test.ts` |
| 2.15 | `tests/pipeline/unit/gravediggerRecord.test.ts` |
| 3.1 | `tests/pipeline/unit/measureIp.test.ts` |
| 3.2 | `tests/pipeline/unit/measureIp.test.ts` |
| 3.3 | `tests/pipeline/unit/ipMeasurement.test.ts`<br>`tests/pipeline/unit/measureIp.test.ts` |
| 3.4 | `tests/pipeline/unit/measureIp.test.ts` |
| 3.5 | `tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/ipMeasurement.test.ts` |
| 3.6 | `tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpected.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpectedClass.test.ts`<br>`tests/pipeline/unit/ipMeasurement.test.ts` |
| 3.7 | `tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpectedClass.test.ts`<br>`tests/pipeline/unit/ipMeasurement.test.ts` |
| 3.8 | `tests/pipeline/unit/ipMeasurement.test.ts` |
| 3.9 | `tests/proof/unit/fixtureIntegrity.test.ts` |
| 3.10 | `tests/pipeline/unit/measureIp.test.ts` |
| 3.11 | `tests/pipeline/unit/ipMeasurement.test.ts`<br>`tests/pipeline/unit/measureIp.test.ts` |
| 4.1 | `tests/pipeline/unit/deltasFile.test.ts` |
| 4.2 | `tests/pipeline/unit/compilerReturnsExpectedClass.test.ts`<br>`tests/pipeline/unit/deltasFile.test.ts` |
| 4.3 | `tests/pipeline/unit/compiler.test.ts` |
| 4.4 | `tests/pipeline/unit/compilerReturnsExpected.test.ts` |
| 4.5 | `tests/pipeline/unit/compiler.test.ts` |
| 4.6 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpected.test.ts` |
| 4.7 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpected.test.ts` |
| 4.8 | `tests/pipeline/unit/compilerReturnsExpectedClass.test.ts`<br>`tests/pipeline/unit/deltasFile.test.ts` |
| 4.9 | `tests/pipeline/property/p06-deltas-roundtrip.test.ts` |
| 4.10 | `tests/pipeline/property/p06-deltas-roundtrip.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpectedClass.test.ts`<br>`tests/pipeline/unit/deltasFile.test.ts` |
| 4.11 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/stubFixture.test.ts` |
| 4.12 | `tests/pipeline/integration/ipAlive.integration.test.ts`<br>`tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpected.test.ts` |
| 4.13 | `tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpectedClass.test.ts` |
| 4.14 | `tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpectedClass.test.ts` |
| 4.15 | `tests/pipeline/unit/compilerReturnsExpectedClass.test.ts` |
| 4.16 | `tests/pipeline/unit/compilerReturnsExpectedClass.test.ts` |
| 4.17 | `tests/pipeline/unit/ipAliveClassEquivalence.test.ts`<br>`tests/pipeline/unit/nonPublicAddress.test.ts` |
| 4.18 | `tests/pipeline/unit/nonPublicAddress.test.ts` |
| 4.19 | `tests/pipeline/unit/nonPublicAddress.test.ts` |
| 4.20 | `tests/pipeline/unit/compilerIp.test.ts`<br>`tests/pipeline/unit/compilerReturnsExpectedClass.test.ts`<br>`tests/pipeline/unit/nonPublicAddress.test.ts` |
| 5.1 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/harnessFile.test.ts` |
| 5.2 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/harnessFile.test.ts` |
| 5.3 | `tests/pipeline/unit/compiler.test.ts` |
| 5.4 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/missingGenerator.test.ts`<br>`tests/pipeline/unit/proveEntry.test.ts` |
| 5.5 | `tests/pipeline/property/p10-compile-deterministic.test.ts`<br>`tests/pipeline/unit/compiler.test.ts` |
| 5.6 | `tests/pipeline/integration/ipExports.integration.test.ts`<br>`tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/ipPreset.test.ts`<br>`tests/pipeline/unit/nonPublicAddress.test.ts` |
| 5.7 | `tests/pipeline/integration/lodashHarness.integration.test.ts` |
| 5.8 | `tests/pipeline/integration/ipExports.integration.test.ts`<br>`tests/pipeline/integration/ipSetup.integration.test.ts`<br>`tests/pipeline/unit/ipPreset.test.ts` |
| 5.9 | `tests/pipeline/property/p08-harness-roundtrip.test.ts` |
| 5.10 | `tests/pipeline/property/p08-harness-roundtrip.test.ts`<br>`tests/pipeline/unit/harnessFile.test.ts` |
| 5.11 | `tests/pipeline/unit/compiler.test.ts`<br>`tests/pipeline/unit/proveEntry.test.ts` |
| 5.12 | `tests/pipeline/integration/ipAlive.integration.test.ts`<br>`tests/pipeline/integration/ipExports.integration.test.ts`<br>`tests/pipeline/unit/ipPreset.test.ts`<br>`tests/pipeline/unit/missingGenerator.test.ts` |
| 5.13 | `tests/pipeline/unit/missingGenerator.test.ts` |
| 5.14 | `tests/pipeline/unit/missingGenerator.test.ts` |
| 6.1 | `tests/pipeline/unit/cliArgs.test.ts` |
| 6.2 | `tests/pipeline/unit/cliArgs.test.ts` |
| 6.3 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.4 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.5 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.6 | `tests/pipeline/unit/kiroRunner.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 6.7 | `tests/medium/integration/secrets.integration.test.ts`<br>`tests/pipeline/unit/kiroRunner.test.ts` |
| 6.8 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.9 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.10 | `tests/pipeline/unit/push.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 6.11 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.12 | `tests/pipeline/unit/kiroRunner.test.ts`<br>`tests/pipeline/unit/sourceScan.test.ts` |
| 6.13 | `tests/pipeline/unit/kiroRunner.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 6.14 | `tests/pipeline/unit/resurrect.test.ts` |
| 6.15 | `tests/pipeline/unit/resurrect.test.ts` |
| 7.1 | `tests/pipeline/unit/resurrect.test.ts` |
| 7.2 | `tests/pipeline/unit/resurrect.test.ts` |
| 7.3 | `tests/pipeline/unit/ledger.test.ts` |
| 7.4 | `tests/pipeline/unit/ledger.test.ts` |
| 7.5 | `tests/pipeline/unit/ledger.test.ts` |
| 7.6 | `tests/pipeline/unit/resurrect.test.ts` |
| 7.7 | `tests/pipeline/property/p11-ledger-roundtrip.test.ts`<br>`tests/pipeline/unit/ledger.test.ts` |
| 7.8 | `tests/pipeline/unit/ledger.test.ts` |
| 7.9 | `tests/pipeline/unit/ledger.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 7.10 | `tests/pipeline/unit/ledger.test.ts`<br>`tests/pipeline/unit/redact.test.ts` |
| 7.11 | `tests/pipeline/unit/resurrect.test.ts` |
| 8.1 | `tests/pipeline/property/p13-intake-paths.test.ts`<br>`tests/pipeline/unit/push.test.ts` |
| 8.2 | `tests/pipeline/unit/push.test.ts` |
| 8.3 | `tests/pipeline/unit/branchNames.test.ts`<br>`tests/pipeline/unit/push.test.ts` |
| 8.4 | `tests/pipeline/unit/push.test.ts` |
| 8.5 | `tests/pipeline/unit/push.test.ts` |
| 8.6 | `tests/pipeline/unit/push.test.ts` |
| 8.7 | `tests/pipeline/unit/push.test.ts` |
| 8.8 | (none) |
| 8.9 | `tests/pipeline/unit/push.test.ts` |
| 8.10 | (none) |
| 8.11 | `tests/pipeline/unit/push.test.ts` |
| 8.12 | `tests/pipeline/unit/push.test.ts` |
| 9.1 | `tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/dispatchInputs.test.ts` |
| 9.2 | `tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/dispatchInputs.test.ts`<br>`tests/pipeline/unit/packTarball.test.ts` |
| 9.3 | `tests/pipeline/integration/gitEntries.integration.test.ts`<br>`tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/fsEntries.test.ts` |
| 9.4 | `tests/pipeline/integration/gitEntries.integration.test.ts`<br>`tests/pipeline/unit/ciIntakeEntry.test.ts` |
| 9.5 | `tests/medium/property/p04-path-rules-oracle.test.ts`<br>`tests/pipeline/integration/gitEntries.integration.test.ts`<br>`tests/pipeline/property/p13-intake-paths.test.ts`<br>`tests/pipeline/unit/fsEntries.test.ts`<br>`tests/pipeline/unit/intakeValidator.test.ts` |
| 9.6 | `tests/medium/property/p04-path-rules-oracle.test.ts`<br>`tests/pipeline/integration/gitEntries.integration.test.ts`<br>`tests/pipeline/property/p13-intake-paths.test.ts`<br>`tests/pipeline/unit/intakeValidator.test.ts` |
| 9.7 | `tests/pipeline/unit/intakeValidator.test.ts` |
| 9.8 | `tests/pipeline/unit/intakeValidator.test.ts` |
| 9.9 | `tests/pipeline/unit/intakeValidator.test.ts` |
| 9.10 | `tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 9.11 | `tests/pipeline/property/p13-intake-paths.test.ts` |
| 9.12 | `tests/pipeline/integration/gitEntries.integration.test.ts`<br>`tests/pipeline/unit/intakeValidator.test.ts` |
| 9.13 | `tests/pipeline/unit/workflowLint.test.ts` |
| 9.14 | (none) |
| 10.1 | `tests/pipeline/unit/necromancy.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 10.2 | `tests/pipeline/unit/necromancy.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 10.3 | `tests/pipeline/unit/necromancy.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 10.4 | `tests/pipeline/property/p15-necromancy-version.test.ts`<br>`tests/pipeline/unit/necromancy.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 10.5 | `tests/pipeline/property/p16-necromancy-name.test.ts`<br>`tests/pipeline/unit/necromancy.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 10.6 | `tests/pipeline/unit/necromancy.test.ts`<br>`tests/pipeline/unit/stubFixtureIp.test.ts` |
| 10.7 | `tests/pipeline/unit/apiSurfaceVerdict.test.ts` |
| 10.8 | `tests/pipeline/unit/ciIntakeEntry.test.ts` |
| 10.9 | `tests/pipeline/property/p15-necromancy-version.test.ts`<br>`tests/pipeline/property/p16-necromancy-name.test.ts`<br>`tests/pipeline/unit/necromancy.test.ts` |
| 11.1 | `tests/pipeline/unit/ciIntakeEntry.test.ts` |
| 11.2 | `tests/pipeline/property/p23-publish-gate.test.ts`<br>`tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/gates.test.ts`<br>`tests/pipeline/unit/planIntake.test.ts` |
| 11.3 | `tests/pipeline/unit/ciIntakeEntry.test.ts` |
| 11.4 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.5 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.6 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.7 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.8 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.9 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.10 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.11 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.12 | `tests/pipeline/unit/ciIntakeEntry.test.ts` |
| 11.13 | `tests/pipeline/unit/workflowLint.test.ts` |
| 11.14 | `tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/workflowLint.test.ts` |
| 11.15 | `tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/planIntake.test.ts` |
| 11.16 | `tests/pipeline/property/p22-attest-decision.test.ts`<br>`tests/pipeline/property/p23-publish-gate.test.ts`<br>`tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/gates.test.ts` |
| 11.17 | `tests/pipeline/property/p22-attest-decision.test.ts`<br>`tests/pipeline/property/p23-publish-gate.test.ts`<br>`tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/gates.test.ts` |
| 11.18 | `tests/pipeline/unit/workflowLint.test.ts` |
| 12.1 | `tests/pipeline/unit/packTarball.test.ts`<br>`tests/pipeline/unit/proveEntry.test.ts` |
| 12.2 | `tests/pipeline/unit/proveEntry.test.ts` |
| 12.3 | `tests/pipeline/unit/proveEntry.test.ts` |
| 12.4 | `tests/pipeline/unit/proveEntry.test.ts`<br>`tests/pipeline/unit/proveExit.test.ts` |
| 12.5 | `tests/pipeline/unit/proveEntry.test.ts` |
| 12.6 | `tests/pipeline/unit/ciIntakeEntry.test.ts`<br>`tests/pipeline/unit/workflowLint.test.ts` |
| 12.7 | (none) |
| 12.8 | `tests/pipeline/unit/workflowLint.test.ts` |
| 12.9 | (none) |
| 12.10 | (none) |
| 12.11 | (none) |
| 12.12 | `tests/pipeline/unit/missingGenerator.test.ts`<br>`tests/pipeline/unit/proveEntry.test.ts`<br>`tests/pipeline/unit/workflowLint.test.ts` |
| 13.1 | `tests/pipeline/property/p22-attest-decision.test.ts`<br>`tests/pipeline/unit/gates.test.ts`<br>`tests/pipeline/unit/predicate.test.ts` |
| 13.2 | `tests/pipeline/property/p22-attest-decision.test.ts`<br>`tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/gates.test.ts` |
| 13.3 | `tests/pipeline/property/p22-attest-decision.test.ts`<br>`tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/gates.test.ts` |
| 13.4 | `tests/pipeline/unit/ciEntries.test.ts` |
| 13.5 | `tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/workflowLint.test.ts` |
| 13.6 | `tests/pipeline/property/p21-predicate.test.ts`<br>`tests/pipeline/unit/predicate.test.ts` |
| 13.7 | `tests/pipeline/property/p21-predicate.test.ts`<br>`tests/pipeline/unit/predicate.test.ts` |
| 13.8 | `tests/pipeline/unit/constants.test.ts`<br>`tests/pipeline/unit/sourceScan.test.ts` |
| 13.9 | `tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 13.10 | `tests/pipeline/property/p23-publish-gate.test.ts`<br>`tests/pipeline/unit/gates.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 13.11 | `tests/pipeline/unit/predicate.test.ts` |
| 13.12 | `tests/pipeline/unit/prText.test.ts` |
| 14.1 | `tests/pipeline/property/p23-publish-gate.test.ts`<br>`tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/gates.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 14.2 | `tests/pipeline/unit/layout.test.ts` |
| 14.3 | `tests/pipeline/unit/layout.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 14.4 | `tests/pipeline/unit/layout.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 14.5 | `tests/pipeline/unit/prText.test.ts` |
| 14.6 | `tests/pipeline/unit/restlessEntryKept.test.ts` |
| 14.7 | `tests/pipeline/unit/branchNames.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 14.8 | (none) |
| 14.9 | `tests/pipeline/unit/prText.test.ts` |
| 14.10 | (none) |
| 14.11 | (none) |
| 14.12 | `tests/pipeline/unit/docsConsistency.test.ts`<br>`tests/pipeline/unit/layout.test.ts` |
| 14.13 | `tests/pipeline/unit/layout.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 14.14 | `tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/prText.test.ts` |
| 14.15 | `tests/pipeline/unit/layout.test.ts` |
| 14.16 | `tests/pipeline/property/p29-nightly-not-resurrected.test.ts`<br>`tests/pipeline/unit/prText.test.ts` |
| 15.1 | `tests/pipeline/property/p23-publish-gate.test.ts`<br>`tests/pipeline/unit/gates.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 15.2 | `tests/pipeline/unit/prText.test.ts` |
| 15.3 | `tests/pipeline/unit/prText.test.ts` |
| 15.4 | `tests/pipeline/unit/prText.test.ts` |
| 15.5 | `tests/pipeline/unit/prText.test.ts` |
| 15.6 | `tests/pipeline/unit/publish.test.ts` |
| 15.7 | `tests/pipeline/unit/publish.test.ts` |
| 15.8 | `tests/pipeline/unit/publish.test.ts` |
| 15.9 | `tests/pipeline/unit/prText.test.ts` |
| 15.10 | `tests/pipeline/unit/prText.test.ts` |
| 15.11 | `tests/pipeline/unit/ciEntries.test.ts`<br>`tests/pipeline/unit/prText.test.ts` |
| 15.12 | `tests/pipeline/unit/prText.test.ts`<br>`tests/pipeline/unit/workflowLint.test.ts` |
| 15.13 | `tests/pipeline/unit/workflowLint.test.ts` |
| 15.14 | `tests/pipeline/unit/prText.test.ts` |
| 15.15 | `tests/pipeline/unit/prText.test.ts` |
| 15.16 | `tests/pipeline/unit/prText.test.ts` |
| 15.17 | `tests/pipeline/unit/prText.test.ts` |
| 16.1 | (none) |
| 16.2 | (none) |
| 16.3 | `tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.4 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.5 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.6 | `tests/pipeline/unit/replay.test.ts` |
| 16.7 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts`<br>`tests/pipeline/unit/replay.test.ts` |
| 16.8 | `tests/pipeline/unit/nightlyClassify.test.ts`<br>`tests/pipeline/unit/replay.test.ts` |
| 16.9 | `tests/pipeline/unit/ghVerifyJson.test.ts`<br>`tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.10 | `tests/pipeline/unit/ghVerifyJson.test.ts`<br>`tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyReport.test.ts` |
| 16.11 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.12 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.13 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/ghVerifyJson.test.ts`<br>`tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.14 | `tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyReport.test.ts` |
| 16.15 | `tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyReport.test.ts` |
| 16.16 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.17 | `tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/replay.test.ts` |
| 16.18 | `tests/pipeline/property/p28-nightly-classification.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.19 | (none) |
| 16.20 | (none) |
| 16.21 | `tests/pipeline/unit/nightly.test.ts` |
| 16.22 | `tests/pipeline/property/p29-nightly-not-resurrected.test.ts`<br>`tests/pipeline/unit/nightly.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.23 | `tests/pipeline/property/p29-nightly-not-resurrected.test.ts`<br>`tests/pipeline/unit/nightlyClassify.test.ts` |
| 16.24 | `tests/pipeline/unit/nightly.test.ts` |
| 17.1 | `tests/pipeline/unit/verifyCommands.test.ts` |
| 17.2 | `tests/pipeline/unit/sourceScan.test.ts` |
| 17.3 | (none) |
| 17.4 | (none) |
| 17.5 | `tests/pipeline/unit/verifyCommands.test.ts` |
| 18.1 | `tests/pipeline/unit/prText.test.ts`<br>`tests/pipeline/unit/verifyCommands.test.ts` |
| 18.2 | (none) |
| 18.3 | (none) |
| 18.4 | (none) |
| 18.5 | `tests/pipeline/unit/prText.test.ts` |
| 18.6 | `tests/pipeline/unit/verifyCommands.test.ts` |
| 19.1 | (none) |
| 19.2 | (none) |
| 19.3 | `tests/pipeline/unit/ipMeasurement.test.ts` |
| 19.4 | `tests/pipeline/unit/ipMeasurement.test.ts` |
| 19.5 | (none) |
| 19.6 | (none) |
| 19.7 | (none) |
| 19.8 | (none) |
| 19.9 | `tests/pipeline/unit/excludedPackages.test.ts` |
| 20.1 | (none) |
| 20.2 | (none) |
| 20.3 | (none) |
| 20.4 | (none) |
| 20.5 | (none) |
| 20.6 | (none) |
| 20.7 | (none) |
| 20.8 | (none) |
| 20.9 | (none) |
| 20.10 | (none) |
| 20.11 | (none) |
| 20.12 | (none) |
| 20.13 | (none) |
| 21.1 | (none) |
| 21.2 | (none) |
| 21.3 | (none) |
| 21.4 | `tests/engine/unit/networkGuard.test.ts` |
| 21.5 | (none) |
| 21.6 | `tests/pipeline/unit/requirementsHeader.test.ts` |
| 21.7 | `tests/pipeline/unit/traceExit.test.ts` |
| 21.8 | (none) |
| 21.9 | `tests/proof/unit/budgetReporter.test.ts` |
| 21.10 | `tests/pipeline/unit/cliArgs.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts`<br>`tests/pipeline/unit/stubPlan.test.ts` |
| 22.1 | `tests/pipeline/unit/redact.test.ts` |
| 22.2 | (none) |
| 22.3 | (none) |
| 22.4 | (none) |
| 22.5 | (none) |
| 22.6 | `tests/pipeline/unit/noNpmPublish.test.ts` |
| 22.7 | `tests/pipeline/unit/noKiroCliInCi.test.ts` |
| 22.8 | (none) |
| 22.9 | `tests/pipeline/unit/prText.test.ts` |
| 22.10 | `tests/pipeline/unit/necromancy.test.ts` |
| 22.11 | (none) |
| 23.1 | `tests/pipeline/unit/resurrect.test.ts` |
| 23.2 | `tests/pipeline/unit/resurrect.test.ts`<br>`tests/pipeline/unit/stubPlan.test.ts` |
| 23.3 | `tests/pipeline/unit/cliArgs.test.ts` |
| 23.4 | `tests/pipeline/unit/ledger.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 23.5 | `tests/pipeline/unit/resurrect.test.ts` |
| 23.6 | `tests/pipeline/unit/push.test.ts` |
| 23.7 | `tests/pipeline/unit/dispatchInputs.test.ts` |
| 23.8 | (none) |
| 23.9 | `tests/pipeline/property/p21-predicate.test.ts`<br>`tests/pipeline/unit/predicate.test.ts` |
| 23.10 | `tests/pipeline/property/p21-predicate.test.ts`<br>`tests/pipeline/unit/predicate.test.ts` |
| 23.11 | `tests/pipeline/unit/layout.test.ts`<br>`tests/pipeline/unit/publish.test.ts` |
| 23.12 | `tests/pipeline/unit/prText.test.ts` |
| 23.13 | (none) |
| 23.14 | `tests/pipeline/unit/nightlyReport.test.ts` |
| 23.15 | (none) |
| 23.16 | (none) |
| 23.17 | `tests/pipeline/unit/resurrect.test.ts`<br>`tests/pipeline/unit/stubPlan.test.ts` |
| 23.18 | `tests/pipeline/unit/stubFixture.test.ts` |
| 23.19 | `tests/pipeline/unit/stubFixture.test.ts` |
| 23.20 | `tests/pipeline/unit/stubFixture.test.ts` |
| 23.21 | `tests/pipeline/unit/stubFixture.test.ts` |
| 23.22 | `tests/proof/unit/fixtureIntegrity.test.ts` |
| 23.23 | `tests/pipeline/unit/ipAliveClassEquivalence.test.ts`<br>`tests/proof/unit/ipAliveFixture.test.ts` |
| 23.24 | `tests/pipeline/integration/ipAlive.integration.test.ts`<br>`tests/pipeline/unit/ipAliveClassEquivalence.test.ts` |
| 23.25 | `tests/pipeline/unit/stubFixtureIp.test.ts` |
| 23.26 | `tests/pipeline/unit/stubFixtureIp.test.ts` |
| 23.27 | (none) |

### Gaps

Criteria that no test file cites, with the class and evidence from `docs/traceability-gaps.json`:

- 1.1: documentation only. structure.md (Guidelines) says to keep the four agent roles (Coroner, Gravedigger, Medium, Undertaker) as distinct units, and the code has one directory each (src/engine, src/pipeline/gravedigger, src/pipeline/medium, src/pipeline/undertaker). No test checks that no module merges two roles; task 14.5 (not done) tests only the ENTRY_FILES names.
- 8.8: manual. Task 7.8 wrote the Push_Script, and tests/pipeline/unit/push.test.ts tests its argument and path logic with injected fakes (the header cites other criteria). The run itself is the user's M5: Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)', M5 (push and dispatch of run 43847482329), and Journal entry 'task 12.9 (M12), ip stub run, second attempt: alive and attested (user-run CI, run 43874004948)' (ledger entry committed from the WSL clone).
- 8.10: manual. Task 10.1 (M3): Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)', M3 (gh 2.104.0 from GitHub's apt repository, gh auth status logged in with repo and workflow scopes, separate clone, commit email set to the no-reply address).
- 9.14: manual. Only a dispatch with an empty branch input exercises it: task 13.11 (M10), Journal entry 'First real Crypt entry, M10 done, second M8 nightly run 43898696521 (user-run; fixes agent-made)'. It dispatched inflight@1.0.6 with no branch and produced PR #6, merged as graveyard/inflight. The step (c) entry says the empty-branch dispatch (V6) was not tested by M5. tests/pipeline/unit/dispatchInputs.test.ts cites other criteria.
- 12.7: needs a test. No test asserts that the toolVersions of a report are read from the running installation; this is the same gap as proof-of-life-engine 13.5. The pipeline side only passes them through (tests/pipeline/unit/proveEntry.test.ts, predicate.test.ts). Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)', M6, records node v26.13.1 and fast-check 4.10.2 in the PR body of run 43847482329, as read by the user.
- 12.9: documentation only. Journal entry 'Node pin entry (D1, R12.9; task 14.2, agent, from design.md and the Journal; nothing run)' records 26.13.1, its source and the research date 2026-11-15. The Nightly_Result tool-versions-changed is tested in tests/pipeline/unit/nightlyClassify.test.ts and p28-nightly-classification (their headers cite 16.x, not 12.9).
- 12.10: documentation only. Rule of the honesty steering file and the Journal convention (numbers only from user runs, for example the Journal entries 'First pipeline measurement from the user's npm test run (checkpoint 9)' and 'Second full run, checkpoint 9 closed (user-run)'). No test scans output for unmeasured numbers.
- 12.11: manual. Run 43847482329 (M5, M6): Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)' records 'Node in CI: v26.13.1' in the PR body, while the user's WSL Node is v26.8.2 (M3). The report is produced only by scripts/ci/prove.ts (tests/pipeline/unit/proveEntry.test.ts).
- 14.8: documentation only. design.md and structure.md name graveyard/ as the committed source and resurrect/ branches as temporary. The Nightly_Workflow reads graveyard/ (tests/pipeline/unit/nightly.test.ts, cited 16.3), as the two nightly runs show: Journal entry 'M8 nightly run 43884658382 failed on a missing graveyard/ (user-run; fix agent-made)' (directory missing) and Journal entry 'First real Crypt entry, M10 done, second M8 nightly run 43898696521 (user-run; fixes agent-made)'. The UI part belongs to spec (c).
- 14.10: manual. Task 13.11 (M10): Journal entry 'First real Crypt entry, M10 done, second M8 nightly run 43898696521 (user-run; fixes agent-made)'. The workflow was dispatched for inflight@1.0.6 with medium_mode=local and no branch; PR #6 was merged as graveyard/inflight (not resurrected).
- 14.11: optional, skipped in first pass. optional task not done, first to cut (task 13.10*, Property 34). tests/pipeline/unit/gravediggerRecord.test.ts, 'gives every fact a Source_URL and the one Fetch_Date, and no path or credential', covers the eligibility record only.
- 16.1: manual. tests/pipeline/unit/workflowLint.test.ts, 'has nightly.yml with the required triggers, permissions and report upload', tests the file: schedule, workflow_dispatch, permissions exactly contents read and attestations read, no write permission, no id-token; tests/pipeline/unit/sourceScan.test.ts scans it for LLM use. Pending: whether attestations: read is sufficient for gh attestation verify on an alive entry is unmeasured until task 16.2. Nightly runs 43884658382 and 43898696521 (Journal) verified no alive entry.
- 16.2: manual. Pinning to a full commit SHA and the same Node version in both workflows are tested (workflowLint.test.ts), but no test checks ubuntu-24.04 or npm ci. Run 43884658382 ran on ubuntu-24.04 with gh 2.103.3 (Journal entry 'M8 nightly run 43884658382 failed on a missing graveyard/ (user-run; fix agent-made)'); run 43898696521 ran too (Journal entry 'First real Crypt entry, M10 done, second M8 nightly run 43898696521 (user-run; fixes agent-made)').
- 16.19: optional, skipped in first pass. optional task not done, first to cut (task 13.9*, the notify job).
- 16.20: optional, skipped in first pass. optional task not done, first to cut (tasks 13.9* and 13.10*, the notify job and its text).
- 17.3: documentation only. Task 14.2 kept the spike files and the Journal entries of 2026-11-15 as they were (spikes/attest/README.md, spikes/attest/DECISION.md, .github/workflows/spike-attest.yml). MAY clause: nothing to test.
- 17.4: documentation only. Task 14.2 changed docs/proof-of-life-ordering.md and the proof-of-life-engine spec to name PREDICATE_TYPE. tests/pipeline/unit/sourceScan.test.ts (cited 17.2) checks code, not these documents.
- 18.2: documentation only. README.md section 'Resurrecting a package' (task 14.1) requires gh 2.67.0 or later (GH_MIN_VERSION) and warns about older versions returning exit status 0. The version check of the nightly is tested in tests/pipeline/unit/nightly.test.ts.
- 18.3: documentation only. README.md (task 14.1) describes how to re-check the Proof of Life with npm run proof:run. No test runs the README commands.
- 18.4: optional, skipped in first pass. optional task not done, first to cut (task 14.7*, offline verification text in the README).
- 19.1: documentation only. docs/demo-packages.md (task 14.2) lists the demo set. Run evidence: lodash.set@4.3.3 stub run 43847482329 (Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)'), ip stub run 43874004948 (Journal entry 'task 12.9 (M12), ip stub run, second attempt: alive and attested (user-run CI, run 43874004948)'), inflight@1.0.6 (Journal entry 'First real Crypt entry, M10 done, second M8 nightly run 43898696521 (user-run; fixes agent-made)').
- 19.2: manual. Task 16.1 (M9, real Medium runs) has not been run. The only lodash.set entry so far is the stub run of Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)' (run 43847482329, PR #1, closed); a stub entry is not the demo entry (R23.15).
- 19.5: manual. Task 13.11 (M10): Journal entry 'First real Crypt entry, M10 done, second M8 nightly run 43898696521 (user-run; fixes agent-made)': PR #6 merged as graveyard/inflight; its open-vulnerability rule cites https://api.osv.dev/v1/query and its status rule cites 7 Coroner sources. The successor lru-cache is tested in tests/pipeline/unit/gravedigger.test.ts and gravediggerRecord.test.ts (headers do not cite 19.5).
- 19.6: needs a test. No test publishes a restless entry and then a later successful run and checks that the earlier entry stays in git history. tests/pipeline/integration/gitEntries.integration.test.ts uses a real local repository but cites other criteria. A test would extend it with two publishes of the same package.
- 19.7: manual. The export shape is checked by the API-surface check of the Proof_Engine in CI: Journal entry 'task 12.9 (M12), ip stub run, second attempt: alive and attested (user-run CI, run 43874004948)' (run 43874004948, alive, all 20 exports tested). tests/pipeline/integration/ipExports.integration.test.ts (cited 5.12) checks that the generated cases cover exactly the function exports of the tarball.
- 19.8: manual. Task 16.1 (M9) has not been run; the one-attempt-per-invocation rule is shown only by real Medium runs. The ip stub runs (Journal entry 'task 12.9 (M12), ip stub run, second attempt: alive and attested (user-run CI, run 43874004948)') use no Medium.
- 20.1: documentation only. Task 14.1 edited .kiro/steering/product.md, README.md, tech.md and structure.md. No test reads these sentences (task 14.6* is optional and not done).
- 20.2: documentation only. Task 14.1 replaced the wording. A grep of README.md and .kiro/steering/*.md finds no 'overnight'. The phrase test is task 14.6* (not done).
- 20.3: documentation only. Task 14.1 replaced the tech.md sentence; tech.md now states the on-demand Medium and the nightly re-verification.
- 20.4: documentation only. Task 14.1 updated the layout of .kiro/steering/structure.md (src/pipeline, scripts/ci, tests/pipeline, graveyard/, ledger.json, workflows). Task 14.5 (not done) tests only the ENTRY_FILES names against README.md and structure.md.
- 20.5: documentation only. Task 14.1 added npm run resurrect, PINNED_NODE_VERSION, the gh minimum, no new secret and the CI-only Proof of Life to .kiro/steering/tech.md.
- 20.6: documentation only. Naming rule of the product steering file, applied in task 14.1. No test.
- 20.7: documentation only. Tasks 1.8 and 14.2 reconciled docs/demo-packages.md with the ip measurement (Journal entry 'ip@2.0.1 tarball and isPublic measurement (tasks 1.6 and 1.7, user-run)', M2, and docs/measurements/ip-2.0.1.json).
- 20.8: documentation only. Task 14.1 added to README.md that ledger.json holds the user's credit meter readings and is the only record of the Medium's credit cost; the Credit_Ceiling statement is printed by the runner. This task did not re-read the whole README wording.
- 20.9: documentation only. Honesty rule. Task 14.1 added no figure that the Journal does not record. No test scans the documents for numbers.
- 20.10: documentation only. Process rule: task 14.1 edited the four files and the requirements document did not. Nothing to test.
- 20.11: optional, skipped in first pass. optional task not done, first to cut (task 14.6*, the documentation phrase test).
- 20.12: documentation only. Task 14.1 added the Ledger statement to README.md (line 57: 'ledger.json is committed by the user'). tests/pipeline/unit/resurrect.test.ts (header cites 6.15 and 7.11) covers the runner side.
- 20.13: documentation only. Task 14.1 added the stub run text to README.md (section 'The stub run': copies a committed fixture) and structure.md (no credit, labelled 'stub run', not Medium-produced).
- 21.1: documentation only. tasks.md titles every such task 'Manual task (yours)' with the exact command or setting (1.6, 1.7, 10.1 to 10.6, 12.9, 13.11, 13.12, 16.1, 16.2). No test.
- 21.2: documentation only. tasks.md checkpoint 9 (done, M11: Journal entry 'Second full run, checkpoint 9 closed (user-run)') and checkpoint 15 (not done yet) carry 'Ready for you to run:' with the exact command.
- 21.3: documentation only. Rule of the testing-workflow steering file. Agent runs of single test files are recorded in the Journal entries. No test.
- 21.5: needs a test. The twelve property tests exist, their headers cite the twelve criteria and each sets numRuns of at least 100 (p01, p06, p08, p10, p11: 150; p13: 200; p15: 300; p16: 200 and 100; p21: 100; p22: 200; p23: 500 to 100; p28: 300 and 100; p29: 200 and 100). The pipeline property tests do not read FC_SEED (only tests/engine/helpers/fc.ts does), so replay by FC_SEED is not wired for them. A test or a shared helper would pass the FC_SEED seed to the pipeline properties.
- 21.8: documentation only. Process rule. The timings of the Journal entries 'First pipeline measurement from the user's npm test run (checkpoint 9)' and 'Second full run, checkpoint 9 closed (user-run)' come from the user's pasted output.
- 22.2: documentation only. Task 14.3: .env.example has no new variable (GITHUB_TOKEN= only, as listed in tech.md). No test.
- 22.3: documentation only. Task 14.3 listed actions/attest, checkout, setup-node, upload-artifact, download-artifact, the GitHub CLI, Sigstore, Kiro CLI and semver in PREEXISTING.md with license and source. No test.
- 22.4: documentation only. Task 14.3 and PREEXISTING.md record the license of each dependency. No test.
- 22.5: documentation only. Layout of .kiro/steering/structure.md (src/pipeline, scripts, tests/pipeline, graveyard/). Task 14.5 (not done) tests only the ENTRY_FILES names.
- 22.8: manual. Tested half: tests/pipeline/unit/gravediggerRecord.test.ts, 'gives every fact a Source_URL and the one Fetch_Date, and no path or credential', and prText.test.ts (sources and dates of failed rules). The no-unmeasured-number half rests on the Journal convention (task 10.6: Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)'); no test enforces it.
- 22.11: documentation only. Rule of the necromancy-laws steering file; applied in the Journal entry 'task 12.9, decision option A (class-gated isPublic in ip-alive), outcome (agent-run)'. No test.
- 23.8: manual. The same five jobs and gates ran on a Stub_Run: run 43847482329 (all five jobs green, Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)', M5) and run 43874004948 (Journal entry 'task 12.9 (M12), ip stub run, second attempt: alive and attested (user-run CI, run 43874004948)'). Run 43867172769 (first ip attempt, restless) shows the verdict gate applied to a stub run. The structure is tested in workflowLint.test.ts and ciIntakeEntry.test.ts (other criteria).
- 23.13: manual. Tested half: the stub label in the pull request title and body (tests/pipeline/unit/prText.test.ts, 'stub: title ends with stub run and the first body line says so'), and in layout.test.ts, publish.test.ts and nightlyReport.test.ts. M6 shows PR #1 titled 'lodash.set 4.3.3: alive (stub run)' (Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)'). The README and docs text (task 14.1) and the UI of spec (c) are not tested here.
- 23.15: manual. Task 16.1 (M9) has not been run, so no Medium-produced lodash.set entry exists yet. The stub PR #1 was closed (Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)').
- 23.16: manual. Task 10.3 (M5): Journal entry 'Step (c) observations, user-run in the WSL clone ~/graveyard-shift (task 10.6)': the lodash.set stub run with tests/pipeline/fixtures/stub/lodash.set, run 43847482329, all five jobs green, PR #1 opened with three attestations verified (M6).
- 23.27: manual. Task 12.9 (M12): Journal entry 'task 12.9 (M12), ip stub run, second attempt: alive and attested (user-run CI, run 43874004948)': npm run resurrect -- ip --stub tests/pipeline/fixtures/stub/ip, run 43874004948, alive, PR #3, gh attestation verify succeeded for the three files, PR closed unmerged.

Gaps per class:

- needs a test: 3
- documentation only: 30
- covered, header missing: 0
- manual: 17
- optional, skipped in first pass: 5

### Classification check

- Unclassified gaps: none
- Classified criteria that do not exist in requirements.md: none
- Stale classification entries (no longer gaps): none
- Duplicate classification entries: none

### Cited numbers that do not exist in requirements.md

none

## Spec: medium-agent

Requirements: `.kiro/specs/medium-agent/requirements.md`. Tests: `tests/medium/**/*.test.ts`.

A citation shows which tests claim to cover a criterion; it does not prove coverage.

### Summary

- Test files scanned: 22
- Acceptance criteria: 110
- Criteria cited by at least one test file: 100
- Criteria with no citing test file (gaps): 10

### Criteria and citing test files

| Criterion | Test files |
| --- | --- |
| 1.1 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.2 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.3 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.4 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.5 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.6 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.7 | `tests/medium/unit/agentDefinition.test.ts` |
| 1.8 | (none) |
| 2.1 | `tests/medium/unit/agentDefinition.test.ts` |
| 2.2 | `tests/medium/unit/agentDefinition.test.ts` |
| 2.3 | `tests/medium/unit/agentDefinition.test.ts` |
| 2.4 | `tests/medium/unit/agentDefinition.test.ts` |
| 2.5 | `tests/medium/unit/agentDefinition.test.ts` |
| 2.6 | `tests/medium/property/p08-task-prompt.test.ts` |
| 2.7 | (none) |
| 3.1 | `tests/medium/unit/agentDefinition.test.ts` |
| 3.2 | `tests/medium/integration/writeGuard.integration.test.ts`<br>`tests/medium/property/p01-guard-paths.test.ts` |
| 3.3 | `tests/medium/integration/writeGuard.integration.test.ts`<br>`tests/medium/property/p01-guard-paths.test.ts` |
| 3.4 | `tests/medium/integration/writeGuard.integration.test.ts`<br>`tests/medium/property/p02-guard-total.test.ts` |
| 3.5 | `tests/medium/integration/writeGuard.integration.test.ts` |
| 3.6 | `tests/medium/integration/writeGuard.integration.test.ts`<br>`tests/medium/property/p02-guard-total.test.ts` |
| 3.7 | `tests/medium/integration/writeGuard.integration.test.ts`<br>`tests/medium/unit/sourceScan.test.ts` |
| 3.8 | `tests/medium/property/p01-guard-paths.test.ts` |
| 3.9 | `tests/medium/integration/writeGuard.integration.test.ts` |
| 3.10 | (none) |
| 3.11 | `tests/medium/property/p04-path-rules-oracle.test.ts`<br>`tests/medium/unit/pathRules.test.ts`<br>`tests/medium/unit/sourceScan.test.ts` |
| 3.12 | `tests/medium/property/p04-path-rules-oracle.test.ts` |
| 4.1 | `tests/medium/integration/guardLog.integration.test.ts`<br>`tests/medium/property/p03-guard-log.test.ts` |
| 4.2 | `tests/medium/integration/guardLog.integration.test.ts`<br>`tests/medium/property/p03-guard-log.test.ts` |
| 4.3 | `tests/medium/integration/guardLog.integration.test.ts`<br>`tests/medium/property/p03-guard-log.test.ts` |
| 4.4 | `tests/medium/integration/guardLog.integration.test.ts` |
| 4.5 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 4.6 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts` |
| 4.7 | `tests/medium/integration/guardLog.integration.test.ts` |
| 5.1 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 5.2 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 5.3 | `tests/medium/unit/outputFormat.test.ts`<br>`tests/medium/unit/presetMenu.test.ts` |
| 5.4 | `tests/medium/unit/outputFormat.test.ts`<br>`tests/medium/unit/presetMenu.test.ts` |
| 5.5 | `tests/medium/property/p07-context-scan.test.ts` |
| 5.6 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts` |
| 5.7 | `tests/medium/unit/docs.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts` |
| 6.1 | `tests/medium/integration/contextServer.integration.test.ts` |
| 6.2 | `tests/medium/integration/contextServer.integration.test.ts`<br>`tests/medium/unit/buildAdvisories.test.ts`<br>`tests/medium/unit/outputFormat.test.ts`<br>`tests/medium/unit/pathRules.test.ts` |
| 6.3 | `tests/medium/integration/contextServer.integration.test.ts` |
| 6.4 | `tests/medium/unit/sourceScan.test.ts` |
| 6.5 | `tests/medium/integration/contextServer.integration.test.ts`<br>`tests/medium/unit/pathRules.test.ts` |
| 6.6 | `tests/medium/integration/contextServer.integration.test.ts` |
| 6.7 | `tests/medium/integration/contextServer.integration.test.ts` |
| 6.8 | `tests/medium/integration/contextServer.integration.test.ts` |
| 6.9 | `tests/medium/integration/contextServer.integration.test.ts` |
| 7.1 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.2 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.3 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.4 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.5 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.6 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.7 | `tests/medium/unit/agentPrompt.test.ts` |
| 7.8 | `tests/medium/unit/agentPrompt.test.ts` |
| 8.1 | `tests/medium/unit/sourceScan.test.ts` |
| 8.2 | `tests/medium/property/p08-task-prompt.test.ts` |
| 8.3 | `tests/medium/property/p08-task-prompt.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts` |
| 8.4 | `tests/medium/unit/agentPrompt.test.ts` |
| 8.5 | `tests/medium/property/p08-task-prompt.test.ts` |
| 8.6 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 9.1 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 9.2 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 9.3 | `tests/medium/property/p11-local-runner-checks.test.ts` |
| 9.4 | `tests/medium/property/p11-local-runner-checks.test.ts` |
| 9.5 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 9.6 | `tests/medium/unit/localRunnerMedium.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 9.7 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 9.8 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 9.9 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 9.10 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 10.1 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/medium/unit/localRunnerMedium.test.ts` |
| 10.2 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 10.3 | `tests/medium/property/p03-guard-log.test.ts`<br>`tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 10.4 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 10.5 | `tests/pipeline/unit/resurrect.test.ts` |
| 10.6 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 10.7 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 10.8 | `tests/medium/property/p11-local-runner-checks.test.ts`<br>`tests/pipeline/unit/resurrect.test.ts` |
| 10.9 | `tests/medium/property/p11-local-runner-checks.test.ts` |
| 10.10 | `tests/medium/property/p11-local-runner-checks.test.ts` |
| 10.11 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 11.1 | `tests/medium/property/p09-medium-env.test.ts` |
| 11.2 | `tests/medium/property/p09-medium-env.test.ts` |
| 11.3 | `tests/medium/unit/sourceScan.test.ts` |
| 11.4 | `tests/medium/integration/secrets.integration.test.ts` |
| 11.5 | `tests/medium/unit/sourceScan.test.ts` |
| 11.6 | `tests/medium/property/p09-medium-env.test.ts` |
| 11.7 | (none) |
| 11.8 | (none) |
| 12.1 | `tests/medium/unit/localRunnerMedium.test.ts` |
| 12.2 | `tests/medium/unit/requirementsHeader.test.ts` |
| 12.3 | `tests/medium/unit/requirementsHeader.test.ts` |
| 12.4 | (none) |
| 12.5 | (none) |
| 12.6 | (none) |
| 12.7 | (none) |
| 13.1 | `tests/medium/unit/docs.test.ts`<br>`tests/medium/unit/pathRules.test.ts` |
| 13.2 | `tests/medium/unit/docs.test.ts` |
| 13.3 | `tests/medium/unit/docs.test.ts` |
| 13.4 | `tests/medium/unit/agentDefinition.test.ts` |
| 13.5 | `tests/medium/unit/sourceScan.test.ts` |
| 13.6 | `tests/medium/unit/sourceScan.test.ts` |
| 13.7 | `tests/medium/unit/sourceScan.test.ts` |
| 13.8 | (none) |
| 13.9 | `tests/medium/unit/docs.test.ts` |
| 13.10 | `tests/medium/unit/docs.test.ts` |

### Gaps

Criteria that no test file cites, with the class and evidence from `docs/traceability-gaps.json`:

- 1.8: manual. Manual step of docs/medium-enforcement-test.md, run in the WSL clone: the user records in docs/kiro-journal.md the output and exit code of `kiro-cli agent validate --path .kiro/agents/medium.json` and the output of `kiro-cli agent list`. No result is recorded yet; the shape of the definition is checked offline by the agent definition test (1.7).
- 2.7: manual. The Journal record of the enforcement test of criterion 3.10 is the only evidence of the effect of the fs_write, fs_read and mcp permission rules. No result is recorded yet. The Write_Guard tests cover the write paths whichever layer refuses a write.
- 3.10: manual. Enforcement test of docs/medium-enforcement-test.md, run by the user against the committed agent definition without --trust-* flags: the user records in docs/kiro-journal.md the Guard_Log lines (ALLOW and DENY) and, per refused write, whether a permission deny, a Write_Guard block or both occurred. No result is recorded yet.
- 11.7: manual. First real Medium run (resurrection-pipeline task 16.1, M9): the user records in docs/kiro-journal.md the Medium_Environment key names printed on standard error, whether kiro-cli started with the logged-in account, and whether kiro-cli wrote any file into the workspace. No result is recorded yet.
- 11.8: manual. Before the first real Medium run, in the WSL clone: the user runs `kiro-cli whoami` with only the Medium_Env_Keys environment and records in docs/kiro-journal.md its output, exit code and the Credit_Meter_Reading before and after. No result is recorded yet.
- 12.4: documentation only. scripts/trace.ts maps tests/medium to medium-agent in its SPECS list and exits 1 on an unclassified gap or a stale entry (tests/pipeline/unit/traceExit.test.ts checks the exit rule on a demo spec, header cites resurrection-pipeline 21.7 only). The medium-agent section and the exit code are shown by the user's run of npm run trace; no test runs the medium-agent mapping itself.
- 12.5: documentation only. Process rule for the task list: .kiro/specs/medium-agent/tasks.md marks every task that needs kiro-cli, WSL or a Credit_Meter_Reading as 'Manual task (yours)' (15.1 for 11.8 and 15.2 for 1.8, 2.7, 3.10) and cites the first real Medium run as resurrection-pipeline task 16.1 (M9) without repeating it. No test reads tasks.md.
- 12.6: documentation only. Process rule: .kiro/specs/medium-agent/tasks.md (conventions at the top and the checkpoint tasks) tells agents to run only npm run typecheck, npm run lint and one test file at a time and to stop with 'Ready for you to run:' for a full run; the workspace testing-workflow steering rule says the same. No test checks it.
- 12.7: documentation only. Honesty rule applied in the Journal: the entries 'Medium-agent checkpoint 5', 'Medium-agent checkpoint 12' and the checkpoint 14 entry in docs/kiro-journal.md state only figures from user-pasted runs and name the command. No test scans the Journal for unsourced numbers.
- 13.8: documentation only. Process rule: the medium-agent work added no third-party tool or dependency, so PREEXISTING.md is unchanged (stated in the Journal entry 'Medium-agent implementation'); the Context_Server and the Write_Guard import only Node built-ins (source scan test cites 13.5 and 13.7). No test checks PREEXISTING.md.

Gaps per class:

- needs a test: 0
- documentation only: 5
- covered, header missing: 0
- manual: 5
- optional, skipped in first pass: 0

### Classification check

- Unclassified gaps: none
- Classified criteria that do not exist in requirements.md: none
- Stale classification entries (no longer gaps): none
- Duplicate classification entries: none

### Cited numbers that do not exist in requirements.md

none
