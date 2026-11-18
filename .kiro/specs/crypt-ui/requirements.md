# Requirements Document

## Introduction

This is spec (c) of three. It defines the Crypt_Site: a read-only static website that shows the committed Graveyard_Directory to a visitor. Spec (a) `resurrection-pipeline` defines everything that produces and checks the data (the Graveyard_Entry layout, the Proof_Report, the attestation, the nightly re-verification), and spec (b) `medium-agent` defines the Medium. This spec reuses their terms and cites their requirements as "resurrection-pipeline R<n>.<m>", "proof-of-life-engine R<n>.<m>" and "autopsy-engine R<n>.<m>". It does not change what CI produces or accepts. resurrection-pipeline R14.8 already names the UI as a reader of `graveyard/` and R19, R14.13 to R14.16 and R23.13 already state what the UI must show.

The Crypt_Site is built with Next.js static export and deployed to GitHub Pages under the base path `/graveyard-shift`. It has three kinds of page: the home page, the Crypt_Index and one Entry_Page per Graveyard_Entry. It reads, at build time, the files committed on `main` under `graveyard/`, the committed `ledger.json`, and, only in a build started by a completed nightly run on `main` (any conclusion; decision of 2026-11-17), the Nightly_Report of that run where its artifact exists and the Nightly_Run_Record. The built site calls no other origin, runs no server, sets no cookie, and has no analytics. It cannot verify an attestation (no network and no `gh`), so it shows the exact `gh attestation verify` commands, offers the committed files for download, says what a verification proves, and never says that the Site itself verified anything.

The Site is the Undertaker's window, not a new authority. It states only what its input files state. It does not recompute a verdict, a risk score, a credit figure or a date, and it does not fetch the Original. Three flows of the product steering are not part of this spec because they need a server or network access: pasting a repository URL or lockfile (user-flow step 1, "Exhume"), listing the dependencies of an arbitrary application (step 2), and the functions that the user's own code uses (step 3). See "Deferred" below.

Facts found in the repository when this spec was written (read from the committed files and from the Journal up to the entry of 2026-11-17; the Journal is the record, these are not new measurements):

- `graveyard/` holds three entries: `inflight` (certificate and Eligibility_Record only, `eligible` false, status `retired-with-successor`: a Not_Resurrected_Entry), and `lodash.set` and `ip` (each with certificate, Eligibility_Record, `deltas.json`, `harness.json`, `resurrection.tgz`, `proof-report.json` with `verdict` `alive`, and three `.sigstore.json` bundles named `<subject>.sigstore.json`).
- No committed entry has `stub-run.json`, and none has the Verdict `restless` or `inconclusive`. The Stub_Marker, the Restless entry and the Inconclusive entry therefore exist only as fixtures of this spec (Requirement 10). The stub runs recorded in `ledger.json` produced pull requests that the user closed (Journal, task 10.6; `docs/traceability-gaps.json`, 23.15).
- A committed certificate has the package health `status` (`alive`, `dying`, `dead` or `retired-with-successor`, autopsy-engine R4; absent only when `statusError` is present) as well as the Proof Verdict (`alive`, `restless` or `inconclusive`, proof-of-life-engine R12). The word `alive` can therefore mean two different things on one page (Requirement 6.4).
- The certificate `causes` field holds codes of the enum `maintainer-gone`, `repo-archived`, `unpatched-cve`, `runtime-rot` (`CauseOfDeathSchema`, `src/engine/types.ts`; autopsy-engine R5.1 to R5.6).
- The committed `proof-report.json` holds the Original's name and version (`package`), `casesPerFunction`, `deltas` with `status` and `demonstration`, `divergences`, `harnessErrors`, `seed` and `toolVersions`. It does not hold the version of the Resurrection. That version exists only in `package/package.json` inside `resurrection.tgz`.
- The `medium.mode` label (`local` or `stub`) is part of the attestation predicate (resurrection-pipeline R13.6), which is inside the `.sigstore.json` bundles. No committed JSON file of an entry states it in plain text. The Stub_Marker `stub-run.json` is the only plain-text stub label of an entry (resurrection-pipeline R23.11). No schema for `stub-run.json` exists; `layout.ts` has the `StubMarker` interface and `buildStubMarker` only.
- `ledger.json` is committed and validated by `LedgerSchema` and `parseLedger` (`src/pipeline/local/core/ledger.ts`). A `local` entry has `mode`, `package`, `version`, `date`, `creditBefore`, `creditAfter` (text as typed), `exitCode`, `kiroCliVersion` and optional `cliUsage`; a `stub` entry has `mode`, `package`, `version`, `date` and `fixture`, and no reading and no exit code. One local entry has the text `not provided` for both readings.
- The nightly report (`nightly-report.json`) is a workflow artifact named `nightly-report`, kept for 7 days and not committed. Its shape is the TypeScript interface `NightlyReport` of `src/pipeline/undertaker/core/nightlyReport.ts` (`repo`, `ghVersion`, `ghMinVersion`, `counts`, `entries` with `package`, `results`, `reason`, `stub`, `committedTools`, `runningTools`, `differingToolFields`, `firstDiffPath`, `facts`). No zod schema for it exists, and it holds no run time, run identifier or run address. The Nightly_Workflow deploys nothing (resurrection-pipeline R16.21, which assigns the deploy of a nightly status to this spec).
- `src/pipeline/common/constants.ts` re-exports `ALLOWED_MEDIUM_PATHS` from `src/pipeline/medium/agent/pathRules.mjs`, a pure module with no imports. Importing the constants therefore imports that file.
- The existing `next.config.mjs` sets only `reactStrictMode`. `src/app/` holds `layout.tsx` and `page.tsx` only. `npm run build` is `next build`, `npm run start` is `next start`. `ci.yml` runs typecheck, lint and `npm test`, not `npm run build`. `.gitignore` does not list `out/`.
- All third-party actions in the existing workflows are pinned to a full commit SHA with a version comment, `PINNED_NODE_VERSION` is `26.13.1`, and each job of `resurrect.yml` and `nightly.yml` that sets up Node checks `node --version`. `actions/download-artifact` is already pinned in `resurrect.yml` at `9000827ccba6bdab643e8b6fd33ac0654aef8333` (comment `v8.0.2`).

Optional criteria (first to cut): none. Every criterion is required; the cut order, if the schedule requires one, is decided in the task list and recorded in the Journal.

## Glossary

Terms of resurrection-pipeline (for example Graveyard_Directory, Graveyard_Entry, Resurrection_Entry, Not_Resurrected_Entry, Rest_In_Peace_Entry, Stub_Marker, Stub_Run, Attestation_Bundle, Death_Certificate, Eligibility_Record, Proof_Report, Verdict, Declared_Delta, Demonstration, Predicate_Type, Signer_Workflow, Nightly_Workflow, Nightly_Result, Ledger, Manual_Task, Journal, Source_URL, Fetch_Date, Fact, Medium, Coroner, Gravedigger, Undertaker, Pinned_Node_Version) keep their meaning. New terms:

