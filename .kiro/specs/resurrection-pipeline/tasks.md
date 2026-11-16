# Implementation Plan: Resurrection Pipeline

## Overview

This plan follows the "Planned work order" of `design.md`: (a) the ip measurement, (b) the building blocks up to the first full-suite checkpoint, (c) the first lodash.set stub run end to end, (d) the ip preset and the ip run, (e) the nightly re-verification, (f) documentation and traceability. Language: TypeScript (strict), as in `src/engine` and `src/proof`. Tests use vitest and fast-check in the new project `pipeline` (`tests/pipeline/**/*.test.ts`).

Conventions for every task:

- Agents run only `npm run typecheck`, `npm run lint` and one test file at a time (`npx vitest run <path>`, under about 30 seconds, one run per change). Agents never run `npm test`, `npm run test:*` or the full suite, and never run a Manual task.
- A task titled "Manual task (yours)" is done by the user. It needs network, `gh`, `kiro-cli`, GitHub settings or a credit meter reading. The agent stops, prints "Ready for you to run: ..." where the task says so, and waits for the pasted output. Journal timings come from the user's pasted runs only.
- Required property tests (design properties 1, 6, 8, 10, 11, 13, 15, 16, 21, 22, 23, 28, 29) are not optional. Every other property test, and the "first to cut" items (R16.19 and R16.20, R18.4, R20.11) are marked optional with `*`.
- Every test file starts with a header line `// Requirements: N.M, ...` (for `npm run trace`) and property tests carry `// Feature: resurrection-pipeline, Property <n>: <title>`. Property tests run at least 100 cases.
- Tests make no network call (the network guard stays in force). Registry, `gh`, `git` and `kiro-cli` are injected fakes or recorded fixtures.
- All WSL commands run in the separate clone `~/graveyard-shift` (state `cd ~/graveyard-shift` first), never in `/mnt/c/dev/graveyard-shift`; `npm ci` and `npm install` are never run in WSL inside `/mnt/c/...`. Keep the clone current with `git pull origin main` whenever workflow files or scripts change (task 10.1).
- Where a design item says "To verify (agent, at task time)" (V13, V14, V16), the task that builds that part reads the code or docs first and records the answer in the Journal. If the answer breaks the design, stop and ask the user.
- Honesty: no number, metric or result is written into code, docs or the Journal unless it was measured and the user pasted it.

**First pass: skip every optional (*) task; the user decides at the end which to add back.**

## Tasks

- [x] 1. Step (a): ip measurement first (R3)
  - [x] 1.1 Add the `pipeline` vitest project and its budget entry
    - In `vitest.config.mts` add the project `pipeline` (`tests/pipeline/**/*.test.ts`), with the network guard in the root `setupFiles` unchanged.
    - In `tests/proof/helpers/budgetReporter.ts` add the project to the target table (90 s, a target and not a measurement); extend `tests/proof/unit/budgetReporter.test.ts` for the new entry (no journal write).
    - Verify with `npm run typecheck`, `npm run lint` and `npx vitest run tests/proof/unit/budgetReporter.test.ts`.
    - _Requirements: 21.9_

  - [x] 1.2 Generalize the tarball recorder to `--package <name> --version <v>`
    - Change `scripts/recordTarball.ts` and `scripts/lib/recordTarball.ts`: default stays lodash.set@4.3.2; `npm run fixtures:record-tarball -- --package ip --version 2.0.1` records `tests/proof/fixtures/ip/ip-2.0.1.tgz` and `.meta.json`. The bytes are verified against the registry integrity before any file is written.
    - Extend the offline tests in `tests/proof/unit/recordTarball.test.ts` (fake fetch, temp dirs): argument parsing, default, integrity mismatch writes nothing, ip paths.
    - _Requirements: 3.9_

  - [x] 1.3 Implement `IpMeasurementSchema`, `deriveIpDeltas` and the key order
    - Create `src/pipeline/harness/core/ipMeasurement.ts` (pure): schema with the five Advisory_Addresses in fixed order (`127.1`, `01200034567`, `012.1.2.3`, `000:0:0000::01`, `::fFFf:127.0.0.1`), `informational` entries (`0`, `017700000001`), canonical JSON, parse and print, `deriveIpDeltas(m)` returning `{ addresses, ipInDemo }` (only results that returned the value `true`; a thrown error or any other value gives no delta; `informational` never matters).
    - Write example tests in `tests/pipeline/unit/ipMeasurement.test.ts` for: all five `false` (ip leaves the demo), mixed results, a thrown error, informational inputs ignored, malformed JSON names the failing path.
    - _Requirements: 3.3, 3.5, 3.6, 3.7, 3.8, 3.11, 19.3, 19.4_

  - [ ]* 1.4 Write property test for ip delta derivation
    - **Property 5: ip deltas come only from measured `true` results**
    - **Validates: Requirements 3.5, 3.6, 3.8, 3.11, 4.12**
    - File: `tests/pipeline/property/p05-ip-deltas.test.ts`. The compile-side half ("a `returns-expected` input not in the set is an error") is added in task 12.3.

  - [x] 1.5 Write `scripts/measureIp.ts` and the `measure:ip` npm script
    - Runs the Original ip@2.0.1 from `tests/proof/fixtures/ip/ip-2.0.1.tgz` (integrity verified against `.meta.json`) through the `Executor` interface (`createSandboxExecutorFactory`, open side, call), with no network, calls `isPublic` for the five addresses and `informational` inputs, and records the exact returned value or the redacted thrown error, the Node version, the ip version and the integrity string.
    - Writes `docs/measurements/ip-2.0.1.json` (canonical JSON, with the advisory ids `GHSA-2p57-rm9w-gvfp` and `CVE-2024-29415` and the two source URLs with `checkedOn` 2026-11-15 taken from `spikes/candidates/IP-SKETCH.md`) and prints a plain table to stderr.
    - Keep the logic in a testable function with injected executor and clock; add `tests/pipeline/unit/measureIp.test.ts` with a fake executor (returned, threw, mixed).
    - Also read the function exports of the recorded tarball through the same executor and print them (input for task 1.8, V16).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.10, 3.11_

  - [x] 1.6 Manual task (yours): M1, record the ip tarball
    - Needs network. Run in PowerShell from the repository root:
      `npm run fixtures:record-tarball -- --package ip --version 2.0.1`
    - Paste back: the full command output (the integrity string and the written paths). Then commit `tests/proof/fixtures/ip/` (the two files).
    - _Requirements: 3.9_

  - [x] 1.7 Manual task (yours): M2, measure `isPublic` and log it in the Journal
    - Run in PowerShell from the repository root (offline; the code runs in the sandbox):
      `npx tsx scripts/measureIp.ts`
    - Paste back: the printed result for all five addresses and the two informational inputs, the ip version, the integrity string and the Node version, plus the exported function names it prints.
    - Add a Journal entry to `docs/kiro-journal.md` with those values (user-run, dated), citing the two advisory URLs of `spikes/candidates/IP-SKETCH.md` (GHSA-2p57-rm9w-gvfp and CVE-2024-29415), and commit `docs/measurements/ip-2.0.1.json`.
    - _Requirements: 3.3, 3.4, 3.10_

  - [x] 1.8 Apply the measurement (agent, after the pasted result)
    - Read the pasted export list. Correct the table in design.md "ip coverage" (names, arguments, generator shapes) and mark which entries were read from the tarball (V16).
    - If the Original returned `false` for all five addresses: record in the Journal and in `docs/demo-packages.md` that the Original already classifies the five addresses as not public, with the measured values, and remove ip from the demo set. Task group 12 then shrinks to the documentation (the ip tasks 12.1 to 12.5 are not started, and the ip run in task 16.1 is skipped).
    - If at least one returned `true`: no change to the demo; the addresses to declare are exactly those (A10). Never adjust an expected value or an input to make a Resurrection pass.
    - If the result is ambiguous, stop and ask the user.
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 5.12, 5.13, 19.3, 19.4, 20.7_

