# Implementation Plan: Crypt UI

## Overview

This plan builds the Crypt_Site in the order the user asked for: first the spec (a) change of the nightly `verified` reason and the two schemas next to their spec (a) types, then the pure core under `src/ui/core/` with its tests, then the shell reader and the copy step, the server components and pages, the configuration and scripts, the workflows, and last the documentation, the trace and the manual GitHub tasks. Language: TypeScript (strict) for `src/ui/`, `src/app/`, `scripts/ui/copyEntryFiles.ts` and the tests; dependency-free ES module JavaScript for `scripts/ui/startNotice.mjs`, `scripts/ui/writeNightlyRun.mjs` and `scripts/ui/checkSite.mjs`. Tests use vitest and fast-check under `tests/ui/`, in the new vitest project `ui` (target 60 s; a target, not a measurement). Task 1 changes tests under `tests/pipeline/` (project `pipeline`, target 90 s).

Conventions for every task:

- Agents run only `npm run typecheck`, `npm run lint` and one test file at a time (`npx vitest run <path>`, under about 30 seconds, one run per change; if it fails, read the output before running again). Agents never run `npm test`, `npm run test:*`, a whole vitest project, `npm run build`, `node scripts/ui/checkSite.mjs` or the full suite, and never run a Manual task. When a task needs one of these, the agent stops and writes "Ready for you to run: <exact command>", then waits for the pasted output (Requirement 10.10).
- A task titled "Manual task (yours)" is a Manual_Task done by the user in the GitHub web interface or with `gh`. The agent does not claim that the Site is live before the user reports the page address (Requirement 9.8).
- Every new test file is under `tests/ui/` and starts with `// Requirements: N.M, ...` naming crypt-ui criteria, plus `; resurrection-pipeline N.M, ...` where it covers criteria of that spec (Requirement 10.7). Property test files are `tests/ui/property/p<nn>-<name>.test.ts`, carry `// Feature: crypt-ui, Property <n>: <title>` and run at least 100 cases (`numRuns: 100`). Seeds replay through `FC_SEED`. Pages are tested as static markup (`renderToStaticMarkup` with `createElement`), never by running `next build` inside vitest (Requirement 10.5).
- Tests make no network call (the network guard of `tests/setup/networkGuard.ts` stays active), use the Fixture_Graveyard and injected file systems, and write only to temporary directories (Requirement 10.1).
- Required tests are not marked. Optional property tests (Properties 7, 8, 9, 11, 12, 14) and nice-to-haves are marked `*`. Properties 1, 2, 3, 4, 5, 6, 10 and 13 (safety, honesty, determinism and byte-identical copies) and every test a criterion names are required.
- Honesty: no run time, count or result enters code, docs or `docs/kiro-journal.md` unless the user ran it and pasted it; each figure names its source run by date and command (Requirement 11.8; testing-workflow rule).
- Do not change any file under `graveyard/`, `ledger.json` or `.env.example` (Requirement 11.7), and do not change `.config.kiro` of this spec.

**First pass: skip every optional (*) task; the user decides at the end which to add back.**

## Tasks

