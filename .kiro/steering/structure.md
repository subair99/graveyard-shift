# Structure

## Current layout
```
.kiro/steering/   Steering rules (product.md, tech.md, structure.md)
src/app/          Next.js App Router: layout.tsx and page.tsx (minimal)
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
scripts/trace.ts  Requirement trace (npm run trace): one section per spec (autopsy-engine: tests/engine; proof-of-life-engine: tests/proof); reads the `// Requirements:` header of each `*.test.ts`, the criteria of the spec's requirements.md and docs/traceability-gaps.json; writes docs/traceability.md (read-only otherwise; not a test). Exit code 1 when a proof-of-life-engine gap is unclassified or a classification entry is stale or names no criterion
tests/proof/unit/fixtureIntegrity.test.ts  Tarball vs meta vs recorded packument, pinned Tree_Hash and fixture byte hashes, line-ending guard, .gitattributes
tests/proof/unit/recordTarball.test.ts  Offline tests for the tarball recorder (fake fetch, temp dirs)
tests/engine/unit/  Engine unit tests (types.test.ts, http.test.ts, ...)
tests/setup/networkGuard.ts  Blocks network access in every vitest project (root setupFiles)
tests/proof/helpers/budgetGlobalSetup.ts  Vitest global setup: measures wall-clock per proof project, enforces the 60 s / 120 s targets (PROOF_BUDGET_MODE, PROOF_LOG_TIMINGS)
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
tests/proof/property/  Proof engine property tests, named p*-*.test.ts (fast-check, one file per design property); part of vitest project `proof-property`
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
scripts/spike/  Sandbox spike scripts (task 1; results in docs/kiro-journal.md)
package.json      Scripts and dependencies (npm)
vitest.config.mts  Vitest config: projects engine, proof-property, proof-integration; budget global setup; network guard in the root setupFiles
eslint.config.mjs  ESLint config (determinism rules over the pure directories)
.github/workflows/ci.yml  CI (GitHub Actions): jobs test-linux, test-no-identity, test-windows; runs typecheck, lint and the full suite; no secrets
tsconfig.json     TypeScript config (strict)
next.config.mjs   Next.js config
docs/             Project docs (demo-packages.md, engine-ordering.md, kiro-journal.md, proof-of-life-ordering.md, traceability.md (generated by npm run trace), traceability-gaps.json (hand-kept class and evidence of each proof-of-life-engine gap; read by npm run trace))
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