- [x] 2. Step (b): common module, lint scope and source scans
  - [x] 2.1 Create `src/pipeline/common/` and extend the determinism lint scope
    - `constants.ts` (`PREDICATE_TYPE`, `REPO`, `SIGNER_WORKFLOW`, `PINNED_NODE_VERSION` = `26.13.1`, `GH_MIN_VERSION`, `CREDIT_CEILING`, `INTAKE_LIMITS`, `ALLOWED_MEDIUM_PATHS`), `packageNames.ts` (wraps `src/engine/parse/packageName.ts`, rejects scoped names with the stated reason), `branchNames.ts` (`resurrectBranchName`, `publishBranchName` returning a `Result`, D2), `canonical.ts` (key-order helper, `redactText` wrapping `findIdentity`/`redactIdentity` plus the absolute-path scan), `result.ts` (re-export of the engine `Result`), `shell/system.ts` (the single entry for the real clock, the secure random seed and `process.env`).
    - Add `src/pipeline/**/core/**/*.ts` to `deterministicFiles` in `eslint.config.mjs`.
    - Tests in `tests/pipeline/unit/`: `constants.test.ts` (values), `packageNames.test.ts`, `branchNames.test.ts` (pattern, D2 collision-free examples), `redact.test.ts` (identity, credential shapes `ghp_`, `github_pat_`, `Bearer `, `Authorization`, absolute paths), `determinismLint.test.ts` (a `Date.now` or `Math.random` in a pipeline `core/` file is reported).
    - _Requirements: 1.6, 7.10, 12.2, 13.8, 22.1_

  - [ ]* 2.2 Write property test for the publish branch name
    - **Property 25: Publish branch name**
    - **Validates: Requirements 8.3, 14.7, 15.1**

  - [x] 2.3 Write the source-scan test
    - `tests/pipeline/unit/sourceScan.test.ts` over `src/pipeline/` and `scripts/`: no LLM client import (R1.5); no `shell: true`, no `exec(` with a string (R6.12); no `console.` outside the documented entries; the string `graveyard-shift.dev` appears in no file under `src/`, `scripts/`, `tests/`, `README.md`, `docs/` (except `docs/kiro-journal.md`) or `.github/workflows/` (except `spike-attest.yml`), and is not scanned in `.kiro/specs/` or `spikes/`; `PREDICATE_TYPE` is defined in exactly one module. The `ci.yml` check is added in task 8.19.
    - _Requirements: 1.5, 6.12, 13.8, 17.2_

- [x] 3. Gravedigger
  - [x] 3.1 Implement the pure core: rules, line counter, record, serialization
    - `src/pipeline/gravedigger/core/rules.ts` (seven rules in fixed order, `evaluateRules`, `unverified` with `missingField`, `retired-with-successor` fails rule (e) and records the Successor), `countLines` (text file = no NUL and strict UTF-8; never `dist.unpackedSize`), `eligibility.ts` (`EligibilityRecordSchema`, `RuleResultSchema`, key-order table, canonical JSON, `deserialize` that names the invalid field and returns no partial record), `record.ts` (`buildEligibilityRecord`, `integrity-mismatch` record with both strings, facts with Source_URL and Fetch_Date, no absolute path).
    - Unit tests per module in `tests/pipeline/unit/` including the three demo packages as examples (lodash.set, ip, inflight with its successor).
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [x] 3.2 Write property test for the Eligibility_Record round trip
    - **Property 1: Eligibility record round trip**
    - **Validates: Requirements 2.9, 2.10**
    - File: `tests/pipeline/property/p01-eligibility-roundtrip.test.ts`.

  - [ ]* 3.3 Write property test for the eligibility rules
    - **Property 2: Eligibility rules decide `eligible`**
    - **Validates: Requirements 2.3, 2.5, 2.6, 2.8**

  - [ ]* 3.4 Write property test for the line count
    - **Property 3: Line count comes from the bytes**
    - **Validates: Requirements 2.4**

  - [x] 3.5 Implement the Gravedigger shell
    - `src/pipeline/gravedigger/shell/gravedigger.ts`: `runGravedigger(cert, { fetch, clock })` fetches the packument and the tarball (registry host checked, redirects refused as in `recordTarball`), computes the sha512 SRI, compares with `dist.integrity`, reads `package.json` through the proof tarball extractor, reads the clock once for every Fetch_Date, returns `{ record, tarball | null }`.
    - Unit tests in `tests/pipeline/unit/gravedigger.test.ts` with a fake fetch and synthetic tarballs built by the existing helpers in `tests/proof/helpers/` (match, mismatch writes no tarball, inflight successor, absent field gives `unverified`).
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 2.11_

  - [ ]* 3.6 Write property test for Gravedigger determinism and digest mismatch
    - **Property 4: Gravedigger is deterministic and rejects a wrong digest**
    - **Validates: Requirements 2.2, 2.11**

- [x] 4. Intake_Validator
  - [x] 4.1 Implement the pure validator and limits
    - `src/pipeline/intake/core/types.ts`, `limits.ts`, `validator.ts`: `validateIntake(entries)` with the check order and violation codes of the design (`bad-path`, `outside-allowlist`, `link`, `case-collision`, limits, `missing-required`, `bad-extension`, `bad-encoding`), all violations listed sorted by path then code, values at the limit accepted and one above rejected.
    - Example tests in `tests/pipeline/unit/intakeValidator.test.ts` (each code, limits at and above, `LICENSE`, strict UTF-8).
    - _Requirements: 9.5, 9.6, 9.7, 9.8, 9.9, 9.12_

  - [x] 4.2 Write property test for allowlisted paths
    - **Property 13: Intake accepts only allowlisted paths**
    - **Validates: Requirements 9.5, 9.6, 9.11, 8.1**
    - File: `tests/pipeline/property/p13-intake-paths.test.ts` (traversal, mixed case, backslashes, drive prefixes, NUL, `.git`/`.github`/`.kiro`, link types).

  - [ ]* 4.3 Write property test for limits and content rules
    - **Property 14: Intake limits and content rules**
    - **Validates: Requirements 9.7, 9.8, 9.9**

  - [x] 4.4 Implement the entry readers and the git plumbing integration test
    - `src/pipeline/intake/shell/gitEntries.ts` (resolve the branch once, fetch, verify the tip equals the resolved SHA, merge base with `main`, `git diff --raw -z --no-renames`, `cat-file --batch-check` and `--batch`, mode mapping `100644/100755` file, `120000` symlink, `160000` submodule, other; never a checkout) and `fsEntries.ts` (`lstat` reading for the Local_Runner and the Push_Script).
    - Integration test `tests/pipeline/integration/gitEntries.integration.test.ts` against a throwaway local git repository in a temp dir with a symlink (skipped where the platform cannot create one, as `treeHash.test.ts` does), a submodule entry, a case collision, a moved branch tip ("branch changed during intake"), and a branch that carries all of `main` (a changed path outside the allowlist is a violation).
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.12_

- [x] 5. Necromancy gate
  - [x] 5.1 Implement the pure gate
    - `src/pipeline/necromancy/core/gate.ts` and `authors.ts`: `checkNecromancy` with checks `license`, `license-file` (root `LICENSE`/`LICENCE`, any extension, case-insensitive, identical bytes), `author-credits` (author plus contributors, string or object form normalized), `version` (`semver.gt`, same major, no prerelease), `name` (`@graveyard-shift/<name>`), `forbidden-fields` (no added `dependencies`, no `preinstall`/`install`/`postinstall`/`prepare`, no `bin`, `type` not `module`). All checks run and all failures are listed.
    - Example tests in `tests/pipeline/unit/necromancy.test.ts`. If `semver` is not yet a direct dependency, add it and note it for `PREEXISTING.md` (task 14.3).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.9_

  - [x] 5.2 Write property test for the version rule
    - **Property 15: Necromancy version rule**
    - **Validates: Requirements 10.4, 10.9**

  - [x] 5.3 Write property test for the name rule
    - **Property 16: Necromancy name rule**
    - **Validates: Requirements 10.5, 10.9**

  - [ ]* 5.4 Write property test for license, credits and forbidden fields
    - **Property 17: Necromancy license, credits and forbidden fields**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.6**