- [x] 1. Spec (a) changes: the `verified` reason and the two schemas (design Component 3)
  - [x] 1.1 Give `verified` an alive and a not-alive reason (spec (a) modules `nightlyReport.ts` and `nightly.ts`)
    - This task changes a module and tests of another spec (resurrection-pipeline R16.14, amended 2026-11-17 for crypt-ui by user decision). Change nothing else in `src/pipeline/`.
    - `src/pipeline/undertaker/core/nightlyReport.ts`: export `VERIFIED_REASON_ALIVE = "Replay identical and attestations verified."` and `VERIFIED_REASON_NOT_ALIVE = "Replay identical; no attestation expected."`. `NightlyEntryInput` gets no new field. `DEFAULT_REASONS.verified` stays equal to `VERIFIED_REASON_ALIVE` (so `buildNightlyReport`, the existing `nightlyReport.test.ts` expected values and p28/p29 are unchanged); the other `DEFAULT_REASONS` and the report shape stay unchanged.
    - `src/pipeline/undertaker/shell/nightly.ts`: in `processEntry`, where the caller `reason` is computed (the committed Verdict is already in scope as `verdict`), a primary result `verified` passes `VERIFIED_REASON_ALIVE` when `verdict === "alive"` and `VERIFIED_REASON_NOT_ALIVE` otherwise as the `reason` of the `NightlyEntryInput`. The `verdict` constant of `processEntry` (`report === null ? null : report.verdict`, read from the committed Proof_Report) is in scope at that spot.
    - `tests/pipeline/unit/nightly.test.ts` gets the new cases: an `alive` entry with an identical replay gets `VERIFIED_REASON_ALIVE`, a `restless` entry with an identical replay gets `VERIFIED_REASON_NOT_ALIVE`. `tests/pipeline/unit/nightlyReport.test.ts` gets only the checks of the two exported constants (their text, and that a built `verified` entry without a caller reason has the text of `VERIFIED_REASON_ALIVE`); no expected value of an existing test changes.
    - Run `npm run typecheck`, `npm run lint`, then one at a time `npx vitest run tests/pipeline/unit/nightlyReport.test.ts`, `tests/pipeline/unit/nightly.test.ts`, `tests/pipeline/property/p28-nightly-classification.test.ts`, `tests/pipeline/property/p29-nightly-not-resurrected.test.ts`. If an existing expected value would need a change, stop and ask the user.
    - _Requirements: 12.5; resurrection-pipeline 16.14_

  - [x] 1.2 Add `StubMarkerSchema` and `NightlyReportSchema` next to their types
    - `src/pipeline/undertaker/core/layout.ts`: `StubMarkerSchema` (strict). `src/pipeline/undertaker/core/nightlyReport.ts`: `NightlyReportSchema` (strict at every level, `results` from `NIGHTLY_RESULT_ORDER`, facts with `SourceUrlSchema` and `UtcTimestampSchema`). Writers unchanged.
    - Write `tests/ui/unit/schemas.test.ts`: `StubMarkerSchema` parses `buildStubMarker()`; `NightlyReportSchema` parses the report of `renderNightlyReportJson(buildNightlyReport(...))` for an alive, a restless and a not-resurrected entry; a TypeScript `satisfies` check that `z.infer` of each schema is assignable to the existing type and back.
    - _Requirements: 2.2_

  - [ ]* 1.3 Write property test for the new schemas (schemas half)
    - **Property 12: The new schemas accept what the writers write**
    - **Validates: Requirements 2.2, 12.2**
    - File: `tests/ui/property/p12-schemas.test.ts`, first half (report and stub marker); task 9.3 adds the `writeNightlyRun.mjs` half.

- [x] 2. Test project, lint scope and core primitives (design Components 2 and 9)
  - [x] 2.1 Add the vitest project `ui`, its budget target and the lint scope
    - `vitest.config.mts`: `defineProject({ test: { name: "ui", include: ["tests/ui/**/*.test.ts"], testTimeout: 60000 } })` (inherits the network guard). `tests/proof/helpers/budgetReporter.ts`: `ui: 60` in `BUDGET_SECONDS` with the comment "A target, not a measurement". `eslint.config.mjs`: `"src/ui/core/**/*.ts"` in `deterministicFiles`.
    - Done here, before the first `tests/ui/` file of task 2, so that `npx vitest run <path>` finds every new test file (as medium-agent task 1.1 did).
    - Write `tests/ui/unit/requirementsHeader.test.ts`: every `tests/ui/**/*.test.ts` starts with a `// Requirements:` line.
    - _Requirements: 10.1, 10.7, 10.9, 11.2_

  - [x] 2.2 Implement link builders and the link filter
    - `src/ui/core/site.ts` (`BASE_PATH`, the Nightly_Input names, `sitePath`, `entryRoute`, `downloadPath`, `historyUrl`, `runUrl`) and `src/ui/core/safeHref.ts` with the rules of design Component 2.
    - _Requirements: 4.10, 7.2, 7.3, 7.4, 7.5, 12.4_

  - [x] 2.3 Write property test for the Safe_Link filter
    - **Property 1: Safe_Link renders an anchor exactly for absolute http(s) URLs**
    - **Validates: Requirements 7.2, 7.3, 7.6**
    - File: `tests/ui/property/p01-safe-link.test.ts`. Tests `safeHref` here; task 7.2 adds the `SafeLink` markup half to the same file.

  - [ ]* 2.4 Write property test for the link builders
    - **Property 8: Built links have their fixed form**
    - **Validates: Requirements 4.10, 7.4, 7.5, 12.4**
    - File: `tests/ui/property/p08-links.test.ts`.

  - [x] 2.5 Implement the label tables, the file-name check, the run record schema and the version reader
    - `src/ui/core/causes.ts` (Cause_Label_Table, `causeView`), `src/ui/core/nightlyLabels.ts` (`nightlyLabel`, the table of design Component 2, Verdict-dependent `verified` label), `src/ui/core/entryFiles.ts` (`checkEntryFileNames`), `src/ui/core/nightlyRun.ts` (`NightlyRunRecordSchema` with `conclusion` shape `^[a-z_]{1,32}$`, `DOCUMENTED_CONCLUSIONS`), `src/ui/core/resurrectionVersion.ts` (`versionFromPackageJson`).
    - Write `tests/ui/unit/coreTables.test.ts`: every `NightlyResult` has a label; the non-alive `verified` label contains neither "verified" nor "attested"; `checkEntryFileNames` accepts the committed entry file sets and rejects a second `.tgz` and an unknown name; `NightlyRunRecordSchema` accepts every `DOCUMENTED_CONCLUSIONS` value and an undocumented well-formed one, and rejects `""`, `null`, `"Success"` and a 33-character value.
    - _Requirements: 2.5, 2.10, 4.2, 12.2, 12.3, 12.5_

  - [ ]* 2.6 Write property test for the cause labels
    - **Property 11: Cause labels are total and keep the code**
    - **Validates: Requirements 4.2**
    - File: `tests/ui/property/p11-causes.test.ts`.

  - [x] 2.7 Implement the fixed texts and the theme data
    - `src/ui/core/texts.ts` (every fixed sentence of design Component 2, including `nightlyNoReport(link, runStartedAt, conclusion)`, the new template `nightlyReportRejected(link, runStartedAt, conclusion)` ("The last nightly run (<link>, <time>) ended <conclusion>; its report did not pass validation.") and "No recent nightly result in this build.") and `src/ui/core/theme.ts` (`PALETTE`, `PAIRS`, `contrastRatio`).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.7, 5.8, 5.9, 8.1, 8.2, 12.6, 12.10, 12.11, 13.3_

