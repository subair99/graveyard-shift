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
4. **The graveyard shift**: Kiro agents (Coroner, Gravedigger, Medium, Undertaker) resurrect the package overnight.
5. **Proof of Life**: a pull request with differential test results and a verifiable signature.

## Quick start
Requires Node.js LTS and npm.

```
npm install
npm run dev     # http://localhost:3000
npm run build
npm run typecheck
npm run lint
npm test        # vitest, all three projects; set FC_SEED to replay a property-test seed
```

### Test projects
Vitest runs three projects (`vitest.config.mts`). Select one with `npx vitest run --project <name>`.

| Project | Files | Wall-clock target |
|---|---|---|
| `engine` | `tests/engine` | none |
| `proof-property` | `tests/proof/property`, `tests/proof/unit` | 60 s |
| `proof-integration` | `tests/proof/integration` (real sandbox child processes) | 120 s |

The numbers are targets, not measurements. A global setup prints each project's wall-clock and fails the run when a target is exceeded. `PROOF_BUDGET_MODE=warn` downgrades that to a warning and `PROOF_LOG_TIMINGS=1` appends the measured value to [docs/kiro-journal.md](docs/kiro-journal.md). Measured timings appear only in that journal, from runs the user made.

Copy `.env.example` to `.env` and fill in `GITHUB_TOKEN` (and `KIRO_API_KEY` for resurrections).

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
Each side (Original and Resurrection) runs in a child process under Node's permission model: exact read grants, no network, no child processes, scrubbed environment. This is a seat belt against accidental access, not a security boundary against malicious code. Do not run a package you do not trust.

### Known gaps
- ES module syntax in a package without a `type` field is not detected, and ESM is not supported (L12). Only `"type": "module"` is reported as `unloadable-module`.
- An unbounded `.filter` in a generator cannot be detected and hangs a run (L13). Harness authors must use constructive generators.
- The user's home directory and name are replaced in the report after the comparison (`<user-home>`, `<user>`). A bare short or generic user name outside a path is not matched (L14).
- A report is withheld as `identity-leak` only when the backstop still finds an identity value after redaction (D10). An identity key collision gives the fallback report without Divergences (D11).

## How Kiro is used
See [`.kiro/`](.kiro/) for specs, steering, hooks and agents. A full write-up will follow.

## Data sources
npm registry · OSV · deps.dev · GitHub REST API

## Pre-existing work
See [PREEXISTING.md](PREEXISTING.md).

## License
MIT