- [x] 6. Deltas_File, Harness_File, compiler, lodash.set preset and Stub_Fixture
  - [x] 6.1 Implement the Deltas_File and Harness_File schemas and parsers
    - `src/pipeline/harness/core/deltas.ts` (`DeltaSchema` with kinds `prototype-unchanged` and `returns-expected`, `DeltaId`, `AdvisoryId`, bounded `JsonValue`, `*_KEY_ORDER`, `parseDeltasFile`, `canonicalDeltasJson`) and `harnessFile.ts` (`HarnessFileSchema`, `parseHarnessFile`, `canonicalHarnessJson`). Strict schemas; parse errors name the failing path.
    - Example tests in `tests/pipeline/unit/deltasFile.test.ts` and `harnessFile.test.ts`.
    - _Requirements: 4.1, 4.2, 4.8, 4.10, 5.1, 5.2, 5.10_

  - [x] 6.2 Write property test for the Deltas_File round trip
    - **Property 6: Deltas_File round trip**
    - **Validates: Requirements 4.9, 4.10**

  - [x] 6.3 Write property test for the Harness_File round trip
    - **Property 8: Harness_File round trip**
    - **Validates: Requirements 5.9, 5.10**

  - [x] 6.4 Implement the compiler, the preset menu and the lodash.set preset
    - Read `src/proof` first (V14): how a sandbox-side property module receives per-delta data, whether `runCli` surfaces a `loadHarness` failure usably, whether `fallbackReport` can be built outside the orchestrator. Record the answer in the Journal. If the engine offers no data channel, generate one property-module file per delta from a template in the work directory (data, not Medium code).
    - `src/pipeline/harness/core/presets/index.ts` and `lodashSet.ts` (reuses `ordinaryArgs`, `ordinaryExplicitCases`, `dangerousArgs`, `deltaExplicitCases`, `pathHasDangerousSegment`, `POLLUTION_MODULE_PATH` from `src/proof/harnesses/lodash.set/config.ts`), and `compiler.ts`: `compileHarness` returns a `Result` and never throws; forbidden keys (`excluded`, `radius`, `caseCount`, `seed`, `perCallTimeoutMs`, `stubs`, `accept`, `args`, `setupModule`, `propertyModule`, `generator`, `predicate`, code strings) give an error naming the key, with "belongs to CI" for CI-owned keys; unknown preset names are errors; advisory must be on the certificate or its aliases; function must be in a selected preset; `returns-expected` cases need `source`; deltas ordered by `id`; no radius field in `CompiledHarness`.
    - The `returns-expected` lowering is built in task 12.2; until then the compiler validates that kind and returns the error code `returns-expected-not-implemented` (covered by a test, removed in 12.2).
    - Example tests in `tests/pipeline/unit/compiler.test.ts`.
    - _Requirements: 4.3, 4.5, 4.6, 4.7, 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.11_

  - [x] 6.5 Write property test for deterministic compilation
    - **Property 10: Compilation is deterministic**
    - **Validates: Requirements 5.5**

  - [ ]* 6.6 Write property test for delta validation
    - **Property 7: Delta validation**
    - **Validates: Requirements 4.2, 4.5, 4.6, 4.7, 4.8, 5.11**

  - [ ]* 6.7 Write property test for forbidden harness content
    - **Property 9: Forbidden harness content is rejected**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.11**

  - [x] 6.8 Create the Stub_Fixture and its tests
    - Create `tests/pipeline/fixtures/stub/lodash.set/` with exactly three entries: `resurrection/` (a separate copy of `tests/proof/fixtures/lodash.set-alive`; `package.json` name `@graveyard-shift/lodash.set`, version `4.3.3`; license text and author credits unchanged from lodash.set@4.3.2), `deltas.json` (one `prototype-unchanged` delta, function `default`, advisory `GHSA-p6mc-m468-83gw`) and `harness.json` (the lodash-set preset). Both files in canonical JSON. Do not edit anything under `tests/proof/fixtures/lodash.set-alive`.
    - Check that the line-ending rules of `.gitattributes` keep the fixture bytes stable.
    - Test `tests/pipeline/unit/stubFixture.test.ts`: the directory holds exactly the three entries; `resurrection/package.json` plus its license pass `checkNecromancy` against the recorded lodash.set@4.3.2 `package.json` and license; `validateIntake` accepts the directory mapped to the Medium_Output paths with no path change; `deltas.json` and `harness.json` parse and compile against the lodash.set certificate fixture.
    - _Requirements: 4.11, 23.18, 23.19, 23.20, 23.21_

  - [x] 6.9 Write the R5.7 integration test (real sandbox)
    - `tests/pipeline/integration/lodashHarness.integration.test.ts`: compile the Stub_Fixture files and run the Proof_Engine with the real Sandbox_Executor against `tests/proof/fixtures/lodash.set-alive` (verdict `alive`) and `tests/proof/fixtures/lodash.set-broken` (verdict `restless`). One example each.
    - _Requirements: 5.7_

- [x] 7. Local_Runner, Ledger, Medium launcher and Push_Script
  - [x] 7.1 Implement the Ledger
    - `src/pipeline/local/core/ledger.ts`: `LedgerEntrySchema` (discriminated on `mode`: `local` with `creditBefore`, `creditAfter`, `exitCode`, `kiroCliVersion`, optional `cliUsage`; `stub` with `fixture` as a `RelativePath`), `LedgerSchema`, `LEDGER_KEY_ORDER`, canonical JSON, `buildLocalEntry` (copies reading strings verbatim, `not provided` when empty, never parses a number), `buildStubEntry`, `appendEntry` (earlier entries unchanged). `src/pipeline/local/shell/atomicWrite.ts` (temp file in the same directory, then rename).
    - Example tests in `tests/pipeline/unit/ledger.test.ts` (malformed file names the failing path, no absolute path, atomic write leaves the old file on failure).
    - _Requirements: 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 23.4_

  - [x] 7.2 Write property test for the Ledger round trip
    - **Property 11: Ledger round trip**
    - **Validates: Requirements 7.7**

  - [ ]* 7.3 Write property test for Ledger append
    - **Property 12: Ledger append keeps history and stores readings verbatim**
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.8, 23.4**

  - [x] 7.4 Implement argument parsing, usage and the stub copy plan
    - `src/pipeline/local/core/cliArgs.ts` (`parseResurrectArgs`: exactly one supported package, optional `--stub <dir>` relative, under `tests/pipeline/fixtures/` or `tests/proof/fixtures/`, no `..`, no absolute path; usage error maps to exit code 64), `usage.ts`, `stubPlan.ts` (the fixture directory must hold exactly `resurrection/`, `deltas.json`, `harness.json`; any other entry is a usage error before anything is copied; plain recursive copy plan with no rename and no filter).
    - Example tests in `tests/pipeline/unit/cliArgs.test.ts` and `stubPlan.test.ts` (Windows and POSIX path strings through injected path functions, R21.10).
    - _Requirements: 6.1, 6.2, 23.2, 23.3, 23.17_

  - [ ]* 7.5 Write property test for command-line arguments
    - **Property 32: Command-line arguments**
    - **Validates: Requirements 6.1, 6.2, 23.3**

  - [x] 7.6 Implement the Medium launcher (fixed prompt and process start)
    - `src/pipeline/medium/core/prompt.ts` (fixed text, built only from the package name), `kiroArgs.ts` (`["chat","--v3","--no-interactive","--agent","medium",<prompt>]`), `src/pipeline/medium/shell/kiroRunner.ts` (spawn without a shell, environment without `GITHUB_TOKEN`, no env value printed or logged; missing `kiro-cli` or a "usage limit" outcome names the cause and points to the account setup note of `spikes/kiro-agent/README.md`).
    - Example tests in `tests/pipeline/unit/kiroRunner.test.ts` with a fake spawn.
    - _Requirements: 6.6, 6.7, 6.12, 6.13_

  - [ ]* 7.7 Write property test for the Medium process environment
    - **Property 33: Medium process environment**
    - **Validates: Requirements 6.6, 6.7**

  - [x] 7.8 Implement the Push_Script
    - `src/pipeline/local/core/pushPlan.ts` (`planPush`: commit paths are a subset of `resurrection/**`, `deltas.json`, `harness.json`; dispatch argv with `package`, `version`, `branch`, `medium_mode`), `shell/gitPlumbing.ts` and `shell/push.ts`: validate again, `git config user.email` is the only git command before the confirmation (printed to the terminal only, never to a file, the Ledger, a log or an artifact), `git fetch origin main`, `git ls-remote --heads origin resurrect/<pkg>` (existing branch: print its name and `git push origin --delete resurrect/<pkg>`, never run it, never force), commit built with a temporary index on `origin/main` (`read-tree`, `hash-object -w`, `update-index --cacheinfo`, `write-tree`, `commit-tree`), `git push origin <commit>:refs/heads/resurrect/<pkg>`, then `gh workflow run resurrect.yml --repo subair99/graveyard-shift --ref main -f package=... -f version=... -f branch=... -f medium_mode=...`; print the command and the workflow runs URL. The eligibility-only dispatch is the same command without `-f branch=` and with `medium_mode=local`. Add the thin entry `scripts/push-resurrection.ts`.
    - Example tests in `tests/pipeline/unit/push.test.ts` with fake git and gh (confirmation first, no email means no further git command, branch exists, argv elements, `ledger.json` never included, failure names the command).
    - _Requirements: 6.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.11, 8.12, 23.6_

  - [ ]* 7.9 Write property test for the push plan
    - **Property 31: Push plan carries only the three paths**
    - **Validates: Requirements 6.11, 8.2, 8.4, 8.7, 8.11, 23.6**

  - [x] 7.10 Implement the Local_Runner orchestration and wire the npm script
    - `src/pipeline/local/shell/resurrect.ts` (`runResurrect(args, deps)`, steps 1 to 10 of the design: parse, read the ledger, refuse existing `resurrection/`, `deltas.json` or `harness.json` at the root, Coroner then Gravedigger, ineligible stop with the no-branch dispatch command, ip gate through `docs/measurements/ip-2.0.1.json` and `deriveIpDeltas`, write `.graveyard-work/certificate.json` (`GRAVEYARD_CERTIFICATE_PATH`), credit statement and readings (not for stub), one Medium start or the stub copy, atomic ledger write even when the Medium failed, validator on the three paths, one `push` call, reminder that the user commits `ledger.json`). Thin entry `scripts/resurrect.ts`; add `"resurrect": "tsx scripts/resurrect.ts"` to `package.json`.
    - Add to `.gitignore` (anchored): `/.graveyard-work/`, `/resurrection/`, `/deltas.json`, `/harness.json`.
    - Unit tests in `tests/pipeline/unit/resurrect.test.ts` with fakes: ineligible stop, ip gate, single Medium start, violation path writes the ledger and does not push, ledger-before-push order, stub run asks no reading and prints "A stub run uses no credit", stub ledger entry, reminder text, missing `kiro-cli`, malformed ledger stops first, Windows and WSL path injection.
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.10, 6.11, 6.13, 6.14, 6.15, 7.1, 7.2, 7.6, 7.9, 7.11, 21.10, 23.1, 23.2, 23.4, 23.5, 23.17_