- [x] 3. View model `buildSiteView` (design Component 2, Data Models)
  - [x] 3.1 Implement `src/ui/core/viewModel.ts`
    - `SiteInput`, `EntryInput`, `SiteView`, `EntryView`, `AttemptRow`, `NightlyEntryView`, `NightlyRunView` as in Data Models; the nightly state table (record, report state, conclusion), including `report-rejected`; `verifyCommands` for `alive` entries only; the reason shown for every nightly result; no clock, no I/O.
    - _Requirements: 2.4, 2.8, 3.5, 3.8, 3.10, 4.8, 5.5, 5.6, 6.2, 6.3, 6.5, 6.6, 12.1, 12.3, 12.5 to 12.11, 13.1, 13.2, 13.4 to 13.6_

  - [x] 3.2 Write property test for the view values
    - **Property 3: Every string in the view comes from an input, a fixed text or a link builder**
    - **Validates: Requirements 3.9, 6.1, 6.3, 6.7, 6.8, 12.9**
    - File: `tests/ui/property/p03-view-values.test.ts`. The SiteInput generator lives in `tests/ui/helpers/arbitraries.ts` and is shared by tasks 3.3 to 3.6.

  - [x] 3.3 Write property test for outcome and verification fields
    - **Property 4: Outcome, Verdict and verification fields follow the entry kind and Verdict**
    - **Validates: Requirements 3.5, 3.8, 4.8, 5.5, 5.6, 6.2**
    - File: `tests/ui/property/p04-outcome.test.ts` (model-based).

  - [x] 3.4 Write property test for the stub flag
    - **Property 5: The stub flag comes only from the Stub_Marker**
    - **Validates: Requirements 2.4, 6.5, 13.5**
    - File: `tests/ui/property/p05-stub-flag.test.ts`.

  - [x] 3.5 Write property test for the nightly view
    - **Property 10: The nightly view follows the run record, the report state and the conclusion**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 12.10, 12.11**
    - File: `tests/ui/property/p10-nightly-view.test.ts`. Conclusions from `DOCUMENTED_CONCLUSIONS` and from other strings of the schema's shape.

  - [ ]* 3.6 Write property test for the Attempts rows
    - **Property 9: The Attempts rows are the matching Ledger entries as typed**
    - **Validates: Requirements 6.6, 13.1, 13.2, 13.4, 13.6**
    - File: `tests/ui/property/p09-attempts.test.ts`.

- [x] 4. Checkpoint: spec (a) change and pure core
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings.
  - Ready for you to run: `npx vitest run --project ui`, then `npx vitest run --project pipeline`. Paste both outputs. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 10.9, 10.10; resurrection-pipeline 16.14_

