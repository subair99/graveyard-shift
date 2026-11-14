# Implementation Plan: Autopsy Engine

## Overview

The design uses TypeScript, so all tasks use TypeScript. The plan first sets up the Next.js, TypeScript, vitest and fast-check project. It then builds the pure core (parser, resolver, causes, successor, risk, status, time of death), the I/O shell (cache, HTTP wrapper, source clients), the certificate builder and canonical serializer, and the orchestrator. It ends with recorded fixtures for ip, lodash.set and inflight, guard checks, and documentation updates.

Each property-based test goes in its own file, `tests/engine/property/pN-<name>.test.ts`, so that tests can run in parallel. Fixtures live in `tests/engine/fixtures/`.

## Tasks

- [ ] 1. Set up the project
  - [ ] 1.1 Scaffold the Next.js + TypeScript project in the workspace root
    - Create `package.json`, `tsconfig.json` (strict), `next.config.mjs`, and `src/app` minimal layout and page
    - Keep the existing `.env`, `.env.example`, `README.md`, `LICENSE`, `docs/`; add `GITHUB_TOKEN` (empty) to `.env.example` if absent
    - Confirm `.env` is listed in `.gitignore`
    - _Requirements: 2.6, 2.8_

  - [ ] 1.2 Add test and runtime dependencies and configure vitest
    - Add `vitest`, `fast-check`, `zod`, `semver`, `@types/semver`
    - Create `vitest.config.ts` including `tests/**/*.test.ts`, and a `test` script using `vitest --run`
    - Create `tests/engine/helpers/fc.ts` exporting shared config: `numRuns: 100`, seed from `FC_SEED`, and verbose failure reporting that prints the shrunk counterexample and the seed
    - _Requirements: 12.5, 12.6_

  - [ ] 1.3 Define shared engine types and schemas in `src/engine/types.ts`
    - `Status`, `CauseOfDeath`, `SourceName`, `Provenance`, `Fact`, `Maybe`, `Vulnerability`, `VitalSigns`, `RiskBreakdown`, `DeathCertificate`, `AutopsyError`, `AutopsyRun`, `PackageRef`, `EngineInput`, `EngineConfig`, `EngineDeps`, `Clock`, `Result`, `SourceResult`
    - Add zod schemas for `DeathCertificate` and for each upstream response shape (npm packument, downloads, OSV, deps.dev, GitHub)
    - _Requirements: 3.1, 7.1, 10.7_

- [ ] 2. Implement input parsing and version resolution
  - [ ] 2.1 Implement the Input_Parser in `src/engine/parse/`
    - `packageName.ts`: npm name validation (1 to 214 characters, scope rules)
    - `inputParser.ts`: package name with optional version, package.json (5 MB limit; dependencies, devDependencies, optionalDependencies), package-lock.json (50 MB limit; lockfileVersion 2/3 `packages` map and v1 `dependencies` fallback; skip root entry)
    - Reject yarn.lock, pnpm-lock.yaml and invalid content with an error naming the input type and reason
    - Sort by name (code-point) then semver precedence, dedupe identical name and version
    - Return an empty list with a "no packages found" note for empty manifests
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 1.9, 1.10_

  - [ ] 2.2 Implement the version resolver in `src/engine/resolve/versionResolver.ts`
    - No spec resolves to `dist-tags.latest`, with an error naming the package when no version is published
    - Exact version resolves to itself
    - Range resolves with `semver.maxSatisfying`, with an error naming package and range when none match
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.11_

  - [ ]* 2.3 Write property test for name and version parsing
    - **Property 1: Name and version parse**
    - **Validates: Requirements 1.1**

  - [ ]* 2.4 Write property test for manifest parsing
    - **Property 2: Manifest parsing preserves entries**
    - **Validates: Requirements 1.2, 1.3**

  - [ ]* 2.5 Write property test for parser output order
    - **Property 3: Parser output is sorted and deduplicated**
    - **Validates: Requirements 1.9**

  - [ ]* 2.6 Write property test for invalid input rejection
    - **Property 4: Invalid input is rejected**
    - **Validates: Requirements 1.8**

  - [ ]* 2.7 Write property test for version resolution
    - **Property 5: Version resolution**
    - **Validates: Requirements 1.5, 1.6, 1.7**

