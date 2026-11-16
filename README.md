# Graveyard Shift

**Dead code, raised on demand, with proof you can verify.**

Graveyard Shift finds the abandoned npm packages holding up your app, issues each a cited
Death Certificate, then resurrects them on demand: forked, modernized, CVE-patched, and proven
identical to the original via differential property-based testing, with a signed Proof of Life.
The Medium is the only Kiro agent and runs on the user's machine. The Coroner, the Gravedigger
and the Undertaker are deterministic code. CI re-runs the Coroner and the Gravedigger, runs the
Proof of Life, attests only an `alive` verdict and opens the pull request. A nightly CI job
re-verifies every committed result without an LLM and without credits.

Built for **Kiroween 2026** · Category: **Resurrection**

- Live demo: _coming soon_
- Demo video: _coming soon_

## How it works
1. **Exhume**: paste a public repo URL or lockfile (no login).
2. **The Crypt**: see which dependencies are dead, with every fact cited to its source.
3. **Death Certificate**: cause and time of death, plus the exact functions your code uses.
4. **The graveyard shift**: the Medium (the only Kiro agent) writes the resurrection on the user's machine, on demand. The Coroner, the Gravedigger and the Undertaker are deterministic code: CI re-runs the Coroner and the Gravedigger, runs the Proof of Life, attests only an `alive` verdict and opens the pull request. A nightly CI job (no LLM, no credits) re-verifies every committed result.
5. **Proof of Life**: a pull request with differential test results and a verifiable signature.

## Quick start
Requires Node.js LTS and npm.

```
npm install
npm run dev     # http://localhost:3000
npm run build
npm run typecheck
npm run lint
npm test        # vitest, all six projects; set FC_SEED to replay a property-test seed
```

### Test projects
Vitest runs six projects (`vitest.config.mts`). Select one with `npx vitest run --project <name>`.

| Project | Files | Wall-clock target |
|---|---|---|
| `engine` | `tests/engine` | none |
| `proof-property` | `tests/proof/property` and `tests/proof/unit`, except the three files of `proof-heavy` | 60 s |
| `proof-heavy` | `p24-same-seed-same-bytes`, `p26-injected-changes`, `p26b-declared-delta` in `tests/proof/property` (100 engine runs each; they were close to the `proof-property` target) | 90 s |
| `proof-integration` | `tests/proof/integration` (real sandbox child processes) | 120 s |
| `pipeline` | `tests/pipeline`, except `tests/pipeline/integration` | 90 s (target) |
| `pipeline-integration` | `tests/pipeline/integration` (real sandbox child processes, a real local git repository) | 120 s (target) |

The table numbers (including the `proof-property`, `pipeline` and `pipeline-integration` rows) are targets, not measurements. Projects run in parallel, so a reporter (`tests/proof/helpers/budgetReporter.ts`) checks each project that ran against its own target, using its **span**: the time from its first test file starting to its last test file ending. Each project prints three lines starting `[budget] <project>:`: the span (checked), the sum of the file durations (information only: files run in parallel, so the sum can exceed the span) and the whole-run wall-clock (information only: an upper bound for the project). If the span cannot be measured, the check falls back to the whole-run wall-clock and the line says "span unavailable". A strict overrun fails the run. `PROOF_BUDGET_MODE=warn` downgrades that to a warning and `PROOF_LOG_TIMINGS=1` appends the checked value to [docs/kiro-journal.md](docs/kiro-journal.md). `PROOF_BUDGET_SCALE=<number>` (test aid only, never set in CI) multiplies every target (60 / 90 / 120 s) by a positive number, default 1, so a strict overrun (exit code 1) and a warn-mode overrun can be confirmed on one fast file; a value that is not a finite number > 0 fails the run with exit code 1 whatever the mode, and a scale other than 1 never writes the journal. The numbers a run prints are measurements of that run; measured timings recorded here come only from runs the user made, in that journal.

Copy `.env.example` to `.env` and fill in `GITHUB_TOKEN`.