- [x] 5. Fixture_Graveyard and Hostile_Fixture (design Data Models)
  - [x] 5.1 Write the Fixture_Graveyard
    - `tests/ui/fixtures/README.md` (all files are test data, no entry is real); `tests/ui/fixtures/graveyard/` with `alive-fixture`, `restless-fixture`, `inconclusive-fixture`, `retired-fixture`, `stub-fixture`, `lodash.set`; `tests/ui/fixtures/ledger.json` with `local` and `stub` rows, including `not provided` readings; `tests/ui/fixtures/nightly/` with the five Nightly_Input cases of the design (valid report and record with `success`; record with `failure` and no report; record with an undocumented well-formed conclusion; report with another `repo`; malformed report with a valid run record, which is the present-but-invalid report case of Requirement 12.11; and a second present-but-invalid report with a run record whose conclusion is `success`, to show that the sentence does not depend on the conclusion).
    - `tests/ui/helpers/fixtureTree.ts`: copies the fixture to a temporary directory and adds the tarballs (`packTarball` from a `package.json` text) and placeholder bundle files at test time, so no binary file is committed under `tests/ui/`.
    - _Requirements: 10.1, 10.2_

  - [x] 5.2 Write the Hostile_Fixture
    - `tests/ui/fixtures/graveyard/hostile-fixture/`: hostile strings in every free-text field the parsers accept and the pages show (Requirement 10.4 list), including `javascript:`, `data:`, scheme-less, mixed-case and whitespace-padded Source_URL values, markup and script text, path-like strings, Ledger readings and nightly `reason` and fact texts. Every file still passes its existing parser.
    - _Requirements: 10.4_

- [x] 6. Shell: reader, tarball version, wiring and copy step (design Component 4)
  - [x] 6.1 Implement `src/ui/shell/tarballVersion.ts`
    - `readResurrectionVersion(bytes)`: temporary directory, `extractTarball` with `DEFAULT_EXTRACT_LIMITS`, only the bytes of `package.json`, `rm` in `finally`. The only `src/ui/` importer of `extractTarball`.
    - _Requirements: 2.9, 2.10_

  - [ ]* 6.2 Write property test for the Resurrection_Version
    - **Property 14: The Resurrection_Version is the valid semver of the tarball's package.json**
    - **Validates: Requirements 2.9, 2.10**
    - File: `tests/ui/property/p14-resurrection-version.test.ts`.

  - [x] 6.3 Implement `src/ui/shell/readSite.ts` and `src/ui/shell/loadSite.ts`
    - `SiteFs`, `SiteReadDeps`, `readSite` with the steps of design Component 4 (name check, regular files only, `checkEntryFileNames`, existing parsers, `deriveEntryKind`, certificate name match, tarball version, stub marker, ledger, the Nightly_Input states with warnings), errors naming the file and failing path. `loadSite`: `node:fs` wiring, memoized, throws on error, then `buildSiteView`.
    - Write `tests/ui/unit/readSite.test.ts`: every fixture kind through a fake fs; the real repository root read-only (the three committed entries); a recording fs that sees only `graveyard/`, `ledger.json` and `.crypt-nightly/`; missing and empty `graveyard/`; each Nightly_Input case and its warning; one malformed entry fails with the file and path (Requirement 10.6).
    - User decision 2026-11-17: `readSite` fails closed when an `alive` resurrection entry has no tarball; the error names the entry and the missing file (`<file>: file is missing`). `readSite.test.ts` includes this case. `buildEntryView` is not changed for it.
    - _Requirements: 1.1, 1.6, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 5.11, 10.6, 12.1, 12.6_

  - [x] 6.4 Write property test for reader order and determinism
    - **Property 6: Entry order and view data are deterministic**
    - **Validates: Requirements 2.7, 2.8**
    - User decision 2026-11-17: the `readSite` fixtures used here keep the tarball for every `alive` entry, because `readSite` fails closed on an `alive` entry without one (task 6.3). `buildEntryView` is not changed for it.
    - File: `tests/ui/property/p06-order.test.ts`.

  - [ ]* 6.5 Write property test for fail-closed reading
    - **Property 7: The reader fails closed on any invalid entry**
    - **Validates: Requirements 2.5, 2.6, 2.10, 5.11**
    - File: `tests/ui/property/p07-fail-closed.test.ts` (fake fs; symbolic links in temporary directories where the platform supports them).

  - [x] 6.6 Implement `src/ui/shell/copyEntryFiles.ts`
    - Copies `entry.files` byte for byte to `out/graveyard/<package>/<file>` with the flag `wx`; nothing else.
    - _Requirements: 5.10_

  - [x] 6.7 Write property test for the copy step
    - **Property 13: Copied entry files are byte-identical and complete**
    - **Validates: Requirements 5.10**
    - File: `tests/ui/property/p13-copy.test.ts` (temporary directories).

