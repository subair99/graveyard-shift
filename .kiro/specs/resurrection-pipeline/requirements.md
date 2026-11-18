# Requirements Document

## Introduction

The Resurrection Pipeline connects the two finished engines of Graveyard Shift (the Autopsy_Engine in `src/engine/` and the Proof_Engine in `src/proof/`) to the Medium, the one Kiro agent of the project, and publishes the result as a pull request with a signed Proof of Life. This is spec (a) of three: spec (b) `medium-agent` defines the Medium agent and its read-only MCP server, and spec (c) `crypt-ui` builds the read-only pages. This spec covers everything between a Death_Certificate and a committed Graveyard_Entry.

The flow, from the user's decisions of 2026-11-15 (docs/kiro-journal.md, "Final plan for spec (a) resurrection-pipeline (user decisions)", the source of truth for this spec):

1. The user runs `npm run resurrect -- <package>` in WSL. The Local_Runner starts the Medium once, records the credit meter readings in `ledger.json`, and calls the Push_Script.
2. The Push_Script pushes the Medium_Output (`resurrection/`, `deltas.json`, `harness.json`) to branch `resurrect/<package>` and starts the CI_Workflow with `gh workflow run`.
3. The CI_Workflow takes the Medium_Output as untrusted data, re-runs the Coroner and the Gravedigger itself, compiles the harness, runs the Proof of Life, and, only for the verdict `alive`, attests the result with GitHub Artifact Attestations. It runs typecheck, lint and the full test suite itself. Only when all three pass does it attest (verdict `alive` only) and open a pull request that adds a Graveyard_Entry and lists the passing results with a link to the run. If any of the three fails, the run stops with no attestation, no pull request and no Graveyard_Entry.
4. A dispatch without a Resurrection_Branch runs the Coroner and the Gravedigger in CI only. A Package that is not eligible (for example inflight, which has a successor) is a valid outcome and not a workflow failure: CI opens a pull request that adds a Not_Resurrected_Entry holding the certificate and the Eligibility_Record, with no resurrection, no proof and no attestation, but only when the three checks pass.
5. A scheduled Nightly_Workflow (the Undertaker, no LLM, no credits) re-verifies every committed Graveyard_Entry.

Principle (check gate): nothing produced by a failing pipeline is signed or proposed. This holds for both paths (with and without a Resurrection_Branch).

The Medium runs on demand. Nothing in this spec runs an LLM in CI. Publishing to npm is out of scope.

For testing the hand-off before spec (b) exists, the Local_Runner has a zero-credit Stub_Run (`--stub <fixture-dir>`, Requirement 23). It copies a committed fixture instead of running kiro-cli. The result is labelled "stub" everywhere and is never presented as a Medium-produced resurrection.

Optional criteria (first to cut): Requirements 16.19 and 16.20 (nightly issue), 18.4 (offline verification documentation) and 20.11 (documentation phrase test) are optional. If the task list must shrink, these are cut first. Each is marked "(optional, first to cut)" in its text. The verdict gate, `gh attestation verify` and the mode label are never cut (J10). Requirement 16.21 (no deploy to GitHub Pages, nothing committed by the Nightly_Workflow) is required and is not optional.

### Decisions carried from the journal (not reopened)

- J1 (who runs what): the Medium runs locally in WSL. CI re-runs the Coroner and the Gravedigger and never trusts certificates or tarballs from the user's machine. From the branch, CI takes only `resurrection/`, `deltas.json` and `harness.json`, as untrusted data, with a path allowlist and size limits. CI then runs the Proof of Life, the attestation and the pull request.
- J2 (hand-off): `npm run resurrect -- <package>` runs the Medium, `push-resurrection.ts` pushes to `resurrect/<package>` and triggers the workflow with `gh workflow run`. The workflow is `workflow_dispatch` on `main` with the branch as input. No environment, no secrets. Review decision A7/A8 makes the branch input optional: a dispatch without a branch is the eligibility-only path (Requirement 14).
- J3 (cap and ledger): one Medium attempt per package per run. The script asks for the credit meter reading before and after and records both in `ledger.json` with the date and package, plus CLI-reported usage if the CLI prints it. The 150-credit ceiling is a documented rule, not enforced.
- J4 (overnight): a scheduled nightly CI job (no LLM, no credits) replays the Proof of Life with the recorded seed and checks that the report is byte-identical, verifies each attestation with `gh attestation verify`, and re-runs the Coroner to flag new advisories. Results go to a nightly report.
- J5 (demo set): one resurrection each for lodash.set and ip, each with a signed Proof of Life, and a rest-in-peace card for inflight (produced by the eligibility-only dispatch, Requirement 14). A Restless or Inconclusive outcome is shown as such, never hidden or signed.
- J6 (committed outputs): after the pull request merges, everything lives in `graveyard/<package>/` on `main`: certificate, eligibility, `deltas.json`, `harness.json`, the resurrection tarball, the proof report and the attestation bundle (`.sigstore.json`). `resurrect/` branches are temporary. The UI reads only `graveyard/`.
- J7 (attestation): subjects are the resurrection tarball, the proof report and the certificate. Predicate type `https://github.com/subair99/graveyard-shift/attestation/resurrection/v1`. Action `actions/attest` pinned to `1e69f48acb82d1966a394da916b4c1698aa569d6` (v4.2.2), permissions `id-token: write`, `attestations: write`, `contents: read` (confirmed by spike 4).
- J8 (ip): version 2.0.1 only; the export shape stays identical. The first task measures what the Original returns for `isPublic` on the five advisory addresses. If it already returns false for all five, there is no delta to prove and ip leaves the demo. The deltas are not adjusted to make it pass.
- J9 (publishing): out of this spec entirely, no stub.
- J10 (standing rules): sign only when the verdict is `alive`; the verdict gate, `gh attestation verify` and the mode label are never cut.

### Decisions added by the user for this spec