### Running the Medium in WSL
- Git and `gh` are set up separately from Windows: use a separate clone at `~/graveyard-shift`, install `gh` from GitHub's apt repository, and set the GitHub no-reply commit email in WSL git too.
- Never run `npm ci` or `npm install` in WSL inside `/mnt/c`.
- A stub run (and any `npm run resurrect`) leaves `resurrection/`, `deltas.json`, `harness.json` and `.graveyard-work/` in the clone root. Remove them before the next run: the Local_Runner refuses to start when they exist.
- `ledger.json` is committed by the user.

## Resurrecting a package
Who runs what: the Medium (Kiro CLI) runs on demand on the user's machine, in the WSL clone. CI does the rest, in `.github/workflows/resurrect.yml`: it re-runs the Coroner and the Gravedigger, runs the Proof of Life (only in CI, on Node `26.13.1`, the `PINNED_NODE_VERSION` of `src/pipeline/common/constants.ts`), attests only an `alive` verdict and opens a pull request. Nothing is merged automatically. `nightly.yml` re-verifies every committed entry without an LLM and without credits.

```
npm run resurrect -- <package>                                   # the Medium; asks for the credit meter readings
npm run resurrect -- lodash.set --stub tests/pipeline/fixtures/stub/lodash.set   # a stub run, no credit
npx tsx scripts/push-resurrection.ts <package> <version> [--stub]  # push resurrect/<package> and dispatch resurrect.yml
npm run measure:ip                                               # ip@2.0.1 measurement, writes docs/measurements/ip-2.0.1.json
```

### The stub run
A stub run copies a committed fixture (`tests/pipeline/fixtures/stub/<package>/`) instead of calling the Medium. It uses no credit, the pull request title and body are labelled "stub run", the entry carries `stub-run.json`, and it is not a Medium-produced resurrection. It exists to test the hand-off (push, CI, proof, attestation, pull request) end to end. Closing a stub pull request leaves a red CI run with no jobs ("workflow file issue", `jobs: []`) on its publish branch. This is expected (A5): it is the `ci.yml` run of the `pull_request` event that was waiting for approval (`action_required`) and ended when the pull request was closed (user-run observations, `docs/kiro-journal.md`, 2026-11-16).

### What a Graveyard entry holds
`graveyard/<package>/` has one of two kinds:
- `resurrection`: `certificate.json`, `eligibility.json`, `deltas.json`, `harness.json`, `resurrection.tgz` and `proof-report.json`. Only an `alive` verdict also has the three bundles `resurrection.tgz.sigstore.json`, `proof-report.json.sigstore.json` and `certificate.json.sigstore.json`. A `restless` or `inconclusive` verdict is shown as such and is never attested. A stub run adds `stub-run.json`.
- `not-resurrected`: `certificate.json` and `eligibility.json` only.

`graveyard/inflight` is the first real Crypt entry: inflight 1.0.6, pull request #6, merged (user-run, see `docs/kiro-journal.md`, 2026-11-16). "Not resurrected" means that the entry holds only the Coroner's certificate and the Gravedigger's eligibility record. There is no resurrection, no proof and no attestation. The entry is shown with the failed rules and their sources (Source_URL and Fetch_Date, or a statement that no source was recorded).

### Verifying an `alive` entry
You need the GitHub CLI `gh` 2.67.0 or later (`GH_MIN_VERSION`). Older versions can return exit status 0 when no attestation is present (CVE-2025-25204, as cited in `spikes/attest/DECISION.md`; to be re-checked before release). So read the JSON, not only the exit status.

Run one command per subject, in the entry directory (the commands are built by `verifyCommands`, `src/pipeline/undertaker/core/verifyCommands.ts`, the same text as in the pull request body and in the nightly):

```
gh attestation verify resurrection.tgz --repo subair99/graveyard-shift --predicate-type https://github.com/subair99/graveyard-shift/attestation/resurrection/v1 --signer-workflow subair99/graveyard-shift/.github/workflows/resurrect.yml --format json
gh attestation verify proof-report.json --repo subair99/graveyard-shift --predicate-type https://github.com/subair99/graveyard-shift/attestation/resurrection/v1 --signer-workflow subair99/graveyard-shift/.github/workflows/resurrect.yml --format json
gh attestation verify certificate.json --repo subair99/graveyard-shift --predicate-type https://github.com/subair99/graveyard-shift/attestation/resurrection/v1 --signer-workflow subair99/graveyard-shift/.github/workflows/resurrect.yml --format json
```