- [x] 7. Server components (design Component 6)
  - [x] 7.1 Implement the components under `src/ui/components/`
    - `SafeLink.tsx`, `SiteLink.tsx`, `JsonText.tsx`, `Sources.tsx`, `Labels.tsx` (`OutcomeLabel`, `PackageStatusLabel`, `StubLabel`), `HomeView`, `CryptIndexView` (caption, nightly line for each state), `EntryView` with `CertificateSection`, `EligibilitySection`, `ProofSection`, `DeltasSection`, `VerificationSection`, `DownloadsSection`, `NightlySection` (results, labels, reason for every result, conclusion, run link, commit note, or the sentence), `AttemptsTable`, `HistoryLink`. Server components only: no `"use client"`, no hooks, no `style` attribute, no `target`.
    - _Requirements: 3.1 to 3.10, 4.1 to 4.10, 5.1 to 5.10, 6.1 to 6.9, 7.1, 7.2, 7.5 to 7.7, 8.4, 8.5, 8.7, 12.3, 12.5 to 12.8, 12.10, 12.11, 13.1 to 13.6_

  - [x] 7.2 Write property test for inert rendering and complete Property 1
    - **Property 2: File_Text renders as inert text**
    - **Validates: Requirements 7.1, 7.5**
    - File: `tests/ui/property/p02-escaping.test.ts`. Also add the `SafeLink` static-markup half of Property 1 to `tests/ui/property/p01-safe-link.test.ts`.

  - [x] 7.3 Write page markup tests
    - `tests/ui/unit/homeIndex.test.ts` (home and Crypt_Index, the four nightly states of the index line) and `tests/ui/unit/entryPage.test.ts` (every fixture kind, `statusError`, unavailable values, stale and omitted facts, `provenanceTotal`, the R5.7 and R5.8 sentences, the stub label, Package status versus Proof verdict, the nightly section with the reason of a restless `verified` result).
    - _Requirements: 3.1 to 3.4, 3.6, 3.7, 3.10, 4.1, 4.3 to 4.7, 4.9, 5.1 to 5.4, 5.7 to 5.9, 6.4, 6.9, 8.4, 8.5, 12.10, 12.11, 13.3_

  - [x] 7.4 Write the hostile-fixture and source-scan tests
    - `tests/ui/unit/hostile.test.ts`: every page from the Fixture_Graveyard, the Requirement 7.8 conditions. `tests/ui/unit/sourceScan.test.ts`: the scans of the design's test table over `src/ui/**`, `src/app/**`, `scripts/ui/**`.
    - _Requirements: 1.3, 1.5, 2.1, 5.5, 7.1, 7.6, 7.7, 7.8, 8.7, 10.4, 10.6, 11.2, 11.3_

- [x] 8. App Router pages, layout and stylesheet
  - [x] 8.1 Implement `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/crypt/page.tsx`, `src/app/crypt/[name]/page.tsx` and `src/app/globals.css`
    - Each page awaits `loadSite()` and renders a view component; `[name]` exports `dynamicParams = false` and `generateStaticParams`. Layout: `lang="en"`, skip link, `header`, `nav`, `main id="main"`, no `next/font`. Stylesheet: `PALETTE` custom properties, `:focus-visible` outline, `prefers-reduced-motion` block, `pre { overflow-x: auto }`, no `@import`, no `url()`.
    - _Requirements: 1.2, 1.3, 1.6, 8.1, 8.3, 8.5, 8.6, 8.7, 8.8_

  - [x] 8.2 Write the theme test
    - `tests/ui/unit/theme.test.ts`: `:root` values equal `PALETTE`; each pair of `PAIRS` meets its ratio; the focus outline pair; no light scheme; the reduced-motion block.
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

