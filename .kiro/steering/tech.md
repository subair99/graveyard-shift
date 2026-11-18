# Tech

## Stack (decided)
- Next.js + TypeScript (strict mode) for the web app ("The Crypt") and API routes.
- Node.js LTS; npm as package manager.
- fast-check for property-based and differential testing.
- ts-morph for static analysis (Haunting Radius).
- `tar` reads package tarballs in the proof engine (only `src/proof/shell/tarball/tarballExtractor.ts` imports it).
- The autopsy engine is deterministic: no LLM calls. Facts come only from the npm registry, OSV, deps.dev and the GitHub REST API, each stored with its source URL and fetch date.
- The Medium runs on demand on the user's machine (Kiro CLI in WSL). CI re-runs the Coroner and the Gravedigger, runs the Proof of Life, attests only an `alive` verdict (GitHub Artifact Attestations) and opens the pull request. A nightly CI job (`nightly.yml`) re-verifies every committed result without an LLM and without credits.
- The Proof of Life runs only in CI, so local Node versions do not affect reports. CI uses the pinned Node version `PINNED_NODE_VERSION` (`src/pipeline/common/constants.ts`, currently `26.13.1`). The Pipeline needs `gh` 2.67.0 or later (`GH_MIN_VERSION`) and uses no new secret.

## Known external dependencies
- Data sources: npm registry, OSV, deps.dev, GitHub REST API.
- Target ecosystem: npm packages and lockfiles.
- Testing approach: differential property-based testing, comparing the resurrected package against the original.
- Output: signed, verifiable Proof of Life attached to a pull request.

## Configuration
- Secrets live in `.env` (gitignored). Variables are documented in `.env.example`: `GITHUB_TOKEN`.
- Never commit, log, or print secret values. Add any new variable to `.env.example` with an empty value.

## Commands
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build` (`next build && tsx scripts/ui/copyEntryFiles.ts`): a static export (`output: "export"`, base path `/graveyard-shift`) into `out/`, then the Entry_File_Copy. Set `NEXT_TELEMETRY_DISABLED=1` in CI (`pages.yml` and the `site` job of `ci.yml` do). Check the result with `node scripts/ui/checkSite.mjs`.
- Start: `npm run start` does not serve the site: it runs `scripts/ui/startNotice.mjs`, prints a notice and exits 1. For development use `npm run dev` (http://localhost:3000/graveyard-shift/). To preview a build, run `npm run build`, then serve the directory `out/` under the path `/graveyard-shift/` with any static file server.
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Test: `npm test` (vitest --run; tests in `tests/**/*.test.ts`; set `FC_SEED` to replay a fast-check seed). Tests are run by the user, not by agents; see `testing-workflow.md`. Agents may run typecheck, lint and one test file at a time.
- One vitest project: `npx vitest run --project engine` (or `proof-property`, `proof-heavy`, `proof-integration`, `pipeline`, `pipeline-integration`, `ui`). Projects are defined in `vitest.config.mts`: `engine` (`tests/engine`), `proof-property` (`tests/proof/property` and `tests/proof/unit`, minus the three files of `proof-heavy`, target 60 s), `proof-heavy` (`p24-same-seed-same-bytes`, `p26-injected-changes`, `p26b-declared-delta`, target 90 s), `proof-integration` (`tests/proof/integration`, target 120 s), `pipeline` (`tests/pipeline` and `tests/medium`, minus the two integration directories, target 90 s), `pipeline-integration` (`tests/pipeline/integration` and `tests/medium/integration`, target 120 s), `ui` (`tests/ui`, target 60 s). Targets are targets, not measurements.
- Proof of Life run: `npm run proof:run -- <options>` (`tsx src/proof/cli.ts`; exit codes 0 alive, 1 restless, 2 inconclusive, 64 usage error)
- Resurrect (Local_Runner, runs the Medium or a stub): `npm run resurrect -- <package> [--stub <fixture-dir>]` (`tsx scripts/resurrect.ts`); the push and the workflow dispatch are done by `scripts/push-resurrection.ts`. A stub run uses no credit.
- Measure ip: `npm run measure:ip` (`tsx scripts/measureIp.ts`; needs the recorded ip tarball); the result is `docs/measurements/ip-2.0.1.json`.
- Record the lodash.set tarball: `npm run fixtures:record-tarball` (manual; needs network, no credentials)
- Record engine fixtures: `npm run fixtures:record` (manual; needs network)
- Requirement trace: `npm run trace` (`tsx scripts/trace.ts`; not a test; reads test headers and the spec, writes `docs/traceability.md`; every `tests/proof/**/*.test.ts` carries a `// Requirements: N.M, ...` header line; `; <spec-name> N.M, ...` after it cites another spec)

## Test environment variables
Not secrets and not in `.env.example`; set them in the shell for a run.
- `PROOF_BUDGET_MODE=warn`: a proof project whose span (first test file start to last test file end) exceeds its target prints a warning instead of failing the run.
- `PROOF_BUDGET_SCALE=<number>` (test aid only, never set in CI) multiplies every target (60 / 90 / 120 s) by a positive number, default 1, so a strict overrun (exit code 1) and a warn-mode overrun can be confirmed on one fast file; a value that is not a finite number > 0 fails the run with exit code 1 whatever the mode, and a scale other than 1 never writes the journal.
- `PROOF_LOG_TIMINGS=1`: appends the checked time (span) of each proof project to `docs/kiro-journal.md`.
- `PROOF_TEST_OTHER_DRIVE`: optional writable directory on another drive, read only by `scripts/spike/otherDrive.ts` (no vitest test reads it yet). The other-drive case is verified in CI on the GitHub Windows runner (checkout D:, temp C:; CI runs 1 and 2); it is not verified on the user's own machine (drive C: only).

## Proof engine notes
- The sandbox runs the package in a child process under Node's permission model (`node --permission` with exact `--allow-fs-read` grants, no network, no child processes, scrubbed environment). It is a seat belt against accidental access, not a security boundary against malicious code.
- `tar` (runtime) and `@babel/parser` (dev, used by the `sourceScan` test) are listed in `PREEXISTING.md` with their licenses.

## Conventions
- License is MIT. Keep dependencies permissively licensed (MIT-compatible); each is listed in `PREEXISTING.md` with its license. The MIT/ISC/BSD/Apache-2.0 list in the necromancy laws applies only to resurrected packages.
- Environment is Windows with PowerShell. Use PowerShell-compatible commands, or cross-platform scripts.
