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
npm test        # vitest; set FC_SEED to replay a property-test seed
```

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

## How Kiro is used
See [`.kiro/`](.kiro/) for specs, steering, hooks and agents. A full write-up will follow.

## Data sources
npm registry · OSV · deps.dev · GitHub REST API

## Pre-existing work
See [PREEXISTING.md](PREEXISTING.md).

## License
MIT