- [x] 9. Configuration and scripts (design Components 1 and 5)
  - [x] 9.1 Change the build configuration and scripts
    - `next.config.mjs`: `output: "export"`, `basePath: "/graveyard-shift"`, `trailingSlash: true`, `reactStrictMode: true`. `package.json` scripts: `build` = `next build && tsx scripts/ui/copyEntryFiles.ts`, `start` = `node scripts/ui/startNotice.mjs`; no dependency change. `scripts/ui/copyEntryFiles.ts` and `scripts/ui/startNotice.mjs`. `.gitignore`: `/out/` and `/.crypt-nightly/`.
    - Write `tests/ui/unit/config.test.ts`: `basePath` equals `BASE_PATH`, `output`, `trailingSlash`; scripts and dependency names unchanged except the two scripts; `startNotice.mjs` as a child exits 1 with the notice on standard error.
    - _Requirements: 1.2, 1.4, 1.7, 1.8, 11.5_

  - [x] 9.2 Implement `scripts/ui/writeNightlyRun.mjs`
    - Reads `GS_RUN_ID`, `GS_RUN_STARTED_AT`, `GS_CONCLUSION`, `GS_HEAD_SHA`, `GS_BUILD_SHA`; plain-code shape checks equal to `NightlyRunRecordSchema`; creates `.crypt-nightly/` if missing; writes `run.json` or prints `::warning::` with the variable name only; exit 0. Exports its check function for the test.
    - _Requirements: 9.7, 9.10, 9.11, 12.2_

  - [ ]* 9.3 Complete property test for the new schemas (writer half)
    - **Property 12: The new schemas accept what the writers write**
    - **Validates: Requirements 2.2, 12.2**
    - File: `tests/ui/property/p12-schemas.test.ts`, second half: five generated environment values; record written if and only if the schema accepts it; once as a child process in a temporary directory.

  - [x] 9.4 Implement `scripts/ui/checkSite.mjs`
    - Dependency-free, `node:` imports only; the four check groups of design Component 5; one line per problem, exit 1 when any.
    - Write `tests/ui/unit/checkSite.test.ts`: the script as a child over small hand-made `out/` and `graveyard/` trees in temporary directories (a passing tree, an external script, an `on*` attribute, a `javascript:` anchor, a missing entry page, a changed copied byte).
    - _Requirements: 10.5_

- [x] 10. Checkpoint: build and Site_Check_Script (settles design open questions 5, 6 and 7)
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings.
  - Ready for you to run: `npx vitest run --project ui`, then `npm run build`, then `node scripts/ui/checkSite.mjs`. Paste the three outputs.
  - Open question 7 (`tar` under the Next.js bundler): settled by the `npm run build` output. If the build fails on `tar`, the agent adds `serverExternalPackages: ["tar"]` to `next.config.mjs`, updates the config test and design Component 1, and asks for the build again.
  - Open question 6 (names with a dot): settled when `checkSite.mjs` finds `out/crypt/lodash.set/index.html`.
  - Open question 5 (empty `generateStaticParams`): Ready for you to run, in PowerShell on Windows (never in WSL under `/mnt/c`), in a scratch worktree so that `graveyard/` of the working copy is not touched: `git worktree add ..\gs-empty-check HEAD`, then in `..\gs-empty-check`: `Remove-Item -Recurse -Force graveyard`, `npm ci`, `npm run build`, `node scripts/ui/checkSite.mjs`; afterwards, from the repository: `git worktree remove --force ..\gs-empty-check`. Paste the outputs.
  - The agent records each result in design "Remaining open questions" as settled (with the date and "user-run") and appends a Journal entry with the pasted facts only. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.2, 1.6, 1.7, 10.5, 10.10_

- [x] 11. Pages_Workflow and third-party entries (design Component 7)
  - [x] 11.1 Read the licenses of the three Pages actions
    - Read the `LICENSE` file of `actions/configure-pages` at `v6.0.0`, `actions/upload-pages-artifact` at `v5.0.0` and `actions/deploy-pages` at `v5.0.1` through the GitHub web (for example `https://github.com/actions/configure-pages/blob/v6.0.0/LICENSE`). If a file cannot be fetched, stop and ask the user to read it; write no license from memory.
    - _Requirements: 11.4_

  - [x] 11.2 Write `.github/workflows/pages.yml` and the `PREEXISTING.md` entries
    - The workflow text of design Component 7 with the pinned actions `actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0`, `actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0`, `actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1`: triggers and paths, `permissions: {}`, job permissions, the `build` `if:` (`github.event_name == 'push'`, `github.event_name == 'workflow_dispatch'` for `pages.yml` itself, or `workflow_run` with workflow name `nightly`, head branch `main`, head repository, nightly event `schedule` or `workflow_dispatch`, any conclusion; the push and `workflow_dispatch` builds have no download and no run record, so the Site shows "No recent nightly result in this build."), download with `name`, `path`, `github-token`, `run-id` and default `digest-mismatch`, the run record step with `GS_CONCLUSION` and no condition on the download outcome, `concurrency`, `timeout-minutes`, `NEXT_TELEMETRY_DISABLED`.
    - `PREEXISTING.md`: one entry per action with the license read in task 11.1 and the source URL.
    - _Requirements: 1.4, 9.1 to 9.7, 9.10 to 9.12, 11.4_

  - [x] 11.3 Extend the workflow lint tests
    - Write `tests/ui/unit/pagesWorkflow.test.ts` with the checks of the design's test table (the three Pages pins equal the Journal values; the `if:` of `build` checks both the `workflow_run` path (name, branch `main`, repository, nightly event, no conclusion condition) and the `workflow_dispatch` path (and `push`), and a `workflow_dispatch` or `push` run has no download step condition that is true; event values only in `env:`). Confirm that `tests/pipeline/unit/workflowLint.test.ts` passes over the new file unchanged (SHA pins, `timeout-minutes`).
    - Run `npx vitest run tests/ui/unit/pagesWorkflow.test.ts`, then `npx vitest run tests/pipeline/unit/workflowLint.test.ts`.
    - _Requirements: 9.1 to 9.7, 9.10 to 9.12; resurrection-pipeline 12.13_