- **Crypt_Site**: The static website of this spec, the read-only UI of Graveyard Shift. "The Site" in the criteria below.
- **Site_Build**: One run of `npm run build`: `next build` (the static export, with the Base_Path) followed by the Entry_File_Copy.
- **Base_Path**: `/graveyard-shift`, the path under which GitHub Pages serves the Crypt_Site for the repository `subair99/graveyard-shift`.
- **Site_Output**: The directory `out/` that the Site_Build writes; the files deployed to GitHub Pages.
- **Entry_Reader**: The build-time code that reads the Graveyard_Directory, `ledger.json` and the optional Nightly_Input, parses every file with the existing parsers and returns the Entry_Views. Its pure part makes no file system call.
- **Entry_View**: The plain data of one Graveyard_Entry that the pages render: the entry kind, the parsed certificate, Eligibility_Record, Proof_Report and Deltas_File where the entry has them, the list of file names present, the stub flag, the Resurrection_Version, the Attempts rows and the nightly view.
- **Resurrection_Version**: The `version` field of `package/package.json` inside the entry's `resurrection.tgz`, read at build time.
- **Crypt_Index**: The page that lists one row per Graveyard_Entry.
- **Entry_Page**: The page of one Graveyard_Entry.
- **Entry_Route**: The path `<Base_Path>/crypt/<package>/` of an Entry_Page; `<package>` is the directory name of the entry.
- **Download_Path**: The path `<Base_Path>/graveyard/<package>/<file>` under which the Site_Output serves a copy of the committed file `graveyard/<package>/<file>`.
- **Entry_File_Copy**: The build step that copies every committed file of every Graveyard_Entry, byte for byte, to its Download_Path in the Site_Output.
- **Cause_Label_Table**: The one fixed table in the Site source that maps each Cause_Of_Death code to a plain-language label.
- **Nightly_Input**: The directory `.crypt-nightly/` at the repository root of the build checkout, which holds the Nightly_Report and the Nightly_Run_Record; written only by the Pages_Workflow in a build started by `workflow_run`, gitignored, never committed.
- **Nightly_Report**: The file `.crypt-nightly/nightly-report.json`, the content of the `nightly-report` artifact of one Nightly_Workflow run.
- **Nightly_Run_Record**: The file `.crypt-nightly/run.json` that the Pages_Workflow writes from the `workflow_run` event: the run identifier, the run start time, the commit the nightly run checked and the commit of the build.
- **Attempts_Table**: The table of an Entry_Page that lists the Ledger entries whose `package` equals the entry's package name.
- **Pages_Workflow**: The GitHub Actions workflow `.github/workflows/pages.yml` that builds and deploys the Crypt_Site.
- **Site_Check_Script**: The dependency-free script `scripts/ui/checkSite.mjs` that checks a built Site_Output.
- **Safe_Link**: A rendered link whose target is a string that parses as an absolute URL with the scheme `http` or `https`, written as an anchor with `rel="noopener noreferrer"`.
- **File_Text**: Any string whose value comes from an input file of the Site_Build (a file under `graveyard/`, `ledger.json`, the Nightly_Report or the Nightly_Run_Record), including file and directory names.
- **Fixture_Graveyard**: A directory of fixture entries under `tests/ui/fixtures/` that has the layout of the Graveyard_Directory, used instead of the real one in tests, with a fixture `ledger.json` and a fixture Nightly_Input.
- **Hostile_Fixture**: A fixture entry in the Fixture_Graveyard whose File_Text contains markup, script text, scheme-less and non-http(s) URLs and path-like strings, and whose files still pass the existing parsers.
- **Ledger_Entry_Text**: A value of `ledger.json` as written there.

## Requirements

### Requirement 1: Build-time data, static export and base path

**User Story:** As a visitor, I want a plain static site that needs no server and phones nobody, so that what I read is exactly what is committed.

#### Acceptance Criteria

1. THE Site_Build SHALL read data only from files under the Graveyard_Directory of the checked-out repository, from `ledger.json` at the repository root, and from the Nightly_Input WHERE it exists, and from no network source, no environment variable and no other file, with the exception of the fixed constants of `src/pipeline/common/constants.ts` (`REPO`, `PREDICATE_TYPE`, `SIGNER_WORKFLOW`, `GH_MIN_VERSION`).
2. THE Site_Build SHALL produce a static export (Next.js `output: "export"`) with the Base_Path and `trailingSlash: true`, so that every internal link and every asset path of the Site_Output works under `/graveyard-shift/`.
3. THE built Crypt_Site SHALL make no request to another origin from the browser, SHALL load no script, stylesheet, font or image from another origin, SHALL set no cookie, SHALL use no local storage and SHALL contain no analytics or tracking code; the same-origin scripts and data files that Next.js emits for its own pages are allowed.
4. THE Site_Build SHALL run with Next.js telemetry disabled, and the Pages_Workflow and the `site` job of `ci.yml` (Requirement 10.5) SHALL set `NEXT_TELEMETRY_DISABLED=1`.
5. THE Crypt_Site SHALL contain no secret, no token and no environment variable value, and the Site_Build SHALL need no repository secret and no `.env` file.
6. THE Site_Build SHALL generate one Entry_Page at the Entry_Route of each directory of the Graveyard_Directory, and no other dynamic route, and WHEN the Graveyard_Directory has no directory, THE Site_Build SHALL produce a Crypt_Index that states that the graveyard is empty and SHALL NOT fail (the same case as resurrection-pipeline R16.24). Amended 2026-11-18 after open question 5 (user-run), see Journal: WHEN the Graveyard_Directory has no directory, THE Site_Build SHALL also generate one placeholder page at the route `/crypt/_empty/` with fixed text stating that the crypt is empty and one link to the Crypt_Index, and no other page SHALL link to it; WHEN the Graveyard_Directory has a directory, THE Site_Build SHALL NOT generate that route.
7. THE scripts `npm run build`, `npm run typecheck` and `npm run lint` SHALL keep working with the static export configuration; `npm run dev` SHALL serve the pages for development under the Base_Path; and `npm run start` SHALL print how to run `npm run dev` and how to preview the Site_Output, SHALL start no server and SHALL exit with a non-zero exit code (decision Q1).
8. THE Site_Build SHALL add no npm dependency (decision Q1).

### Requirement 2: Entry reader and validation

**User Story:** As a maintainer, I want every input file parsed by the same parsers that wrote it, so that the Site never shows a value that the Pipeline would have rejected.

#### Acceptance Criteria

1. THE Entry_Reader SHALL parse `certificate.json` with the existing Death_Certificate deserializer (autopsy-engine R10.7), `eligibility.json` with the existing Eligibility_Record deserializer (resurrection-pipeline R2.9, R2.10), `proof-report.json` with the existing Proof_Report deserializer (proof-of-life-engine R13), `deltas.json` with `parseDeltasFile`, `harness.json` with `parseHarnessFile`, and `ledger.json` with `parseLedger`, and SHALL NOT define a second schema for these files.
2. THE Entry_Reader SHALL parse `stub-run.json` with a `StubMarkerSchema` and the Nightly_Report with a `NightlyReportSchema`, each defined once next to its existing TypeScript type in `src/pipeline/undertaker/core/` (`layout.ts` and `nightlyReport.ts`) and checked by a test to describe the same shape as that type; the Pipeline's writers SHALL stay unchanged.
3. THE Entry_Reader SHALL derive the entry kind with the one function `deriveEntryKind` (resurrection-pipeline R14.12, R14.15), and SHALL use the file names of `ENTRY_FILES` and `bundleName` of `src/pipeline/undertaker/core/layout.ts` and no copy of them.
4. WHEN an entry contains `stub-run.json`, THE Entry_Reader SHALL set the stub flag of its Entry_View, and WHEN it does not, THE Entry_Reader SHALL leave the flag unset, and THE Entry_Reader SHALL read no other source for the stub flag, including the `mode` of a Ledger entry and the `stub` field of the Nightly_Report (resurrection-pipeline R23.11, R23.13).
5. IF a file of an entry is missing for its kind (resurrection-pipeline R14.2, R14.13), is malformed, fails its parser (including an unknown `schemaVersion`), or has a name outside the expected set of entry file names, or IF `ledger.json` is missing, malformed or fails `parseLedger`, THEN THE Site_Build SHALL fail with an error that names the file and the failing path, and SHALL NOT omit the entry, show a partial entry or substitute a default (decision Q9, fail closed).
6. IF the name of a directory of the Graveyard_Directory is outside the supported unscoped package name set (`supportedPackageNameProblem` of `src/pipeline/common/packageNames.ts` returns a reason), or differs from the `package.name` of the entry's certificate, THEN THE Site_Build SHALL fail with an error that names the directory (decision Q11).
7. THE Entry_Reader SHALL read the entries of the Graveyard_Directory in ascending order of package name by code-point comparison (resurrection-pipeline R16.3), so that two builds from the same files produce the same page order.
8. WHEN the Site_Build runs twice on the same input files and the same tool versions, THE two Site_Outputs SHALL have the same page data (the Entry_Views, compared as canonical JSON); the Site SHALL read no clock at build time for any displayed value, and SHALL NOT show the build date as the date of any entry.
9. THE Entry_Reader SHALL treat every file as data and SHALL execute no package code; it SHALL read the Resurrection_Version only by extracting `resurrection.tgz` with `extractTarball` of `src/proof/shell/tarball/tarballExtractor.ts` (the only importer of `tar`) into a new temporary directory that it removes afterwards, and SHALL read no extracted file other than `package.json` (decision Q5).
10. IF `resurrection.tgz` fails `extractTarball`, has no `package.json`, or its `package.json` is not JSON or has a `version` that is not a valid semantic version, THEN THE Site_Build SHALL fail with an error that names the entry directory and the cause.

