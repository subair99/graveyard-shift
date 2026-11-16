# Graveyard Shift

**Dead code, raised overnight, with proof you can verify.**

Graveyard Shift finds the abandoned npm packages holding up your app, issues each a cited
Death Certificate, then Kiro agents resurrect them overnight: forked, modernized, CVE-patched,
and proven identical to the original via differential property-based testing, with a signed
Proof of Life.

Built for **Kiroween 2026** · Category: **Resurrection**

- Live demo: _coming soon_
- Demo video: _coming soon_

## How it works
1. **Exhume**: paste a public repo URL or lockfile (no login).
2. **The Crypt**: see which dependencies are dead, with every fact cited to its source.
3. **Death Certificate**: cause and time of death, plus the exact functions your code uses.
4. **The graveyard shift**: Kiro agents (Coroner, Gravedigger, Medium, Undertaker) resurrect the package. The Medium runs locally on demand; CI re-runs the Coroner and Gravedigger and does the Proof of Life, the attestation and the pull request. A nightly CI job re-verifies every committed resurrection.
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
| `pipeline` | `tests/pipeline`, except `tests/pipeline/integration` | 90 s |
| `pipeline-integration` | `tests/pipeline/integration` (real sandbox child processes, a real local git repository) | 120 s |

The table numbers are targets, not measurements. Projects run in parallel, so a reporter (`tests/proof/helpers/budgetReporter.ts`) checks each project that ran against its own target, using its **span**: the time from its first test file starting to its last test file ending. Each project prints three lines starting `[budget] <project>:`: the span (checked), the sum of the file durations (information only: files run in parallel, so the sum can exceed the span) and the whole-run wall-clock (information only: an upper bound for the project). If the span cannot be measured, the check falls back to the whole-run wall-clock and the line says "span unavailable". A strict overrun fails the run. `PROOF_BUDGET_MODE=warn` downgrades that to a warning and `PROOF_LOG_TIMINGS=1` appends the checked value to [docs/kiro-journal.md](docs/kiro-journal.md). `PROOF_BUDGET_SCALE=<number>` (test aid only, never set in CI) multiplies every target (60 / 90 / 120 s) by a positive number, default 1, so a strict overrun (exit code 1) and a warn-mode overrun can be confirmed on one fast file; a value that is not a finite number > 0 fails the run with exit code 1 whatever the mode, and a scale other than 1 never writes the journal. The numbers a run prints are measurements of that run; measured timings recorded here come only from runs the user made, in that journal.

Copy `.env.example` to `.env` and fill in `GITHUB_TOKEN`.

### Running the Medium in WSL
- Git and `gh` are set up separately from Windows: use a separate clone at `~/graveyard-shift`, install `gh` from GitHub's apt repository, and set the GitHub no-reply commit email in WSL git too.
- Never run `npm ci` or `npm install` in WSL inside `/mnt/c`.
- A stub run (and any `npm run resurrect`) leaves `resurrection/`, `deltas.json`, `harness.json` and `.graveyard-work/` in the clone root. Remove them before the next run: the Local_Runner refuses to start when they exist.
- `ledger.json` is committed by the user.

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