- [x] 12. `ci.yml` job `site` (design Component 8; open question 6 confirmed in CI)
  - [x] 12.1 Add the job `site` to `.github/workflows/ci.yml`
    - Text of design Component 8 with the comment naming crypt-ui Requirement 10.5; workflow-level permissions unchanged. Add its checks to `tests/ui/unit/pagesWorkflow.test.ts` (Node pin and check step, `NEXT_TELEMETRY_DISABLED`, `npm run build`, `checkSite.mjs`, no `secrets.`).
    - The first CI run of the job after the push is the user's; its result is recorded with the run address in the Journal.
    - _Requirements: 1.4, 10.5_

- [x] 13. Documentation and traceability (design Component 9)
  - [x] 13.1 Update the steering files and the README
    - `.kiro/steering/structure.md`: `src/ui/core/`, `src/ui/shell/`, `src/ui/components/`, the `src/app/` files, `scripts/ui/*`, `tests/ui/`, `pages.yml`, the `site` job, `out/`, `.crypt-nightly/`, the project `ui`, the trace mapping. `.kiro/steering/tech.md` "Commands": `build`, `start`, `npx vitest run --project ui` (target 60 s). `README.md`: quick start for `npm run dev`, `npm run build` and the preview; the sentence of Requirement 11.6; in "Ledger and credits" the sentence "The credit meter shows credits used (the user's statement, 2026-11-17)." with no figure; "Live demo: _coming soon_" unchanged.
    - _Requirements: 9.9, 11.1, 11.6, 11.9_

  - [x] 13.2 Map `tests/ui` to this spec in the trace and classify the manual criteria
    - `scripts/trace.ts`: `{ name: "crypt-ui", requirements: ".kiro/specs/crypt-ui/requirements.md", testsDir: "tests/ui" }` in `SPECS`, and "`tests/ui` is crypt-ui" in the header-syntax sentence. `docs/traceability-gaps.json`: entries for 8.8 (320 px layout), 9.8, 11.7, 11.8 and any criterion the trace reports as uncited, each with its class and evidence.
    - Write `tests/ui/unit/docs.test.ts`: `structure.md` paths exist, `.gitignore` lines, README phrases, `PREEXISTING.md` entries for the three actions, the trace mapping and the budget entry.
    - _Requirements: 9.9, 10.8, 10.9, 11.1, 11.4, 11.5, 11.6, 11.9_

  - [ ]* 13.3 Add a Journal note on the first `ui` project span
    - Only from the user's pasted output of task 14, as "Spans, checked against targets (user-pasted run)".
    - _Requirements: 10.10, 11.8_

- [x] 14. Final checkpoint: full suite and trace, run by the user
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings. Do not run `npm test`.
  - Ready for you to run: `npm test`, then `npm run trace`. Paste both outputs. The agent then adds a `docs/traceability-gaps.json` entry for each crypt-ui criterion the trace reports as unclassified, and asks the user to run `npm run trace` again until it exits with code 0. Spans of `ui` and `pipeline` in the Journal come only from the pasted `npm test` output.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 10.8, 10.9, 10.10_