### Requirement 3: Home page and Crypt index

**User Story:** As a first-time visitor, I want to see in plain words what Graveyard Shift does and what every label means, then find an entry quickly, so that I can judge the project without reading the specs.

#### Acceptance Criteria

1. THE home page SHALL state in plain words that Graveyard Shift finds abandoned npm packages, issues each a cited Death Certificate, and resurrects them on demand with a Proof of Life, and SHALL link to the Crypt_Index.
2. THE home page SHALL describe the four roles consistently with `product.md` and resurrection-pipeline A1: the Coroner (deterministic, makes the Death Certificate), the Gravedigger (deterministic, fetches and checks the Original and decides eligibility), the Medium (the only Kiro agent, runs on demand on the user's machine, makes no CI decision), and the Undertaker (deterministic CI code, runs the Proof of Life, attests only an `alive` Verdict, opens the pull request and re-verifies every entry nightly). THE home page SHALL state that only the Medium calls an LLM.
3. THE home page SHALL define the four outcomes in one place, each in a sentence derived from the specs: `alive` (proof-of-life-engine R12.1: zero divergences, every Declared_Delta demonstrated, no harness error), `restless` (R12.2: a divergence or a not-demonstrated Declared_Delta), `inconclusive` (R12.3: the proof could not be completed, for example a harness error), and "not resurrected" (resurrection-pipeline R14.13, R14.16: the package failed an eligibility rule, so nothing was resurrected, proven or attested, and this is not a failed run).
4. THE home page SHALL state that only the Verdict `alive` is attested, that `restless` and `inconclusive` entries are shown and never hidden (resurrection-pipeline R14.6), and that an entry labelled "stub run" is not a Medium-produced resurrection (resurrection-pipeline R23.13).
5. THE Crypt_Index SHALL show one row per Graveyard_Entry with these columns, each with a text column header: package name (a link to its Entry_Page), the version of the Original (from the certificate, labelled "Original version"), the outcome (one of the four labels of criterion 3, where "not resurrected" is shown for a Not_Resurrected_Entry and the Verdict otherwise), the Verdict (the `verdict` field, or "none" for a Not_Resurrected_Entry), the date of criterion 6 and the stub flag.
6. THE Crypt_Index SHALL show exactly one date per row: the certificate `analysisDate`, in a column labelled "analysed", as written in the file (decision Q4). Amended 2026-11-18 after the deployed-site check, see docs/kiro-journal.md 'crypt-ui task 15.2 deployed-site checks': the header reads "Analysed".
7. THE Crypt_Index SHALL show the label "stub run" in the stub column of every row whose Entry_View has the stub flag, and an empty-state sentence WHEN there is no row.
8. THE Crypt_Index SHALL give a Not_Resurrected_Entry the outcome "not resurrected" and the Successor from the Eligibility_Record, WHERE it has one, and SHALL NOT use the words "failed", "success", "resurrected" or "alive" as its outcome.
9. THE home page and the Crypt_Index SHALL state no total, count, average, percentage or rate computed by the Site (Requirement 6.3).
10. THE Crypt_Index SHALL state, above the table, either the Nightly_Workflow run that the nightly results of this build come from (a link built by Requirement 12.4, the run start time and the run's `conclusion` of the Nightly_Run_Record), or the sentence of Requirement 12.10 or 12.11, or the sentence "No recent nightly result in this build." (Requirement 12.6).

### Requirement 4: Entry page, Death Certificate and eligibility

**User Story:** As a visitor, I want the cited facts of one package, with each source link and fetch date, so that I can check any statement myself.

#### Acceptance Criteria

1. THE Entry_Page SHALL show, from the certificate, the package name, the Original version, the package health `status` (or the `statusError` text WHERE `status` is absent), the time of death with its availability, `daysSinceDeath` labelled "at the analysis date", the `analysisDate` labelled "analysed" (Amended 2026-11-18 after the deployed-site check, see docs/kiro-journal.md 'crypt-ui task 15.2 deployed-site checks': the label reads "Analysed"), the risk score with its contributions, the Successor WHERE one exists, and the open vulnerabilities with identifier, aliases, summary and severity.
2. THE Entry_Page SHALL show each cause of the certificate `causes` list as its code, verbatim, followed by the plain-language label of that code from the Cause_Label_Table, and WHEN a code is not in the Cause_Label_Table, THE Entry_Page SHALL show the code as itself with no label (decision Q6).
3. THE Entry_Page SHALL show each Fact of the certificate (the `facts` list) with its value and every provenance entry as a Source_URL and its Fetch_Date (autopsy-engine R3), and SHALL show a Fact marked `stale` with the word "stale" next to its sources (resurrection-pipeline R15.15 states the same for the pull request).
4. WHERE the certificate lists an omitted Fact in `notes.omittedFacts`, THE Entry_Page SHALL list it as omitted with the reason as written, and SHALL NOT fill it in.
5. THE Entry_Page SHALL show, from the Eligibility_Record, `eligible`, the integrity comparison (expected string, computed string, whether they match) and every rule with its name, whether it holds, the observed value, the `reason` and the `missingField` where present, in the order of the file.
6. THE Entry_Page SHALL show for every rule the provenance entries of the Fact `rule.<name>` as Source_URL and Fetch_Date, WHEN the Fact carries `provenanceTotal` THE Entry_Page SHALL say "first 20 of N sources" with the value from the file (resurrection-pipeline R2.14, R15.16), and WHEN a failed rule has no Fact THE Entry_Page SHALL say that no source was recorded (resurrection-pipeline R14.14).
7. WHEN an entry is a Not_Resurrected_Entry, THE Entry_Page SHALL show the heading "Not resurrected", the failed rules with their observed values and sources, and the Successor, the npm registry lookup that confirmed it and the deprecation message WHERE the files hold them, with Source_URL and Fetch_Date (resurrection-pipeline R14.9, R14.14), and SHALL state that nothing was resurrected, proven or attested.
8. THE Entry_Page of a Not_Resurrected_Entry SHALL NOT show a Verdict, a proof section, a delta section, a Resurrection_Version or verification commands.
9. IF a value of the certificate or the Eligibility_Record is marked unavailable in the file, THEN THE Entry_Page SHALL show "unavailable" for it, as written, and SHALL NOT show a zero, an empty value or a computed substitute.
10. THE Entry_Page SHALL link to the GitHub commit history of `graveyard/<package>` on `main` (`https://github.com/<REPO>/commits/main/graveyard/<package>`), labelled as the history of the entry's files, and SHALL show no pull request link (decision Q7).

### Requirement 5: Entry page, Proof of Life, deltas and verification

**User Story:** As a reviewer, I want the verdict, the evidence behind it and the exact commands to verify the signature, so that I never have to trust the page.

#### Acceptance Criteria

1. WHEN an entry is a Resurrection_Entry, THE Entry_Page SHALL show the Verdict as written in `proof-report.json`, the Original name, version and integrity string with `verified`, the Resurrection_Version labelled "Resurrection version (package.json in resurrection.tgz)", the Tree_Hash of the Resurrection, the `seed`, the `toolVersions`, the functions tested, and for each function the number of cases as written in `casesPerFunction`. Amended 2026-11-18 after the deployed-site check, see docs/kiro-journal.md 'crypt-ui task 15.2 deployed-site checks': the labels read "Integrity" and "Verified".
2. THE Entry_Page SHALL show every Divergence, every harness error, every excluded function and every non-deterministic function of the Proof_Report as written, and SHALL show an empty list as "none" and not omit the section (resurrection-pipeline R14.5; a `missing-generator` outcome is shown as such, R5.14).
3. THE Entry_Page SHALL show each Declared_Delta of the Proof_Report with its id, function and `status`, whether it was demonstrated, and the Demonstration where present, and WHERE the entry has a Deltas_File, THE Entry_Page SHALL show for each delta its kind, function, advisory identifier (as text), class, expected value and cases, each case with its Source_URL (a Safe_Link when it passes Requirement 7.2) and Fetch_Date (resurrection-pipeline R4.1, R4.14).
4. WHEN an entry has the Verdict `restless` or `inconclusive`, THE Entry_Page SHALL show that Verdict in the page heading in plain words, SHALL state that the entry is not attested and is not a successful resurrection (resurrection-pipeline R15.5), and SHALL list its Divergences, not-demonstrated deltas and harness errors before any other proof detail.
5. WHEN an entry has the Verdict `alive`, THE Entry_Page SHALL list the three expected Attestation_Bundles (`resurrection.tgz`, `proof-report.json`, `certificate.json`, each with `.sigstore.json`) with whether the file is present in the entry, and SHALL show the three verification commands built by the one function `verifyCommands` of `src/pipeline/undertaker/core/verifyCommands.ts` (resurrection-pipeline R18.1) with the prefix `graveyard/<package>/`, and SHALL NOT build a verification command by any other code.
6. WHEN an entry has the Verdict `alive` and an expected bundle file is missing, or has another Verdict and a file named `*.sigstore.json` is present, THE Entry_Page SHALL show that fact in plain words next to the bundle list (the same condition that the Nightly_Workflow reports as `attestation-failed` or `unexpected-attestation`, resurrection-pipeline R16.11, R16.12), and SHALL NOT call the entry "attested".
   _Decision 2026-11-18 (user): R5.6 is unchanged. A missing or extra `*.sigstore.json` bundle is shown on the Entry_Page in plain words and is not a build failure. This display is intended._

7. THE Entry_Page of an `alive` entry SHALL state, in the words of resurrection-pipeline R13.12 and R18.5: a successful verification proves who signed which digests, not that the content of the predicate is true; SHALL state that `gh` version `GH_MIN_VERSION` or later is required and that older versions can return exit status 0 when no attestation is present, so the reader must inspect the JSON output (resurrection-pipeline R18.2); and SHALL state that the Site itself has not verified the attestations.
8. THE Entry_Page of an `alive` entry SHALL describe the replay of the Proof of Life in one sentence that points to `npm run proof:run` with the committed files (resurrection-pipeline R18.3), and SHALL NOT claim that the Site has replayed it.
9. WHERE the entry is a Stub_Run (the stub flag), THE Entry_Page SHALL show the label "stub run" in the page heading, and the sentence of resurrection-pipeline R23.12 ("produced from a committed fixture and not by the Medium"), next to the Verdict.
10. THE Entry_File_Copy SHALL copy every file of every Graveyard_Entry to its Download_Path byte for byte, SHALL copy no other file of the repository, and THE Entry_Page SHALL list every file of the entry as a download link to its Download_Path, with the sentence that the verification commands expect the files under `graveyard/<package>/` relative to the directory where they are run (decision Q8).
11. IF a file of an entry is not a regular file (a directory, a symbolic link or another type), THEN THE Entry_File_Copy SHALL fail the Site_Build with an error that names the file, and SHALL NOT follow the link.

### Requirement 6: Honesty of the displayed data

**User Story:** As the project owner, I want the Site to be unable to overstate anything, so that a visitor can trust every sentence on it.

#### Acceptance Criteria

1. THE Site SHALL display a fact about a package, an advisory or a registry only together with the Source_URL and Fetch_Date that the input file holds for it, and WHEN the file holds none, THE Site SHALL say that no source was recorded.
2. THE Site SHALL NOT display the words "resurrected", "alive", "success", "verified" or "attested" for a Not_Resurrected_Entry, a `restless` entry or an `inconclusive` entry as a statement about that entry's outcome, and SHALL show a Not_Resurrected_Entry neither with success nor with failure styling (Requirement 8.4).
3. THE Site SHALL display a number only WHEN it is a value of an input file (shown as written, with its field name or label) or the length of a list that the same page renders in full; THE Site SHALL NOT display a sum, total, average, percentage, rate, duration, cost, difference, ranking or a number computed from the current date, and SHALL NOT display the `counts` of the Nightly_Report.
4. WHEN the Site shows both the package health `status` and the Verdict, THE Site SHALL label them differently ("Package status" and "Proof verdict") and SHALL NOT render them with one shared style, so that `alive` as a package status is never read as a Proof Verdict.
5. THE Site SHALL show a Stub_Run entry with the label "stub run" wherever it shows the Verdict of an entry with a Stub_Marker (resurrection-pipeline R23.13), SHALL NOT infer the stub label of an entry from any source other than the Stub_Marker, and SHALL NOT state that an entry without a Stub_Marker was "produced by the Medium" (the label `medium.mode` is declared and unverified, resurrection-pipeline R13.11).
6. THE Site SHALL show `ledger.json` values only in the Attempts_Table (Requirement 13), as Ledger_Entry_Text, and SHALL NOT compute a cost, a difference or a total from them (resurrection-pipeline R7.5; decision Q3).
7. THE Site SHALL state no result, count or timing that is not read from an input file, and SHALL show nightly results only as Requirement 12 states.
8. THE Site SHALL display each date as the string written in the file (an ISO 8601 UTC string), with the name of the field or its label, and SHALL NOT convert it to a local time zone or a relative phrase.
9. THE Site text SHALL NOT describe a Deferred item (see "Deferred") as a feature of the Site, and SHALL NOT link to, promise or announce one.

### Requirement 7: Safe rendering of file text

**User Story:** As a visitor, I want the Site to be unable to run anything that an input file contains, so that a hostile entry cannot attack me.

#### Acceptance Criteria

1. THE Crypt_Site SHALL render every File_Text as text, SHALL NOT use `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in its source, and a source scan test SHALL fail WHEN a file of the Site source contains one of these names.
2. THE Crypt_Site SHALL render a link from File_Text only as a Safe_Link: WHEN the string parses as an absolute URL with the scheme `http` or `https`, THE Site SHALL render an anchor with `rel="noopener noreferrer"` and the string as its `href`; OTHERWISE THE Site SHALL render the string as text with no anchor.
3. THE Site SHALL NOT render as an anchor a string with another scheme (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`), a scheme-less or protocol-relative string, a string with a leading, trailing or embedded control character or whitespace, or a string that fails to parse, whatever its letter case or percent-encoding.
4. THE Site SHALL build the links that it does not take from File_Text (the Entry_Route, the Download_Path, the history link of Requirement 4.10 and the run link of Requirement 12.4) only from the fixed constants `REPO` and the Base_Path, a validated package name (Requirement 2.6), a file name that the Entry_Reader accepted (Requirement 2.5) and a validated run identifier (Requirement 12.2).
5. THE Site SHALL render package names, directory names, file names and paths as text, and SHALL percent-encode a package name and a file name WHEN it is used in a route segment or link, so that a name with markup characters cannot change the structure of a page, a route or a link.
6. THE Crypt_Site SHALL NOT emit an inline event handler attribute or `javascript:` URL from File_Text, and SHALL set no `target="_blank"` link without `rel="noopener noreferrer"`.
7. THE Crypt_Site SHALL NOT use `style` attributes or `<style>` text, ids, class names or `name` attributes built from File_Text.
8. THE Hostile_Fixture (Requirement 10.4) SHALL prove criteria 1 to 5: the static markup of the home page, the Crypt_Index and each Entry_Page, rendered from the Fixture_Graveyard, contains no unescaped copy of the hostile markup, no anchor whose `href` has a scheme other than `http` or `https` and is not a Base_Path link, no anchor without `rel="noopener noreferrer"` for an external target, and the hostile strings appear as escaped text.

### Requirement 8: Theme and accessibility

**User Story:** As a visitor with any browser, keyboard or assistive technology, I want a Halloween look that I can still read and use, so that the theme never gets in the way of the facts.

#### Acceptance Criteria

1. THE Crypt_Site SHALL use one dark graveyard theme (dark background; Crypt, Death Certificate, Proof of Life as user-facing names) in the page text and styling, SHALL offer no light theme (decision Q15), and SHALL keep code, file names, identifiers and documentation plain (product steering).
2. THE Crypt_Site SHALL use a contrast ratio of at least 4.5:1 for normal text and at least 3:1 for large text and for interface component boundaries (WCAG 2.2 success criteria 1.4.3 and 1.4.11), and a test SHALL compute the ratio of each text and background colour pair that the stylesheet defines.
3. THE Crypt_Site SHALL be fully usable by keyboard: every link is reachable by Tab in reading order, every focused element has a visible focus indicator with a contrast ratio of at least 3:1, and each page has a skip link to the main content.
4. THE Crypt_Site SHALL NOT use colour as the only carrier of the outcome: each of the four outcomes ("alive", "restless", "inconclusive", "not resurrected") SHALL be shown as a text label, and the "stub run" label SHALL be text.
5. THE Crypt_Site SHALL use semantic HTML: one `h1` per page, headings that do not skip a level, `main`, `nav` and `header` landmarks, a `table` with `th` cells and a `caption` for the Crypt_Index and the Attempts_Table, definition or table markup for the facts, and `lang="en"` on the document.
6. THE Crypt_Site SHALL use no animation or flashing that cannot be switched off, and SHALL respect `prefers-reduced-motion`.
7. THE Crypt_Site SHALL render all its content without client JavaScript for reading the data (the content is in the static HTML), and SHALL keep the verification commands in text that can be selected and copied.
8. THE Crypt_Site SHALL load no remote font and no remote image, and SHALL work at a viewport width of 320 CSS pixels without horizontal scrolling of the page body (long commands and hashes may scroll inside their own block).

### Requirement 9: Deployment workflow

**User Story:** As a maintainer, I want the Site deployed by a locked-down workflow, so that publishing the Crypt gives no new power to any other job.

#### Acceptance Criteria

1. THE Pages_Workflow SHALL run on `push` to `main` WHEN a path under `graveyard/`, `ledger.json` or a path of the Site source (`src/app/`, `src/ui/`, `scripts/ui/`, `next.config.mjs`, `package.json`, `package-lock.json`, `.github/workflows/pages.yml`) changes, on `workflow_run` of the Nightly_Workflow with the type `completed`, and on `workflow_dispatch`, and on no other event (decision Q14).
2. THE Pages_Workflow SHALL set workflow-level `permissions: {}`, SHALL give the build job `contents: read` and `actions: read` only, and SHALL give `pages: write` and `id-token: write` to the deploy job only, with no other permission and no `attestations`, `contents: write` or `pull-requests: write` permission anywhere.
3. THE Pages_Workflow SHALL pin every third-party action to a full commit SHA with the version in a comment, as the other workflows do, SHALL reuse the existing pin of `actions/download-artifact`, SHALL take the SHAs of `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages` only from results pasted by the user (decision Q13), and a test SHALL fail WHEN a `uses:` line of the Pages_Workflow does not name a 40-character hexadecimal SHA (the existing `workflowLint` conventions of resurrection-pipeline apply).
4. THE Pages_Workflow SHALL set up Node with the Pinned_Node_Version (`PINNED_NODE_VERSION` of `src/pipeline/common/constants.ts`, the same exact version as `resurrect.yml` and `nightly.yml`), SHALL fail the job WHEN `node --version` differs, and SHALL run `npm ci`.
5. THE Pages_Workflow SHALL build with `NEXT_TELEMETRY_DISABLED=1`, SHALL run the Site_Check_Script on the Site_Output, SHALL upload the Site_Output as the Pages artifact, and SHALL deploy it in the `github-pages` environment, and a Site_Build or Site_Check_Script failure SHALL fail the build job and SHALL leave the previous deployment in place.
6. THE Pages_Workflow SHALL use a concurrency group so that at most one deployment runs at a time and a started deployment is not cancelled.
7. THE Pages_Workflow SHALL pass no input, event value, token or secret into a `run:` string, and SHALL run no package code and no LLM.
8. THE repository owner SHALL enable GitHub Pages with the source "GitHub Actions" in the repository settings, which is a Manual_Task; THE task list SHALL name the setting and SHALL NOT claim that the Site is live until the user has run the workflow and reported the page address (honesty rule).
9. THE README "Live demo" line SHALL be changed from "coming soon" only WHEN the user has reported a successful deployment in the Journal, with the address.
10. WHEN the Pages_Workflow runs on `workflow_run`, THE build job SHALL run only IF the triggering run is a run of the workflow named `nightly` of this repository (head repository equal to the repository), on the head branch `main`, started by the event `schedule` or `workflow_dispatch`, whatever its conclusion; SHALL download the `nightly-report` artifact of that run (identified by the run identifier of the event) into the Nightly_Input; and SHALL write the Nightly_Run_Record, including the run's conclusion, from the event values passed through `env:`, whether or not the download succeeded; WHEN the Pages_Workflow runs on `push` or on `workflow_dispatch` of `pages.yml` itself, THE build job SHALL run without those guards, SHALL NOT download any artifact and SHALL NOT create the Nightly_Input, so that the Site shows "No recent nightly result in this build." (Requirement 12.6; decision Q2, amended 2026-11-17 and in the third round).
11. IF the download of the `nightly-report` artifact fails (for example an expired or missing artifact, or a run that ended before the upload), THEN THE build job SHALL continue without the Nightly_Report and with the Nightly_Run_Record, so that the Site shows the sentence of Requirement 12.6, 12.10 or 12.11.
12. THE Pages_Workflow SHALL NOT commit, push or upload the Nightly_Report or the Nightly_Run_Record, other than the per-entry values that the pages render inside the Pages artifact.

### Requirement 10: Tests and traceability

**User Story:** As a maintainer, I want the Site tested without network, with hostile and failing inputs included, so that the safety and honesty rules are checked by code.

#### Acceptance Criteria

1. THE tests of this spec SHALL live in `tests/ui/`, SHALL make no network call (the network guard of `tests/setup/networkGuard.ts` stays in the setup of the vitest project), and SHALL use the Fixture_Graveyard and injected file readers (resurrection-pipeline R21.4).
2. THE Fixture_Graveyard SHALL contain at least these entries, each parseable by the existing parsers: an `alive` Resurrection_Entry with three bundle files, a `restless` Resurrection_Entry, an `inconclusive` Resurrection_Entry, a Not_Resurrected_Entry with a Successor, a Resurrection_Entry with a Stub_Marker, an entry named `lodash.set`, and the Hostile_Fixture, plus a fixture `ledger.json` with `local` and `stub` entries and a fixture Nightly_Input; the fixture files SHALL state in their directory name or a `README` that they are test data and not real entries, and no fixture SHALL be placed under `graveyard/`.
3. THE tests SHALL check, for each fixture entry kind, the page data extraction of the Entry_Reader (the Entry_View: kind, stub flag, outcome label, verdict, date field, sources, Resurrection_Version, Attempts rows, nightly view and verification commands), the text of the Crypt_Index row and the sections of the Entry_Page, with property tests (at least 100 generated cases, fast-check, the seed reported for replay through `FC_SEED`) for: the Safe_Link filter, the escaping of File_Text, the ordering and determinism of the Entry_Reader (Requirement 2.7, 2.8), and the byte equality of the Entry_File_Copy.
4. THE Hostile_Fixture SHALL hold hostile strings in every free-text field that the parsers accept and the pages show (for example vulnerability summaries, maintainer names, deprecation text, rule `observed` and `reason` values, delta ids and case sources, Source_URL values with `javascript:`, `data:` and scheme-less forms, divergence detail strings, Ledger readings and nightly `reason` and fact texts), and a test SHALL fail WHEN any Requirement 7.8 condition is false for the static markup of the pages rendered from the Fixture_Graveyard.
5. THE repository SHALL NOT run the Site_Build inside vitest; THE `ci.yml` workflow SHALL have a job that runs `npm run build` over the real Graveyard_Directory with `NEXT_TELEMETRY_DISABLED=1` and then the Site_Check_Script, which SHALL check that the Site_Output contains the home page, the Crypt_Index and one Entry_Page per entry directory under the Base_Path (with `trailingSlash`, including `lodash.set`), that no page loads a script, stylesheet, font or image from another origin and no stylesheet imports one, that every anchor `href` is an `http` or `https` URL or a relative or Base_Path link, and that every copied file has the sha256 of its source and the set of copied files equals the set of entry files (decision Q12).
6. THE tests SHALL include source scan tests for Requirement 7.1 and 7.6 and for the absence of `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` and `"use client"` in the Site source, a `verifyCommands` use test for Requirement 5.5 (no other construction of `gh attestation verify` in the Site source), a Pages_Workflow lint test for Requirement 9.1 to 9.7 and 9.10 to 9.12, a test that the Entry_Reader fails on a malformed fixture entry with the error of Requirement 2.5, and a contrast test for Requirement 8.2.
7. EVERY test file of this spec SHALL carry a header line `// Requirements: N.M, ...` in the form that `npm run trace` reads; a criterion of another spec is cited after a semicolon, for example `// Requirements: 5.5; resurrection-pipeline 18.1`.
8. THE repository SHALL map `tests/ui` to this spec in `scripts/trace.ts` (as `tests/medium` is mapped to medium-agent), `docs/traceability.md` SHALL get a section for this spec, and each criterion that no test covers (for example the Pages setting of Requirement 9.8) SHALL be classified in `docs/traceability-gaps.json` with its class and evidence.
9. THE tests of this spec SHALL belong to one vitest project `ui` in `vitest.config.mts` that includes `tests/ui/**/*.test.ts`, with the target 60 s added to the budget reporter's table, and the task list SHALL state the target as a target and not as a measurement (decision Q12).
10. THE agents that execute the tasks SHALL run only `npm run typecheck`, `npm run lint` and one test file at a time with `npx vitest run <path>`, and SHALL NOT run `npm test` or the full suite; WHEN a task needs the full suite, the `ui` project or the Site_Build with `npm run build`, THE task list SHALL state "Ready for you to run:" followed by the exact command and wait for the user's pasted output (resurrection-pipeline R21.2, R21.3; testing-workflow rule). Timings written to the Journal come from the user's pasted runs.

### Requirement 11: Repository fit and documentation

**User Story:** As a maintainer, I want the new code, libraries and settings recorded where the project records them, so that the repository stays consistent and honest.

#### Acceptance Criteria

1. WHEN the Site code is added, THE repository SHALL update `.kiro/steering/structure.md` with each new directory and file and a one-line description, with the vitest project `ui`, `scripts/trace.ts`, the Pages_Workflow, the Site_Check_Script, the Nightly_Input and the Site_Output directory, and SHALL update the "Commands" section of `.kiro/steering/tech.md` for the changed `build` and `start` scripts and the project `ui`.
2. THE Site source SHALL be in its own directories, SHALL keep a pure part (view model, outcome labels, Cause_Label_Table, link filter and link builders; no file system, clock or network) and an I/O part (the Entry_Reader's file reads, the tarball read, the Entry_File_Copy, the pages), and SHALL import the parsers, `ENTRY_FILES`, `deriveEntryKind`, `verifyCommands`, `supportedPackageNameProblem`, `extractTarball` and the constants of the existing modules and not copy them.
3. THE repository SHALL keep the four roles (Coroner, Gravedigger, Medium, Undertaker) as distinct units, and the Site SHALL import no module that starts a process, makes a network call or belongs to `src/pipeline/medium/`, with the one exception of the pure `src/pipeline/medium/agent/pathRules.mjs` that `constants.ts` re-exports.
4. WHEN the Pipeline adds a third-party library, action or tool, THE repository SHALL list it in `PREEXISTING.md` with its license and source URL; THE new actions of the Pages_Workflow (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`) SHALL be listed there, and no npm library SHALL be added (Requirement 1.8; resurrection-pipeline R22.3, R22.4).
5. THE repository SHALL add the Site_Output directory `out/` and the Nightly_Input `.crypt-nightly/` to `.gitignore`, and SHALL NOT commit built output.
6. THE `README.md` quick start SHALL describe `npm run dev` for development, `npm run build` for the static export and how to preview the Site_Output, and SHALL state that the Site reads only `graveyard/`, `ledger.json` and, in a build after a completed nightly run on `main`, that run's report and conclusion.
7. THE spec SHALL NOT change any file under `graveyard/`, SHALL NOT change `ledger.json`, SHALL NOT change what the Pipeline writes, and SHALL NOT add a variable to `.env.example`.
8. THE Journal SHALL record, as a user-run result, the first successful deployment (date, run address, page address), and SHALL NOT record a timing that the user did not paste (resurrection-pipeline R21.8; the Journal convention).
9. THE README section "Ledger and credits" SHALL state that the credit meter shows credits used, citing the user's decision of 2026-11-17 as the source of that statement, and SHALL still state no credit figure (decision Q3).

### Requirement 12: Last nightly re-verification

**User Story:** As a visitor, I want to see when an entry was last re-verified by the nightly job and with what result, so that I know whether the committed proof still holds.

#### Acceptance Criteria

1. WHERE the Nightly_Input exists, THE Entry_Reader SHALL parse the Nightly_Run_Record with its schema and, WHERE the Nightly_Report exists, the Nightly_Report with `NightlyReportSchema`; THE Entry_Reader SHALL accept the record only WHEN it parses, and SHALL accept the report only WHEN the record is accepted, the report parses and the report `repo` equals `REPO`.
2. THE Nightly_Run_Record SHALL hold `schemaVersion` 1, `runId` (the `workflow_run` event's run identifier), `runStartedAt` (the event's run start time), `conclusion` (the event's `workflow_run.conclusion`), `headSha` (the commit the nightly run checked) and `buildSha` (the commit of the Site_Build), each validated by the reader (a positive integer; an ISO 8601 UTC string; a string of 1 to 32 lower-case ASCII letters and underscores; two 40-character lower-case hexadecimal strings), and THE Site SHALL show an accepted `conclusion` as written, whether or not it is one of the values that GitHub documents (`success`, `failure`, `neutral`, `cancelled`, `skipped`, `stale`, `timed_out`, `action_required`).
3. WHEN the Nightly_Report is accepted, THE Entry_Page SHALL show, under the heading "Last nightly re-verification", the results of the report entry whose `package` equals the entry's package name: each result code verbatim with a plain-language label from one fixed table in the Site source, the run start time labelled "run started", the run's `conclusion` labelled "run conclusion", and a link to the run.
4. THE Site SHALL build the run link only as `https://github.com/<REPO>/actions/runs/<runId>` from `REPO` and the validated `runId`, and SHALL NOT take a run address from the event or the report.
5. THE Entry_Page SHALL show, together with the label of each result and not instead of it, the report's `reason` text as written for every result, including `verified` (whose default reason distinguishes an `alive` entry, "Replay identical and attestations verified.", from an entry with another Verdict, "Replay identical; no attestation expected.", resurrection-pipeline R16.14 as amended 2026-11-17); SHALL give the result `verified` a label from the fixed table that depends on the entry's Verdict, so that the Site's own text tells an `alive` entry from another one and does not contain the words "verified" or "attested" for an entry whose Verdict is not `alive`; and SHALL show each nightly fact with its Source_URL (a Safe_Link) and Fetch_Date.
6. WHEN no Nightly_Run_Record is accepted (including a build without Nightly_Input), or the record is accepted with the conclusion `success` and no Nightly_Report exists, THE Crypt_Index and every Entry_Page SHALL show the sentence "No recent nightly result in this build.", and WHEN a file of the Nightly_Input is present but not accepted THE Site_Build SHALL print a warning that names the file and the failing path and SHALL NOT fail.
7. WHEN the Nightly_Report is accepted and has no entry for a package, THE Entry_Page of that package SHALL state that the nightly run of this build has no result for it.
8. WHEN `headSha` differs from `buildSha`, THE Crypt_Index and every Entry_Page that shows a nightly result or the sentence of criterion 10 or 11 SHALL state that the nightly run checked commit `headSha` and that the Site was built from commit `buildSha`.
9. THE Site SHALL NOT show the nightly `stub` field, the `counts`, the `ghVersion` as a claim about the reader's `gh`, or any nightly value (including the run's `conclusion`) as the outcome of an entry; the outcome and the Verdict come only from `proof-report.json` and the entry kind.
10. WHEN the Nightly_Run_Record is accepted, its `conclusion` is not `success` and no Nightly_Report exists, THE Crypt_Index and every Entry_Page SHALL show the sentence "The last nightly run (<run link>, <runStartedAt>) ended <conclusion> without a report.", with the run link of criterion 4 and the two values as written in the record, and SHALL show no nightly result for any entry (decision of 2026-11-17).
11. WHEN the Nightly_Run_Record is accepted and a Nightly_Report file is present but not accepted (it fails `NightlyReportSchema`, or its `repo` differs from `REPO`), THE Crypt_Index and every Entry_Page SHALL show the sentence "The last nightly run (<run link>, <runStartedAt>) ended <conclusion>; its report did not pass validation.", with the run link of criterion 4 and the two values as written in the record, whatever the conclusion, and SHALL show no nightly result for any entry; the sentence "No recent nightly result in this build." SHALL NOT be shown in this case (decision of 2026-11-17, third round).

### Requirement 13: Attempts table

**User Story:** As a visitor, I want to see the recorded Medium attempts for a package with the meter readings as the user typed them, so that the cost record is visible without being reinterpreted.

#### Acceptance Criteria

1. THE Entry_Page SHALL show an Attempts_Table with one row per Ledger entry whose `package` equals the entry's package name, in the order of `ledger.json`, with the columns date, mode, Original version, exit code, credit meter reading before and credit meter reading after (decision Q3).
2. THE Attempts_Table SHALL show every value as Ledger_Entry_Text, SHALL show the readings exactly as typed (including the text `not provided`), and SHALL show "not recorded" for the exit code and the readings of a `stub` row, which has none.
3. THE Attempts_Table SHALL carry the caption "Attempts recorded in ledger.json" and the note "credit meter readings as typed by the user (the meter shows credits used)".
4. THE Site SHALL compute no difference, sum or other figure from the readings, and SHALL NOT state which attempt produced the committed entry.
5. THE Attempts_Table SHALL label the `mode` column "Ledger mode", and the Site SHALL NOT use a Ledger `mode` as the stub label of the entry (Requirement 2.4, 6.5).
6. WHEN no Ledger entry matches the package, THE Entry_Page SHALL state that `ledger.json` records no attempt for it.

## Deferred

These points are decided to be outside this spec. None is a criterion, and none is mentioned as a feature in the Site text (Requirement 6.9).

- Exhume (a pasted repository URL or lockfile), the dependency list of an arbitrary application and "the exact functions your code uses" (product steering, user flow steps 1 to 3; README "How it works"): they need a server or network access at run time, which Requirement 1 excludes. The committed certificates have no field for functions used by a user's code, so the Entry_Page cannot show it. The README and product steering keep describing the whole product; the Site does not claim these steps.
- A source diff of the Resurrection against the Original: it needs the Original tarball, which is not committed, and fetching it contradicts Requirement 1 (decision Q5).
- Replaying the Proof of Life or verifying an attestation in the browser: the Site shows commands and offers the files for download only (Requirement 5).
- A custom domain: not used; the address stays `https://subair99.github.io/graveyard-shift/` (decision Q10).
- A light theme (decision Q15).
- Vercel as a fallback host (Journal, 2026-11-15 plan): not built here.
- Publishing to npm: out of scope for the Pipeline (resurrection-pipeline R22.6).

## Decisions

Each question was decided by the user on 2026-11-17. The decision is recorded under the question; the criteria above apply it.

- Q1 (static export, base path and the dev setup). Decision: `npm run dev` for development; `output: "export"` with the Base_Path for builds. The `start` script is replaced so that it cannot pretend to serve the export: it prints how to preview instead. No new dependency. Applied in Requirement 1.7, 1.8, 11.6.
- Q2 (nightly result). Decision: the Pages_Workflow also runs on `workflow_run` of the nightly (type `completed`, only on conclusion `success`), downloads that run's `nightly-report` artifact (permission `actions: read`, run identifier from the event, only in the build job), validates it with a nightly report schema, and the UI shows per entry "last re-verified" with the result, the run time and a link to the run. Without a valid report (push or dispatch builds, expired artifact) the Site says "no recent nightly result in this build". The report is never committed. Applied in Requirement 9.1, 9.2, 9.10 to 9.12, 12. No zod schema existed for the report (see Introduction), so Requirement 2.2 adds one next to the existing type, and the run time and run identifier come from the event (Nightly_Run_Record). Amended 2026-11-17 (user decision, design open question 1): the Pages_Workflow runs on every completed nightly run on `main`, whatever its conclusion, and the Nightly_Run_Record carries the run's conclusion; with a valid report the Site shows its results and the conclusion, without a report after a run that did not succeed it shows "The last nightly run (<link>, <time>) ended <conclusion> without a report.", and otherwise the sentence above. Applied in Requirement 3.10, 9.10, 9.11, 12.1 to 12.3, 12.6, 12.8 to 12.10.
- Q3 (ledger). Decision: show it per entry as an Attempts table: date, mode (local or stub), exit code and both meter readings exactly as typed, labelled "credit meter readings as typed by the user (the meter shows credits used)". The README ledger section gains that meaning, citing the user. No difference is computed. Applied in Requirement 1.1, 6.6, 11.9, 13.
- Q4 (date). Decision: the certificate `analysisDate`, labelled "analysed". Applied in Requirement 3.6, 4.1.
- Q5 (version and diff). Decision: read the Resurrection_Version from `package.json` inside `resurrection.tgz` at build time through `tarballExtractor.ts`. No source diff: Deferred. Applied in Requirement 2.9, 2.10, 5.1.
- Q6 (causes). Decision: show cause codes verbatim, each with a plain-language label from one fixed table in the UI code; an unknown code is shown as itself. Applied in Requirement 4.2.
- Q7 (pull request link). Decision: none; link to the GitHub history of `graveyard/<package>` on `main` instead. Applied in Requirement 4.10.
- Q8 (copy files). Decision: copy each entry's committed files byte for byte into the export, so a reader can download them and run the `gh attestation verify` commands; a test compares the sha256 of every copied file with the source. Applied in Requirement 5.10, 5.11, 10.3, 10.5.
- Q9 (schema versions). Decision: an unknown `schemaVersion` or an invalid file fails the build with a message naming the file (fail closed). Applied in Requirement 2.5.
- Q10 (custom domain). Decision: no. Moved to Deferred.
- Q11 (routes). Decision: `trailingSlash: true`; one directory per entry named by the package name (`lodash.set` works); names outside the supported unscoped name set fail the build; tested with `lodash.set`. Applied in Requirement 1.2, 2.6, 10.2, 10.5.
- Q12 (tests). Decision: one vitest project `ui` (target 60 s) for the unit and property tests under `tests/ui/`; the build is not run inside vitest. A `ci.yml` job runs `npm run build` with `NEXT_TELEMETRY_DISABLED=1` and the dependency-free `scripts/ui/checkSite.mjs`, which checks the export (expected pages exist, no external script or fetch, every link `http(s)` or relative, copied files match). `out/` is added to `.gitignore`. Applied in Requirement 10.5, 10.9, 11.5.
- Q13 (action SHAs). Decision: no SHA or version is guessed. The design names the actions with SHA placeholders and gives the `gh api` commands; the pins are filled from the user's pasted results and carry version comments like the other workflows. Applied in Requirement 9.3. Done 2026-11-17: the user pasted the tags and SHAs of the three Pages actions (Journal, "2026-11-17: crypt-ui Pages action pins (user-run)"); design.md, Component 7, uses them.
- Q14 (triggers). Decision: `push` to `main` touching `graveyard/**`, the Site sources, `next.config.mjs`, `package.json`, `package-lock.json` or the workflow file; `workflow_run` of the nightly; `workflow_dispatch`. `ledger.json` is added to the paths because Q3 makes it a Site input. Applied in Requirement 9.1.
- Q15 (theme). Decision: dark only, WCAG AA contrast, keyboard navigable, semantic headings, reduced motion respected. Applied in Requirement 8.

## Open questions

None at the requirements level. Points that the design leaves open are listed in design.md, "Remaining open questions".

## Notes

- Requirement IDs cited from other specs, checked against the files on the day of writing: resurrection-pipeline R2.9, R2.10, R2.14, R4.1, R4.14, R5.14, R7.5, R13.6, R13.11, R13.12, R14.2, R14.5, R14.6, R14.8, R14.9, R14.12 to R14.16, R15.5, R15.15, R15.16, R16.1, R16.3, R16.11, R16.12, R16.14, R16.21, R16.24, R18.1 to R18.3, R18.5, R19, R21.2 to R21.4, R21.8, R21.9, R22.3, R22.4, R22.6, R23.11 to R23.13, and decisions A1 and A12; proof-of-life-engine R12.1 to R12.3 and R13; autopsy-engine R3, R4, R5 and R10.7.
- The five outcome words of Requirement 3.3 are the three Verdicts of proof-of-life-engine R12 and the one entry kind "not resurrected" of resurrection-pipeline R14.13; "stub run" is a label, not an outcome.
- Requirement 6.2 does not forbid the sentence "this entry is not a successful resurrection" (Requirement 5.4); it forbids using those words as the outcome of such an entry. The nightly label of Requirement 12.5 avoids the word "verified" for a non-alive entry for the same reason.
- This spec does not claim that any page has been deployed. The facts in the Introduction are the committed files as read when the spec was written.

### Decisions 2026-11-17 (user)

The user decided Q1 to Q15 on 2026-11-17 (see "Decisions"). In short: `npm run dev` for development and a static export for builds, with a `start` script that only prints how to preview; the Pages_Workflow also runs after a successful nightly run (amended in the second round below: any completed nightly run on `main`) and shows that run's per-entry results, run time and run link, and says "No recent nightly result in this build." otherwise; `ledger.json` is shown per entry as an Attempts table with the readings as typed and the meaning "the meter shows credits used", which the README gains; the date is `analysisDate` ("analysed"); the Resurrection version comes from `package.json` inside `resurrection.tgz` through the existing extractor, and no source diff is shown; cause codes are shown with a fixed plain-language label; no pull request link, a history link instead; the committed files are copied into the export for download, checked by sha256; unknown schema versions and invalid files fail the build; no custom domain; `trailingSlash: true` with one directory per entry; one vitest project `ui` and a `ci.yml` build job with `scripts/ui/checkSite.mjs`; action SHAs only from the user's pasted `gh api` results; the triggers of Q14; and a dark, accessible theme only. Two facts found while applying them changed the wording: no zod schema for the nightly report existed (Requirement 2.2 adds one), and `constants.ts` imports the pure `pathRules.mjs` of `src/pipeline/medium/` (Requirement 11.3 allows that one file).

### Decisions 2026-11-17, second round (user)

The user decided the design's open questions 1 to 3 and the action pins on 2026-11-17:

1. Stale results: the Pages_Workflow runs on every completed nightly run on `main` (any conclusion), still guarded on the workflow name, the head repository, the head branch and the triggering event. The Nightly_Run_Record carries the run's `conclusion`. Applied in Requirement 3.10, 9.10, 9.11, 11.6 and 12 (criteria 1 to 3, 6, 8, 9 and the new criterion 10).
2. The nightly `verified` reason: spec (a) changes the default reason of `verified` to "Replay identical; no attestation expected." for an entry whose Verdict is not `alive` and keeps "Replay identical and attestations verified." for an `alive` one (resurrection-pipeline R16.14, amended 2026-11-17 for crypt-ui). The code and test change is a task of this spec. The Site shows the reason for every result, `verified` included, and keeps its own Verdict-dependent label of `verified`. Applied in Requirement 12.5.
3. Action pins: the user ran `gh api repos/actions/<repo>/releases/latest` and `gh api repos/actions/<repo>/commits/<tag>` for the three Pages actions; the pins are in the design and the Journal. Applied in Requirement 9.3 (decision Q13).
4. `actions/download-artifact` v8.0.2: the user read its `action.yml` at `9000827ccba6bdab643e8b6fd33ac0654aef8333`; the inputs `name`, `path`, `github-token` and `run-id` exist, so the design's use stands (design Remaining open questions, item 3, closed).

The GitHub conclusion values named in Requirement 12.2 are the conclusion values in the `status` parameter list of the REST endpoint "List workflow runs for a repository" (https://docs.github.com/en/rest/actions/workflow-runs, read 2026-11-17), whose response field `conclusion` is typed as a string or null without an enum.

### Decisions 2026-11-17, third round (user)

The user decided these points on 2026-11-17 after the second round:

1. Verified label: the Site keeps its own Verdict-dependent label of the result `verified`, shown together with the report's `reason`, not instead of it. Applied in Requirement 12.5.
2. Rejected report: WHEN a Nightly_Run_Record is accepted and the Nightly_Report file is present but fails `NightlyReportSchema` (or the `repo` check), the Site shows "The last nightly run (<link>, <time>) ended <conclusion>; its report did not pass validation." and not "No recent nightly result in this build.", which stays for the case without an accepted run record and for the conclusion `success` with no report. Applied in Requirement 3.10, 9.11, 12.6, 12.8 and the new criterion 12.11.
3. Alive flag: `NightlyEntryInput` gets no `alive` field. The nightly shell passes the matching `verified` reason text as the caller `reason` (resurrection-pipeline R16.14, amendment text updated). The two default texts of 12.5 are unchanged.
4. Pages triggers: the `build` job of `pages.yml` also runs on `workflow_dispatch` of `pages.yml` itself and on `push`, without a download and without a run record, so that the Site shows "No recent nightly result in this build."; the `workflow_run` guards stay for the `workflow_run` path. Applied in Requirement 9.10.
