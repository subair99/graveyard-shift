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
tests/proof/unit/recordTarball.test.ts  Offline tests for the tarball recorder (fake fetch, temp dirs)
tests/engine/unit/  Engine unit tests (types.test.ts, http.test.ts, ...)
src/proof/index.ts, types.ts  Proof of Life Engine public API; zod schemas and shared types (Proof_Report, Outcome, encoded nodes, harness errors, Result)
src/proof/core/  Pure core (determinism lint scope): seeds, equal (comparison), normalize (Root_Normalizer), redact (Path_Redactor, Identity_Redactor over nodes), identity (Identity_Values, scanner), delta (classification), apiSurface, verdict, report (buildReport, fallbackReport)
src/proof/serialize/  Pure: canonicalReport.ts (REPORT_KEY_ORDER, canonical JSON), deserialize.ts (zod)
src/proof/shell/  I/O shell: driver, orchestrator, emit (the single output path), entry, integrity, treeHash, workDir
src/proof/shell/tarball/  tarballExtractor.ts, the only importer of `tar`
src/proof/shell/executor/  Executor interface (types.ts) and inProcessExecutor.ts (tests only); the Sandbox_Executor is planned here
src/proof/child/  Sandbox side, self-contained, erasable TypeScript syntax only: protocol, prototypes, sideRuntime, stubs, package.json ({"type":"module"}); runner.ts is planned
src/proof/child/codec/  Pure Value_Codec (determinism lint scope): nodes, order, encode, decode, canonical; imports nothing outside this directory
tests/proof/unit/  Proof engine unit tests (one file per module, sourceScan.test.ts, determinismLint.test.ts, ...)
tests/proof/property/  Proof engine property tests, named p*-*.test.ts (fast-check, one file per design property)
tests/proof/integration/  Planned: real child process (sandbox) tests; does not exist yet
tests/proof/helpers/  Shared test helpers (arbitraries, synthetic packages, tarball builders, runners)
tests/proof/fixtures/  Planned: recorded tarballs (written by npm run fixtures:record-tarball); does not exist yet
scripts/spike/  Sandbox spike scripts (task 1; results in docs/kiro-journal.md)
package.json      Scripts and dependencies (npm)
tsconfig.json     TypeScript config (strict)
next.config.mjs   Next.js config
docs/             Project docs (demo-packages.md, engine-ordering.md, kiro-journal.md, proof-of-life-ordering.md)
.env.example      Documented environment variables (committed)
.env              Local secrets (gitignored, never commit)
README.md         Project overview and flow
PREEXISTING.md    Third-party libraries and data sources
LICENSE           MIT
```
Specs, hooks, and agents are planned under `.kiro/` (see README). Only `src/app` exists so far; engine code goes in `src/engine/` and tests in `tests/` (see the autopsy-engine spec).

## Guidelines
- Put Kiro specs, hooks, and agent definitions in `.kiro/`, not at the repo root.
- When adding source code, update this file with the new layout.
- Keep the four agent roles (Coroner, Gravedigger, Medium, Undertaker) as distinct units of code or config, not one merged module.
- Update `README.md` quick start when setup steps exist.
- Update `PREEXISTING.md` when adding a third-party library or data source.