- [ ] 15. Manual tasks on GitHub
  - [ ] 15.1 Manual task (yours): enable GitHub Pages
    - Repository settings, Pages, "Build and deployment", Source: "GitHub Actions". Report in the Journal that the setting is on (date). The agent claims nothing about the Site until 15.2 is reported.
    - _Requirements: 9.8_

  - [ ] 15.2 Manual task (yours): first `pages.yml` run by `workflow_dispatch` (settles design open question 8)
    - After this spec's changes are on `main`: `gh workflow run pages.yml --ref main`, then `gh run watch`. Record in the Journal: the run address, the conclusion of `build` and `deploy`, the page address (`https://subair99.github.io/graveyard-shift/`), what the home page, the Crypt_Index and one Entry_Page show (expected: "No recent nightly result in this build."), and whether `configure-pages` needed another permission or order (open question 8). Only after this record may the README "Live demo" line change (Requirement 9.9, a separate request).
    - _Requirements: 9.5, 9.8, 9.9, 11.8_

  - [ ] 15.3 Manual task (yours): one `pages.yml` run started by a nightly run (settles design open question 4)
    - `gh workflow run nightly.yml --ref main` (or wait for the scheduled run); when it completes, the `pages` run starts by `workflow_run`. `workflow_run` fires only once `pages.yml` is on `main`, so the nightly run must complete after `pages.yml` is merged to `main` (a nightly run that completed earlier starts no `pages` run). Record in the Journal: both run addresses, the nightly conclusion, whether the download step succeeded, whether `writeNightlyRun.mjs` wrote the record or warned (the format of `run_started_at`, open question 4), and what the Crypt_Index and one Entry_Page show (expected: that run's results, run start time, conclusion and run link).
    - _Requirements: 9.10, 9.11, 12.2, 12.3, 12.10, 12.11, 11.8_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP (Properties 7, 8, 9, 11, 12, 14 and the Journal span note 13.3). Properties 1, 2, 3, 4, 5, 6, 10 and 13 are required: they check safe rendering, honesty of every displayed string and of the nightly view, the stub label, determinism and byte-identical downloads.
- Decisions 2026-11-17, third round (user), recorded in requirements.md and design.md: the Site keeps its own `verified` label and shows the report reason together with it; a present-but-invalid report with a run record shows "its report did not pass validation" (R12.11); `NightlyEntryInput` gets no `alive` field (task 1.1); `pages.yml` `build` also runs on `workflow_dispatch` and `push` (tasks 11.2, 11.3); the task 10 scratch-worktree commands run in PowerShell on Windows, never in WSL under `/mnt/c`; `workflow_run` fires only once `pages.yml` is on `main` (task 15.3).
- Task 1 changes spec (a) code and tests (`nightlyReport.ts`, `nightly.ts`, `tests/pipeline/unit/nightlyReport.test.ts`, `tests/pipeline/unit/nightly.test.ts`) under the amendment of resurrection-pipeline R16.14 dated 2026-11-17; it is the only task that edits `src/pipeline/` beyond the two schemas of task 1.2.
- The vitest project `ui` and the lint scope (task 2.1) come before the core code instead of with the configuration of task 9, so that each new test file can be run alone from the start.
- Design open questions 4 to 8 are settled by tasks 15.3 (4), 10 (5, 6, 7; 6 again by the first CI run of task 12) and 15.2 (8). Questions 1 to 3 were closed by the user on 2026-11-17.
- The licenses of the three Pages actions are written to `PREEXISTING.md` only after task 11.1 has read each `LICENSE` at the pinned tag.
- No task changes `graveyard/`, `ledger.json` or `.env.example`; the empty-graveyard build of task 10 runs in a scratch worktree.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.5", "2.7"] },
    { "id": 2, "tasks": ["1.3", "2.3", "2.4", "2.6", "3.1"] },
    { "id": 3, "tasks": ["3.2", "5.1", "6.1", "6.6"] },
    { "id": 4, "tasks": ["3.3", "5.2", "6.2", "6.3", "6.7"] },
    { "id": 5, "tasks": ["3.4", "6.4", "7.1"] },
    { "id": 6, "tasks": ["3.5", "6.5", "7.2", "8.1"] },
    { "id": 7, "tasks": ["3.6", "7.3", "8.2", "9.1"] },
    { "id": 8, "tasks": ["7.4", "9.2", "9.4"] },
    { "id": 9, "tasks": ["9.3", "11.1"] },
    { "id": 10, "tasks": ["11.2"] },
    { "id": 11, "tasks": ["11.3"] },
    { "id": 12, "tasks": ["12.1"] },
    { "id": 13, "tasks": ["13.1", "13.2"] },
    { "id": 14, "tasks": ["13.3", "15.1"] },
    { "id": 15, "tasks": ["15.2"] },
    { "id": 16, "tasks": ["15.3"] }
  ]
}
```