`--signer-workflow` is the path of the workflow file on `main`, without a ref. In the JSON, compare `statement.subject[].digest.sha256` with the sha256 of the file you hold; the nightly does the same comparison. Only the `gh attestation verify` successes are verified so far: on 2026-11-16 the user's stub runs (the lodash.set run and the ip run 43874004948) verified all three files, each signed by `.github/workflows/resurrect.yml@refs/heads/main`. The JSON field names above come from the spike notes (`spikes/attest/DECISION.md`) and the nightly parser. They are not yet confirmed by a nightly run on an `alive` entry, because no `alive` entry is on `main`, and the exit code of a failing verification has not been observed.

What a successful verification proves: that a workflow run of this repository signed these digests. It does not prove that the content of the proof report is true, that the resurrected package is safe, or that its tests were sufficient. Read the resurrected package's code in the pull request before merging.

To re-check the Proof of Life itself, fetch the Original from the npm registry, check its Integrity_Hash against `proof-report.json`, and run `npm run proof:run` with the committed `resurrection.tgz`, the harness files and the seed of the report. The nightly does this replay (`src/pipeline/undertaker/shell/replay.ts`).

### Ledger and credits
`ledger.json` holds the user's credit meter readings before and after each Medium run. It is the only record of the Medium's credit cost; no figure is stated here. It is committed to `main` by the user, from the WSL clone. No script and no workflow pushes it (the Push_Script and the workflows never do). The Credit_Ceiling of 150 credits is a rule the user follows, not a limit that the Local_Runner enforces.

## Recording fixtures
The engine's fixture tests replay recorded upstream responses from `tests/engine/fixtures/`.
Recording is a manual step: it calls the live npm, OSV, deps.dev and GitHub APIs, so it needs
network and `GITHUB_TOKEN` in `.env` (it also runs unauthenticated, with a low GitHub rate limit).

```
npm run fixtures:record              # records ip@2.0.1, lodash.set@4.3.2, inflight@1.0.6
npm run fixtures:record -- --force   # overwrite existing fixtures
npm run fixtures:record -- --dry-run # no network, prints the plan
```

Fixture files hold only `{ cacheKey, sourceUrl, body, status, fetchedAt }`. The script aborts
without writing if any file would contain the token, `Authorization` or `Bearer`. The fixture
tests (9.3 to 9.5) use only the recorded files and make no network calls. The fixtures are
committed, so there is nothing to run for a normal checkout. Re-run the script (with `--force`
to overwrite) only to refresh them. The files contain no credentials, which
`tests/engine/unit/fixtureSecrets.test.ts` checks.

## Recording the lodash.set tarball
The proof engine tests use the lodash.set@4.3.2 tarball as the Original. Recording it is a manual
step that needs network (npm registry only, no credentials):

```
npm run fixtures:record-tarball              # download, verify, write
npm run fixtures:record-tarball -- --force   # overwrite existing files
npm run fixtures:record-tarball -- --dry-run # no network, prints the plan
```

It takes the tarball URL and `dist.integrity` from the recorded packument
`tests/engine/fixtures/lodash.set/npm-449996e32bd2.json`, downloads only from
`https://registry.npmjs.org/` (redirects are refused) and verifies the bytes against that
integrity before writing anything. On a mismatch nothing is written. It writes
`tests/proof/fixtures/lodash.set/lodash.set-4.3.2.tgz` and `lodash.set-4.3.2.meta.json` (name,
version, tarball URL, integrity, source URL, fetch date, license, author credits).

## Running a Proof of Life

`npm run proof:run` compares an Original tarball with a Resurrection (a directory or a tarball)
using a harness, and prints the canonical report JSON on standard output (or writes it to `--out`).
The CLI writes only the final report to standard output (or to `--out`). Every log line, the one-line verdict and every error go to standard error through `emit`. `src/proof/cli.ts` is the only file allowed to write to standard output, and only the final report; this is the documented exception (`CLI_EXCEPTION` in `tests/proof/unit/sourceScan.test.ts`) to the single-output rule. The CLI needs no network and reads no secrets.