- [ ] 3. Implement cache and HTTP wrapper
  - [ ] 3.1 Implement the cache in `src/engine/cache/`
    - `cacheKey.ts`: canonical JSON of `[source, url, sortedQueryPairs]` with no credential argument
    - `cache.ts`: `Cache` interface and in-memory `Map` store holding `{ body, status, fetchedAt }`
    - TTL resolution: default 24 h, a non-positive or non-finite configured TTL returns an error naming the TTL and the default is used
    - _Requirements: 9.5, 9.6, 9.7, 9.8_

  - [ ] 3.2 Implement the HTTP wrapper in `src/engine/sources/http.ts`
    - Injected `fetch` and `Clock`, 10 s timeout via `AbortSignal.timeout`
    - Cache hit when age is at most the TTL, otherwise fetch and replace the entry with its original `fetchedAt`
    - On failure with an expired entry use it and mark results stale, leaving the entry unchanged. On failure with no entry store nothing
    - Record `sourceUrl` as the requested URL before redirects, with second-precision UTC `fetchedAt`
    - Map errors, timeouts and rate-limit responses (including reset time header) to `unavailable`
    - Redact the GitHub token from all error messages and log lines
    - De-duplicate in-flight requests by Cache key
    - _Requirements: 2.8, 2.9, 2.11, 3.2, 3.3, 9.1, 9.2, 9.3, 9.4, 9.9_

  - [ ]* 3.3 Write property test for cache freshness and fallback
    - **Property 19: Cache freshness and fallback**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ]* 3.4 Write property test for cache key identity
    - **Property 20: Cache key identity**
    - **Validates: Requirements 9.5, 9.6**

  - [ ]* 3.5 Write property test for TTL configuration
    - **Property 21: TTL configuration**
    - **Validates: Requirements 9.7, 9.8**

- [ ] 4. Implement source clients
  - [ ] 4.1 Implement the npm Source_Client in `src/engine/sources/npm.ts`
    - Packument (maintainers in registry order, `time` map, deprecation message, repository URL, dist-tags, published versions)
    - Weekly downloads from the npm downloads API
    - Existence lookup for successor candidates
    - A 404 on the packument returns `not-found`
    - _Requirements: 2.1, 2.5, 2.10, 4.2_

  - [ ] 4.2 Implement the OSV Source_Client in `src/engine/sources/osv.ts`
    - POST query for `name@version`, normalize id, aliases, summary, severity and fixed versions
    - _Requirements: 2.2, 7.5_

  - [ ] 4.3 Implement the deps.dev Source_Client in `src/engine/sources/depsdev.ts`
    - Dependent count and OpenSSF Scorecard (0 to 10), with "no scorecard" reported as unavailable
    - _Requirements: 2.3, 7.8, 7.9, 7.10_

  - [ ] 4.4 Implement the GitHub Source_Client in `src/engine/sources/github.ts`
    - Call only for github.com repository URLs, otherwise skip and record that no github.com repository URL was available
    - Fetch `archived` and `pushed_at`
    - Send `Authorization: Bearer` only when `GITHUB_TOKEN` is set, otherwise record that data was fetched without a token
    - _Requirements: 2.4, 2.6, 2.7, 2.12_

  - [ ]* 4.5 Write unit tests for the source clients
    - Endpoint construction, bearer header only with a token, unauthenticated note, registry 404 stops the autopsy, rate-limit reset time, redirect keeps the requested Source_URL
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10, 2.11, 3.2_

  - [ ]* 4.6 Write property test for GitHub eligibility
    - **Property 8: GitHub eligibility**
    - **Validates: Requirements 2.12**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement the pure core
  - [ ] 6.1 Implement time of death in `src/engine/core/timeOfDeath.ts`
    - Latest parseable timestamp excluding `created` and `modified`
    - `daysSince = max(0, floor(elapsed / 24h))`, unavailable with reason "no release publish date was found" when none parse
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 6.2 Implement cause detection and vulnerability filtering in `src/engine/core/causes.ts`
    - Causes in fixed order, each at most once, strict `> 730` days for `runtime-rot`, unavailable signals never produce a cause
    - Open vulnerability filter: drop only when a fixed version greater than the analyzed version is published on npm. Sort ids ascending, no duplicates
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ] 6.3 Implement successor extraction in `src/engine/core/successor.ts`
    - `extractCandidates`: backticks, word after `use` / `check out` / `switch to` / `replaced by`, word before `instead`, case-insensitive, trailing punctuation stripped, ordered by position then rule order
    - `findSuccessor`: skip stoplisted (case-insensitive) and invalid names without lookup, look up the rest in order, skip failures, record each lookup
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ] 6.4 Implement the risk scorer in `src/engine/core/risk.ts`
    - Fixed formula with non-negative integer contributions (cause weights 20/20/25/15, 5 per vulnerability capped at 20, Scorecard `round((10 - score) * 2)`), clamp to 0..100
    - Return contributions, raw score, formula weights and thresholds, unavailable sign names, and the "no inputs were available" note
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [ ] 6.5 Implement status assignment in `src/engine/core/status.ts`
    - Precedence: successor, deprecated without successor (record full message), any cause, invalid risk (error, no status), risk 40 to 100 `dying`, 0 to 39 `alive`
    - _Requirements: 4.1, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15_

  - [ ]* 6.6 Write property test for time of death
    - **Property 15: Time of death**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5**

  - [ ]* 6.7 Write property test for cause detection
    - **Property 13: Cause detection**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9**

  - [ ]* 6.8 Write property test for open vulnerability filtering
    - **Property 14: Open vulnerability filtering**
    - **Validates: Requirements 5.3, 5.7, 5.8**

  - [ ]* 6.9 Write property test for successor selection
    - **Property 11: Successor selection**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7, 4.9**

  - [ ]* 6.10 Write property test for risk score range and accounting
    - **Property 17: Risk score range and accounting**
    - **Validates: Requirements 8.1, 8.5, 8.6, 8.7, 8.8**

  - [ ] 6.11 Write property test for risk score monotonicity
    - **Property 18: Risk score monotonicity**
    - **Validates: Requirements 8.3, 8.4, 12.2**

  - [ ]* 6.12 Write property test for status assignment
    - **Property 12: Status assignment**
    - **Validates: Requirements 4.1, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15**