- [x] 8. Undertaker: entry layout, gates, CI step code and `resurrect.yml`
  - [x] 8.1 Implement the entry layout module
    - `src/pipeline/undertaker/core/layout.ts`: `ENTRY_FILES`, `bundleName`, `EntryKind`, `deriveEntryKind` (a file list with `proof-report.json` is `resurrection`; otherwise `eligibility.json` with `eligible: false` gives `not-resurrected`; anything else is `malformed-entry`), `planEntryFiles` (sorted; six base files, three bundles only for `alive`, `stub-run.json` only for a stub; two files for not-resurrected), the stub marker builder `{ schemaVersion: 1, mode: "stub", label: "stub run" }`.
    - Example tests in `tests/pipeline/unit/layout.test.ts`.
    - _Requirements: 14.2, 14.3, 14.4, 14.12, 14.13, 14.15, 23.11_

  - [ ]* 8.2 Write property test for the entry file plan
    - **Property 24: Entry file plan and kind derivation**
    - **Validates: Requirements 14.2, 14.3, 14.4, 14.13, 14.15, 23.11**

  - [x] 8.3 Implement the Resurrection_Predicate
    - `src/pipeline/undertaker/core/predicate.ts`: `ResurrectionPredicateSchema` (strict; `verdict` literal `alive`; `medium.mode` exactly `local` or `stub`), `PREDICATE_KEY_ORDER`, canonical JSON, parse and print, `buildPredicate` using `PREDICATE_TYPE` from common.
    - Example tests in `tests/pipeline/unit/predicate.test.ts` (error names the field for a non-`alive` verdict and for an unknown mode).
    - _Requirements: 13.1, 13.6, 13.7, 13.11, 23.9, 23.10_

  - [x] 8.4 Write property test for the predicate round trip and mode check
    - **Property 21: Resurrection_Predicate round trip and mode check**
    - **Validates: Requirements 13.6, 13.7, 23.9, 23.10**

  - [x] 8.5 Implement the attest decision and the publish gate
    - `src/pipeline/undertaker/core/gates.ts`: `attestDecision` and `publishGate` exactly as in the design (`JobResult` = `success | failure | cancelled | skipped`).
    - Example tests in `tests/pipeline/unit/gates.test.ts`: the full finite table of job results, verdicts and kinds for both gates (the verdict gate is never cut, J10).
    - _Requirements: 1.4, 11.2, 11.16, 11.17, 13.1, 13.2, 13.3, 13.10, 14.1, 15.1_

  - [x] 8.6 Write property test for the attest decision
    - **Property 22: Attest decision**
    - **Validates: Requirements 1.4, 11.16, 11.17, 13.1, 13.2, 13.3**

  - [x] 8.7 Write property test for the publish gate
    - **Property 23: Publish gate**
    - **Validates: Requirements 11.2, 11.16, 11.17, 13.10, 14.1, 15.1**

  - [x] 8.8 Implement dispatch input validation and exit-code mapping
    - `src/pipeline/undertaker/core/dispatchInputs.ts` (`validateDispatchInputs`: ref `refs/heads/main`, supported package, exact semver, branch empty or `resurrect/<package>`, mode `local` or `stub`) and `proveExit.ts` (`mapExitCode`: 0 `alive`, 1 `restless`, 2 `inconclusive`, anything else `inconclusive` with the harness error `harness-config-error`), plus `planIntake({ eligible, branch })` (ineligible gives `not-resurrected` and reads no branch; eligible with no branch is the error "a Resurrection_Branch is required"; eligible with a branch gives `resurrection`).
    - Example tests in `tests/pipeline/unit/dispatchInputs.test.ts`, `proveExit.test.ts`, `planIntake.test.ts`.
    - _Requirements: 9.1, 9.2, 9.14, 11.2, 11.15, 12.4, 23.7_

  - [ ]* 8.9 Write property test for dispatch input validation
    - **Property 18: Dispatch input validation**
    - **Validates: Requirements 9.1, 9.2, 23.7**

  - [ ]* 8.10 Write property test for exit-code mapping
    - **Property 19: Exit codes never produce `alive` by accident**
    - **Validates: Requirements 12.4**

  - [x] 8.11 Implement the verification commands and the pull request text
    - `src/pipeline/undertaker/core/verifyCommands.ts` (one builder: `gh attestation verify <name> --repo subair99/graveyard-shift --predicate-type <PREDICATE_TYPE> --signer-workflow <SIGNER_WORKFLOW> --format json`; also used by the nightly in task 13.7 and by the README text) and `prText.ts` (`renderPrTitle`, `renderPrBody`: all fields of the design, the D3 sentence about the Existing_CI, the A12 sentence, the "not attested" sentence for `restless` and `inconclusive`, "stub run" in the title and as the first body line for a stub, the Not_Resurrected_Entry body with failed rules and Source_URL and Fetch_Date). Every rendered text passes `redactText`. No template contains a time or credit number.
    - Example tests in `tests/pipeline/unit/verifyCommands.test.ts` (string construction only, no network) and `prText.test.ts` (alive, restless, inconclusive, not-resurrected, stub).
    - _Requirements: 13.12, 14.5, 14.9, 14.14, 15.2, 15.3, 15.4, 15.5, 15.9, 15.10, 15.11, 15.12, 17.1, 17.5, 18.1, 18.5, 18.6, 23.12_

  - [ ]* 8.12 Write property test for the pull request text
    - **Property 26: Pull request text**
    - **Validates: Requirements 14.5, 15.2, 15.3, 15.4, 15.5, 15.10, 15.11, 15.12, 23.12**

  - [ ]* 8.13 Write property test for verification command construction
    - **Property 27: Verification command construction**
    - **Validates: Requirements 17.1, 17.5, 18.1, 18.6**

  - [x] 8.14 Implement the `gh` wrapper and the publish shell
    - `src/pipeline/undertaker/shell/ghCli.ts` (argv builders and JSON parsing for `gh`, no shell) and `publish.ts` (entry writer using `planEntryFiles` and `deriveEntryKind`, replaces `graveyard/<package>/` completely with bytes copied unchanged, recomputes the sha256 of the three subjects against `attest/predicate.json` for `alive`, D2 collision check with `git ls-remote --heads origin "publish/<slug>-run<run_id>-*"` that fails with the branch name and the delete command, bot identity `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com`, `gh auth setup-git`, commit only `graveyard/<package>/`, push without force, `gh pr create --base main --head <branch> --title <t> --body-file pr-body.md`, never merge, never auto-merge, lists open `publish/<slug>-*` pull requests in the job summary, prints the setting name "Allow GitHub Actions to create and approve pull requests" when `gh pr create` fails).
    - Example tests in `tests/pipeline/unit/publish.test.ts` with fake fs, git and gh (digest mismatch fails before any push, collision message, replaced entry, stub marker only for stub, no bundle for `restless`).
    - _Requirements: 13.9, 13.10, 14.1, 14.3, 14.4, 14.7, 14.13, 15.1, 15.6, 15.7, 15.8, 23.11_

  - [x] 8.15 Write the CI step entries for `intake`
    - `scripts/ci/intake.ts` with sub-commands `validate-inputs` (also compares `process.version` with `v${PINNED_NODE_VERSION}`), `coroner` (Coroner then Gravedigger with `GITHUB_TOKEN`, writes `certificate.json`, `eligibility.json`, `original.tgz`), `plan`, `resolve-branch` (the only step with a token near the branch; reads no content), `fetch-and-validate` (no token; `gitEntries`, `validateIntake`, `checkNecromancy`, violations and failed checks to the job summary, exit 1), and the packing step (validated files to `work/medium/`, `resurrection.tgz` with entries under `package/`, sorted, mtime 0, uid and gid 0, plus `deltas.json` and `harness.json` copied).
    - Packing: `tech.md` says only `src/proof/shell/tarball/tarballExtractor.ts` imports `tar`. Add a `packTarball` function in that directory rather than importing `tar` in `scripts/`. If that needs a change of the proof engine beyond one added export, stop and ask the user.
    - Inputs reach scripts only as environment variables; output goes through the redaction used by the other entries. Keep each entry thin and test the called functions; add `tests/pipeline/unit/ciIntakeEntry.test.ts` with injected deps.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.10, 10.8, 11.1, 11.2, 11.3, 11.12, 11.15, 12.6_

  - [x] 8.16 Write the CI step entry for `prove`
    - `scripts/ci/prove.ts`: choose the Run_Seed once with the secure source in `common/shell/system.ts`, call `runCli` with `--original original.tgz --integrity <from eligibility.json> --version --name --resurrection resurrection.tgz --harness pipeline --seed <seed> --cases 100 --out proof-report.json` and a `loadHarness` that calls `compileHarness`; **no `--radius` option, no radius variable**, nothing from the dispatch inputs, the environment or the Medium_Output (R12.12); map the exit code with `mapExitCode`; on a compile error or a missing report write `fallbackReport(...)` with `harness-config-error` and the messages; write the `verdict` output. Verify V13 first (`casesRequested` equals the `--cases` value; `functionsTested` is accepted by `--radius`) and record it in the Journal.
    - Tests in `tests/pipeline/unit/proveEntry.test.ts`: the argument list never contains `--radius` (example test), seed and case count come only from the script, fallback report on compile failure.
    - _Requirements: 5.4, 5.11, 12.1, 12.2, 12.3, 12.4, 12.5, 12.12_

  - [x] 8.17 Write the CI step entries for `checks`, `attest` and `publish`
    - `scripts/ci/checks-summary.ts` (reads the three step outcomes from environment variables, writes each result and the run URL to the summary, writes `checks-results.json`, exits 1 if any outcome is not `success`), `scripts/ci/attest.ts` (`prepare`: parse the report with `ProofReportSchema`, recompute the Tree_Hash of `resurrection.tgz` and the Integrity_Hash of `original.tgz`, call `attestDecision`, compute the sha256 of the three subjects, write `attest/predicate.json` and print `predicate_type` (from `PREDICATE_TYPE`) and the subject paths as step outputs; `collect`: copy the three `bundle-path` outputs to `attest-bundles/<subject>.sigstore.json`), `scripts/ci/publish.ts` (`gate` calls `publishGate`; `build-entry`; `push-pr`).
    - Tests in `tests/pipeline/unit/ciEntries.test.ts` with injected deps (hash mismatch ends without signing, a non-`alive` report ends without signing, checks failure exits 1, gate output).
    - _Requirements: 11.14, 11.16, 11.17, 13.2, 13.3, 13.4, 13.5, 13.9, 14.1_

  - [x] 8.18 Write `resurrect.yml`, add `workflow_dispatch` to `ci.yml`, and the workflow lint
    - `.github/workflows/resurrect.yml`: jobs `intake`, `checks`, `prove`, `attest`, `publish` with the permissions, `needs` and `if` text of design D4 and "Workflow YAML"; `permissions: {}` at workflow level; concurrency group per package with `cancel-in-progress: false`; `timeout-minutes` on every job; every third-party action pinned to the SHAs listed in the design (checkout `3d3c42e5...`, setup-node `949feb24...`, upload-artifact `cf430e03...`, download-artifact `9000827c...`, attest `1e69f48a...`), `node-version: 26.13.1`, a `node --version` check step, `persist-credentials: false` on every checkout, `npm ci --ignore-scripts` in `attest` and `publish`, three `actions/attest` steps (tarball, report, certificate) with the predicate type taken from the `prepare` output (the YAML never contains the type string), `PROOF_BUDGET_MODE: warn` in `checks`, every user input assigned to an `env:` variable and never written inside a `run:` string.
    - `.github/workflows/ci.yml`: add `workflow_dispatch:` to `on:` (nothing else changes).
    - Add a YAML parser dependency if the repository has none (record it for `PREEXISTING.md`, task 14.3).
    - `tests/pipeline/unit/workflowLint.test.ts`: fails on a third-party `uses:` without a 40-hex SHA, `id-token: write` or `attestations: write` in a job that runs `prove` or touches `work/medium`, `secrets.` other than the workflow token, differing or non-`major.minor.patch` Node versions across `resurrect.yml` and `nightly.yml` or a mismatch with `PINNED_NODE_VERSION`, a job without `timeout-minutes`, a checkout without `persist-credentials: false`, `attest` or `publish` without `checks` in `needs`, a `--radius` in any workflow; asserts `ci.yml` has `workflow_dispatch`. Extend `sourceScan.test.ts` where needed.
    - _Requirements: 9.13, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 11.14, 11.18, 12.6, 12.8, 12.12, 13.5, 15.12, 15.13_

  - [ ]* 8.19 Write property test for the Node pin lint
    - **Property 20: Node pin lint**
    - **Validates: Requirements 12.6, 12.8**