- U1: Restless and Inconclusive runs get a `graveyard/<package>/` entry with the report and the verdict shown plainly, and never an attestation.
- U2: The nightly byte-identical replay pins the exact Node version in CI (`actions/setup-node` with a fixed exact version, picked in the design from the versions that `actions/setup-node` offers and not from the user's machine), and the report records it. If the version must change, the nightly job reports "tool versions changed" as a distinct result and not as a failure of the resurrection.
- U3: The steering files, README and structure wording are updated so that the Medium runs on demand and the nightly CI job re-verifies without an LLM (Requirement 20).
- U4: The first task of the task list measures `isPublic` on the five advisory addresses of ip@2.0.1 before any ip harness work (Requirement 3).
- U5: Tests are run by the user. Every task that needs network, kiro-cli, gh or a credit meter reading is a manual task of the user, and agents do not run the full suite (Requirement 21).

### Review decisions and remaining assumptions

Items marked "decision" were assumptions that the user resolved in review; they keep their identifiers A2, A4, A5, A7 to A11 and A14 to A17 so that the references in the requirements stay stable. A16 and A17 were agreed by the user in review and are now decisions.

- A1 (role mapping): the journal names four roles without defining their code. This spec maps them as follows: the Coroner is the Autopsy_Engine; the Gravedigger is a deterministic unit that fetches the Original tarball, verifies it and writes the Eligibility_Record; the Medium is the Kiro agent; the Undertaker is the deterministic CI side that runs the Nightly_Workflow and the publication steps (attestation and pull request). Only the Medium calls an LLM. The four stay separate units of code or configuration.
- A2 (decision: limits are chosen upper bounds, not measurements): the numeric limits of Requirement 9.7 (200 files, 1 MiB per file, 5 MiB in total, depth 8, 64 KiB for `deltas.json` and `harness.json`) are upper bounds chosen for this spec. No run has measured them, and no document may present them as measured. The design may revise them.
- A3 (names of workflow files and commands): `.github/workflows/resurrect.yml`, `.github/workflows/nightly.yml` and the module names are working names. The design may change them. The command `npm run resurrect -- <package>` and the branch name `resurrect/<package>` are fixed by the journal.
- A4 (decision: nightly permissions): the Nightly_Workflow keeps `contents: read` and `attestations: read` (the second because the verify job runs `gh attestation verify`; see design, "Nightly permissions"), with the nightly report written to the job summary and to a workflow artifact, and nothing committed. WHEN a nightly run fails, it may open or update one issue titled "Nightly re-verification failed", which needs `issues: write` and no other added permission (Requirement 16.1 and 16.19). A later deploy of the nightly status to GitHub Pages belongs to spec (c) `crypt-ui` and is explicitly out of scope of this spec.
- A5 (decision: pull requests from the workflow token): documented GitHub behaviour is that events created with `GITHUB_TOKEN` do not trigger other workflows, except `workflow_dispatch` and `repository_dispatch`. The pull request opened by the CI_Workflow therefore does not start `ci.yml`. So the CI_Workflow runs typecheck, lint and the full test suite itself, and opens the pull request only when all three pass. The pull request body lists the passing results with a link to the run (Requirements 11.14, 11.16, 11.17 and 15.10). A failing check stops the run before any attestation, pull request or Graveyard_Entry (principle: nothing produced by a failing pipeline is signed or proposed). `ci.yml` gets a `workflow_dispatch` trigger so that the user can run it on any branch, including the pull request branch. No personal access token and no GitHub App are used. Observed by the user in the first stub run (task 10.4): the push of the publish branch starts no `ci.yml` run; the `pull_request` event does create a `ci.yml` run, but in the state `action_required` (it waits for approval); the pull request shows "No checks". Still to be verified: whether `workflow_dispatch` from the workflow token is allowed. The repository setting that allows Actions to create pull requests is a manual setting of the user.
- A6 (gh and git in WSL): the Push_Script runs where the Local_Runner runs (WSL). `gh` and `git` are assumed to be authenticated in that environment. Spike 5 confirmed kiro-cli in WSL, not `gh`. The setup of `gh` and `git` in WSL is a Manual_Task of the user (Requirement 8.10), and the Push_Script asks the user to confirm the configured commit email before its first git command (Requirement 8.9).
- A7 and A8 (decision: an ineligible package is a valid outcome, one path for both): a Package that fails the Eligibility_Gate in CI is not a workflow failure. A dispatch without a Resurrection_Branch runs the Coroner and the Eligibility_Gate in CI and, only WHEN the three checks pass, opens a pull request that adds `graveyard/<package>/` containing the certificate and the Eligibility_Record only: no resurrection, no proof, no attestation. The rest-in-peace card of inflight is this path. The UI (spec (c)) shows such an entry as "not resurrected" with the reason. The nightly run expects no attestation for such an entry and does not flag it as missing proof (Requirements 11.2, 14, 15 and 16).
- A9 (decision: ip delta scope): only `isPublic` and the five advisory addresses are advisory-backed (spikes/candidates/IP-SKETCH.md, user-checked 2026-11-15). docs/demo-packages.md lists `isPublic`, `isPrivate` and `isLoopback` for the ip delta and seven inputs; Requirement 20 reconciles the document after the measurement.
- A10 (decision: partially failing measurement): a delta lists as cases only the addresses that the Original actually misclassifies (returns `true`), because a Declared_Delta needs a Demonstration that fails on the Original (proof-of-life-engine Requirement 11.5). The measurement is recorded for all five addresses. Since A18, this rule applies to the explicit `cases` of the `returns-expected-class` delta: each explicit case must be measured `true` on the Original. The class predicate may cover more inputs than the cases, and the informational inputs `0` and `017700000001` never become explicit cases.
- A11 (decision: seed ownership): the Run_Seed and the case count belong to CI, not to the Medium, so that the Medium cannot choose a seed that hides a divergence.
- A12 (what an attestation proves): an attestation proves that a run of this repository's CI_Workflow signed the statement for the listed digests. It does not prove that the predicate content is true (spikes/attest/DECISION.md). The Proof of Life is checkable by replaying the Proof_Engine on the committed tarball.
- A13 (decision: Node version): CI pins one exact Node version in both workflows. The version is picked in the design from the versions that `actions/setup-node` offers, not from the user's machine. The local Node versions (Windows 26.13.1, WSL 26.8.2) do not affect any Proof_Report, because the Proof of Life runs only in CI.
- A14 (decision): a dispatch without a Resurrection_Branch for a Package that is eligible has nothing to do, so the CI_Workflow ends with a failure that says a Resurrection_Branch is required, and adds no entry.
- A15 (decision): the nightly issue of A4 is opened or updated only WHEN the Nightly_Workflow run fails, and the issue step runs in its own job that executes no package code.
- A16 (decision, Stub_Run, Requirement 23): (i) the stub label reaches CI as a dispatch input `medium_mode` and is a declared label like `medium.mode` `local` (CI does not verify it); (ii) a stub entry carries a Stub_Marker file `stub-run.json` so that the UI of spec (c), the Nightly_Workflow and the docs can label it, and the marker is an addition to the file list of Requirement 14.2 for stub runs only; (iii) the Stub_Fixture directory (`tests/pipeline/fixtures/stub/lodash.set/`) mirrors the Medium_Output and contains exactly `resurrection/` (the package files), `deltas.json` and `harness.json`, and the Stub_Run copies it as-is; (iv) the fixture directory must lie under `tests/pipeline/fixtures/` or under `tests/proof/fixtures/`, and the lodash.set stub uses the first, because `tests/proof/fixtures/lodash.set-alive` has its bytes pinned by `fixtureIntegrity` and its name `lodash.set` and version `4.3.3` would not pass the necromancy gate (Requirement 10.5), so the Stub_Fixture is a separate copy with the name `@graveyard-shift/lodash.set` (Requirement 23.18); (v) a stub run that reaches `alive` is attested like any other run, because the point of the stub is to test attestation end to end, and its predicate says `medium.mode` `stub`; (vi) a stub entry is never part of the demo set, and the user should close or replace a stub pull request instead of merging it as a resurrection.
- A17 (decision, Requirement 8.9): reading the configured commit email needs one read-only `git config user.email` call, which is the only git command that may run before the confirmation. The email is printed only to the local terminal for the confirmation. It is never written to a file, the Ledger, a log, a workflow artifact or CI (an exception limited to that print, to the identity redaction of Requirement 11.12).
- A18 (decision, ip delta as a class, 2026-11-15): the ip-alive fixture (`tests/proof/fixtures/ip-alive`) keeps its canonicalizing fix, which corrects every non-public address and not only the five advisory addresses. Narrowing the fix to leave `017700000001` public would be string-matching, because `01200034567` is the same octal-long form. The flaw is therefore declared as a class (`returns-expected-class`, Requirement 4.14 to 4.20), and the Verdict stays `alive` only WHEN every Divergence falls in the declared class and equals the expected value. `0` and `017700000001` remain information (Requirement 3.11) and never become explicit cases.

## Glossary

- **Pipeline**: The whole flow of this spec, from a Death_Certificate to a committed Graveyard_Entry and its nightly re-verification.
- **Package**: An npm package named by a Package_Reference with an exact version. The demo Packages are lodash.set@4.3.2, ip@2.0.1 and inflight@1.0.6.
- **Death_Certificate**: The result of the Autopsy_Engine for one package, as defined in the autopsy-engine spec.
- **Coroner**: The role performed by the Autopsy_Engine (`src/engine/`). It is deterministic and makes no LLM call.
- **Gravedigger**: The deterministic unit that fetches the Original tarball from the npm registry, verifies it against the registry integrity string, and writes the Eligibility_Record. It makes no LLM call.
- **Medium**: The Kiro agent that reads a Death_Certificate through a read-only tool and writes the Medium_Output. It is the only unit of the Pipeline that calls an LLM. Its definition belongs to spec (b).
- **Undertaker**: The deterministic CI side of the Pipeline: the attestation and pull request steps of the CI_Workflow and the Nightly_Workflow. It makes no LLM call.
- **Original**: The npm package version under test, as defined in the proof-of-life-engine spec.
- **Resurrection**: The modified package produced by the Medium, as defined in the proof-of-life-engine spec.
- **Eligibility_Record**: The JSON artifact written by the Gravedigger. It states whether a Package may be resurrected and cites a Source_URL and Fetch_Date for each fact.
- **Eligibility_Gate**: The rule set of Requirement 2.
- **Medium_Output**: The three paths the Medium may write: the directory `resurrection/`, the file `deltas.json` and the file `harness.json`.
- **Deltas_File**: `deltas.json`. The declarative list of Declared_Deltas in the delta DSL, each citing an advisory identifier.
- **Harness_File**: `harness.json`. The declarative harness description: preset names and options, with no executable code.
- **Harness_Compiler**: The deterministic component that turns the Deltas_File and the Harness_File into a Harness_Config. It makes no LLM call.
- **Preset**: A named, reviewed generator or property module kept in the repository. The Harness_File refers to it by name.
- **Local_Runner**: The command `npm run resurrect -- <package>`.
- **Push_Script**: `push-resurrection.ts`. It pushes the Resurrection_Branch and starts the CI_Workflow.
- **Resurrection_Branch**: The temporary branch `resurrect/<package>` that holds the Medium_Output.
- **Ledger**: The file `ledger.json` in the repository root. It holds one entry per Medium attempt.
- **Credit_Meter_Reading**: The credit meter value as read and typed by the user, kept as entered.
- **Credit_Ceiling**: 150 credits per Medium attempt. It is a documented rule and is not enforced.
- **Stub_Run**: A run of the Local_Runner with `--stub <fixture-dir>`. It copies a Stub_Fixture as the Medium_Output instead of running kiro-cli, uses no credit and is never a Medium-produced resurrection (Requirement 23).
- **Stub_Fixture**: A committed directory under `tests/pipeline/fixtures/` (or `tests/proof/fixtures/`) that mirrors the Medium_Output and contains exactly `resurrection/` (a ready-made resurrection package), `deltas.json` and `harness.json`. For lodash.set it is `tests/pipeline/fixtures/stub/lodash.set/`, whose `resurrection/` is a copy of `tests/proof/fixtures/lodash.set-alive` with the name `@graveyard-shift/lodash.set` (Requirement 23.18).
- **Stub_Marker**: The file `stub-run.json` of a Graveyard_Entry produced by a Stub_Run. It states `mode` `stub`.
- **CI_Workflow**: The GitHub Actions workflow started by `workflow_dispatch` on `main`. With a Resurrection_Branch input it processes that branch. Without the input it runs the eligibility-only path (Requirement 14).
- **Existing_CI**: The existing workflow `.github/workflows/ci.yml` (typecheck, lint and the full suite).
- **Check_Results**: The outcomes of typecheck, lint and the full test suite as run by the `checks` job of the CI_Workflow. The `checks` job succeeds only when all three pass; a failing check stops the run (Requirement 11.16).
- **Nightly_Workflow**: The scheduled GitHub Actions workflow that performs the nightly re-verification.
- **Intake_Validator**: The deterministic component that checks the Medium_Output against the path allowlist, type rules and size limits. The Local_Runner and the CI_Workflow use the same component.
- **Branch_Commit**: The commit SHA of the Resurrection_Branch, resolved once at the start of the CI_Workflow.
- **Proof_Engine**, **Proof_Report**, **Verdict**, **Harness_Config**, **Declared_Delta**, **Demonstration**, **Seed**, **Tree_Hash**, **Integrity_Hash**: As defined in the proof-of-life-engine spec. The Verdict is one of `alive`, `restless` or `inconclusive`.
- **Run_Seed**: The Seed chosen by the CI_Workflow for one Proof of Life run.
- **Tool_Versions**: The `toolVersions` object of the Proof_Report: the Node version, the fast-check version and the report schema version.
- **Pinned_Node_Version**: The exact Node version written in the `actions/setup-node` step of the CI_Workflow and the Nightly_Workflow. The design picks it from the versions that `actions/setup-node` offers.
- **Graveyard_Directory**: The directory `graveyard/` on `main`.
- **Graveyard_Entry**: The directory `graveyard/<package>/` and its files (Requirement 14). It is one of two kinds: Resurrection_Entry or Not_Resurrected_Entry.
- **Resurrection_Entry**: A Graveyard_Entry for a run that reached the Proof_Engine. It contains a `proof-report.json`.
- **Not_Resurrected_Entry**: A Graveyard_Entry for a Package that failed the Eligibility_Gate. It contains the certificate and the Eligibility_Record only, with `eligible` false, and no `proof-report.json`.
- **Rest_In_Peace_Entry**: A Not_Resurrected_Entry for a Package of status `retired-with-successor`.
- **Attestation_Bundle**: The Sigstore bundle JSON written by `actions/attest`, committed as `<name>.sigstore.json`.
- **Predicate_Type**: The URI `https://github.com/subair99/graveyard-shift/attestation/resurrection/v1`.
- **Resurrection_Predicate**: The JSON predicate of the attestation (Requirement 13).
- **Attest_Action**: `actions/attest` at commit `1e69f48acb82d1966a394da916b4c1698aa569d6` (v4.2.2).
- **Signer_Workflow**: The CI_Workflow file path used with `--signer-workflow` in verification.
- **Replay**: A second run of the Proof_Engine with the Seed, the case count and the radius recorded in a committed Proof_Report, on the committed Resurrection tarball, the Original verified against the recorded Integrity_Hash, and the committed Deltas_File and Harness_File.
- **Nightly_Result**: One of the per-package outcomes of Requirement 16: `verified`, `replay-mismatch`, `tool-versions-changed`, `attestation-failed`, `unexpected-attestation`, `new-advisory`, `not-resurrected`, `not-checked`.
- **Input_Class**: A named, reviewed set of inputs of one function, defined by a pure parent-side predicate in a Preset (repository code, never Medium output). A `returns-expected-class` delta names one; the Medium chooses only the name from the Preset menu. The ip class is `non-public-address`. The five ip inputs `127.1`, `01200034567`, `012.1.2.3`, `000:0:0000::01` and `::fFFf:127.0.0.1` from GHSA-2p57-rm9w-gvfp and CVE-2024-29415.
- **Manual_Task**: A task that only the user can perform because it needs network access, kiro-cli, `gh`, the GitHub settings or a credit meter reading.
- **Journal**: `docs/kiro-journal.md`.
- **Source_URL**, **Fetch_Date**, **Fact**: As defined in the autopsy-engine spec.

## Requirements

### Requirement 1: Roles, trust boundaries and determinism

**User Story:** As a maintainer of Graveyard Shift, I want the four roles kept separate and the Medium's output treated as untrusted, so that only deterministic, auditable code decides what is proven and signed.

#### Acceptance Criteria

1. THE Pipeline SHALL implement the Coroner, the Gravedigger, the Medium and the Undertaker as four distinct units of code or configuration, with no module that merges two of them.
2. THE Pipeline SHALL make zero LLM calls from the Coroner, the Gravedigger, the Harness_Compiler, the Intake_Validator, the Proof_Engine, the CI_Workflow, the Nightly_Workflow and the Undertaker.
3. THE Pipeline SHALL treat every byte of the Medium_Output as untrusted data in the Local_Runner, the Push_Script and the CI_Workflow.
4. THE Pipeline SHALL derive the Verdict only from the Proof_Engine, and SHALL derive the decision to attest only from that Verdict and from the checks of Requirement 13.
5. THE Pipeline SHALL NOT import any LLM client library, and a source scan test SHALL fail WHEN a module under `src/pipeline/` or `scripts/` imports one.
6. WHERE a module of the Pipeline needs the real clock or randomness, THE module SHALL obtain it through one injectable shell entry, and the pure modules of the Pipeline SHALL NOT read the system clock or random values (the determinism lint scope of the existing engines applies).

### Requirement 2: Gravedigger and eligibility

**User Story:** As a maintainer, I want the Original fetched, verified and checked against the project's eligibility rules by deterministic code, so that only suitable packages are resurrected.

#### Acceptance Criteria

1. WHEN the Gravedigger is run for a Package, THE Gravedigger SHALL fetch the registry packument and the tarball of the exact version from the npm registry and SHALL compute the sha512 digest of the tarball bytes.
2. IF the computed digest differs from the `dist.integrity` of the packument, THEN THE Gravedigger SHALL write an Eligibility_Record with `eligible` false and the reason `integrity-mismatch`, containing both strings, and SHALL write no tarball to the output location.
3. WHEN the digest matches, THE Gravedigger SHALL read the `package.json` of the tarball and SHALL write an Eligibility_Record that states, for each rule below, the observed value and whether the rule holds: (a) the license is MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0 as a plain SPDX identifier; (b) the `dependencies` object is absent or empty; (c) the `type` field is not `module`; (d) the total number of lines of the text files in the tarball is at most 5,000; (e) the Death_Certificate status is `dead` or `dying`; (f) the Death_Certificate lists at least one cause of death; (g) the Death_Certificate lists at least one Open_Vulnerability.
4. THE Gravedigger SHALL count the lines of rule (d) from the tarball bytes of the run, and SHALL NOT use `dist.unpackedSize` as the line count.
5. THE Eligibility_Record SHALL set `eligible` to true only WHEN every rule of criterion 3 holds, and SHALL set it to false otherwise, listing every rule that failed.
6. IF a field needed by a rule cannot be read, THEN THE Gravedigger SHALL record the rule as failed with the reason `unverified` and the name of the missing field, and SHALL NOT record the rule as holding.
7. THE Eligibility_Record SHALL attach to each Fact a Source_URL and a Fetch_Date in the format of the autopsy-engine spec, and SHALL contain no credential and no absolute local path.
8. WHEN the Death_Certificate has the status `retired-with-successor`, THE Gravedigger SHALL record the rule (e) as failed with the Successor name, and the Pipeline SHALL NOT start a Medium run for that Package, and the Eligibility_Record SHALL be committed through a Not_Resurrected_Entry (Requirement 14).
9. THE Eligibility_Record SHALL be serialized as JSON with a fixed key order, and FOR ALL valid Eligibility_Records, deserializing the serialized record and serializing the result SHALL produce an identical string (round-trip property).
10. IF the JSON supplied for deserialization is malformed or lacks a required field, THEN THE deserializer SHALL reject it with an error that names the invalid field and SHALL NOT return a partial record.
11. WHEN the Gravedigger is run twice with identical registry responses, THE Gravedigger SHALL produce byte-identical Eligibility_Records.
12. WHEN the Death_Certificate lists no cause and one or more cause inputs were unavailable (maintainers: `vitalSigns.maintainers.available` false; githubRepo: no `githubRepo` fact and no `notes.omittedFacts` entry for it; openVulnerabilities: `vitalSigns.openVulnerabilities.available` false; timeOfDeath: `timeOfDeath.available` false), THE Gravedigger SHALL record the causes rule as `unverified` with `missingField` naming every unavailable input, comma-separated without spaces, in the order maintainers, githubRepo, openVulnerabilities, timeOfDeath. WHEN at least one listed cause has every input it depends on available, THE causes rule SHALL hold; WHEN every listed cause depends on an unavailable input, THE causes rule SHALL be `unverified` naming those unavailable inputs (the unavailable inputs of the listed causes only, in the same order and format). A cause depends on these inputs (src/engine/core/causes.ts): maintainer-gone on maintainers; repo-archived on githubRepo; unpatched-cve on openVulnerabilities; runtime-rot on timeOfDeath and githubRepo (the last push date).
13. IF `vitalSigns.openVulnerabilities` of the Death_Certificate is unavailable, THEN THE Gravedigger SHALL record the open-vulnerability rule as `unverified` with `missingField` `openVulnerabilities`.
14. THE Eligibility_Record SHALL keep at most 20 provenance entries per Fact, the first 20 in sourceUrl then fetchedAt order (autopsy-engine R3.4), and WHEN more than 20 entries contributed, THE Fact SHALL carry `provenanceTotal`, the number of distinct contributing entries.
15. THE Gravedigger SHALL give the Facts of the rules `rule.status`, `rule.causes` and `rule.open-vulnerability` the union of the provenance entries of the Death_Certificate facts that contributed to each rule, with the Coroner's own Fetch_Dates, and SHALL NOT use the Gravedigger's clock as the Fetch_Date of those Facts.

### Requirement 3: ip measurement before any ip harness work

**User Story:** As a maintainer, I want to measure what ip@2.0.1 returns before building anything for it, so that the demo never claims a fix for behavior that the Original does not have.

#### Acceptance Criteria

1. THE first task of the task list of this spec SHALL measure the return value of `isPublic` of the Original ip@2.0.1 for each of the Advisory_Addresses, before any other ip harness, delta, preset or Medium work.
2. THE measurement SHALL run the Original from the integrity-verified tarball inside the Sandbox_Executor of the Proof_Engine, with no network access from the measured code.
3. THE measurement SHALL record, for each of the five Advisory_Addresses, the exact returned value or the thrown error, and SHALL record the Node version, the ip version and the integrity string.
4. THE measurement SHALL log the results for all five Advisory_Addresses, the tool versions and the date in the Journal as a user-run result, and SHALL NOT log a value that was not observed.
5. WHEN the Original returns `false` for all five Advisory_Addresses, THE Pipeline SHALL declare no ip delta, SHALL remove ip from the demo set, and SHALL record in the Journal and in docs/demo-packages.md that the Original already classifies the five addresses as not public, with the measured values.
6. WHEN the Original returns `true` for at least one Advisory_Address, THE Pipeline SHALL declare cases only for the Advisory_Addresses where the Original returned `true` (decision A10), and SHALL still record the measured value of every one of the five addresses.
7. THE Pipeline SHALL NOT change an expected value, an input or a function of an ip delta in order to make a Resurrection pass.
8. IF the Original throws for an Advisory_Address, THEN THE Pipeline SHALL record the error text redacted by the Proof_Engine, SHALL declare no delta for that address, and SHALL record in the Journal that the address has no measurable delta.
9. THE ip tarball for the measurement SHALL be recorded by a manual, network-gated recorder generalized from `npm run fixtures:record-tarball`, which verifies the bytes against the registry integrity before writing any file, and the recording SHALL be a Manual_Task.
10. THE measurement SHALL take the five addresses from GHSA-2p57-rm9w-gvfp and CVE-2024-29415 as checked by the user on 2026-11-15, and SHALL cite those two URLs in the Journal entry.
11. THE measurement SHALL record, as information that does not decide criteria 5 and 6, the return values for the inputs `0` and `017700000001` that docs/demo-packages.md lists.

### Requirement 4: Deltas file (delta DSL)

**User Story:** As a reviewer, I want the allowed behavior changes written in a small declarative format that cites advisories, so that no executable code from the Medium decides what counts as an allowed change.

#### Acceptance Criteria

1. THE Deltas_File SHALL be a JSON document with a schema version and a list of deltas, each delta having an identifier, a function name, a kind, an advisory identifier, and the kind-specific fields.
2. THE Harness_Compiler SHALL accept exactly three delta kinds: `prototype-unchanged`, `returns-expected` and `returns-expected-class` (criteria 14 to 20).
3. WHEN a delta has the kind `prototype-unchanged`, THE Harness_Compiler SHALL compile it to a Declared_Delta that selects calls whose path argument contains `__proto__`, `constructor` or `prototype` as a segment and whose property module checks that the Prototype_Delta of the call is empty, reusing the lodash.set property module of the proof-of-life-engine spec.
4. WHEN a delta has the kind `returns-expected`, THE Harness_Compiler SHALL compile it to a Declared_Delta whose input predicate is an equality test on the listed explicit inputs and whose property module checks that the Resurrection returned the listed expected value.
5. THE Harness_Compiler SHALL reject a delta whose advisory identifier is not in the Open_Vulnerability list or the alias list of the Death_Certificate produced by the CI_Workflow, with an error that names the delta and the identifier.
6. THE Harness_Compiler SHALL reject a delta whose function name is not exported by the Original.
7. THE Harness_Compiler SHALL reject a `returns-expected` delta whose expected value cites no source URL and Fetch_Date, so that every expected value is traceable.
8. THE Harness_Compiler SHALL reject a Deltas_File that contains a function, a code string, a module path or any field outside the schema.
9. THE Deltas_File serializer SHALL write canonical JSON with a fixed key order, and FOR ALL valid Deltas_Files, parsing, printing and parsing again SHALL produce an equal document (round-trip property).
10. IF the JSON supplied for parsing is malformed or fails the schema, THEN THE parser SHALL reject it with an error that names the failing path.
11. THE lodash.set Deltas_File SHALL contain one `prototype-unchanged` delta citing GHSA-p6mc-m468-83gw and matching the declared delta of docs/demo-packages.md.
12. WHERE the measurement of Requirement 3 leaves at least one Advisory_Address to declare, THE ip Deltas_File SHALL contain exactly one delta, of the kind `returns-expected-class`, for the function `isPublic`, citing GHSA-2p57-rm9w-gvfp, with the class `non-public-address`, the expected value `false`, and as `cases` the Advisory_Addresses that the Original returned `true` for (all five when the Original returned `true` for all five), with the cited advisory URL and Fetch_Date (decision A10 applies to the cases).
13. THE ip Deltas_File SHALL declare no delta for `isPrivate`, `isLoopback` or any other function WHILE no advisory text names that function (decision A9), and the compiler SHALL enforce this through the preset delta allowlist of criterion 20 (ip: `isPublic` only).
14. THE Harness_Compiler SHALL accept the delta kind `returns-expected-class`, with the fields `function`, `advisory`, `class`, `expected` and `cases`, where `class` is the name of an Input_Class defined by a Preset the Harness_File selects, `expected` is one JSON value, and `cases` are explicit demonstration inputs, each with the Source_URL and Fetch_Date of the advisory (decision A18).
15. WHEN a delta has the kind `returns-expected-class`, THE Harness_Compiler SHALL compile it to a Declared_Delta whose input predicate is the parent-side predicate of the named Input_Class, whose explicit cases are the listed `cases`, and whose property module checks that the Resurrection returned a value equal to the single `expected` value, so that a call selected by the class that returns any other value is a Divergence and a call outside the class is compared against the Original as usual.
16. THE Harness_Compiler SHALL reject a `returns-expected-class` delta whose `class` is not in the class menu of a Preset the Harness_File selects for that function, with an error that names the delta and the class. The Medium SHALL be able to choose only a class name from that menu, and SHALL NOT supply a predicate, code or pattern for a class.
17. THE ip Preset SHALL define the Input_Class `non-public-address`, whose predicate is a pure reference classifier written in the repository (not by the Medium) that parses dotted, short, octal, hexadecimal, long-integer and IPv6 forms (including IPv4-mapped IPv6) and returns `true` for an input that it can canonicalize and whose canonical form falls in a range that the `isPrivate` function of ip@2.0.1 treats as private or loopback (IPv4 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12 and 169.254.0.0/16; IPv6 `::1`, `::`, fc00::/7 and fe80::/16; and the IPv4-mapped IPv6 forms of the IPv4 ranges, classified by the embedded IPv4 address). Ranges that `isPrivate` does not cover (for example 0.0.0.0/8, 100.64.0.0/10 and 198.18.0.0/15) are not in the class.
18. THE classifier of criterion 17 SHALL take its ranges from the recorded ip@2.0.1 file `package/lib/ip.js` (the functions `isPrivate` and `isLoopback`, not from memory), SHALL cite that file and the line numbers of those ranges in a code comment and in the design, and SHALL cite RFC 1918, RFC 3927 and RFC 4291 as supporting references only.
19. IF the classifier cannot parse an input, THEN THE input SHALL NOT be in the class `non-public-address`; THE classifier SHALL be pure (no I/O, clock or randomness) and SHALL be covered by unit tests on the five Advisory_Addresses, on `017700000001`, on `::ffff:7f00:1`, on canonical private and loopback examples inside the covered ranges, on canonical public examples, and on `0`, `0x0`, `0.0.0.0`, `100.64.0.1` and `198.18.0.1` as inputs that are not in the class.
20. THE Harness_Compiler SHALL enforce a preset-level allowlist of the functions that may carry a delta (ip: `isPublic` only; lodash-set: its single function), and SHALL reject a delta of any kind on a function outside the allowlist, with an error that names the delta and the function.
### Requirement 5: Harness file and compiler

**User Story:** As a maintainer, I want the harness built from a declarative file by deterministic code, so that an LLM never writes executable harness code.

#### Acceptance Criteria

1. THE Harness_File SHALL be a JSON document that names the Package, selects Presets by name for the generators of each tested function, and gives only the options that each Preset declares.
2. THE Harness_Compiler SHALL reject a Harness_File that contains a function, a code string, a module path, a file path or any field outside the schema.
3. THE Harness_Compiler SHALL reject a Preset name that is not in the reviewed Preset menu of the repository, with an error that names the Preset.
4. THE Harness_Compiler SHALL reject a Harness_File that excludes a function from testing, disables the determinism control of a function, lowers the case count, sets a Seed, sets a per-call timeout, or narrows the radius to fewer than every exported function, because those values belong to CI (decision A11, Requirement 12.12).
5. THE Harness_Compiler SHALL compile the same Deltas_File, Harness_File and Death_Certificate to the same Harness_Config on every run, and a property test SHALL check that two compilations of the same inputs produce equal results (idempotence).
6. THE Preset menu SHALL contain a Preset for the lodash.set generators and a Preset for the ip address generator that covers the forms of the table in spikes/candidates/IP-SKETCH.md, with the explicit Cases of the Advisory_Addresses.
7. WHEN the Harness_File of the lodash.set Graveyard_Entry is compiled together with its Deltas_File, THE resulting Harness_Config SHALL give the Verdict `alive` for the Original against `tests/proof/fixtures/lodash.set-alive` and the Verdict `restless` for the Original against `tests/proof/fixtures/lodash.set-broken`, in a test that uses the Sandbox_Executor.
8. THE ip Preset SHALL replace `os.networkInterfaces()` identically on both sides through the setup module (proof-of-life-engine Requirement 8.10).
9. THE Harness_File serializer SHALL write canonical JSON with a fixed key order, and FOR ALL valid Harness_Files, parsing, printing and parsing again SHALL produce an equal document (round-trip property).
10. IF the JSON supplied for parsing is malformed or fails the schema, THEN THE parser SHALL reject it with an error that names the failing path.
11. THE Harness_Compiler SHALL return an error value and SHALL NOT throw for invalid input, so that the CI_Workflow can report the reason and end with the Verdict `inconclusive` and the harness error `harness-config-error`.
12. THE ip Preset SHALL provide a generator for every export of ip@2.0.1, where the export list is read from the tarball recorded by the first task (Requirement 3.9, manual task M1), and a test SHALL compare the Preset's list of covered exports with the export list of that recorded tarball.
13. IF the ip Preset cannot cover an export of ip@2.0.1, THEN THE Pipeline SHALL list that export with the reason in the design and in the Journal, and the Proof_Engine run for ip SHALL end with the Verdict `inconclusive` and the harness error `missing-generator` for that export.
14. THE Pipeline SHALL show a `missing-generator` outcome as such in the Proof_Report, the Graveyard_Entry and the pull request, and SHALL NOT hide it, SHALL NOT exclude the export through the Harness_File (Requirement 5.4), and SHALL NOT present the entry as `alive`.

### Requirement 6: Local runner (`npm run resurrect`)

**User Story:** As a user, I want one local command that runs the Medium once and hands the result to CI, so that I control when credits are spent.

#### Acceptance Criteria

1. THE repository SHALL provide the npm script `resurrect` that runs the Local_Runner, and WHEN `npm run resurrect -- <package>` is run, THE Local_Runner SHALL accept exactly one package name that passes the package name rules of the Input_Parser, and optionally the option `--stub <fixture-dir>` (Requirement 23).
2. IF the number of package names is not one or the package name is invalid, THEN THE Local_Runner SHALL write a usage message to standard error, start no Medium process, write no Ledger entry, and exit with code 64.
3. WHEN the Local_Runner starts, THE Local_Runner SHALL run the Coroner for the package, SHALL run the Gravedigger, and SHALL start the Medium only WHEN the Eligibility_Record has `eligible` true.
4. IF the Eligibility_Record has `eligible` false, THEN THE Local_Runner SHALL print the failed rules, start no Medium process, write no Ledger entry, print the `gh workflow run` command that dispatches the CI_Workflow without a Resurrection_Branch to record a Not_Resurrected_Entry, and exit with a non-zero code.
5. WHILE the package is ip, THE Local_Runner SHALL start the Medium only WHEN the measurement of Requirement 3 is recorded and at least one delta remains to declare.
6. WHERE the option `--stub` is not given, THE Local_Runner SHALL start the Medium exactly once per invocation with `kiro-cli chat --v3 --no-interactive --require-mcp-startup --agent medium <prompt>` (seven arguments after `kiro-cli`, in this order), so that a run whose MCP context server fails to start ends before spending credits, SHALL NOT retry the Medium automatically, and SHALL leave a second attempt to a new explicit invocation by the user. (amended 2026-11-16 by medium-agent; see medium-agent R8.5)
7. THE Local_Runner SHALL start the Medium with an environment built from an allowlist: only the keys of Medium_Env_Keys (as defined in medium-agent Requirement 11.1) that have a value, minus every key whose name ends in `_TOKEN`, `_KEY` or `_SECRET` (compared case-insensitively) even when the key is allowlisted, plus `GRAVEYARD_CERTIFICATE_PATH` and `GUARD_LOG_FILE`, so that `GITHUB_TOKEN` in any letter case is absent, and THE Local_Runner SHALL NOT write the value of any environment variable to standard output, standard error, the Ledger or a log file. The exact allowlist is defined and confirmed in medium-agent Requirements 11.1, 11.7 and 11.8. (amended 2026-11-16 by medium-agent; see medium-agent R11.1)
8. WHEN the Medium process ends, THE Local_Runner SHALL run the Intake_Validator on the Medium_Output and SHALL report each violation, without deleting any file.
9. IF the Medium process exits with a non-zero code or the Intake_Validator reports a violation, THEN THE Local_Runner SHALL still write the Ledger entry of Requirement 7, SHALL NOT call the Push_Script, and SHALL exit with a non-zero code.
10. WHEN the Medium_Output passes the Intake_Validator, THE Local_Runner SHALL call the Push_Script once.
11. THE Local_Runner SHALL read the Death_Certificate for the Medium from the local Coroner run and SHALL NOT send that certificate to CI, because CI re-runs the Coroner (Requirement 11).
12. THE Local_Runner SHALL run under Node in WSL and under Node on Windows, use no shell-specific syntax, and start every child process with an argument list and no shell string interpolation.
13. WHERE kiro-cli is not found or `kiro-cli` reports that the login has no credits, THE Local_Runner SHALL exit with a non-zero code, SHALL name the cause, and SHALL point to the account setup note of spikes/kiro-agent/README.md.
14. THE Local_Runner SHALL be a Manual_Task wherever it needs kiro-cli, and its pure parts (argument parsing, Ledger entry building, Intake_Validator calls) SHALL be tested with injected fakes and no network.
15. WHEN the Local_Runner has written a Ledger entry, THE Local_Runner SHALL print a reminder that the user commits `ledger.json` to `main` themselves and that the Push_Script does not push it.

### Requirement 7: Ledger and credit ceiling

**User Story:** As a user, I want each Medium attempt recorded with the credit meter readings I typed, so that the cost is documented without guessing.

#### Acceptance Criteria

1. WHEN the Local_Runner is about to start the Medium (not in a Stub_Run, Requirement 23), THE Local_Runner SHALL ask the user to type the Credit_Meter_Reading and SHALL record the text as entered.
2. WHEN the Medium process has ended (not in a Stub_Run), THE Local_Runner SHALL ask the user to type the Credit_Meter_Reading again and SHALL record the text as entered.
3. THE Ledger entry SHALL contain the package name, the exact version, the date of the attempt in UTC ISO 8601 format, the reading before, the reading after, the exit code of the Medium process, the kiro-cli version, and the CLI-reported usage WHEN the CLI prints one.
4. IF the user gives no reading, THEN THE Local_Runner SHALL record the value `not provided` for that reading, and SHALL NOT estimate, convert or fill in a number.
5. THE Local_Runner SHALL NOT compute a cost from the two readings and SHALL NOT write a computed credit number into the Ledger, the README or any report (the cost rule of the honesty steering).
6. THE Local_Runner SHALL print the Credit_Ceiling of 150 credits before the attempt, and SHALL state that it is a documented rule that the Local_Runner does not enforce.
7. THE Ledger SHALL be a JSON document with a fixed key order and a schema version, and FOR ALL valid Ledgers, parsing, printing and parsing again SHALL produce an equal document (round-trip property).
8. WHEN the Local_Runner appends an entry, THE Local_Runner SHALL keep every earlier entry unchanged and SHALL write the file atomically, so that an interrupted write leaves the previous file intact.
9. IF the existing `ledger.json` is malformed, THEN THE Local_Runner SHALL stop before the Medium starts, SHALL name the failing path, and SHALL leave the file unchanged.
10. THE Ledger SHALL contain no credential, no identity value and no absolute local path.
11. THE Ledger SHALL stay a local file that the user commits to `main` themselves, and no workflow and no script of the Pipeline SHALL commit or push it (Requirements 6.15 and 8.11).

### Requirement 8: Push script and dispatch

**User Story:** As a user, I want the Medium's output pushed to a temporary branch and the CI started by one script, so that the hand-off is repeatable and carries only the three allowed paths.

#### Acceptance Criteria

1. WHEN the Push_Script is called for a package, THE Push_Script SHALL run the Intake_Validator on the Medium_Output again before any git command.
2. THE Push_Script SHALL create or update the Resurrection_Branch `resurrect/<package>` with a commit that changes only `resurrection/`, `deltas.json` and `harness.json`, and SHALL NOT include any other path in that commit.
3. IF the Resurrection_Branch already exists on the remote, THEN THE Push_Script SHALL stop before pushing, name the branch, and print the exact command to delete it, `git push origin --delete resurrect/<package>` with the package name filled in, and SHALL NOT use a force push and SHALL NOT run that command itself.
4. WHEN the push succeeds, THE Push_Script SHALL start the CI_Workflow with `gh workflow run` on ref `main` with the inputs package name, exact version and Resurrection_Branch name.
5. THE Push_Script SHALL print the command it ran for the dispatch and the URL of the workflow runs page, and SHALL write no token value.
6. IF `gh` or `git` fails, THEN THE Push_Script SHALL exit with a non-zero code, name the failing command, and leave the local files unchanged.
7. THE Push_Script SHALL start `gh` and `git` with argument lists and no shell string interpolation, and SHALL pass the package name only after the package name rules of the Input_Parser accepted it.
8. THE Push_Script SHALL be a Manual_Task to run, because it needs network and `gh`, and its argument and path logic SHALL be tested with injected fakes.
9. WHEN the Push_Script starts, THE Push_Script SHALL read the configured commit email with `git config user.email`, print it, and ask the user to confirm it before its first other git command (decision A17), and IF the user does not confirm or no email is configured, THEN THE Push_Script SHALL run no further git command, push nothing, and exit with a non-zero code.
10. THE task list SHALL contain a Manual_Task for the user to set up git and gh in WSL: install `gh`, run `gh auth login`, run `gh auth setup-git`, and run `git config user.email` with the user's GitHub no-reply address, before the first Push_Script run (assumption A6).
11. THE Push_Script SHALL NOT include `ledger.json` in the Resurrection_Branch or in any commit it creates.
12. THE Push_Script SHALL print the configured commit email only to the local terminal, and SHALL NOT write it to a file, the Ledger, a log, a workflow artifact or CI (decision A17).

### Requirement 9: CI intake of untrusted Medium output

**User Story:** As a maintainer, I want CI to take only the three allowed paths from the branch and to check them strictly, so that a hostile or broken Medium output cannot reach anything else.

#### Acceptance Criteria

1. WHEN the CI_Workflow starts, THE CI_Workflow SHALL verify that it runs from `main`, that the package input passes the package name rules, that the version input is an exact semver version, and that the branch input is either empty or equals `resurrect/` followed by the package name.
2. IF an input check of criterion 1 fails, THEN THE CI_Workflow SHALL end before any checkout of the branch, with a reason in the job summary.
3. THE CI_Workflow SHALL resolve the Resurrection_Branch to one Branch_Commit at the start, SHALL use only that commit for every later read, and SHALL record the Branch_Commit in the job summary and in the Resurrection_Predicate.
4. THE CI_Workflow SHALL check out from the Branch_Commit only the paths `resurrection/`, `deltas.json` and `harness.json`, and SHALL NOT read, execute or copy any other path of that commit.
5. THE Intake_Validator SHALL reject a path that is not under `resurrection/` and is not exactly `deltas.json` or `harness.json`.
6. THE Intake_Validator SHALL reject a symbolic link, a hard link, a device file, an absolute path, a path with a `..` segment, a path with a backslash, a drive prefix, or a control character (any of U+0000 to U+001F, which includes NUL and newline, or U+007F), the reason naming the code point of the first such character (for example `U+000A`), and the Pipeline SHALL write a path to a log or summary only with control characters escaped (`\u000a`), so that no path can add a line such as a `::` workflow command, a path with a segment `.git`, `.github` or `.kiro`, and two paths that differ only in letter case.
7. THE Intake_Validator SHALL reject a Medium_Output that exceeds these limits: 200 files under `resurrection/`, 1 MiB per file, 5 MiB in total, a path depth of 8, `deltas.json` or `harness.json` larger than 64 KiB. These limits are chosen upper bounds, not measurements (decision A2).
8. THE Intake_Validator SHALL reject a Medium_Output in which `resurrection/` or `deltas.json` or `harness.json` is missing, and a `resurrection/` directory that has no `package.json` at its root.
9. THE Intake_Validator SHALL reject a file in `resurrection/` that is not valid UTF-8 text, WHERE the file extension is `.js`, `.cjs`, `.json`, `.md` or `.txt`, and SHALL reject any file with an extension not in that list and not named `LICENSE`.
10. IF the Intake_Validator reports a violation, THEN THE CI_Workflow SHALL end before any package code runs, SHALL list each violation with its path in the job summary, and SHALL produce no Graveyard_Entry.
11. FOR ALL generated path lists, THE Intake_Validator SHALL accept a path only WHEN it is under `resurrection/` or is `deltas.json` or `harness.json`, and a property test SHALL check this with at least 100 generated cases, including paths with traversal, mixed case, backslashes and Windows drive prefixes.
12. THE Intake_Validator SHALL be a pure function of the list of entries (path, type, size, bytes) and SHALL be the same code in the Local_Runner, the Push_Script and the CI_Workflow.
13. THE CI_Workflow SHALL run `actions/checkout` with `persist-credentials: false` in every job that handles Medium_Output.
14. WHEN the branch input is empty, THE CI_Workflow SHALL read no Resurrection_Branch, SHALL run no Intake_Validator step and no Proof_Engine step, and SHALL follow the eligibility-only path of Requirements 11.2 and 14.

### Requirement 10: Necromancy gate on the Resurrection

**User Story:** As a maintainer, I want every Resurrection checked against the necromancy laws by code, so that no license, author credit, version or API rule depends on the Medium's good behavior.

#### Acceptance Criteria

1. THE CI_Workflow SHALL read the `package.json` of the Resurrection and SHALL reject it WHEN its `license` differs from the `license` of the Original.
2. THE CI_Workflow SHALL reject a Resurrection whose license file is missing or whose bytes differ from the license file of the Original, WHERE the Original has a license file.
3. THE CI_Workflow SHALL reject a Resurrection whose `author` and `contributors` fields lack any author credit present in the Original `package.json`.
4. THE CI_Workflow SHALL reject a Resurrection whose version is not a patch or minor increase over the Original version according to semver precedence, and SHALL reject a major increase.
5. THE CI_Workflow SHALL reject a Resurrection whose `name` is not `@graveyard-shift/` followed by the Original package name.
6. THE CI_Workflow SHALL reject a Resurrection that adds a `dependencies` entry, a `scripts` entry named `preinstall`, `install`, `postinstall` or `prepare`, a `bin` field, or sets `type` to `module`.
7. THE CI_Workflow SHALL leave the check of the public API (export names, signatures and return shapes) to the API-surface check of the Proof_Engine, and SHALL treat an API-surface Divergence as a Verdict `restless` result.
8. IF a check of criteria 1 to 6 fails, THEN THE CI_Workflow SHALL end before the Proof_Engine runs, SHALL list each failed check in the job summary, and SHALL produce no Graveyard_Entry, because a rejected Medium_Output is a failed run and not an ineligible Package.
9. THE necromancy checks SHALL be a pure function of the two `package.json` objects and the two license texts, and SHALL be tested with at least 100 generated cases for the version rule and for the name rule.

### Requirement 11: CI re-runs the Coroner and the Gravedigger; job isolation and permissions

**User Story:** As a maintainer, I want CI to rebuild every trusted fact itself and to run untrusted code in a job that holds no write permission, so that a hostile branch cannot sign or publish anything.

#### Acceptance Criteria

1. THE CI_Workflow SHALL run the Coroner and the Gravedigger for the exact Package of the inputs on the CI runner, and SHALL NOT read any certificate, eligibility record or tarball from the Resurrection_Branch or from the user's machine.
2. WHEN the Eligibility_Record of the CI run has `eligible` false, THE CI_Workflow SHALL read no Medium_Output, SHALL run no Proof_Engine step, SHALL end with success, and SHALL pass the certificate and the Eligibility_Record to the `publish` job for a Not_Resurrected_Entry, with the failed rules in the job summary, and the `publish` job SHALL run only WHEN the `checks` job succeeded (decision A7 and A8, Requirement 11.16).
3. THE CI_Workflow SHALL pass `GITHUB_TOKEN` to the Coroner step only as the workflow token with `contents: read`, and SHALL NOT print it, store it in an artifact, or pass it to any step that handles Medium_Output.
4. THE CI_Workflow SHALL be split into five jobs that exchange data only through workflow artifacts: `intake`, `checks`, `prove`, `attest` and `publish`.
5. THE `prove` job SHALL be the only job that executes code from the Medium_Output, SHALL run it only through the Sandbox_Executor, and SHALL have the permission `contents: read` and no other permission, in particular no `id-token`, no `attestations`, no `pull-requests` and no `contents: write`.
6. THE `attest` job SHALL run no code from the Medium_Output, and SHALL have the permissions `id-token: write`, `attestations: write` and `contents: read`.
7. THE `publish` job SHALL run no code from the Medium_Output, and SHALL have the permissions `contents: write` and `pull-requests: write`.
8. THE workflow-level default permission of the CI_Workflow SHALL be none (`permissions: {}`), and each job SHALL declare the permissions it needs.
9. THE CI_Workflow SHALL define no environment and use no secret other than the automatic workflow token.
10. THE CI_Workflow SHALL pin every third-party action to a full commit SHA with the tag in a comment, and SHALL run on `ubuntu-24.04`.
11. THE CI_Workflow SHALL set `timeout-minutes` on every job and SHALL use a `concurrency` group per package that does not cancel a run in progress.
12. THE CI_Workflow SHALL contain no step that prints environment variables, and the Proof_Engine's `emit` rules (identity redaction of every log line) SHALL apply to every Pipeline log line.
13. A workflow lint test SHALL fail WHEN a workflow file of the repository lacks a SHA pin on a third-party action, grants `id-token: write` or `attestations: write` to a job that runs Medium_Output code, or defines a `secrets.` reference other than the workflow token.
14. THE `checks` job SHALL run `npm ci`, `npm run typecheck`, `npm run lint` and `npm test` on the checkout of `main`, SHALL read no Medium_Output, SHALL have the permission `contents: read` and no other permission, and SHALL upload the Check_Results as a workflow artifact whatever the outcome and write each check result to the job summary, because pull requests opened with the workflow token do not start the Existing_CI (decision A5). The exact GitHub behaviour is to be verified in the design.
15. WHEN the branch input is empty and the Eligibility_Record has `eligible` true, THE CI_Workflow SHALL end with a failure that states a Resurrection_Branch is required, and SHALL produce no Graveyard_Entry (decision A14).
16. THE CI_Workflow SHALL run the `checks` job on both paths (with and without a Resurrection_Branch), and IF any of typecheck, lint or the full test suite fails, THEN THE CI_Workflow SHALL end the run with failure, SHALL NOT run the `attest` job, SHALL NOT run the `publish` job, SHALL open no pull request, SHALL produce no Graveyard_Entry and no Attestation_Bundle, and SHALL write the failing check and the link to the workflow run in the job summary.
17. THE `attest` job and THE `publish` job SHALL each declare `needs` on the `checks` job and SHALL run only WHEN the `checks` job result is `success` (the `publish` job additionally needs `intake`, and, for a Resurrection_Entry, `prove` and `attest`), so that nothing produced by a failing pipeline is signed or proposed.
18. THE `checks` job SHALL set the environment variable `PROOF_BUDGET_MODE=warn`, as `ci.yml` does, because the time targets of the proof projects were set on the user's machine, and a budget warning SHALL NOT fail the `checks` job, and a test failure SHALL fail the `checks` job (Requirement 11.16).

### Requirement 12: Proof of Life run, Seed and pinned tool versions

**User Story:** As a reviewer, I want the proof run configured by CI alone and recorded with its tool versions, so that the Verdict is reproducible and the Medium cannot influence the evidence.

#### Acceptance Criteria

1. WHEN the necromancy checks pass, THE `prove` job SHALL run the Proof_Engine through the CLI of the proof-of-life-engine spec with the Original tarball verified against the Integrity_Hash of the registry packument, the Resurrection from the Branch_Commit, and the Harness_Config compiled by the Harness_Compiler.
2. THE `prove` job SHALL choose the Run_Seed once, as a 32-bit integer from a cryptographically secure random source in the shell, SHALL pass it to the Proof_Engine, and SHALL record it in the Proof_Report.
3. THE `prove` job SHALL set the case count to at least the Proof_Engine default of 100 cases per function, and SHALL ignore any case count or Seed in the Medium_Output (Requirement 5.4).
4. THE `prove` job SHALL map the Proof_Engine exit codes 0, 1 and 2 to the Verdicts `alive`, `restless` and `inconclusive`, and SHALL treat exit code 64 or any other code as `inconclusive` with a harness error, and SHALL NOT treat an unexpected exit code as `alive`.
5. THE `prove` job SHALL upload the Proof_Report, the resurrection tarball and the Eligibility_Record as workflow artifacts whatever the Verdict is.
6. THE CI_Workflow and the Nightly_Workflow SHALL set the Pinned_Node_Version in `actions/setup-node` to one exact version that the design picks from the versions that `actions/setup-node` offers (never a major alias, and never taken from the user's machine), and SHALL install with `npm ci` so that the fast-check version comes from `package-lock.json`.
7. THE Proof_Report SHALL record the Node version, the fast-check version and the report schema version in `toolVersions`, as read from the running installation (proof-of-life-engine Requirement 13.5).
8. THE Pinned_Node_Version of the CI_Workflow and of the Nightly_Workflow SHALL be equal, and a workflow lint test SHALL fail WHEN the two differ or WHEN either is not an exact `major.minor.patch` version.
9. WHERE the Pinned_Node_Version changes in the repository, THE Pipeline SHALL record the change and its date in the Journal, and the Nightly_Workflow SHALL report the Nightly_Result `tool-versions-changed` for each Graveyard_Entry whose committed Tool_Versions differ (Requirement 16).
10. THE Pipeline SHALL state no run time or credit number in any output that was not measured and logged in the Journal.
11. THE Pipeline SHALL produce every Proof_Report only in the CI_Workflow and the Nightly_Workflow, so that the Node version of the user's machine (Windows 26.13.1, WSL 26.8.2 as read by the user) does not enter any committed Proof_Report.
12. THE `prove` job SHALL always pass the full radius to the Proof_Engine, meaning every exported function of the Original, and SHALL NOT define or accept a fallback radius, a narrowed radius or a radius option from the Medium_Output, the dispatch inputs or the environment; IF the Proof_Engine cannot cover every exported function, THEN THE `prove` job SHALL end with the Verdict `inconclusive` (for ip, Requirement 5.13), and the Pipeline SHALL show that Verdict as such.

### Requirement 13: Verdict gate and attestation

**User Story:** As a reader of a pull request, I want a signature only on a Proof of Life that came out `alive`, so that a signature always means a passed proof.

#### Acceptance Criteria

1. THE `attest` job SHALL run only WHEN the `checks` job succeeded and the `prove` job reports the Verdict `alive`, and SHALL NOT run for a failed `checks` job, for the Verdict `restless` or `inconclusive`, for a failed `prove` job, or for any missing Verdict.
2. WHEN the `attest` job starts, THE `attest` job SHALL parse the downloaded Proof_Report with the report schema and SHALL end without signing IF the parse fails or the `verdict` field is not `alive`.
3. WHEN the `attest` job starts, THE `attest` job SHALL extract the downloaded resurrection tarball and recompute its sha512 Tree_Hash over paths and bytes, and SHALL recompute the sha512 Integrity_Hash of the Original, and SHALL end without signing IF either value differs from the value in the Proof_Report.
4. THE `attest` job SHALL attest three subjects with the Attest_Action: the resurrection tarball, the Proof_Report and the Death_Certificate produced by the CI run, each with its sha256 digest.
5. THE `attest` job SHALL use the Predicate_Type and SHALL use the Attest_Action at the pinned commit SHA.
6. THE Resurrection_Predicate SHALL contain: the package name and exact version of the Original, the Integrity_Hash of the Original, the Tree_Hash of the Resurrection, the sha256 digests of the tarball, the Proof_Report and the Death_Certificate, the Verdict, the Run_Seed, the Tool_Versions, the Branch_Commit, the run identifier of the CI_Workflow, and `medium.mode` with the value `local`, or the value `stub` WHEN the run is a Stub_Run (Requirement 23).
7. THE Resurrection_Predicate SHALL be canonical JSON with a fixed key order, and FOR ALL valid predicates, parsing, printing and parsing again SHALL produce an equal document (round-trip property).
8. THE Pipeline SHALL define the Predicate_Type string once in one module, and a test SHALL fail WHEN any file under `src/`, `scripts/` or `tests/`, `README.md`, any file under `docs/` except the Journal (`docs/kiro-journal.md`), or any file under `.github/workflows/` except `spike-attest.yml` contains the string `graveyard-shift.dev`, and the scan SHALL NOT cover `.kiro/specs/`, `spikes/` or any other path.
9. THE `attest` job SHALL upload each Attestation_Bundle as a workflow artifact named for its subject, so that the `publish` job can commit it as `<subject>.sigstore.json`.
10. IF the Attest_Action fails for any subject, THEN THE `attest` job SHALL fail, and THE `publish` job SHALL NOT commit a Graveyard_Entry that claims an attestation.
11. THE Pipeline SHALL record `medium.mode` as a declared label and SHALL NOT claim that CI verified it.
12. THE README, the Resurrection_Predicate documentation and the verification text SHALL state assumption A12 in plain words: the attestation proves who signed which digests, not that the predicate content is true.

### Requirement 14: Graveyard entries, including Restless, Inconclusive and not resurrected

**User Story:** As a visitor, I want every run that reached the Proof of Life, and every package found ineligible, to appear in the graveyard with its verdict or its reason, so that failures and refusals are visible and only successes are signed.

#### Acceptance Criteria

1. THE `publish` job SHALL create the Resurrection_Entry `graveyard/<package>/` for every run that reached the Proof_Engine and whose `checks` job succeeded, whatever the Verdict is (U1).
2. THE Resurrection_Entry SHALL contain `certificate.json`, `eligibility.json`, `deltas.json`, `harness.json`, the resurrection tarball `resurrection.tgz` (one fixed name, because the Proof_Report and the attestation predicate already record the package name and the resurrection version) and `proof-report.json`, all produced or checked by CI as in Requirements 11 and 12.
3. WHEN the Verdict is `alive`, THE Resurrection_Entry SHALL also contain one Attestation_Bundle for each of the three subjects of Requirement 13.4.
4. WHEN the Verdict is `restless` or `inconclusive`, THE Resurrection_Entry SHALL contain no Attestation_Bundle and no file whose name ends in `.sigstore.json`.
5. THE Resurrection_Entry for a Verdict other than `alive` SHALL show the Verdict in the `proof-report.json` and in the pull request title and body in plain words, and SHALL list every Divergence, not-demonstrated Declared_Delta and harness error that the Proof_Report holds.
6. THE Pipeline SHALL NOT delete, hide or relabel an entry with the Verdict `restless` or `inconclusive`, and SHALL NOT present it as a successful resurrection.
7. WHEN a Graveyard_Entry already exists for the package, THE `publish` job SHALL replace the files of that entry in the pull request, and the earlier version SHALL stay in git history.
8. THE Graveyard_Directory SHALL be read by the UI (spec (c)) and by the Nightly_Workflow as the only source of committed results, and `resurrect/` branches SHALL be treated as temporary.
9. THE Rest_In_Peace_Entry SHALL be a Not_Resurrected_Entry, WHERE the Package has the status `retired-with-successor` (decision A8), and SHALL show the Successor, the npm registry lookup that confirmed it, and the deprecation message with their Source_URL and Fetch_Date.
10. THE Pipeline SHALL produce the Rest_In_Peace_Entry for inflight@1.0.6 by the dispatch without a Resurrection_Branch, without any Medium run, any Resurrection, any proof or any attestation.
11. THE Graveyard_Entry files SHALL contain no credential, no Identity_Value, no absolute local path and no wall-clock timestamp other than the Fetch_Date and Analysis_Date facts of the certificate.
12. THE Pipeline SHALL define the file names, the layout and the two kinds of the Graveyard_Entry once in one module, and a test SHALL fail WHEN the writer, the Nightly_Workflow reader and the documentation list different names or kinds.
13. WHEN the CI run found the Package not eligible (Requirement 11.2) and the `checks` job succeeded, THE `publish` job SHALL create the Not_Resurrected_Entry `graveyard/<package>/` containing `certificate.json` and `eligibility.json` only, as produced by the CI run, with no resurrection tarball, no `deltas.json`, no `harness.json`, no `proof-report.json` and no Attestation_Bundle.
14. THE Not_Resurrected_Entry SHALL state the failed rules of the Eligibility_Record with their observed values, each failed rule with its Source_URL and Fetch_Date, or states that no source was recorded, so that the UI of spec (c) can show it as "not resurrected" with the reason.
15. THE Pipeline SHALL derive the kind of a Graveyard_Entry from one function: an entry that contains `proof-report.json` is a Resurrection_Entry, and an entry without it is a Not_Resurrected_Entry whose `eligibility.json` has `eligible` false.
16. THE Pipeline SHALL NOT present a Not_Resurrected_Entry as a failed run, a Restless outcome or a successful resurrection.

### Requirement 15: Pull request

**User Story:** As a maintainer, I want the result delivered as a pull request with the verification command, so that I review the evidence before it reaches `main`.

#### Acceptance Criteria

1. WHEN the `publish` job has a Graveyard_Entry and the `checks` job succeeded, THE `publish` job SHALL open one pull request against `main` that adds or updates that entry and changes no other path.
2. THE pull request title SHALL contain the package name, the exact Resurrection version and the Verdict for a Resurrection_Entry, and SHALL contain the package name, the exact Original version and the words "not resurrected" for a Not_Resurrected_Entry.
3. THE pull request body for a Resurrection_Entry SHALL contain the Verdict, the Run_Seed, the Tool_Versions, the Branch_Commit, the link to the workflow run, the counts of cases per function from the Proof_Report, and, for each Declared_Delta, whether it was demonstrated.
4. WHEN the Verdict is `alive`, THE pull request body SHALL contain the verification command of Requirement 18.
5. WHEN the Verdict is `restless` or `inconclusive`, THE pull request body SHALL state that the entry is not attested and is not a successful resurrection.
6. THE `publish` job SHALL NOT merge the pull request and SHALL NOT enable auto-merge.
7. THE `publish` job SHALL use only the workflow token with `contents: write` and `pull-requests: write`, and SHALL NOT use a personal access token.
8. IF the repository does not allow GitHub Actions to create pull requests, THEN THE `publish` job SHALL fail with a message that names the repository setting, and SHALL leave the artifacts of the run available.
9. THE pull request body SHALL contain no credential, no Identity_Value and no absolute local path.
10. THE pull request body of every entry SHALL list the Check_Results (typecheck, lint, full test suite) as passed with a link to the workflow run (decision A5), because a pull request exists only WHEN all three checks passed (Requirement 11.16).
11. THE pull request body for a Not_Resurrected_Entry SHALL state the failed eligibility rules, each failed rule with its Source_URL and Fetch_Date, or states that no source was recorded, the link to the workflow run, and that nothing was resurrected, proven or attested.
12. THE repository SHALL add the `workflow_dispatch` trigger to `ci.yml` so that the user can run the Existing_CI on any branch, and the pull request body SHALL tell the reviewer that the Existing_CI is not started automatically for this pull request.
13. THE Pipeline SHALL use no personal access token and no GitHub App to start the Existing_CI.
14. WHEN the Eligibility_Record has a reason, THE pull request body SHALL show `Reason: <reason>` whether or not failed rules are listed.
15. WHEN the Fact of a failed rule is stale, THE pull request body SHALL mark each of its sources with `(stale)`, because staleness is recorded per Fact, not per source.
16. WHEN a Fact carries `provenanceTotal`, THE pull request body SHALL say `first 20 of N sources` for that rule.
17. THE pull request body SHALL show every provenance entry of a failed rule and SHALL NOT substitute another Fact's source.

### Requirement 16: Nightly re-verification (the Undertaker)

**User Story:** As a user, I want every committed resurrection re-checked every night without any LLM or credit, so that a regression or a new advisory is noticed.

#### Acceptance Criteria

1. THE Nightly_Workflow SHALL run on a schedule and on `workflow_dispatch`, SHALL run on `main`, SHALL use no LLM and no credit, and SHALL have the permissions `contents: read` and `attestations: read` and no other permission for the job that verifies the entries, with no write permission and no `id-token` (decision A4). The only permission added is `issues: write` for the notification job of criterion 19.
2. THE Nightly_Workflow SHALL run on `ubuntu-24.04`, with the Pinned_Node_Version and `npm ci`, and with every third-party action pinned to a full commit SHA.
3. WHEN the Nightly_Workflow runs, THE Nightly_Workflow SHALL process every directory of the Graveyard_Directory in ascending order of package name by code-point comparison.
4. FOR EACH Graveyard_Entry with a Resurrection, THE Nightly_Workflow SHALL compare the Tool_Versions in the committed `proof-report.json` with the Tool_Versions of the running installation.
5. IF the Tool_Versions differ, THEN THE Nightly_Workflow SHALL record the Nightly_Result `tool-versions-changed` for that entry, SHALL list the fields that differ, and SHALL NOT report the entry as a failed resurrection and SHALL NOT report a byte comparison of the report as a pass or a failure (U2).
6. IF the Tool_Versions are equal, THEN THE Nightly_Workflow SHALL perform the Replay with the committed Seed, case count and radius, and SHALL compare the canonical JSON of the new Proof_Report with the committed `proof-report.json` byte for byte.
7. IF the two reports differ while the Tool_Versions are equal, THEN THE Nightly_Workflow SHALL record the Nightly_Result `replay-mismatch`, SHALL include the first differing path of the two reports in the nightly report, and SHALL fail the workflow run.
8. THE Replay SHALL fetch the Original from the npm registry and verify it against the Integrity_Hash recorded in the committed report, and IF the fetch fails or the digest differs, THEN THE Nightly_Workflow SHALL record the Nightly_Result `not-checked` with the reason for that entry.
9. FOR EACH Graveyard_Entry with the Verdict `alive`, THE Nightly_Workflow SHALL verify exactly three attestations, one each for `resurrection.tgz`, `proof-report.json` and `certificate.json`, with `gh attestation verify` using `--repo`, `--predicate-type` with the Predicate_Type and `--signer-workflow` with the Signer_Workflow, SHALL read the JSON output instead of relying on the exit code alone, and IF the number of verification results is not exactly three THEN THE Nightly_Workflow SHALL record the Nightly_Result `attestation-failed` and SHALL fail the workflow run.
10. THE Nightly_Workflow SHALL require `gh` version 2.67.0 or later and SHALL record the `gh` version in the nightly report.
11. IF an attestation verification fails or its `statement.subject` digest differs from the sha256 of the committed file, THEN THE Nightly_Workflow SHALL record the Nightly_Result `attestation-failed` and SHALL fail the workflow run.
12. FOR EACH Graveyard_Entry with the Verdict `restless` or `inconclusive`, and FOR EACH Not_Resurrected_Entry, THE Nightly_Workflow SHALL verify that no Attestation_Bundle exists in the entry, and IF one exists THEN THE Nightly_Workflow SHALL record the Nightly_Result `unexpected-attestation` and SHALL fail the workflow run.
13. FOR EACH Graveyard_Entry with a certificate, THE Nightly_Workflow SHALL re-run the Coroner and SHALL record the Nightly_Result `new-advisory` with the new identifiers WHEN the Open_Vulnerability list contains an identifier that the committed certificate does not contain, and SHALL NOT fail the workflow run for it.
14. THE Nightly_Workflow SHALL write the nightly report as the job summary and as a workflow artifact, with one line per package that holds the package, the Nightly_Result, the reason where one applies, the committed Tool_Versions and the running Tool_Versions; WHEN the first Nightly_Result of an entry is `verified` and no other reason is given, THE reason SHALL be "Replay identical and attestations verified." for an entry with the Verdict `alive` and "Replay identical; no attestation expected." for an entry with another Verdict. (Amended 2026-11-17 for crypt-ui (user decision): the second text is new; before, both cases had the first text, which is wrong for an entry that has no attestation. The nightly shell chooses the text from the Verdict it reads and passes it as the reason of the entry; the report builder gets no Verdict field. The code and test change is a task of the crypt-ui spec.)
15. THE nightly report SHALL cite for every fact it states about the registry or an advisory its Source_URL and Fetch_Date, and SHALL state no number that the run did not measure.
16. THE Nightly_Workflow SHALL end with success WHEN every Nightly_Result is `verified`, `tool-versions-changed`, `new-advisory`, `not-resurrected` or `not-checked`, and SHALL end with failure WHEN any Nightly_Result is `replay-mismatch`, `attestation-failed` or `unexpected-attestation`.
17. THE Nightly_Workflow SHALL treat the Graveyard_Entry files as data and SHALL run package code only through the Sandbox_Executor of the Proof_Engine.
18. THE pure parts of the nightly decision (classification of one entry into a Nightly_Result from the inputs: version equality, report equality, attestation outcomes, advisory lists) SHALL be a pure function, and a property test SHALL check with at least 100 generated cases that `tool-versions-changed` is the result whenever the Tool_Versions differ, whatever the other inputs are.
19. (optional, first to cut) WHEN the Nightly_Workflow run ends with failure, THE notification job of the Nightly_Workflow SHALL open one issue titled "Nightly re-verification failed", or update that issue WHEN it is already open, with the failing packages, their Nightly_Results and the link to the run, SHALL create no second issue with that title, and SHALL have the permission `issues: write` and no other permission (decision A4, decision A15).
20. (optional, first to cut) THE notification job SHALL run no package code and SHALL read no Medium_Output, and the issue text SHALL contain no credential, no Identity_Value and no absolute local path.
21. THE Nightly_Workflow SHALL NOT deploy to GitHub Pages and SHALL commit nothing, and the deploy of the nightly status to Pages is out of scope of this spec and belongs to spec (c) `crypt-ui` (decision A4).
22. FOR EACH Not_Resurrected_Entry, THE Nightly_Workflow SHALL expect no Proof_Report and no attestation, SHALL perform no Replay and no `gh attestation verify`, SHALL NOT report the missing proof as a failure or as a missing attestation, and SHALL record the Nightly_Result `not-resurrected`, except WHEN criterion 12 or criterion 13 gives `unexpected-attestation` or `new-advisory` for that entry (decision A7 and A8).
23. THE pure classification of criterion 18 SHALL take the entry kind as an input, and a property test SHALL check with at least 100 generated cases that a Not_Resurrected_Entry without an Attestation_Bundle is never classified as `attestation-failed`, `replay-mismatch` or `tool-versions-changed`.
24. WHEN the Graveyard_Directory is missing or contains no directory, and the working directory is the repository root (`.github/workflows/nightly.yml` exists), THE Nightly_Workflow SHALL treat the graveyard as empty: zero entries, counts all 0, exit code 0, the summary line "No entries in the graveyard: nothing to verify." and one `::notice::` line with the same text, and SHALL NOT report a malformed entry and SHALL NOT state "All N entries not-checked". IF the Graveyard_Directory is missing and the working directory is not the repository root, THEN THE Nightly_Workflow SHALL end with failure and a message that names the problem. Anything unreadable inside an existing Graveyard_Directory SHALL still fail the run, and files directly in the Graveyard_Directory are ignored.

### Requirement 17: Predicate type references and documents

**User Story:** As a maintainer, I want the new predicate URI used everywhere it matters, so that verification commands in the docs match what CI signs.

#### Acceptance Criteria

1. THE Pipeline SHALL use the Predicate_Type of the glossary in the Attest_Action step, in every `gh attestation verify` command that the Pipeline prints or documents, and in the Nightly_Workflow.
2. THE README and docs/proof-of-life-ordering.md SHALL contain no reference to `https://graveyard-shift.dev/attestation/spike/v1`, and SHALL NOT be changed to add a new reference to `graveyard-shift.dev`.
3. THE spike files `spikes/attest/README.md`, `spikes/attest/DECISION.md` and `.github/workflows/spike-attest.yml`, and the Journal entries of 2026-11-15, MAY keep the spike URI as a record of the spike.
4. WHEN the Proof_Engine documentation or the proof-of-life-engine spec refers to the predicate type of the attestation, THE reference SHALL name the Predicate_Type of this spec.
5. THE documentation SHALL describe the Signer_Workflow as the path of the CI_Workflow file on `main`, and SHALL give `--signer-workflow` in the form `<owner>/<repo>/.github/workflows/<file>` without a ref, as spike 4 confirmed.

### Requirement 18: Verification instructions

**User Story:** As a stranger who got a Proof of Life, I want exact commands to verify it, so that I do not have to trust the project's pages.

#### Acceptance Criteria

1. THE Pipeline SHALL write, in the pull request body of an `alive` entry, in the README and in the docs, the command `gh attestation verify <file> --repo subair99/graveyard-shift --predicate-type <Predicate_Type> --signer-workflow subair99/graveyard-shift/.github/workflows/<CI_Workflow file> --format json` for each of the three subjects.
2. THE documentation SHALL require `gh` version 2.67.0 or later and SHALL warn that older versions can return exit status 0 when no attestation is present (CVE-2025-25204 as cited in spikes/attest/DECISION.md, to be re-checked before release), and SHALL tell the reader to inspect the JSON output.
3. THE documentation SHALL describe how to re-check the Proof of Life itself: obtain the Original from the registry, check its Integrity_Hash, and run `npm run proof:run` with the committed Resurrection tarball, harness files and the Seed of the report.
4. (optional, first to cut) THE documentation SHALL describe the offline verification with `gh attestation trusted-root`, `--bundle` and `--custom-trusted-root`, and SHALL mark it as not yet verified WHILE no user run has confirmed it (spikes/attest/DECISION.md, "Still to verify").
5. THE verification text SHALL state what a successful verification proves and does not prove (assumption A12).
6. THE verification commands SHALL be tested for their string construction only, with no network call.

### Requirement 19: Demo set

**User Story:** As the project owner, I want the demo set fixed and honest, so that the video and the write-up show real outcomes.

#### Acceptance Criteria

1. THE demo set SHALL contain lodash.set@4.3.2, ip@2.0.1 and inflight@1.0.6, and no other Package (J5, J8).
2. THE demo SHALL show a lodash.set Graveyard_Entry with the Verdict and, only WHEN the CI run produced the Verdict `alive`, its attestation.
3. WHEN the measurement of Requirement 3 leaves at least one delta, THE demo SHALL show an ip Graveyard_Entry with the Verdict that CI produced.
4. WHEN the measurement of Requirement 3 leaves no delta, THE demo SHALL show the ip Death_Certificate and the recorded measurement, and SHALL NOT show an ip resurrection.
5. THE demo SHALL show the Rest_In_Peace_Entry of inflight, produced by the dispatch without a Resurrection_Branch, as "not resurrected" with the Successor `lru-cache`, the reason and its cited sources.
6. THE Pipeline SHALL show a Verdict `restless` or `inconclusive` entry as such WHEN one exists, and SHALL NOT replace it with a later successful run without leaving the earlier entry in git history.
7. THE ip resurrection SHALL keep the export shape of ip@2.0.1 identical (names, functions and `length` of each function), as checked by the API-surface check of the Proof_Engine.
8. WHERE an ip resurrection is attempted, THE Pipeline SHALL attempt it once per user invocation of the Local_Runner.
9. THE safe-eval and node-serialize packages SHALL stay excluded from the Pipeline, and the Pipeline SHALL NOT resurrect any other package of spikes/candidates/SHORTLIST.md in this spec.

### Requirement 20: Documentation consistency

**User Story:** As a reader of the repository, I want the steering files, README and structure notes to say the same true thing about who runs what, so that no document claims an overnight LLM run.

#### Acceptance Criteria

1. THE documentation update of this spec SHALL change `.kiro/steering/product.md`, `README.md`, `.kiro/steering/tech.md` and `.kiro/steering/structure.md` so that each says: the Medium runs on demand on the user's machine; CI re-runs the Coroner and the Gravedigger, runs the Proof of Life, attests only an `alive` Verdict and opens the pull request; the nightly CI job re-verifies every committed result without an LLM and without credits.
2. THE documentation update SHALL replace the wording that Kiro agents "resurrect them overnight" (the opening paragraph of `product.md` and of `README.md`) and the user-flow step "The graveyard shift: Kiro agents (Coroner, Gravedigger, Medium, Undertaker) resurrect the package" with wording that names the Medium as the only Kiro agent and the other three roles as deterministic code.
3. THE documentation update SHALL replace the sentence of `tech.md` "CI does the verification, the Proof of Life, the attestation and the pull request" with a sentence that also states the nightly re-verification and the on-demand Medium.
4. THE documentation update SHALL add the new directories and files of the Pipeline, the workflows, `graveyard/` and `ledger.json` to the layout of `structure.md`, with the one-line description of each, and SHALL update the description of `.github/workflows/ci.yml` to state its added `workflow_dispatch` trigger (Requirement 15.12).
5. THE documentation update SHALL add the new environment, tool and command facts to `tech.md`: `npm run resurrect`, the Pinned_Node_Version, the `gh` version minimum, that the Pipeline uses no new secret, and that the Proof of Life runs only in CI so that local Node versions do not affect reports.
6. THE documentation update SHALL keep the project's Halloween naming in user-facing names and plain wording in code and docs, as the product steering requires.
7. THE documentation update SHALL reconcile docs/demo-packages.md with assumption A9 and with the result of Requirement 3: the functions and inputs of the ip delta, the planned fate of ip, and the figure "verified on" dates, and SHALL cite the measured values from the Journal.
8. THE documentation update SHALL add to the README the statements that the Medium's credit cost is documented only through the user's meter readings in `ledger.json` and that the Credit_Ceiling is a rule and not an enforced limit.
9. THE documentation update SHALL NOT state any credit, time or count figure that the Journal does not record as measured.
10. THE documentation update SHALL be delivered as a task of the task list that edits those four files, and this requirements document SHALL NOT edit them.
11. (optional, first to cut) A documentation test SHALL fail WHEN `README.md`, `product.md`, `tech.md` or `structure.md` contains the phrase "overnight" in a sentence that attributes the resurrection to the Kiro agents, or WHEN `README.md` or `structure.md` lists a Pipeline path that does not exist.
12. THE documentation update SHALL add to the README the statement that the Ledger (`ledger.json`) is committed to `main` by the user and is never pushed by the Push_Script or any workflow (Requirements 6.15 and 7.11).
13. THE documentation update SHALL add to the README and to `structure.md` the Stub_Run, stating that a stub run copies a committed fixture, uses no credit, is labelled "stub run", and is not a Medium-produced resurrection (Requirement 23).

### Requirement 21: Testing and task conventions

**User Story:** As the user, I want to run the heavy and the manual steps myself, so that no agent runs the full suite or spends credits on its own.

#### Acceptance Criteria

1. THE task list of this spec SHALL mark every task that needs network access, kiro-cli, `gh`, GitHub repository settings or a Credit_Meter_Reading as a Manual_Task of the user, with the exact command or setting to use.
2. WHEN a task needs the full test suite, THE task list SHALL state "Ready for you to run:" followed by the exact command, and the agent SHALL stop and wait for the user's pasted output.
3. THE agents that execute the tasks SHALL run only `npm run typecheck`, `npm run lint` and one test file at a time with `npx vitest run <path>`, and SHALL NOT run `npm test`, `npm run test:*` or the full vitest suite.
4. THE tests of this spec SHALL make no network call, with the network guard of `tests/setup/networkGuard.ts` in effect, and SHALL use recorded fixtures or injected fakes for the registry, `gh`, `git` and `kiro-cli`.
5. THE tests of this spec SHALL include the property tests of Requirements 2.9, 4.9, 5.5, 5.9, 7.7, 9.11, 10.9, 11.17 (the publish gate, design property 23), 13.1 (the attest decision, which signs only the Verdict `alive`, with 13.2 and 13.3; design property 22), 13.7, 16.18 and 16.23 (twelve criteria), each with at least 100 generated cases, and SHALL report the failing input in shrunk form and the seed to replay (`FC_SEED`).
6. EVERY test file of this spec SHALL carry a header line `// Requirements: N.M, ...` in the form that `npm run trace` reads, and WHEN a test cites a criterion of another spec THE header SHALL name that spec after a semicolon.
7. THE traceability output SHALL cover this spec as a third section, and SHALL classify each criterion that no automated test covers (for example a criterion that only a Manual_Task verifies) in `docs/traceability-gaps.json`, with the class and the evidence.
8. THE timings recorded in the Journal SHALL come from the user's pasted runs and not from an agent's own runs.
9. THE new tests SHALL belong to existing Vitest projects or to the new projects `pipeline` and `pipeline-integration` defined in `vitest.config.mts`, and the task list SHALL state each project and its target time as a target and not as a measurement.
10. THE Pipeline SHALL be tested for the Windows and WSL conditions of the Local_Runner, using path and process injection in the unit tests, and the WSL run itself SHALL be a Manual_Task.

### Requirement 22: Repository hygiene, licenses and scope

**User Story:** As a maintainer, I want new dependencies, secrets and scope limits handled the same way as in the earlier specs, so that the repository stays clean and MIT-compatible.

#### Acceptance Criteria

1. THE Pipeline SHALL read the GitHub token only from the `GITHUB_TOKEN` environment variable (locally from `.env`, in CI from the workflow token), and SHALL NOT write its value to any file, log line, artifact, pull request, Ledger entry or error message.
2. THE Pipeline SHALL add no new variable to `.env.example` unless a task needs one, and any new variable SHALL be added with an empty value.
3. WHEN the Pipeline adds a third-party library, an action, a tool or a data source, THE repository SHALL list it in `PREEXISTING.md` with its license and source URL, and the list SHALL include at least `actions/attest`, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`, the GitHub CLI, Sigstore as used by GitHub Artifact Attestations, and Kiro CLI as a user-side tool.
4. THE Pipeline SHALL keep its dependencies permissively licensed and MIT-compatible.
5. THE Pipeline SHALL put its source under `src/pipeline/`, its scripts under `scripts/`, its tests under `tests/pipeline/` and its Graveyard_Entries under `graveyard/`, and SHALL keep the Medium agent definition and the MCP server for spec (b).
6. THE Pipeline SHALL NOT publish to npm, SHALL NOT create a stub for publishing, and SHALL NOT use the `@graveyard-shift` npm organization except for the `name` field check of Requirement 10.5 (J9).
7. THE Pipeline SHALL NOT implement the dependency root extension of the proof-of-life-engine spec, ESM support, packages that need network access, or a Medium run in CI.
8. THE Pipeline SHALL show every fact in a Graveyard_Entry or report with its Source_URL and Fetch_Date, and SHALL NOT state a number, metric or result that was not measured and logged in the Journal.
9. THE Pipeline SHALL show a failed resurrection as Restless and SHALL NOT hide it (honesty rules).
10. THE Pipeline SHALL NOT change the public API (names, signatures, return shapes) of a resurrected package, SHALL preserve the original license and author credits in every Resurrection, and SHALL treat a Resurrection as a patch or minor release (necromancy laws).
11. IF the specification of a delta is ambiguous or a property cannot be stated, THEN THE Pipeline task SHALL stop and ask the human instead of guessing (necromancy laws).

### Requirement 23: Zero-credit stub run

**User Story:** As the user, I want to test push, CI, proof, attestation and pull request end to end with a committed fixture, so that I can check the hand-off before spec (b) exists and without spending credits.

#### Acceptance Criteria

1. WHEN `npm run resurrect -- <package> --stub <fixture-dir>` is run, THE Local_Runner SHALL run the Coroner and the Gravedigger as in Requirement 6.3, and SHALL start the Medium only for a run without `--stub`.
2. WHEN the Eligibility_Record has `eligible` true in a Stub_Run, THE Local_Runner SHALL copy the Stub_Fixture directory as-is as the Medium_Output (`resurrection/`, `deltas.json` and `harness.json`, with no rename, no edit and no regeneration; decision A16), SHALL run no kiro-cli process, and SHALL continue as for a Medium run: the Intake_Validator (Requirement 6.8), then the Push_Script (Requirement 6.10).
3. IF the `--stub` argument is missing, is not a directory under `tests/pipeline/fixtures/` or `tests/proof/fixtures/`, or names an absolute path or a path with a `..` segment, THEN THE Local_Runner SHALL write a usage message to standard error, copy nothing, write no Ledger entry, and exit with code 64.
4. WHEN a Stub_Run writes its Ledger entry, THE Local_Runner SHALL mark the entry with `mode` `stub`, SHALL record the package name, the exact version, the date in UTC ISO 8601 format and the Stub_Fixture path relative to the repository root, SHALL ask for no Credit_Meter_Reading, and SHALL record no reading, no exit code and no kiro-cli version.
5. THE Local_Runner SHALL NOT use, ask for or print any credit figure in a Stub_Run, except the statement that a Stub_Run uses no credit.
6. WHEN the Push_Script is called for a Stub_Run, THE Push_Script SHALL pass the extra dispatch input `medium_mode` with the value `stub` to the CI_Workflow, and SHALL pass the value `local` for a Medium run.
7. THE CI_Workflow SHALL validate `medium_mode` as `local` or `stub` with the input checks of Requirement 9.1, and SHALL treat the value as a declared label that it does not verify (Requirement 13.11).
8. THE CI_Workflow SHALL treat the Medium_Output of a Stub_Run as untrusted branch content, and SHALL apply to it the same Intake_Validator, necromancy gate, `checks` job, `prove` job and verdict gate as to a Medium run, with no relaxed rule.
9. WHEN the Verdict of a Stub_Run is `alive`, THE `attest` job SHALL attest it as in Requirement 13, and THE Resurrection_Predicate SHALL record `medium.mode` `stub`.
10. THE Resurrection_Predicate parser of Requirement 13.7 SHALL accept exactly the `medium.mode` values `local` and `stub`, and SHALL reject any other value with an error that names the field.
11. THE `publish` job SHALL add the Stub_Marker `stub-run.json` to the Graveyard_Entry of a Stub_Run, whatever the Verdict is (decision A16), and a Graveyard_Entry of a run with `medium_mode` `local` SHALL contain no Stub_Marker.
12. THE pull request title of a Stub_Run SHALL end with the words "stub run", and the first line of the pull request body SHALL state that the run is a stub run produced from a committed fixture and not by the Medium.
13. THE Pipeline SHALL NOT present a Stub_Run as a Medium-produced resurrection in the pull request, the README, the docs or the UI of spec (c), and SHALL show the entry with the label "stub run" wherever it shows the Verdict of a Graveyard_Entry that has a Stub_Marker.
14. THE Nightly_Workflow SHALL verify a Graveyard_Entry with a Stub_Marker with the same checks as any other entry, and SHALL write the words "stub run" on its line of the nightly report.
15. THE demo set of Requirement 19 SHALL NOT count a Stub_Run entry as the lodash.set resurrection of the demo, and the demo lodash.set entry SHALL come from a Medium run, which replaces the stub entry through Requirement 14.7.
16. THE first end-to-end task of the task list SHALL use a Stub_Run for lodash.set with the Stub_Fixture `tests/pipeline/fixtures/stub/lodash.set/`, to test the push, CI, proof, attestation and pull request path before spec (b) exists, and SHALL be a Manual_Task, placed after the ip measurement task of Requirement 3.1.
17. THE pure parts of the Stub_Run (argument check, fixture copy plan, Ledger entry building, `medium_mode` validation and Stub_Marker building) SHALL be tested with injected fakes and no network.

18. THE repository SHALL contain the Stub_Fixture `tests/pipeline/fixtures/stub/lodash.set/`, which contains exactly `resurrection/`, `deltas.json` and `harness.json`, mirroring the Medium_Output; `resurrection/` SHALL be a copy of `tests/proof/fixtures/lodash.set-alive` whose `package.json` has the `name` `@graveyard-shift/lodash.set` and a `version` one patch above the version of the Original (lodash.set@4.3.2, so 4.3.3), and whose license file and author credits (`author` and `contributors`) are unchanged from the Original.
19. THE `deltas.json` and `harness.json` at the root of the Stub_Fixture directory SHALL be the committed Deltas_File and Harness_File of lodash.set, and these two files SHALL be the same bytes that the lodash.set Graveyard_Entry is built from.
20. A test SHALL check that the Stub_Fixture `resurrection/package.json`, the license text of `resurrection/` and the Original `package.json` pass the necromancy checks of Requirement 10.1 to 10.6, that the Stub_Fixture directory contains exactly the three entries `resurrection/`, `deltas.json` and `harness.json`, and that the Intake_Validator accepts the Stub_Fixture directory as a Medium_Output without any path change.
21. THE Stub_Fixture SHALL be a separate copy, and THE Pipeline SHALL NOT edit any file under `tests/proof/fixtures/lodash.set-alive` and SHALL NOT use that directory as the `--stub` value for the lodash.set stub.
22. THE repository SHALL contain the test fixture `tests/proof/fixtures/ip-alive/`, a copy of ip@2.0.1 from the recorded tarball with the smallest change to `isPublic` (and only the code `isPublic` needs) so that `isPublic` returns false for the five Advisory_Addresses and, because the fix canonicalizes the address, for every address of the Input_Class `non-public-address` (decision A18), with `version` `2.0.2` and the license and author credits unchanged; its README SHALL state that it is a hand-written development fixture, not Medium output and not a demo entry; its bytes SHALL be pinned in `tests/proof/unit/fixtureIntegrity.test.ts`.
23. A unit test SHALL check that `ip-alive` differs from the Original only in the `version` of `package.json` and in the `isPublic`-related code (the file list and the bytes of every file other than `package.json` and the file holding `isPublic` are equal; for `package.json` every field other than `version` is equal; the differing lines of the `isPublic` file are limited to the lines of the `isPublic` fix, named in the test).
24. WHEN the compiled ip Preset and the ip Deltas_File run through the real Sandbox_Executor with the Original and `ip-alive`, THE Proof_Engine SHALL give the Verdict `alive`, with the `isPublic` delta demonstrated, every Divergence inside the declared class `non-public-address` and equal to the expected value, every export covered and no `missing-generator`; WHEN the Original runs against itself, THE Verdict SHALL NOT be `alive` and the delta SHALL NOT be demonstrated.
25. THE repository SHALL contain the Stub_Fixture `tests/pipeline/fixtures/stub/ip/`, which contains exactly `resurrection/` (`ip-alive` with the `name` `@graveyard-shift/ip` and the `version` `2.0.2`), `deltas.json` and `harness.json` (the same canonical bytes as the ip Deltas_File and Harness_File of tasks 12.3 and 12.12, copied again by task 12.14), and THE Pipeline SHALL NOT use `tests/proof/fixtures/ip-alive` directly as the `--stub` value.
26. A test SHALL check that the ip Stub_Fixture passes the necromancy checks of Requirement 10.1 to 10.6 against the recorded ip@2.0.1 `package.json` and license, that the Intake_Validator accepts it, and that its files compile against the ip Death_Certificate.
27. THE ip stub run SHALL be a Manual_Task placed after the ip fixture tasks, SHALL use `npm run resurrect -- ip --stub tests/pipeline/fixtures/stub/ip`, SHALL verify the pull request and the three attestations with `gh attestation verify`, and SHALL end with the pull request closed and the branches deleted, so that no ip stub entry reaches `main`.