- [ ] 7. Implement certificate assembly and serialization
  - [ ] 7.1 Implement certificate assembly in `src/engine/core/certificate.ts`
    - Build vital signs with `Maybe` tri-state (empty list and zero distinct from unavailable), Facts with 1 to 20 provenance entries, stale flags, notes (token use, GitHub skip reason)
    - Omit any Fact lacking Source_URL or Fetch_Date and list it in `omittedFacts`
    - Include the unavailable attempt URL and time for failed signs
    - Include Time_Of_Death and days since for every status
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 4.2, 4.14, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 8.6, 8.8, 8.9_

  - [ ] 7.2 Implement the canonical serializer and deserializer in `src/engine/serialize/`
    - `canonicalJson.ts`: single `CERTIFICATE_KEY_ORDER` table, recursive fixed key order, every list sorted by its documented rule with tie-breakers, second-precision timestamps
    - `deserialize.ts`: zod validation, error naming the invalid or missing field, no partial certificate
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

  - [ ] 7.3 Write `docs/engine-ordering.md`
    - Document the ordering rule and tie-breaker for every list (certificates in a run, causes, open vulnerabilities, aliases, maintainers, facts, provenance entries, risk contributions, unavailable signs) as in the design table
    - Document the fixed key order of the certificate
    - _Requirements: 10.4_

  - [ ] 7.4 Write property test for fact provenance
    - **Property 9: Every fact carries valid provenance**
    - **Validates: Requirements 3.1, 3.4, 3.6, 12.4**

  - [ ]* 7.5 Write property test for vital signs normalization
    - **Property 16: Vital signs normalization**
    - **Validates: Requirements 6.4, 7.1, 7.2, 7.3, 7.5, 7.6, 7.8, 7.10**

  - [ ]* 7.6 Write property test for canonical ordering
    - **Property 24: Canonical ordering**
    - **Validates: Requirements 10.4, 10.5**

  - [ ] 7.7 Write property test for serialization round trip
    - **Property 25: Serialization round trip**
    - **Validates: Requirements 10.6, 12.3**

  - [ ]* 7.8 Write property test for invalid certificate JSON
    - **Property 26: Invalid certificate JSON is rejected**
    - **Validates: Requirements 10.7**