- [-] 9. Checkpoint: end of step (b), full suite run by the user
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings. Do not run `npm test`.
  - Ready for you to run: `npm test` (M11). Paste the output. Add the observed span of the `pipeline` project to `docs/kiro-journal.md` only from that pasted output.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 21.2, 21.3, 21.8, 21.9_

- [ ] 10. Step (c): checkpoint, the first lodash.set stub run end to end
  - [ ] 10.1 Manual task (yours): M3, set up `gh`, a separate clone and `git` in WSL
    - **NEVER run `npm ci` or `npm install` in WSL inside `/mnt/c/dev/graveyard-shift`.** Linux binaries would replace the Windows `node_modules`. All WSL work uses the separate clone `~/graveyard-shift` created below.
    - Install `gh` in WSL (Ubuntu) from GitHub's official apt repository, not Ubuntu's default package. These are the commands of the [GitHub CLI Linux install instructions](https://github.com/cli/cli/blob/trunk/docs/install_linux.md) (fetched 2026-11-15; re-read that page if it has changed):
      ```bash
      (type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
        && sudo mkdir -p -m 755 /etc/apt/keyrings \
        && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
        && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
        && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
        && sudo apt update \
        && sudo apt install gh -y
      ```
      Then `gh --version` must report 2.67.0 or later. If it is older, stop and report it; do not fall back to Ubuntu's own `gh` package.
    - Authenticate and create the clone (replace `<id>` and `<name>`; keep the account name `subair99`):
      `gh auth login`
      `gh auth setup-git`
      `git clone https://github.com/subair99/graveyard-shift.git ~/graveyard-shift`
      `cp /mnt/c/dev/graveyard-shift/.env ~/graveyard-shift/.env` (the `.env` is gitignored; never paste its content)
      `cd ~/graveyard-shift`
      `npm ci`
      `git config user.name "<name>"`
      `git config user.email "<id>+subair99@users.noreply.github.com"`
      `git config user.email`
      `node --version`
    - `user.name` and `user.email` are set inside the clone only. The Push_Script still prints the `git config user.email` value and asks you to confirm it before it pushes (task 7.8).
    - Keep the clone current: whenever workflow files or scripts change on `main` (or on a branch you run from), run `cd ~/graveyard-shift && git pull origin main` (and `npm ci` again if `package-lock.json` changed) before the next WSL run.
    - Paste back: `gh --version`, `gh auth status`, `node --version`, and the output of `git -C ~/graveyard-shift config user.name` and `git -C ~/graveyard-shift config user.email`. Do not paste tokens or `.env` content.
    - _Requirements: 8.10_

  - [ ] 10.2 Manual task (yours): M4, allow Actions to create pull requests
    - In the browser: repository Settings, Actions, General, Workflow permissions, tick "Allow GitHub Actions to create and approve pull requests", Save.
    - Check from PowerShell: `gh api repos/subair99/graveyard-shift/actions/permissions/workflow` and paste back the JSON (`can_approve_pull_request_reviews` should be `true`).
    - _Requirements: 15.8_

  - [ ] 10.3 Manual task (yours): M5, commit the workflows to `main` and run the first stub run
    - In PowerShell from the repository root, check `git status`, then commit everything of steps (a) and (b) to `main` (stage files by name) and push: `git push origin main`.
    - In WSL, in the separate clone (never in `/mnt/c/dev/graveyard-shift`): `cd ~/graveyard-shift`, then `git pull origin main`, `npm ci`, then
      `npm run resurrect -- lodash.set --stub tests/pipeline/fixtures/stub/lodash.set`
      Confirm the printed commit email when asked. The run copies the fixture, writes a `mode: stub` entry to `ledger.json` (in `~/graveyard-shift`), pushes `resurrect/lodash.set` and dispatches `resurrect.yml`.
    - Paste back: the full terminal output (the printed dispatch command and runs URL), then `gh run list --workflow resurrect.yml --limit 3`, and `gh run view <run-id>` for the dispatch run. Commit `ledger.json` to `main` yourself (the Push_Script does not): in WSL, `cd ~/graveyard-shift`, `git add ledger.json`, commit, `git push origin main`; then `git pull origin main` in the Windows clone.
    - _Requirements: 6.15, 8.4, 8.5, 23.1, 23.2, 23.16_

  - [ ] 10.4 Manual task (yours): M6, check the stub pull request and the attestations
    - From PowerShell: `gh pr list --state open`, `gh pr view <number>`, `gh pr checks <number>`, `gh run list --workflow ci.yml --limit 5`.
    - Check out the pull request branch: `gh pr checkout <number>`; in `graveyard/lodash.set/` run the three commands of the pull request body, which have this form (replace `<file>` with `lodash.set-4.3.3.tgz`, `proof-report.json`, `certificate.json`):
      `gh attestation verify <file> --repo subair99/graveyard-shift --predicate-type https://github.com/subair99/graveyard-shift/attestation/resurrection/v1 --signer-workflow subair99/graveyard-shift/.github/workflows/resurrect.yml --format json`
    - Observe and paste back (V1, V2, V3, V5, V7, V8): the `node --version` step output of the jobs; whether the `publish/...` push started a `ci.yml` run; whether the `pull_request` event created an approval-required `ci.yml` run or none; what the merge box shows; whether the anonymous fetch in `intake` worked; whether each of the three `gh attestation verify` commands found its own attestation, with the JSON field names and the exit code of any failing case. Do not merge the stub pull request.
    - _Requirements: 11.14, 13.4, 13.9, 15.10, 15.12, 18.1, 23.9, 23.12_

  - [ ] 10.5 Manual task (yours): M7, re-run once to confirm the collision message
    - From PowerShell: `gh run rerun <run-id> --repo subair99/graveyard-shift` (the run of M5), then `gh run watch <new run id>` or read it in the browser.
    - Paste back (V4): whether `publish` failed with the message that names the existing `publish/lodash-set-run<id>-a1` branch and the command `git push origin --delete <branch>`.
    - Then clean up: `gh pr close <number> --delete-branch`, and `git push origin --delete resurrect/lodash.set`.
    - _Requirements: 8.3, 14.7_

  - [ ] 10.6 Manual task (yours): record the observations
    - Write the observations of M3 to M7 in `docs/kiro-journal.md` (dated, user-run, only what you observed, including the run URLs). State the verified-or-failed status of V1 to V8 in that entry.
    - _Requirements: 21.8, 22.8_

- [ ] 11. Checkpoint: stop until the user reports the observations
  - Do not start step (d) until the user has pasted the M3 to M7 results. Fixes to the workflows that follow from them (for example the D3 wording or the artifact flow) are made first, with one test file run per change. After such a fix reaches `main`, the user runs `cd ~/graveyard-shift && git pull origin main` in WSL before any further WSL run.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Step (d): ip preset and ip run (only while ip stays in the demo, see task 1.8)
  - [ ] 12.1 Implement the ip preset and its setup module
    - `src/pipeline/harness/core/presets/ipAddress.ts` with one generator for every export of ip@2.0.1 as read from the recorded tarball (task 1.8), using the shapes of the design (`ipString` with the forms of `spikes/candidates/IP-SKETCH.md` and explicit cases for the five Advisory_Addresses plus `0` and `017700000001`, `ipPair`, `ipMaskPair`, `cidrString`, `prefixLen`, `longInt`, `bufferArgs` (Buffers of at most 64 bytes), `familyArg`), registered in `presets/index.ts`. `src/pipeline/harness/sandbox/ipSetup.cjs` replaces `os.networkInterfaces()` identically on both sides.
    - Tests in `tests/pipeline/unit/ipPreset.test.ts`: each generator produces values the Value_Codec encodes (one example per generator), and the list test of R5.12 in `tests/pipeline/integration/ipExports.integration.test.ts`: the preset's covered exports equal the export list of the recorded tarball, read through the Sandbox_Executor.
    - _Requirements: 5.6, 5.8, 5.12_

  - [ ] 12.2 Implement the `returns-expected` lowering
    - `src/pipeline/harness/sandbox/returnsExpected.cjs` and the `returns-expected` branch of `compiler.ts` (an equality predicate on the listed inputs, explicit cases from the listed inputs, per-delta data through the channel found in task 6.4, V14). Remove the `returns-expected-not-implemented` error and its test. Every case of one delta must have the same expected value; the compiler rejects a delta whose cases differ with the error code `delta-expected-differs`, naming the delta and saying to split it (unit test). The `ip` measurement rule: every `returns-expected` input must be listed as `true` in the measurement.
    - Example tests in `tests/pipeline/unit/compilerReturnsExpected.test.ts`.
    - _Requirements: 4.4, 4.6, 4.7, 4.12, 3.6_

  - [ ] 12.3 Add the ip Deltas_File and Harness_File examples and their compile tests
    - Example files under `tests/pipeline/fixtures/ip/` (a Deltas_File with one `returns-expected` delta for `isPublic` with one case per measured-`true` address (the five addresses when all five are `true`), expected `false`, advisory `GHSA-2p57-rm9w-gvfp`, source the advisory URL with `checkedOn` 2026-11-15; a Harness_File selecting the `ip-address` preset for every export). These are test data, not Medium output.
    - Tests: compile examples; no delta for `isPrivate`, `isLoopback` or any other function; an input not in the measured-`true` set is a compile error (the compile half of Property 5).
    - _Requirements: 4.12, 4.13, 3.5, 3.6, 3.7_

  - [ ] 12.4 Write the R5.8 integration example
    - `tests/pipeline/integration/ipSetup.integration.test.ts`: the setup module replaces `os.networkInterfaces()` identically on both sides (one example with the real Sandbox_Executor).
    - _Requirements: 5.8_

  - [ ] 12.5 Missing-generator behavior and the uncoverable-export list
    - Tests: a Harness_File that omits one function gives a compile error or the harness error `missing-generator`, never `alive`; the argument list built by `prove.ts` still never contains `--radius`.
    - If task 1.8 found an export with no honest generator, write the list with the reasons in design.md ("Uncoverable exports") and in the Journal (R5.13); otherwise write "none" with the date of the tarball read. For such an export the ip run ends `inconclusive` with `missing-generator`; it is shown as such and never excluded or narrowed (R5.14).
    - _Requirements: 5.4, 5.12, 5.13, 5.14, 12.12_

- [ ] 13. Step (e): nightly re-verification
  - [ ] 13.1 Implement the nightly classification
    - `src/pipeline/undertaker/core/nightlyClassify.ts`: `NightlyResult`, `NightlyInput`, `classifyEntry` returning `{ results, fails }` in the fixed order (`tool-versions-changed`, `unexpected-attestation`, `attestation-failed`, `replay-mismatch`, `not-checked`, `new-advisory`, then `verified` or `not-resurrected`), `fails` only for `replay-mismatch`, `attestation-failed`, `unexpected-attestation`; a not-resurrected entry never gets `attestation-failed`, `replay-mismatch`, `tool-versions-changed` or `not-checked`; a stub flag. A pure `nightlyOrder` helper (ascending code point).
    - Example tests in `tests/pipeline/unit/nightlyClassify.test.ts`.
    - _Requirements: 16.3, 16.4, 16.5, 16.7, 16.8, 16.11, 16.12, 16.13, 16.16, 16.18, 16.22, 16.23_

  - [ ] 13.2 Write property test for nightly classification
    - **Property 28: Nightly classification**
    - **Validates: Requirements 16.4, 16.5, 16.7, 16.11, 16.12, 16.13, 16.16, 16.18**

  - [ ] 13.3 Write property test for not-resurrected entries
    - **Property 29: Not-resurrected entries are never proof failures**
    - **Validates: Requirements 16.22, 16.23**

  - [ ]* 13.4 Write property test for nightly order
    - **Property 30: Nightly order**
    - **Validates: Requirements 16.3**

  - [ ] 13.5 Implement the nightly report
    - `src/pipeline/undertaker/core/nightlyReport.ts`: `nightly-report.json` and the job summary, one line per package (package, results, reason, committed and running Tool_Versions, "stub run" for a stub, the `gh` version, first differing path for a mismatch); facts about the registry or advisories carry Source_URL and Fetch_Date; no unmeasured number; all text through `redactText`.
    - Example tests in `tests/pipeline/unit/nightlyReport.test.ts`.
    - _Requirements: 16.10, 16.14, 16.15, 23.14_

  - [ ] 13.6 Implement the Replay
    - `src/pipeline/undertaker/shell/replay.ts`: fetch the Original by name and version from the committed report and compare its sha512 with `report.original.integrity` (mismatch or fetch failure gives `fetch-failed`); run the `prove.ts` path with the committed tarball, `deltas.json`, `harness.json`, `--seed report.seed`, `--cases report.sandbox.limits.casesRequested`, `--radius report.functionsTested`; compare canonical JSON byte for byte and record the first differing path. Confirm V13 (task 8.16) still holds.
    - Example tests in `tests/pipeline/unit/replay.test.ts` with fakes (identical, different with first path, fetch failed, digest differs).
    - _Requirements: 16.6, 16.7, 16.8, 16.17_

  - [ ] 13.7 Implement the nightly shell and its CI entry
    - `src/pipeline/undertaker/shell/nightly.ts` and `scripts/ci/nightly.ts`: list `graveyard/` sorted by code point, `deriveEntryKind` per entry (a malformed entry fails the run and names the path), re-run the Coroner for new advisory ids, compare Tool_Versions, Replay when equal, `gh attestation verify ... --format json` for `alive` entries built with `verifyCommands` (task 8.11), parse the JSON and compare `statement.subject[].digest.sha256` with the committed file, print `gh --version` and fail below `GH_MIN_VERSION`, write the report. It commits nothing and deploys nothing.
    - Unit test `tests/pipeline/unit/ghVerifyJson.test.ts` against a small recorded sample of `gh attestation verify` output, marked as a sample of field names unverified until M8 (use what M6 recorded where available). Tests with fake fs and gh.
    - _Requirements: 16.3, 16.9, 16.10, 16.11, 16.13, 16.17, 16.21_

  - [ ] 13.8 Write `nightly.yml`
    - `.github/workflows/nightly.yml`: `schedule` (cron `17 3 * * *`) and `workflow_dispatch`, `permissions: {}`, job `verify` with `contents: read` only, `ubuntu-24.04`, `timeout-minutes`, SHA-pinned actions, `node-version: 26.13.1`, `npm ci`, `GH_TOKEN` from `github.token`, upload of `nightly-report` with `if: always()`. Extend `workflowLint.test.ts` for the file.
    - _Requirements: 16.1, 16.2, 16.14, 16.21, 12.6, 12.8_

  - [ ]* 13.9 Write the optional `notify` job and its tests (R16.19, R16.20, first to cut)
    - Add job `notify` to `nightly.yml` (`needs: verify`, `if: ${{ always() && needs.verify.result == 'failure' }}`, `permissions: { issues: write }` only, no checkout, no npm) and `scripts/ci/nightly-notify.sh` (shell with `gh` and `jq` only: opens or updates one issue titled "Nightly re-verification failed"). Add a unit test of the issue text (no identity, credential or absolute path) and a lint assertion on its permissions.
    - _Requirements: 16.1, 16.19, 16.20_

  - [ ]* 13.10 Write property test for generated text redaction
    - **Property 34: No identity, credential or absolute path in generated text**
    - **Validates: Requirements 2.7, 7.10, 14.11, 15.9, 16.20, 22.1**
    - Covers `record.ts`, `ledger.ts`, `prText`, `nightlyReport` and, when it exists, the issue text.

  - [ ] 13.11 Manual task (yours): M10, dispatch the eligibility-only run for inflight
    - Run in PowerShell:
      `gh workflow run resurrect.yml --repo subair99/graveyard-shift --ref main -f package=inflight -f version=1.0.6 -f medium_mode=local`
      then `gh run list --workflow resurrect.yml --limit 3` and `gh run watch <run-id>`.
    - Paste back: the run result, the pull request URL and the pull request body (a Not_Resurrected_Entry with the Successor `lru-cache`, failed rules, Source_URL and Fetch_Date). Review it and merge it yourself, then `git pull origin main` (V6).
    - _Requirements: 14.9, 14.10, 14.13, 14.14, 19.5_

  - [ ] 13.12 Manual task (yours): M8, dispatch `nightly.yml` once and read its report
    - Run in PowerShell: `gh workflow run nightly.yml --repo subair99/graveyard-shift --ref main`, then `gh run watch <run-id>` and `gh run view <run-id> --log` (read the summary), and `gh run download <run-id> -n nightly-report`.
    - Paste back (V9, V10, V13): the report lines, the `gh` version on the runner (2.67.0 or later), whether `gh attestation verify` worked with the `contents: read` token (needs an `alive` entry on `main`; M9 runs only after spec (b) and is not a prerequisite, so if no such entry exists yet, say so and record `gh attestation verify` as not checked in the nightly), and the JSON field names. Check the GitHub documentation on scheduled workflows in public repositories and note the inactivity rule in the Journal; observe whether the schedule fires after the merge.
    - _Requirements: 16.1, 16.9, 16.10, 16.14, 16.21_

- [ ] 14. Step (f): documentation and traceability
  - [ ] 14.1 Update the steering files and the README
    - `.kiro/steering/product.md`, `README.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`: the Medium runs on demand on the user's machine; CI re-runs the Coroner and the Gravedigger, runs the Proof of Life, attests only an `alive` verdict and opens the pull request; the nightly job re-verifies without an LLM and without credits. Replace the "resurrect them overnight" wording and the user-flow step 4; replace the `tech.md` sentence "CI does the verification, the Proof of Life, the attestation and the pull request" with one that also states the nightly re-verification and the on-demand Medium.
    - `tech.md`: `npm run resurrect`, `npm run measure:ip`, `PINNED_NODE_VERSION`, `gh` at least 2.67.0, no new secret, the Proof of Life runs only in CI, the `pipeline` vitest project (target only), `tar` importer rule if changed in task 8.15.
    - `structure.md`: `src/pipeline/` with its subdirectories, `scripts/resurrect.ts`, `push-resurrection.ts`, `measureIp.ts`, `scripts/ci/`, `tests/pipeline/` and fixtures, the Stub_Fixture, `docs/measurements/`, `graveyard/`, `ledger.json`, the two workflows, and the added `workflow_dispatch` of `ci.yml`; the stub run (copies a fixture, no credit, labelled "stub run", not Medium-produced).
    - `README.md`: new section "Resurrecting a package" (commands, the stub run, the verification commands built from the same text as `verifyCommands`, the A12 statement, the `gh` minimum and the CVE-2025-25204 warning marked "to be re-checked before release", the Ledger statement that the user commits `ledger.json` and no script or workflow does, the Credit_Ceiling statement), the "Known limitations" text of the design, the `pipeline` row in the test projects table (target only). No figure that the Journal does not record as measured. Keep Halloween naming in user-facing names and plain wording in code and docs.
    - _Requirements: 7.11, 17.2, 17.5, 18.1, 18.2, 18.3, 18.5, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.8, 20.9, 20.10, 20.12, 20.13, 13.12_

  - [ ] 14.2 Reconcile the demo docs, the predicate references and the Journal
    - `docs/demo-packages.md`: reconcile with A9 and the ip measurement (functions and inputs of the ip delta, the planned fate of ip, the "verified on" dates), citing the measured values from the Journal. `docs/proof-of-life-ordering.md` and the proof-of-life-engine spec (`.kiro/specs/proof-of-life-engine/`): replace any reference to `https://graveyard-shift.dev/attestation/spike/v1` with a reference to the Predicate_Type of this spec by the name `PREDICATE_TYPE` (R17.2, R17.4; spike files and Journal entries of 2026-11-15 keep the spike URI).
    - `docs/kiro-journal.md`: the Node pin entry (D1: `26.13.1`, source manifest and release, research date 2026-11-15, the open checks V1 and the full-suite check, R12.9), and the entries for the V13, V14 and V16 answers.
    - _Requirements: 12.9, 17.2, 17.3, 17.4, 20.7_

  - [ ] 14.3 Update `PREEXISTING.md`, `.gitignore` and `.env.example`
    - `PREEXISTING.md`: `actions/attest`, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`, the GitHub CLI, Sigstore as used by GitHub Artifact Attestations, Kiro CLI (user-side), the YAML parser and `semver` (MIT, a direct dependency, `^7.8.6`; list it if not already listed), each with its license and source URL.
    - Confirm the four `.gitignore` lines of task 7.10 are present; confirm `.env.example` has no new variable.
    - _Requirements: 22.2, 22.3, 22.4_

  - [ ] 14.4 Add the `resurrection-pipeline` section to the traceability script
    - `scripts/trace.ts`: a third section reading `tests/pipeline` headers (bare list = this spec; `; <spec-name> N.M` cites another spec) and this spec's `requirements.md`. `docs/traceability-gaps.json`: classify each criterion that only a manual task covers (class and evidence, including M1 to M10 results and the criteria of the Workflow YAML that only a run verifies). Exit code 1 for an unclassified gap or a stale entry.
    - _Requirements: 21.6, 21.7_

  - [ ] 14.5 Write the layout and documentation consistency test
    - `tests/pipeline/unit/docsConsistency.test.ts`: every file name of `ENTRY_FILES` and the two entry kinds appear in `README.md` and `structure.md` (the writer, the nightly reader and the docs list the same names).
    - _Requirements: 14.12_

  - [ ]* 14.6 Write the documentation phrase test (R20.11, first to cut)
    - A test that fails when `README.md`, `product.md`, `tech.md` or `structure.md` contains "overnight" in a sentence that attributes the resurrection to the Kiro agents, or when `README.md` or `structure.md` lists a Pipeline path that does not exist.
    - _Requirements: 20.11_

  - [ ]* 14.7 Document offline verification (R18.4, first to cut)
    - README text for `gh attestation trusted-root`, `--bundle` and `--custom-trusted-root`, marked "not yet verified" while no user run has confirmed it.
    - _Requirements: 18.4_

  - [ ] 14.8 Typecheck and lint pass
    - Run `npm run typecheck` and `npm run lint` and fix findings. Do not run the full suite.
    - _Requirements: 21.3_

- [ ] 15. Final checkpoint: full suite and traceability, run by the user
  - Ready for you to run: `npm test` (M11). Paste the output. Journal timings come from this pasted output only.
  - Ready for you to run: `npm run trace`. Paste the output (exit code 0 means no unclassified gap).
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 21.2, 21.7, 21.8_

- [ ] 16. After spec (b): real Medium runs (not part of steps (a) to (f))
  - This group starts only after spec (b) exists and the Medium agent is installed. Steps (e) and (f) and checkpoint 15 do not wait for it, and task 12 does not depend on it.
  - [ ] 16.1 Manual task (yours): M9, real Medium runs (needs spec (b) and your meter readings)
    - Run in WSL, in the separate clone, one per invocation: `cd ~/graveyard-shift && git pull origin main && npm ci` (only if `package-lock.json` changed), then
      `npm run resurrect -- lodash.set`
      `npm run resurrect -- ip` (only if task 1.8 left at least one delta; there is no ip stub fixture)
    - Type the credit meter reading when asked, before and after (leave it empty if you have none; it is stored as `not provided`). The runner prints the Credit_Ceiling statement (150, a rule that is not enforced).
    - Paste back: the terminal output, the exit code, the dispatch run URL, the pull request URL and what the pull request shows. Record in the Journal (V12) the exit code and output of a "no credits" case if it happened and whether the CLI printed usage. Commit `ledger.json` to `main` yourself, from `~/graveyard-shift` (`git add ledger.json`, commit, `git push origin main`), then `git pull origin main` in the Windows clone. A stub pull request is never the demo entry (close it).
    - _Requirements: 6.6, 7.1, 7.2, 7.3, 7.6, 19.2, 19.3, 19.8, 23.15_

  - [ ] 16.2 Manual task (yours): M8 (second run), dispatch `nightly.yml` again once an `alive` entry from M9 is merged
    - Start only after the pull request of an `alive` real Medium run (task 16.1) is merged to `main` by you. A stub entry does not count. This task is after spec (b) and blocks nothing; task 13.12 stays as it is and records "no `alive` entry yet" for `gh attestation verify`.
    - Same commands as task 13.12, in PowerShell: `gh workflow run nightly.yml --repo subair99/graveyard-shift --ref main`, then `gh run watch <run-id>` and `gh run view <run-id> --log` (read the summary), and `gh run download <run-id> -n nightly-report`.
    - Paste back (V9): the report line of the `alive` entry, the `gh` version on the runner, whether `gh attestation verify` worked on that real entry with the `contents: read` token, the exit code and the JSON field names (compare with what M6 recorded), and whether the `statement.subject[].digest.sha256` comparison held. If it differs from the sample used by `ghVerifyJson.test.ts` (task 13.7), stop and tell the agent, who then fixes the parser.
    - _Requirements: 16.9, 16.10, 16.11, 16.13, 16.21_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The first to cut, in the design's order: 34, 33, 32, 31, 30, 27, 26, 25, 12, 14, 17, 18, 20, 3, 4, 7, 9, 5, 2, 24, 19 (property numbers), then R16.19 and R16.20 (13.9), R18.4 (14.7), R20.11 (14.6). The verdict gate, `gh attestation verify` and the mode label are never cut.
- Required property tests: 1, 6, 8, 10, 11, 13, 15, 16, 21, 22, 23, 28, 29 (the twelve criteria of R21.5).
- Manual tasks (yours): M1 (1.6), M2 (1.7), M3 (10.1), M4 (10.2), M5 (10.3), M6 (10.4), M7 (10.5), the observation record (10.6), M10 (13.11), M8 (13.12), and M11 (checkpoints 9 and 15), and M9 (16.1, after spec (b); blocks nothing above), and M8 (second run) (16.2, after an `alive` M9 entry is merged; blocks nothing).
- Deviation from the work-order wording: `verifyCommands` is built in step (b) (task 8.11) because the pull request text needs it; step (e) reuses it in the nightly (task 13.7).
- The pull request text never claims that the Existing_CI runs; it uses the D3 sentence.
- Design properties map to the tasks above: 1 (3.2), 2 (3.3), 3 (3.4), 4 (3.6), 5 (1.4), 6 (6.2), 7 (6.6), 8 (6.3), 9 (6.7), 10 (6.5), 11 (7.2), 12 (7.3), 13 (4.2), 14 (4.3), 15 (5.2), 16 (5.3), 17 (5.4), 18 (8.9), 19 (8.10), 20 (8.19), 21 (8.4), 22 (8.6), 23 (8.7), 24 (8.2), 25 (2.2), 26 (8.12), 27 (8.13), 28 (13.2), 29 (13.3), 30 (13.4), 31 (7.9), 32 (7.5), 33 (7.7), 34 (13.10).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.6"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["1.7"] },
    { "id": 4, "tasks": ["1.8"] },
    { "id": 5, "tasks": ["2.1"] },
    { "id": 6, "tasks": ["2.2", "2.3", "3.1", "4.1", "5.1", "6.1", "7.1", "7.4", "8.1"] },
    { "id": 7, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "4.4", "5.2", "5.3", "5.4", "6.2", "6.3", "7.2", "7.3", "7.5", "7.6", "8.2", "8.3", "8.5", "8.8"] },
    { "id": 8, "tasks": ["3.6", "6.4", "7.7", "7.8", "8.4", "8.6", "8.7", "8.9", "8.10", "8.11"] },
    { "id": 9, "tasks": ["6.5", "6.6", "6.7", "6.8", "7.9", "8.12", "8.13", "8.14"] },
    { "id": 10, "tasks": ["6.9", "7.10", "8.15", "8.16"] },
    { "id": 11, "tasks": ["8.17"] },
    { "id": 12, "tasks": ["8.18"] },
    { "id": 13, "tasks": ["8.19"] },
    { "id": 14, "tasks": ["10.1", "10.2"] },
    { "id": 15, "tasks": ["10.3"] },
    { "id": 16, "tasks": ["10.4"] },
    { "id": 17, "tasks": ["10.5"] },
    { "id": 18, "tasks": ["10.6"] },
    { "id": 19, "tasks": ["12.1", "12.2"] },
    { "id": 20, "tasks": ["12.3", "12.4", "12.5"] },
    { "id": 21, "tasks": ["13.1"] },
    { "id": 22, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 23, "tasks": ["13.7", "13.10"] },
    { "id": 24, "tasks": ["13.8"] },
    { "id": 25, "tasks": ["13.9", "13.11"] },
    { "id": 26, "tasks": ["13.12"] },
    { "id": 27, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 28, "tasks": ["14.5", "14.6", "14.7"] },
    { "id": 29, "tasks": ["14.8"] },
    { "id": 30, "tasks": ["16.1"] },
    { "id": 31, "tasks": ["16.2"] }
  ]
}
```
