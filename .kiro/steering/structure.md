# Structure

## Current layout
```
.kiro/steering/   Steering rules (product.md, tech.md, structure.md)
src/app/          Next.js App Router of the Crypt_Site (static export): layout.tsx, page.tsx (home), globals.css, crypt/page.tsx (Crypt index), crypt/[name]/page.tsx (one page per Graveyard entry); thin pages that call src/ui
src/types/assets.d.ts  Committed ambient declaration `declare module "*.css";` so typecheck passes without the git-ignored next-env.d.ts (covered by the `**/*.ts` include of tsconfig.json)
src/ui/core/      Pure Site code (no file system, clock or network): view model (viewModel.ts), Cause_Label_Table (causes.ts), nightly labels and run record (nightlyLabels.ts, nightlyRun.ts), link filter (safeHref.ts), texts, theme, entry file list, static params
src/ui/shell/     Site I/O: Entry_Reader (readSite.ts, loadSite.ts), tarball version read (tarballVersion.ts), Entry_File_Copy (copyEntryFiles.ts)
src/ui/components/  Server components only (no client code): SafeLink, SiteLink, JsonText, Sources, Labels, HomeView, CryptIndexView, EntryView and its sections, AttemptsTable, NightlyLine, NightlySection
scripts/ui/       Site scripts: checkSite.mjs (Site_Check_Script, `node scripts/ui/checkSite.mjs` after the build), copyEntryFiles.ts (run by `npm run build`), startNotice.mjs (`npm run start` notice, exit 1), writeNightlyRun.mjs (writes the Nightly_Input record in pages.yml)
tests/ui/         Site tests: `unit/`, `property/` (p*-*.test.ts), `helpers/`; vitest project `ui`
tests/ui/fixtures/  Hand-written Site fixtures: `graveyard/` (alive, restless, inconclusive, stub, retired, hostile and lodash.set entries), `nightly/` (run records and reports), `ledger.json`
.github/workflows/pages.yml  Crypt_Site build and deploy to GitHub Pages (jobs `build`, `deploy`); triggers push to main (listed paths), completed `nightly` run, workflow_dispatch; downloads the nightly artifact into `.crypt-nightly/`
out/              Site_Output (static export of `npm run build`); gitignored, never committed
.crypt-nightly/   Nightly_Input (last nightly run's record and report, written by pages.yml); gitignored
src/engine/types.ts  Shared engine types, zod schemas (certificate, upstream responses), Result helper
src/engine/reasons.ts  Shared reason constants (NO_SCORECARD_REASON, NO_GITHUB_REPOSITORY_REASON); no imports from sources or core
src/engine/cache/cache.ts, cacheKey.ts  Cache store, TTL resolution, Cache key
src/engine/sources/http.ts  HTTP wrapper shared by source clients: createHttpClient (get/post/request), timeout, Cache, stale fallback, rate limit mapping, token redaction, in-flight dedupe
src/engine/autopsy.ts  Orchestrator: runAutopsy (parse, resolve, fetch with bounded concurrency, successor lookup, single Analysis_Date read, buildCertificate) and compareCertificates
src/engine/index.ts  Public engine API (runAutopsy, compareCertificates, canonicalJson, canonicalize, deserialize, parseInput, createMemoryCache, systemClock, public types)
src/engine/internal.ts  Internals for scripts (fixture recording): createHttpClient and the npm/OSV/deps.dev/GitHub clients; not public API
src/engine/clock.ts  systemClock, the only real-clock entry point; production wiring only, tests inject a fake Clock
scripts/recordFixtures.ts, scripts/lib/recordFixtures.ts  Manual fixture recording (npm run fixtures:record); writes tests/engine/fixtures/<package>/*.json
scripts/recordTarball.ts, scripts/lib/recordTarball.ts  Manual lodash.set@4.3.2 tarball recording (npm run fixtures:record-tarball); verifies integrity against the recorded packument, then writes tests/proof/fixtures/lodash.set/lodash.set-4.3.2.tgz and .meta.json
scripts/printFixtureHashes.ts  Prints the pinned fixture sha512 table and the original's Tree_Hash (npx tsx scripts/printFixtureHashes.ts)
scripts/trace.ts  Requirement trace (npm run trace): one section per spec (autopsy-engine: tests/engine; proof-of-life-engine: tests/proof); reads the `// Requirements:` header of each `*.test.ts` (bare list = the test's own spec; `// Requirements: 1.2; proof-of-life-engine 15.5, 15.9` cites another spec's criteria), the criteria of the spec's requirements.md and docs/traceability-gaps.json; writes docs/traceability.md (read-only otherwise; not a test). Exit code 1 when a gap of either spec is unclassified or a classification entry is stale or names no criterion
tests/proof/unit/fixtureIntegrity.test.ts  Tarball vs meta vs recorded packument, pinned Tree_Hash and fixture byte hashes, line-ending guard, .gitattributes
tests/proof/unit/recordTarball.test.ts  Offline tests for the tarball recorder (fake fetch, temp dirs)
tests/engine/unit/  Engine unit tests (types.test.ts, http.test.ts, ...)
tests/setup/networkGuard.ts  Blocks network access in every vitest project (root setupFiles)
tests/proof/helpers/budgetReporter.ts  Vitest custom reporter (default export, loaded by path from vitest.config.mts): checks each proof project that ran against its target on its span (first test file start to last test file end; 60 s / 90 s / 120 s; PROOF_BUDGET_MODE, PROOF_LOG_TIMINGS, PROOF_BUDGET_SCALE test aid); falls back to the whole-run wall-clock when the span is unavailable; exports the pure `parseBudgetScale`, `createSpanTracker`, `evaluateBudget`, `evaluateRun`, `concludeRun` (injected clock and writers)
tests/proof/unit/budgetReporter.test.ts  Span-based budget logic (R15.7, R15.8): targets, strict vs warn, exact-target, span fallback, unknown project and project without files not evaluated, span tracker, PROOF_BUDGET_SCALE parse and scaled targets; no journal write
src/proof/index.ts, types.ts  Proof of Life Engine public API; zod schemas and shared types (Proof_Report, Outcome, encoded nodes, harness errors, Result)
src/proof/core/  Pure core (determinism lint scope): seeds, equal (comparison), normalize (Root_Normalizer), redact (Path_Redactor, Identity_Redactor over nodes), identity (Identity_Values, scanner), delta (classification), apiSurface, verdict, report (buildReport, fallbackReport)
src/proof/serialize/  Pure: canonicalReport.ts (REPORT_KEY_ORDER, canonical JSON), deserialize.ts (zod)
src/proof/shell/  I/O shell: driver, orchestrator, emit (the single output path), entry, integrity, treeHash, workDir
src/proof/cli.ts  Thin CLI (`npm run proof:run`): `runCli(argv, deps)` returns {exitCode, stdout, stderr}; built-in harness registry; only `main` writes to the process streams: the final report to stdout (when `--out` is not given), everything else to stderr through emit (documented exception CLI_EXCEPTION in sourceScan.test.ts)
tests/proof/unit/cli.test.ts  CLI tests with a fake `run` (args, usage errors, exit codes, --meta, --out, identity)
src/proof/shell/tarball/  tarballExtractor.ts, the only importer of `tar`
src/proof/shell/executor/  Executor interface (types.ts) and inProcessExecutor.ts (tests only), sandboxCommand.ts (pure buildSandboxArgv / buildSandboxEnv), sandboxExecutor.ts (Sandbox_Executor, createSandboxExecutorFactory; the default executor of the orchestrator)
tests/proof/unit/sandboxCommand.test.ts  Argv and environment builder tests
tests/proof/unit/sandboxExecutor.test.ts  Sandbox_Executor with real children: probe, open/list/call, timeout kill, crash, restart budget, output limit, dispose
src/proof/child/  Sandbox side, self-contained, erasable TypeScript syntax only: protocol, prototypes, sideRuntime, stubs, runner (entry script: NDJSON loop over SideRuntime on stdin/stdout), package.json ({"type":"module"})
tests/proof/unit/runner.test.ts  Smoke test: runner as a real child under `node --permission`
src/proof/child/codec/  Pure Value_Codec (determinism lint scope): nodes, order, encode, decode, canonical; imports nothing outside this directory
src/proof/harnesses/lodash.set/  lodash.set Harness_Config (config.ts: generators, predicate, declared delta) and sandbox/pollution.cjs (CommonJS delta property module); the only lodash-specific code
tests/proof/unit/lodashHarness.test.ts  Config validation, generator/predicate agreement, pollution module
tests/proof/unit/  Proof engine unit tests (one file per module, sourceScan.test.ts, determinismLint.test.ts, ...); part of vitest project `proof-property`
tests/proof/property/  Proof engine property tests, named p*-*.test.ts (fast-check, one file per design property); part of vitest project `proof-property`, except p24-same-seed-same-bytes, p26-injected-changes and p26b-declared-delta, which are the vitest project `proof-heavy`
tests/proof/integration/  Real child process (sandbox) tests, named *.integration.test.ts: envScrubbed, fileReadDenied, networkDenied, spawnDenied, protoIsolation, timeoutKill, lodashAlive, lodashBroken, lodashIdentity (vitest project `proof-integration`)
tests/proof/integration/helpers/lodashRun.ts  Shared runner for the lodash.set integration tests
tests/proof/integration/helpers/sandboxHarness.ts  withExecutor / createHarness: temp root, real Sandbox_Executor, open side, call, cleanup in finally; readChildEnvKeys, readChildPermissions
tests/proof/integration/helpers.integration.test.ts  Self-test of the helpers (round trip on exports-only, cleanup)
tests/proof/integration/fixtures/  Hand-written CommonJS sandbox fixture packages: net-probe, fs-probe, env-probe, spin, spawn-probe, proto-pollute, crash, restart-probe, exports-only
tests/proof/helpers/  Shared test helpers (arbitraries, synthetic packages, tarball builders, runners)
tests/proof/fixtures/  Recorded tarball (lodash.set/, written by npm run fixtures:record-tarball) and hand-written fixture packages
tests/proof/fixtures/lodash.set-alive/  Hand-written lodash.set 4.3.3 resurrection (original plus the pollution guard in baseSet); test fixture, never published
tests/proof/unit/lodashAliveFixture.test.ts  Original vs alive fixture checks (pollution runs in a spawned node child)
tests/proof/fixtures/lodash.set-broken/  Deliberately broken lodash.set 4.3.3 (numeric-index containers are `{}`; has the pollution guard); test fixture, never published
tests/proof/unit/lodashBrokenFixture.test.ts  Original vs broken fixture checks (pollution runs in a spawned node child)
tests/pipeline/  Resurrection pipeline tests (unit, property, helpers, fixtures); vitest project `pipeline`, except tests/pipeline/integration
tests/pipeline/integration/  Pipeline tests with real sandbox children or a real local git repository, named *.integration.test.ts: gitEntries, ipAlive, ipExports, ipSetup, lodashHarness (vitest project `pipeline-integration`)
tests/pipeline/fixtures/  Pipeline test fixtures (ip/ with deltas.json and harness.json, stub/)
tests/pipeline/fixtures/stub/<package>/  Stub_Fixture (ip, lodash.set): committed `resurrection/`, `deltas.json` and `harness.json`, copied by a stub run. A stub run uses no credit, is labelled "stub run" and is not a Medium-produced resurrection
src/pipeline/  Resurrection pipeline, one directory per role or concern, each with `core/` (pure) and `shell/` (I/O) where it has both: `common/` (constants such as `PREDICATE_TYPE` and `PINNED_NODE_VERSION`, branch and package names, canonical JSON, Result, `shell/system.ts`), `gravedigger/` (Gravedigger: rules and eligibility record), `harness/` (compiler of `deltas.json` and `harness.json`, `core/presets/`, `sandbox/` CommonJS modules), `intake/` (CI intake validation of a pushed resurrection branch), `local/` (Local_Runner on the user's machine: arguments, ledger, stub plan, push), `medium/` (Medium prompt and the Kiro CLI runner), `necromancy/` (author and license gate), `undertaker/` (entry layout, gates, predicate, pull request text, `verifyCommands`, publish, replay, nightly re-verification)
.kiro/agents/medium.json  Kiro CLI agent definition of the Medium (`--agent medium`): prompt, tool allowlist, the writeGuard hook and the context server; check with `kiro-cli agent validate`
src/pipeline/medium/agent/writeGuard.mjs  preToolUse hook of the Medium: denies writes outside the allowed paths and appends to the guard log (plain ESM, with a `.d.mts` type file)
src/pipeline/medium/agent/contextServer.mjs  MCP stdio server that gives the Medium its read-only context (certificate, eligibility, preset menu) from the work directory, plus advisories and the Original files (plain ESM)
src/pipeline/medium/agent/pathRules.mjs  Pure path rules shared by the guard and the Local_Runner checks (allowed write targets, rejected paths); plain ESM so the hook can load it
src/pipeline/medium/core/mediumEnv.ts  Pure: builds the scrubbed environment of the Kiro CLI child
src/pipeline/medium/core/presetMenu.ts  Pure: the preset menu text given to the Medium
src/pipeline/medium/core/guardLog.ts  Pure: summarizes a guard log (line count and DENY lines); the line format is written by writeGuard.mjs
src/pipeline/local/core/porcelain.ts  Pure: parses `git status --porcelain` output for the Local_Runner checks
src/pipeline/local/core/mediumContext.ts  Pure: builds the context files the Local_Runner writes for the Medium
docs/medium-enforcement-test.md  Manual Enforcement_Test_Doc: how the user checks that the Medium's guard and tool limits hold with `--agent medium`
tests/medium/  Medium agent tests: `unit/`, `property/` (p*-*.test.ts) and `integration/` (*.integration.test.ts, real guard and server processes); run by the vitest projects `pipeline` and `pipeline-integration`
scripts/resurrect.ts  Local_Runner entry (`npm run resurrect -- <package> [--stub <fixture-dir>]`)
scripts/push-resurrection.ts  Pushes `resurrect/<package>` and dispatches `resurrect.yml`; never pushes `ledger.json`
scripts/measureIp.ts, scripts/lib/measureIp.ts  ip@2.0.1 measurement (`npm run measure:ip`); writes `docs/measurements/ip-2.0.1.json`
scripts/ci/  CI entry scripts (intake, checks-summary, prove, attest, publish, nightly) with their step code in `scripts/ci/lib/`
docs/measurements/  Committed measurement results (ip-2.0.1.json)
graveyard/  Graveyard_Directory: one directory per package, written only by the `publish` job through a pull request. An entry is `resurrection` (certificate.json, eligibility.json, deltas.json, harness.json, resurrection.tgz, proof-report.json, plus three `.sigstore.json` bundles only for an `alive` verdict, and `stub-run.json` for a stub run) or `not-resurrected` (certificate.json and eligibility.json only)
ledger.json  Credit ledger of the Medium runs (the user's meter readings); committed to `main` by the user, never by a script or workflow
.github/workflows/resurrect.yml  Signer_Workflow (`workflow_dispatch`): intake, checks, prove, attest, publish
.github/workflows/nightly.yml  Nightly re-verification of `graveyard/` (no LLM, no credits; `contents: read`, `attestations: read`)
scripts/spike/  Sandbox spike scripts (task 1; results in docs/kiro-journal.md)
package.json      Scripts and dependencies (npm)
vitest.config.mts  Vitest config: projects engine, proof-property, proof-heavy, proof-integration, pipeline, pipeline-integration, ui; budget reporter; network guard in the root setupFiles
eslint.config.mjs  ESLint config (determinism rules over the pure directories)
.github/workflows/ci.yml  CI (GitHub Actions): jobs test-linux, test-no-identity, test-windows, site (npm run build, then node scripts/ui/checkSite.mjs, on the pinned Node version); runs typecheck, lint and the full suite; triggers push, pull_request and workflow_dispatch; no secrets
tsconfig.json     TypeScript config (strict)
next.config.mjs   Next.js config
docs/             Project docs (demo-packages.md, engine-ordering.md, kiro-journal.md, proof-of-life-ordering.md, traceability.md (generated by npm run trace), traceability-gaps.json (hand-kept class and evidence of each gap of both specs; read by npm run trace))
.env.example      Documented environment variables (committed)
.env              Local secrets (gitignored, never commit)
README.md         Project overview and flow
PREEXISTING.md    Third-party libraries and data sources
LICENSE           MIT
```
Specs live under `.kiro/specs/`; hooks and agents are planned under `.kiro/` (see README). Engine code goes in `src/engine/`, proof engine code in `src/proof/`, and tests in `tests/`.

## Guidelines
- Put Kiro specs, hooks, and agent definitions in `.kiro/`, not at the repo root.
- When adding source code, update this file with the new layout.
- Keep the four agent roles (Coroner, Gravedigger, Medium, Undertaker) as distinct units of code or config, not one merged module.
- Update `README.md` quick start when setup steps exist.
- Update `PREEXISTING.md` when adding a third-party library or data source.