- [ ] 8. Implement the orchestrator and wire everything together
  - [ ] 8.1 Implement `runAutopsy` in `src/engine/autopsy.ts`
    - Parse input, fetch the packument per reference, resolve versions, stop a package on npm not-found without calling other sources
    - Call OSV, deps.dev, downloads and GitHub (when eligible) with bounded concurrency (default 8), look up successor candidates, run the pure core, build the certificate
    - Collect per-reference errors and continue with the rest. Order output by sorted references, not by completion order
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.11, 2.9, 2.10, 4.1, 9.4, 9.9, 10.2_

  - [ ] 8.2 Expose the public engine API in `src/engine/index.ts`
    - Export `runAutopsy`, `canonicalJson`, `deserialize`, `parseInput` and public types
    - _Requirements: 10.5, 10.6_

  - [ ]* 8.3 Write property test for source failure degradation
    - **Property 7: Source failures degrade, not abort**
    - **Validates: Requirements 2.9, 2.11, 3.5, 7.4, 7.7, 7.9**

  - [ ]* 8.4 Write property test for cached fact fetch dates
    - **Property 10: Cached facts keep their original fetch date**
    - **Validates: Requirements 3.3**

  - [ ]* 8.5 Write property test for one request per unique cache key
    - **Property 22: One request per unique cache key**
    - **Validates: Requirements 9.9**

  - [ ] 8.6 Write property test for idempotent, byte-identical analysis
    - **Property 23: Analysis is idempotent and byte-identical**
    - **Validates: Requirements 8.2, 10.3, 11.7, 12.1**

  - [ ]* 8.7 Write property test that the token never appears in output
    - **Property 6: Secret token never appears in output**
    - **Validates: Requirements 2.8, 9.6**

  - [ ]* 8.8 Write unit tests for orchestrator behavior
    - Latest version when none is given, empty manifest note, successor lookup recorded as a Fact, certificate contains the formula, a failing package does not stop the others
    - _Requirements: 1.4, 1.10, 1.11, 4.2, 8.9_

- [ ] 9. Add fixtures and guard checks
  - [ ] 9.1 Create recorded fixtures and the replay `fetch`
    - Add a recording script under `scripts/` that captures responses for ip@2.0.1, lodash.set@4.3.2 and inflight@1.0.6 (including the `lru-cache` existence lookup), storing them in `tests/engine/fixtures/{ip,lodash.set,inflight}/` keyed by cache key
    - Add `tests/engine/helpers/replayFetch.ts`: serves recorded files and throws a typed error on any unrecorded URL, with no network fallback
    - Check figures against `docs/demo-packages.md`
    - _Requirements: 11.4, 11.6_

  - [ ] 9.2 Write fixture verdict tests in `tests/engine/unit/fixtures.test.ts`
    - ip@2.0.1: `dead`, cause `unpatched-cve`, vulnerability id or alias CVE-2024-29415
    - lodash.set@4.3.2: `dead`, cause `unpatched-cve`, vulnerability id or alias CVE-2020-8203
    - inflight@1.0.6: status `retired-with-successor`
    - A list of the three yields exactly three certificates ordered `inflight`, `ip`, `lodash.set`
    - A missing or unparseable recording fails only that package with an error naming the package and response, and makes zero network requests
    - Two runs give identical status, cause, Successor and vulnerability values
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ] 9.3 Write inflight successor test in `tests/engine/unit/inflightSuccessor.test.ts`
    - Using the recorded inflight@1.0.6 fixtures, the Successor is `lru-cache` and `it` is never the Successor
    - _Requirements: 4.8, 11.3_

  - [ ] 9.4 Add the network guard and determinism lint rule
    - Test setup guard that fails the run on any request outside recorded hosts, including any LLM service host
    - ESLint rule (`no-restricted-properties` / `no-restricted-syntax`) banning `Date.now`, argument-less `new Date()` and `Math.random` in `src/engine/core` and `src/engine/serialize`
    - _Requirements: 10.1, 10.2, 11.4_

  - [ ]* 9.5 Write meta checks for the property test suite
    - Verify the property test files exist, `numRuns` is at least 100, and seed reporting is enabled
    - _Requirements: 12.5, 12.6, 12.7_

- [ ] 10. Update project documentation
  - [ ] 10.1 Add the new third-party data sources and libraries to `PREEXISTING.md`
    - List the npm registry and downloads API, OSV, deps.dev (OpenSSF Scorecard) and GitHub REST API, each with its base URL
    - List new libraries added: Next.js, TypeScript, vitest, fast-check, zod, semver
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Fixture tests (9.2) are not optional because they validate the demo verdicts
- Each task references specific requirements for traceability
- Each property-based test is a single test with at least 100 runs, tagged `Feature: autopsy-engine, Property {n}: {title}`
- Property tests validate universal correctness. Unit tests validate specific examples and edge cases

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1", "2.2", "3.1", "6.1", "6.2", "6.3", "6.4", "6.5", "9.4", "10.1"] },
    { "id": 4, "tasks": ["3.2", "7.1", "7.2", "7.3", "2.3", "2.4", "2.5", "2.6", "2.7", "3.4", "3.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12"] },
    { "id": 5, "tasks": ["4.1", "4.2", "4.3", "4.4", "3.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 6, "tasks": ["4.5", "4.6", "8.1"] },
    { "id": 7, "tasks": ["8.2", "9.1"] },
    { "id": 8, "tasks": ["8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "9.2", "9.3", "9.5"] }
  ]
}
```