```
npm run proof:run -- --meta tests/proof/fixtures/lodash.set/lodash.set-4.3.2.meta.json \
  --original tests/proof/fixtures/lodash.set/lodash.set-4.3.2.tgz \
  --resurrection tests/proof/fixtures/lodash.set-alive \
  --harness lodash.set --out proof-report.json
```

Options: `--original <tgz>`, `--meta <file>` or `--integrity <sha512-SRI> --version <v> [--name <n>]`,
`--resurrection <dir|tgz>`, `--harness <name|path>`, `--seed <int>`, `--cases <n>`,
`--radius <fn,fn>`, `--out <file>`, `--timeout <ms>`. Exit codes: 0 alive, 1 restless,
2 inconclusive, 64 usage error. To add a harness, export a `HarnessConfig` from a module
(`harness` or default export) and pass its path to `--harness`, or register it in
`BUILT_IN_HARNESSES` in `src/proof/cli.ts`.

### Function names in the report
Functions are named by their export key. A package whose `module.exports` is itself a function (such as `lodash.set`) is tested under the name `default`, and its harness keys and `--radius default` use that name. The function's own `name` is not used because it is unreliable for minified, anonymous or re-assigned functions.

### Sandbox
Each side (Original and Resurrection) runs in a child process under Node's permission model: exact read grants, no network, no child processes, scrubbed environment.

## Known limitations
**Resurrection pipeline.** The proof runs the package's code on a GitHub runner inside a Node sandbox. That sandbox guards against accidents. It is not a security boundary against code that is written to break out. If a resurrected package did break out, it could write a false proof report that says "alive", and our signing step would sign it, because the signing step checks that the report refers to the right files but cannot re-check the verdict. The proof job has no permission to write to the repository or to sign anything, and a different job does the signing, but that does not stop a forged report. The nightly check runs the proof again on a fresh runner. It catches changed tools, flaky behavior and reports edited after the fact. It does not catch a package that forges the same report every time, because the same code runs again, and it finds problems after a pull request is merged, not before. A signature means that this repository's workflow signed those files. It does not mean the claims inside are true. Before merging, read the resurrected package's code in the pull request. Packages with no generator for one of their functions get the verdict "inconclusive" and are never signed.

**Other limits.**
- The nightly's use of `gh attestation verify` with the `contents: read` and `attestations: read` permissions of its job is not yet confirmed by a run on an `alive` entry (the only entry on `main` so far is not resurrected).
- The sandbox is a seat belt against accidental access, not a security boundary against malicious code (Node's permission model). Do not run a package you do not trust.
- ES module syntax in a package without a `type` field still loads through `require` and is not detected, and ESM is not supported (L12). A package with `"type": "module"` is rejected as `unloadable-module` before any child starts.
- An unbounded `.filter` in a harness arbitrary hangs the run and cannot be detected by the engine (L13). Use `accept` or `fc.pre` with a skip budget, and constructive generators.
- The user's home directory and name are replaced in the report after the comparison (`<user-home>`, `<user>`). A bare short or generic user name outside a path context is not redacted; home paths and the name as a path segment are (L14).
- Reference identity is not compared: two values that differ only in which slots share one object compare as equal (L1).
- Verified: the other-drive case (checkout and temp on different drives) is exercised in CI on the GitHub Windows runner (CI runs 1 and 2, recorded in `docs/kiro-journal.md`). It is not verified on the author's own machine, which has drive `C:` only.
- A report is withheld as `identity-leak` only when the backstop still finds an identity value after redaction (D10). An identity key collision gives the fallback report without Divergences (D11).
## How Kiro is used
See [`.kiro/`](.kiro/) for specs, steering, hooks and agents. A full write-up will follow.

## Data sources
npm registry · OSV · deps.dev · GitHub REST API

## Pre-existing work
See [PREEXISTING.md](PREEXISTING.md).

## License
MIT