# Implementation Plan: Proof of Life Engine

## Overview

The design uses TypeScript, so all tasks use TypeScript. The project already has Next.js, TypeScript strict mode, vitest, fast-check, zod, semver, ESLint (Babel parser, determinism rules scoped by glob), tsx and the finished autopsy engine in `src/engine`. This plan does not redo that setup. It adds only what the Proof of Life Engine needs: the `tar` dependency, the ESLint determinism scope for the pure proof core, and a vitest `projects` configuration for `tests/proof`.

The order is:

1. **Task 1, sandbox spike.** Settles every item under "Risks to verify" in the design, plus the other facts the design marks as unconfirmed. Each result is logged in `docs/kiro-journal.md` with the command, date, Node version and environment. If a risk fails, `design.md` is updated before the checkpoint.
2. **Task 2, checkpoint.** Stops for the user's review. Nothing after it starts until the user approves.
3. **Tasks 3 to 11, pure core and in-process engine.** Value codec, comparison, seeds, Root_Normalizer, Path_Redactor, delta classification, API-surface check, verdict, report builder, canonical serializer, shell modules (integrity, Tree_Hash, extractor, work directory, entry resolution), the shared SideRuntime, the InProcess_Executor, the fast-check driver and the orchestrator. They are built and tested against the InProcess_Executor before the sandbox exists.
4. **Tasks 13 to 16, fixtures and the lodash.set harness.** A manual step (task 14) records the lodash.set@4.3.2 tarball.
5. **Tasks 17 and 18, Sandbox_Executor and sandbox integration tests.**
6. **Tasks 19 to 21, time budgets, documentation, final checkpoint.**

Test files go in `tests/proof/{unit,property,integration,helpers,fixtures}/`. Each property test goes in its own file, `tests/proof/property/pN-<name>.test.ts`, tagged `Feature: proof-of-life-engine, Property N: <text>` and using the shared `fcParams()` helper from `tests/engine/helpers/fc.ts` (at least 100 runs, `FC_SEED` replay).

Required versus optional: property tests 4, 7, 8, 11, 20, 21, 24, 25, 26 are required. All other property tests are optional (`*`). The required integration tests are the sandbox denials (network, file read outside the package, environment scrubbing, timeout kill, child-process spawn, worker spawn), the `__proto__` isolation test (Requirement 5.15), and the two lodash.set verdict tests. Four more tests are required because they make those items meaningful or are cheap safety checks: the fixture tarball integrity test (15.3), the recorder offline-logic test (13.2), the determinism lint test (3.3) and the temp-root-leak safety test (8.6). All remaining test sub-tasks are optional. Unit tests that the requirements list as "SHALL" (for example Requirement 15.12) are optional here because the task brief says so; each implementation task still has to pass the checks it needs to be useful.

Manual steps that need the user: task 1.7 (optional, a second drive), task 2 (spike review), task 14 (run `npm run fixtures:record-tarball`), and the final review in task 21.

## Tasks

- [x] 1. Sandbox spike: settle every item in "Risks to verify"
  - Goal: replace assumptions with observations before any sandbox code is written. Every sub-task runs a small throwaway script under `scripts/spike/`, then appends an entry to `docs/kiro-journal.md` under a new heading "Proof of Life: sandbox spike". Each entry records only observed facts: the exact command, the date, `node -v`, the OS version, the working directory, and the observed output or exit code. Do not write any number or result that was not observed. A risk that cannot be tested on this machine is logged as "not tested" with the reason, never as passed.
  - Run Node with the permission flags exactly as the design's `buildSandboxArgv` will: `process.execPath --permission --allow-fs-read=<abs path> ... <entry>`. Use `node:child_process` `spawnSync` with `shell: false` so that each path is one argv element.
  - _Requirements: 5.2, 5.3, 5.7, 5.8, 16.3_

  - [x] 1.1 Create the spike scaffolding and the journal section
    - Create `scripts/spike/lib.ts` (throwaway): a helper that spawns `process.execPath` with given flags, env, cwd and returns `{ status, signal, stdout, stderr }`
    - Add the heading "Proof of Life: sandbox spike" to `docs/kiro-journal.md` with an environment block (date, `node -v`, OS version, the drive letters present, the vitest and fast-check versions read from `node_modules/<package>/package.json`)
    - Check that `scripts/spike/` does not break `npm run typecheck` or `npm run lint` (the lint script covers only `src` and `tests`); fix the `tsconfig.json` include only if typecheck fails, and log what was done
    - Disposition: `lib.ts` is deleted in 1.15 unless a later kept script needs it
    - _Requirements: 5.2_

  - [x] 1.2 Risk 1: native type stripping under `--permission`
    - Create `scripts/spike/child/` with a `package.json` `{"type":"module"}`, an `a.ts` that imports `./b.ts`, and a `runner.ts` that prints a line, all using only erasable syntax (type annotations, `interface`, `import type`)
    - Run `node --permission --allow-fs-read=<abs scripts/spike/child dir> <abs runner.ts>` and log: exit code, output, whether Node printed an experimental warning, whether the import of a sibling `.ts` file worked, and what happens when the sibling is outside the granted directory
    - Also run the same script without the `package.json` `{"type":"module"}` and log whether it still loads (this decides whether the child `package.json` is required)
    - Also log the observed behavior of an enum or parameter property (non-erasable syntax) to confirm what the design's "erasable syntax only" rule protects against
    - If this fails: record the failing message, and note the design's named fallback (compile `src/proof/child` to `.mjs` with esbuild into a granted build directory); the design update happens in 1.14
    - Disposition: keep `child/` as the basis of the integration test `smoke` (task 18.11); the rest is deleted in 1.15
    - _Requirements: 5.2, 5.8_

  - [x] 1.3 Risk 2: CommonJS loading of the package under `--allow-fs-read=<package dir>`
    - Create a package directory with `package.json` (`main`, no `type`), `index.js` (`module.exports`), and a second file loaded through `require('./lib/x.js')`
    - From the spike runner, load it with `createRequire(<packageDir>/package.json)(entryFile)` while only the runner directory and the package directory are granted
    - Log: whether the `package.json` scope lookup works, whether `main` resolution with and without `.js` and with `/index.js` works, and the error code when the package requires a file outside the grant, and when it requires a Node built-in such as `node:os`
    - Also log what a `"type": "module"` package does (error code and message), because the design maps that to `unloadable-module`
    - If this fails: record the failing message and the extra grants that would be needed; the design update happens in 1.14
    - Disposition: deleted in 1.15 (the real coverage comes from the lodash and synthetic runs)
    - _Requirements: 3.5, 5.2_

  - [x] 1.4 Risk 3: minimum Windows environment variable set (`env-minimum`)
    - Start the spike runner under `--permission` with, in order: `env: {}`; `{ TZ: 'UTC' }`; `{ SystemRoot }`; `{ SystemRoot, TZ: 'UTC' }` (the design's candidate list)
    - For each, log whether the child starts, loads a package and answers a message, with the exit code and any stderr text
    - Record the smallest set that starts and loads a package, and whether `SystemRoot` is needed. Also record whether `TZ=UTC` changes `new Date().getTimezoneOffset()` (observed value only)
    - Record that `NODE_OPTIONS` was not passed. Set a sentinel variable `GS_TEST_SECRET` in the parent and log that the child's `Object.keys(process.env)` lacks it
    - If a platform other than Windows is unavailable, log the POSIX result as "not tested"
    - Disposition: kept as the basis of the integration test `env-minimum` (task 18.11)
    - _Requirements: 5.3, 16.3_

  - [x] 1.5 Risk 4: child current directory equal to the package directory
    - Spawn with `cwd: <package dir>` under `--permission --allow-fs-read=<runner dir> --allow-fs-read=<package dir>` and log: whether Node starts, `process.cwd()` seen by the child (compare with the real path), and whether a relative `require('./x.js')` from the package works
    - Also log the result when `cwd` is the package directory but the package directory is only reachable through a symbolic link or a short (8.3) name, if such a path can be created on this machine; otherwise log "not tested" with the reason
    - If this fails: record the error and the observed alternative (for example spawning with the parent's cwd and calling `process.chdir` in the runner); the design update happens in 1.14
    - Disposition: deleted in 1.15 (the check is covered by the `smoke` and `paths-spaces` integration tests)
    - _Requirements: 4.6, 5.2_

  - [x] 1.6 Risk 5a: package path that contains spaces
    - Create `<tmp>/gs space/pkg/` with a CommonJS package; run the child with `--allow-fs-read=<that dir>` passed as one argv element, with `cwd` set to it
    - Log: whether the child starts and loads the package, the path of the `file://` URL in a thrown error message (to confirm the percent-encoded form the Root_Normalizer must match), and the error text of a denied read
    - Disposition: kept as the basis of the integration test `paths-spaces` (task 18.11)
    - _Requirements: 5.2, 13.19_

  - [x] 1.7 Risk 5b: package path on another drive (manual input possible)
    - List the available drive letters (`Get-PSDrive -PSProvider FileSystem`) and the drive of the repository and of `os.tmpdir()`
    - If a second writable drive exists, or the user sets `PROOF_TEST_OTHER_DRIVE` to a writable directory on another drive, run the 1.3 package from there while the runner directory stays on the repository drive; log the result
    - If no other drive is available, log exactly "other drive not available" and DO NOT claim the case as verified. Ask the user once whether they can provide a directory on another drive (for example a USB or a second partition); if they cannot, continue
    - Disposition: kept as the basis of the conditional integration test `other-drive` (task 18.11)
    - _Requirements: 5.2_

  - [x] 1.8 Risk 6a: fast-check 4.10 `RunDetails` field names
    - Read `node_modules/fast-check/lib/types/check/runner/reporter/RunDetails.d.ts` (and the types it references) and list the actual field names and types of the failed variant: `failed`, `counterexample`, `counterexamplePath`, `numRuns`, `numShrinks`, `numSkips`, `seed`, `error`, `errorInstance` and any other field present
    - Run a tiny script with `fc.check(fc.asyncProperty(fc.integer(), async (n) => n < 10), { seed: 42, numRuns: 100 })` and log the actual keys of the returned object, the type and value of `counterexample` (a tuple), `counterexamplePath`, `numShrinks`, and the details of a passing run and of a run with `numRuns` too small to fail
    - Log what is returned when an async property throws, and when an arbitrary exhausts its `filter` (the `generator-exhausted` case: `failed`, `counterexample` null, the error text)
    - If a design field name differs: record the difference; the design update happens in 1.14
    - Disposition: deleted in 1.15 (the driver tests in task 11 cover this)
    - _Requirements: 8.7, 8.8_

  - [x] 1.9 Risk 6b: `path` replay with `numRuns` smaller than the recorded run index
    - With the property of 1.8, record `seed` and `counterexamplePath` of a shrunk failure at its original `numRuns`; then replay with `{ seed, path, numRuns: 1 }`, `{ seed, path, numRuns: 100 }`, and `{ seed, path }` without `numRuns`
    - Log, for each: whether the same counterexample is returned, and `numRuns`, `numShrinks` of the replay
    - Also replay with the same seed and a different `numRuns` than recorded and log whether the path still reproduces
    - If replay does not reproduce with a smaller `numRuns`: record the minimum that works; the Replay_Parameters in the design (`seed`, `path`) and R8.8 change in 1.14
    - Disposition: deleted in 1.15
    - _Requirements: 8.8_

  - [x] 1.10 Extra risk: vitest 5 `projects` key, `globalSetup` and per-project timing
    - The design says "the exact vitest 5 configuration key is confirmed when the config is written". Read `node_modules/vitest/package.json` and the vitest 5 type definitions for `test.projects` (or its renamed key), `globalSetup` and `setupFiles` per project; read the existing `vitest.config.mts`
    - Create a scratch config `scripts/spike/vitest.config.mts` with two projects selecting different folders, each with a `globalSetup` whose teardown prints elapsed wall-clock time for that project; run `npx vitest --run --config scripts/spike/vitest.config.mts`
    - Log: the key names that worked, whether a failing teardown fails the run, whether the per-project teardown time can be measured and how, and how the existing `tests/setup/networkGuard.ts` must be attached to each project
    - Disposition: the findings drive task 3.2; the scratch config is deleted in 1.15
    - _Requirements: 15.7, 15.8_

  - [x] 1.11 Extra risk: `tar` 7.5.23 API and licenses
    - Run `npm install --no-save tar@7.5.23` (does not change `package.json`); read the installed `tar` types for the parser (`tar.Parser` or its current name), entry event names and the entry fields `type`, `path`, `size`
    - Write a throwaway script that parses an in-memory `.tgz` (created with `tar.create` or a hand-built ustar buffer plus `zlib.gzipSync`) and logs entry type names for a file, directory, symbolic link and hard link
    - Read the `license` field of `tar` and of each transitive dependency from `node_modules` and log them; flag any that is not MIT-compatible
    - Log whether the parser stops early when a compressed size or entry limit is exceeded (needed for `archive-too-large`)
    - If the API differs from the design: record it; the extractor in task 9.5 uses the observed API
    - Disposition: deleted in 1.15
    - _Requirements: 3.1, 3.2, 3.3, 14.11_

  - [x] 1.12 Extra risk: `--allow-fs-read` argument syntax for `,` and `*` in paths
    - The design refuses paths containing `*` and conservatively `,` because "the documented separator behavior is not verified". Under `--permission`, grant a directory named `a,b` and a directory with `*` in its name (if the OS allows it) and a path whose prefix equals another directory name (`pkg` and `pkg2`); log what the child can and cannot read
    - Log whether `--allow-fs-read=<dir>` also grants a sibling directory that starts with the same text
    - Disposition: the findings decide the path rules in `buildSandboxArgv` (task 17.1); the script is deleted in 1.15
    - _Requirements: 5.2_

  - [x] 1.13 Extra measurement: cost of one child process start
    - The design says the cost of a start is "not measured yet". Measure the elapsed time (`process.hrtime.bigint()` in the spike script, not in engine code) of starting the spike runner under `--permission` to the `ready` line, for 10 consecutive starts
    - Log the command, the number of runs, and every individual time (no averages invented; a minimum, median and maximum computed from the logged values are fine)
    - Disposition: the numbers feed the time budget discussion in task 19; the script is deleted in 1.15
    - _Requirements: 15.7_

  - [x] 1.14 Update design.md if any risk or extra item failed or differed
    - For every spike sub-task whose result differs from the design, edit `.kiro/specs/proof-of-life-engine/design.md` BEFORE the checkpoint, and list in the journal which sections were edited
    - Sections by risk: Risk 1 (type stripping) goes to "Key design decisions" (last row), "Module layout" (`child/package.json`) and "Sandbox_Executor / Command line", with the design's named fallback (compile `src/proof/child` to `.mjs` with esbuild, already installed as a dependency of `tsx`, and grant the build directory); Risk 2 (CommonJS loading) goes to "How files become readable"; Risk 3 (environment) goes to the "Environment" table in "Sandbox_Executor" and to the `env-minimum` test text; Risk 4 (cwd) goes to the spawn options in "Command line" and to R4.6 notes; Risk 5 (spaces, other drive) goes to the "Package directory addressing" table; Risk 6 (RunDetails and replay) goes to "Fast-check driver", "Replay (R8.8)" and the `Replay` type in "Proof_Report"; the vitest key goes to "Time budgets"; `tar` API goes to "Tarball_Extractor"; `,`/`*` rules go to "Command line"
    - Also edit the "Risks to verify" section: mark each item as verified, failed or not tested with a pointer to the journal entry
    - If a changed fact conflicts with a requirement (for example the flags in Requirement 5.2, the environment rule in 5.3, or the replay parameters in 8.8), do NOT edit `requirements.md`: list the conflict in the journal and raise it at the checkpoint
    - If all items passed as designed, still edit "Risks to verify" to record the verification and state "no design change needed" in the journal
    - _Requirements: 5.2, 5.3, 8.8_

  - [x] 1.15 Clean up the scratch scripts
    - Delete every script under `scripts/spike/` whose disposition says "deleted"; keep only those whose disposition says "kept as the basis" (`child/` for the smoke test, the env-minimum script, the spaces script, the other-drive script), and list the kept files in the journal
    - Kept files are moved into `tests/proof/integration/` by task 18.11; until then they stay in `scripts/spike/` and are not imported by any other code
    - _Requirements: 5.2_

- [ ] 2. CHECKPOINT: spike review (STOP for the user)
  - STOP here. Present the logged results to the user: for each of the six "Risks to verify" and for each extra item (vitest key, `tar` API, `,`/`*` rules, child start cost), state in one line whether it passed, failed or was not tested, with the journal entry that holds the evidence
  - List every edit made to `design.md` in 1.14 and every conflict with `requirements.md` that needs a decision
  - Ask the user whether to continue (and, if needed, how to resolve the conflicts). Do NOT start task 3 or any later task until the user approves
  - If the user rejects a result, return to the failing spike sub-task or to the design, as the user directs
  - _Requirements: 5.2, 5.3, 8.8_

- [ ] 3. Project prerequisites for proof-of-life
  - [ ] 3.1 Add the `tar` dependency and update PREEXISTING.md
    - Run `npm install tar@7.5.23` (exact version confirmed in 1.11 or its replacement), keep `package-lock.json` consistent
    - Re-check the license of `tar` (BlueOak-1.0.0) and of every transitive dependency listed in `package-lock.json` (design names `chownr`, `yallist`, `minipass`, `minizlib`, `@isaacs/fs-minipass`) using the values observed in 1.11; if any is not MIT-compatible, STOP and ask the user
    - Add to `PREEXISTING.md`: `tar` with name, license, source URL https://github.com/isaacs/node-tar and its transitive dependencies with licenses; the lodash.set@4.3.2 tarball (MIT) with URL https://registry.npmjs.org/lodash.set/-/lodash.set-4.3.2.tgz
    - _Requirements: 3.1, 14.11_

  - [ ] 3.2 Extend the ESLint determinism scope and configure the vitest projects
    - In `eslint.config.mjs` add `src/proof/core/**`, `src/proof/serialize/**` and `src/proof/child/codec/**` to `deterministicFiles` (keep `src/engine/core`, `src/engine/serialize`); make sure `src/proof/child/stubs.ts` stays outside the scope
    - In `vitest.config.mts` define the projects `engine` (existing tests, unchanged behavior), `proof-property` (`tests/proof/property` and `tests/proof/unit`) and `proof-integration` (`tests/proof/integration`), using the keys confirmed in 1.10; attach `tests/setup/networkGuard.ts` to every project; keep `FC_SEED` handling
    - Create `tests/proof/helpers/budgetGlobalSetup.ts`: measures the wall-clock time of the project in its teardown (the measurement may read the clock because it lives in test helpers, outside the lint scope), prints it, fails the run when the target (60 s for `proof-property`, 120 s for `proof-integration`) is exceeded unless `PROOF_BUDGET_MODE=warn`, and appends the measured value to `docs/kiro-journal.md` when `PROOF_LOG_TIMINGS=1`
    - Confirm `npm test` still runs the existing engine suite
    - _Requirements: 15.5, 15.7, 15.8, 15.9, 16.2_

  - [ ] 3.3 Write the determinism lint test for the proof scope
    - Create `tests/proof/unit/determinismLint.test.ts` (modelled on `tests/engine/unit/determinismLint.test.ts`): ESLint reports `Date.now`, `new Date()` and `Math.random` in a probe file placed under each of `src/proof/core`, `src/proof/serialize` and `src/proof/child/codec`, and reports nothing for the real files in those directories
    - Required (cheap safety check added beyond the brief's list)
    - _Requirements: 16.2_

  - [ ] 3.4 Define shared proof types and zod schemas in `src/proof/types.ts`
    - `Outcome`, `DeltaEntry`, `EncodedDescriptor`, `ProofReport` and all nested types, `Verdict`, `HarnessErrorKind`, `HarnessError`, `Divergence`, `Replay`, `DeltaReport`, `UnencodableCount`, `HarnessConfig`, `FunctionHarness`, `ExcludedFunction`, `DeclaredDelta`, `ProofRequest`, `ProofDeps`, `ProofRun`, `RequestValidationError`
    - zod schemas: every object `.strict()`, `EncodedNode` as a recursive `z.lazy` discriminated union on `t`, and the cross-field rules of Requirement 13.6 (`casesWithUnencodable <= cases`, `total` equals the sum of `reasons`, `reasons` has exactly the four keys)
    - Reuse the `Result` helper from `src/engine/types.ts`
    - _Requirements: 1.1, 1.2, 13.2, 13.6_

- [ ] 4. Implement the Value_Codec
  - [ ] 4.1 Create `src/proof/child/` base files
    - `src/proof/child/package.json` (`{"type":"module"}`, or the layout the spike settled), `codec/nodes.ts` (EncodedNode types, `NODE_KEY_ORDER`, unencodable reasons), `codec/order.ts` (`compareCodePoints`, `sortBy`, `ordered`, copied generic helpers); only erasable TypeScript syntax; no imports outside `child/codec`
    - _Requirements: 6.1, 13.1, 13.3, 16.2_

  - [ ] 4.2 Implement encode, decode and canonicalization
    - `codec/canonical.ts` (`canonicalizeNode`, `nodeJson`), `codec/encode.ts` (`encodeValue` with budget, depth limit 1000, ancestor-path cycle detection, holes, getters, proxies, no `stack`, realm-independent type tests), `codec/decode.ts` (fresh copies, stand-in classes cached per name, throws on `unencodable`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 13.11_

  - [ ] 4.3 Write property test for the codec round trip
    - **Property 8: Value codec round trip**
    - **Validates: Requirements 6.1, 6.5, 6.6, 13.11**
    - File: `tests/proof/property/p08-codec-roundtrip.test.ts`; required (not optional)

  - [ ]* 4.4 Write property test for shared references and cycles
    - **Property 9: Shared references are encoded by value, cycles are unencodable**
    - **Validates: Requirements 6.2, 6.7, 15.11**

  - [ ]* 4.5 Write property test for the output budget
    - **Property 10: Encoding respects the output budget**
    - **Validates: Requirements 5.6, 6.9**

  - [ ]* 4.6 Write unit tests for the codec
    - Depth boundary 1,000 and 1,001, `[o, o]`, `{a: x, b: x}`, `o.self = o`, a twice-reachable acyclic value, the `orderParity.test.ts` check of `compareCodePoints` against `src/engine/serialize`
    - _Requirements: 6.3, 6.7, 15.12_

- [ ] 5. Implement comparison and seeds
  - [ ] 5.1 Implement `src/proof/core/equal.ts`
    - `deepEqualNodes`, `compareOutcomes`, `firstDifference`, with the Outcome-kind rules of Requirement 7.9
    - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.10_

  - [ ] 5.2 Write property test for strict comparison
    - **Property 11: Comparison is strict structural equality**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 6.4**
    - File: `tests/proof/property/p11-strict-comparison.test.ts`; required (not optional)

  - [ ]* 5.3 Write property test for outcome comparison
    - **Property 12: Outcome comparison detects every part**
    - **Validates: Requirements 7.5, 7.6, 7.9**

  - [ ] 5.4 Implement `src/proof/core/seeds.ts`
    - `deriveSeed(seed, ...parts)`: FNV-1a 32-bit over UTF-8 of `${seed}\0${parts.join('\0')}`, result `| 0`
    - _Requirements: 8.5_

  - [ ]* 5.5 Write property test for seed independence
    - **Property 16: Seeds are independent of function order**
    - **Validates: Requirements 8.5**

- [ ] 6. Implement the Root_Normalizer and Path_Redactor
  - [ ] 6.1 Implement `src/proof/core/normalize.ts`
    - `normalizeOutcome`, `normalizeText`, matcher construction for all root forms (native, slash forms, escaped back-slash, `\\?\`, percent-encoded `file://`, real path), longest-first alternation, boundary lookahead, re-canonicalization, `normalization-collision`
    - Use the percent-encoded form observed in 1.6
    - _Requirements: 13.18, 13.19, 13.20, 13.21, 13.22_

  - [ ] 6.2 Implement `src/proof/core/redact.ts`
    - `redactErrorText`, `redactOutcome` (error text only), the four redaction passes of the design
    - _Requirements: 13.10, 13.12, 13.13, 13.14, 13.20_

  - [ ]* 6.3 Write property test for root normalization
    - **Property 13: Root normalization is side-symmetric, bounded and complete**
    - **Validates: Requirements 13.18, 13.19, 13.20, 13.21, 13.22, 13.24, 7.5**

  - [ ]* 6.4 Write property test for path redaction
    - **Property 14: Path redaction hides every other path and never creates divergence**
    - **Validates: Requirements 13.10, 13.12, 13.13, 13.14, 13.16, 13.20**

  - [ ]* 6.5 Write unit tests with the Windows and POSIX example lists
    - The examples of Requirements 13.16 and 13.24 (sibling directory, non-root path unchanged, key collision, two roots compare equal)
    - _Requirements: 13.16, 13.24_

- [ ] 7. Implement delta classification, API-surface check and verdict
  - [ ] 7.1 Implement `src/proof/core/delta.ts`
    - `classifyCase` (rules 1 to 3 of the design), `pickDemonstration` (first in execution order)
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.10_

  - [ ] 7.2 Write property test for delta classification
    - **Property 20: Delta classification**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.9, 11.10**
    - File: `tests/proof/property/p20-delta-classification.test.ts`; required (not optional)

  - [ ] 7.3 Implement `src/proof/core/apiSurface.ts`
    - `compareExports`: removed, added, type, name, arity and primitive differences give `api-surface` Divergences naming the export
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 7.4 Write property test for the API-surface check
    - **Property 19: API-surface differences are divergences**
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [ ] 7.5 Implement `src/proof/core/verdict.ts`
    - `computeVerdict` with the six-step precedence of the design, `functionsLackingEvidence`
    - _Requirements: 9.4, 10.4, 11.6, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7_

  - [ ] 7.6 Write property test for the verdict
    - **Property 21: Verdict**
    - **Validates: Requirements 9.4, 10.4, 11.6, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7**
    - File: `tests/proof/property/p21-verdict.test.ts`; required (not optional)

- [ ] 8. Implement the report builder, serializer and ordering document
  - [ ] 8.1 Implement `src/proof/core/report.ts`
    - `buildReport`, `fallbackReport`, the temp-root-leak check (all root forms including JSON-escaped), sorting rules, `treeHash: null` for early errors
    - _Requirements: 2.4, 8.6, 8.11, 13.2, 13.4, 13.5, 13.17, 13.23_

  - [ ] 8.2 Implement `src/proof/serialize/canonicalReport.ts` and `deserialize.ts`
    - `REPORT_KEY_ORDER`, `canonicalizeReport`, `canonicalReportJson`, `deserializeReport` returning `Result<ProofReport, { issues: string[] }>` with failing paths
    - _Requirements: 1.2, 13.1, 13.3, 13.6, 13.7_

  - [ ]* 8.3 Write property test for serialization round trip
    - **Property 22: Report serialization round trip and schema validation**
    - **Validates: Requirements 13.6, 13.7, 1.2**

  - [ ]* 8.4 Write property test for canonical ordering
    - **Property 23: Canonical ordering**
    - **Validates: Requirements 13.1, 13.3**

  - [ ]* 8.5 Write property test for the no-temporary-root guarantee
    - **Property 15: Reports never contain a temporary root**
    - **Validates: Requirements 13.4, 13.17, 13.23, 15.11**

  - [ ] 8.6 Write the temp-root-leak safety test
    - `tests/proof/unit/leakCheck.test.ts`: a serialized report that still contains a temporary root (native, JSON-escaped, `file://` forms) makes the leak check yield `temp-root-leak`; the fallback report passes the same check; and a deliberately broken leak check (test double that never finds a root) makes the test fail
    - Required (cheap safety check added beyond the brief's list)
    - _Requirements: 13.23, 13.24, 16.3_

  - [ ] 8.7 Write `docs/proof-of-life-ordering.md`
    - Document the key-order table, the sort table, the position and `reasons` order of `unencodableValues`, the canonical node order, the omission of undefined keys, and the replay recipe (using the field names confirmed in 1.8 and 1.9)
    - _Requirements: 13.1, 13.3_

  - [ ]* 8.8 Write a unit test for the ordering document
    - The document lists every key of `REPORT_KEY_ORDER`
    - _Requirements: 13.1_

- [ ] 9. Implement the I/O shell modules
  - [ ] 9.1 Implement `src/proof/shell/integrity.ts`
    - sha512 SRI computation and verification (`node:crypto`), `invalid-integrity` for malformed strings, `integrity-mismatch` message with both strings
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 9.2 Write property test for integrity verification
    - **Property 2: Integrity verification precedes extraction**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 9.3 Implement `src/proof/shell/treeHash.ts`
    - `computeTreeHash` per the definition (sorted by code point, `path 0x00 length 0x00 bytes 0x00`, `sha512-<base64>`)
    - _Requirements: 4.1, 4.3, 4.4_

  - [ ] 9.4 Write property test for Tree_Hash
    - **Property 4: Tree_Hash depends only on paths and bytes**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - File: `tests/proof/property/p04-tree-hash.test.ts`; includes an independent reference implementation; required (not optional)

  - [ ] 9.5 Implement `src/proof/shell/tarball/tarballExtractor.ts`
    - The only importer of `tar`, using the API observed in 1.11; in-memory validation under the limits (5 MiB, 20 MiB, 2000 entries), rejection list of the design, then writes regular files itself
    - _Requirements: 3.1, 3.2, 3.3, 3.8_

  - [ ]* 9.6 Write property test for extraction
    - **Property 3: Extraction preserves safe trees and rejects unsafe archives**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ] 9.7 Implement `src/proof/shell/workDir.ts` and `entry.ts`
    - Work root `gs-<random>` under the real temp path, copy of a Resurrection directory (reject symbolic links, skip `node_modules` and `.git`), cleanup in `finally`; entry resolution via `exports`, `main`, `index.js`, `unloadable-module` for `"type":"module"`
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 4.2, 4.5, 4.6_

  - [ ]* 9.8 Write unit tests for entry resolution and the work directory
    - `exports`, `main`, `index.js`, `type: module`, cleanup after success, harness error and an internal exception
    - _Requirements: 3.5, 3.6_

  - [ ]* 9.9 Write source-scan tests
    - Only the Tarball_Extractor imports `tar` (with a negative test of the scanner); no file in `src/proof/` imports `node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram` or calls `fetch`
    - _Requirements: 1.6, 3.8, 16.1_

- [ ] 10. Implement the SideRuntime and the InProcess_Executor
  - [ ] 10.1 Implement `src/proof/child/prototypes.ts`
    - `snapshotPrototypes`, `diffPrototypes`, `restorePrototypes`, `snapshotsEqual`, `isRestorable`, with an injectable `PrototypeSet`
    - _Requirements: 5.10, 5.11, 5.12_

  - [ ] 10.2 Write property test for prototype delta and restoration
    - **Property 7: Prototype delta and restoration**
    - **Validates: Requirements 5.10, 5.12**
    - File: `tests/proof/property/p07-prototype-delta.test.ts`; uses injected fake prototype sets only (never the real prototypes of the test process); required (not optional)

  - [ ] 10.3 Implement `src/proof/child/stubs.ts`
    - Frozen `Date` (2000-01-01T00:00:00.000Z) and mulberry32 `Math.random` reseeded per call
    - _Requirements: 9.1_

  - [ ] 10.4 Implement `src/proof/child/protocol.ts`
    - Message types, constants, pure `parseProtocolLine` (returns `undefined` for anything that is not valid JSON with `gs: 1` and a known `t`)
    - _Requirements: 5.8_

  - [ ]* 10.5 Write property test for the protocol parser
    - **Property 6: Protocol parser accepts only well-formed messages**
    - **Validates: Requirements 5.8**

  - [ ] 10.6 Implement `src/proof/child/sideRuntime.ts`
    - `load` (capture intrinsics, install stubs, setup module, `createRequire`), `exports`, `call` (reseed, decode, snapshot, call with timeout, diff, restore, verify, encode with budget, run property modules after restoration)
    - _Requirements: 5.4, 5.6, 5.10, 5.11, 5.12, 8.9, 9.1, 11.7_

  - [ ] 10.7 Define `src/proof/shell/executor/types.ts`
    - `Executor`, `SideHandle`, `SideSpec`, `CallRequest`, `CallResult`, `PropertyResult`, `ExecutorError`, `ExportsInfo`, `RestartBudget`, `ExecutorFactory`
    - _Requirements: 5.1, 5.13, 5.14_

  - [ ] 10.8 Implement `src/proof/shell/executor/inProcessExecutor.ts`
    - Same interface, calls `SideRuntime` directly, requires `acknowledgeUnsandboxed: true`, mechanism `in-process`, per-call global stubs, `Promise.race` timeouts, shared `RestartBudget`
    - _Requirements: 5.1, 5.9, 15.1_

- [ ] 11. Implement the driver, orchestrator and engine-level tests
  - [ ] 11.1 Implement `src/proof/shell/driver.ts`
    - `runCase`, `makeProperty`, per-function phases (`explicit`, `generated`, `delta:<id>`), counting from executed attempts, shrink budget, confirmation run, replay parameters using the field names confirmed in 1.8 and 1.9, self-consistency repeat call, `generator-exhausted`, `generator-violates-predicate`, `irreproducible-divergence`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 9.2, 9.3, 9.5, 11.7, 11.8, 11.9_

  - [ ] 11.2 Implement `src/proof/shell/orchestrator.ts` and `src/proof/index.ts`
    - `validateRequest` (throws `RequestValidationError` before any I/O), `runProofOfLife` steps 1 to 9 with cleanup in `finally`, harness errors as values, `toolVersions` read from the running installation; public API exports only
    - Default executor is injected through `executorFactory`; the Sandbox_Executor is wired in 17.5
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.2, 2.3, 3.6, 4.4, 8.3, 10.1, 12.1, 12.3, 16.1, 16.4_

  - [ ] 11.3 Create the synthetic package generator and tarball builder
    - `tests/proof/helpers/syntheticPackage.ts`: the behavior menu of the design (each with arguments arbitrary, unencodable-count oracle and an injectable mutation) written as a directory
    - `tests/proof/helpers/buildTarball.ts`: tiny ustar writer, `zlib.gzipSync`, sha512 integrity (no `tar` dependency in tests)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.10_

  - [ ] 11.4 Write property test for same seed, same bytes
    - **Property 24: Same seed, same bytes**
    - **Validates: Requirements 15.2**
    - File: `tests/proof/property/p24-same-seed.test.ts`; InProcess_Executor; 100 generated packages with about 10 inner Cases each; required (not optional)

  - [ ] 11.5 Write property test for alive against itself
    - **Property 25: A package is alive against itself**
    - **Validates: Requirements 15.3**
    - File: `tests/proof/property/p25-alive-against-itself.test.ts`; required (not optional)

  - [ ] 11.6 Write property test for injected behavior changes
    - **Property 26: Injected behavior changes are detected**
    - **Validates: Requirements 15.4, 15.11, 7.7, 7.8, 10.2**
    - File: `tests/proof/property/p26-injected-changes.test.ts`; required (not optional)

  - [ ]* 11.7 Write property test for request validation
    - **Property 1: Invalid requests are rejected before any child starts**
    - **Validates: Requirements 1.5**

  - [ ]* 11.8 Write property test for counts from executed Cases
    - **Property 17: Counts come from executed Cases**
    - **Validates: Requirements 8.6, 8.11, 9.2, 13.9, 15.10**

  - [ ]* 11.9 Write property test for non-deterministic functions
    - **Property 18: Non-deterministic functions are flagged, not diverged**
    - **Validates: Requirements 9.3, 9.4, 9.5**

  - [ ]* 11.10 Write property test for shrinking and replay
    - **Property 27: Shrinking and replay**
    - **Validates: Requirements 8.7, 8.8**

  - [ ]* 11.11 Write unit tests for the orchestrator
    - All-unencodable function gives `inconclusive` (R15.12), Haunting_Radius rules, `too-many-crashes` with a stub executor that always crashes, `.env` sentinel never appears in a report
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 12.7, 15.12, 16.3, 16.4_

- [ ] 12. Checkpoint: pure core and in-process engine
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run typecheck`, `npm run lint` and `npm test`; report failures before the sandbox is built

- [ ] 13. Implement the tarball recorder (manual script)
  - [ ] 13.1 Write `scripts/recordTarball.ts` and `scripts/lib/recordTarball.ts`
    - Pure, offline-testable logic in `scripts/lib/recordTarball.ts`: read `dist.tarball` and `dist.integrity` of 4.3.2 from the recorded packument `tests/engine/fixtures/lodash.set/npm-449996e32bd2.json`, verify downloaded bytes against that integrity, read author and contributors from the tarball's own `package.json`, build the metadata object (name, version, tarball URL, integrity, source URL, fetch date, license `MIT`, author credits)
    - `scripts/recordTarball.ts`: the only code that performs the download; writes `tests/proof/fixtures/lodash.set-4.3.2.tgz` and `lodash.set-4.3.2.meta.json`; refuses to write when the digest does not match
    - Add the script `"fixtures:record-tarball": "tsx scripts/recordTarball.ts"` to `package.json` (add `--env-file=.env` only if the script needs a variable)
    - Do NOT run the script and do not fetch anything live in this task
    - _Requirements: 14.1_

  - [ ] 13.2 Write offline tests for the recorder logic
    - `tests/proof/unit/recordTarball.test.ts`: integrity verification (accepts matching bytes, rejects a changed byte), metadata building from a small in-test tarball, no network access (the network guard stays active)
    - Required (added so the recorder is trustworthy before the human runs it)
    - _Requirements: 14.1, 14.2_

- [ ] 14. MANUAL STEP: record the lodash.set@4.3.2 tarball (STOP for the user)
  - STOP here. Ask the user to run `npm run fixtures:record-tarball` from the repository root with network access, and to confirm that `tests/proof/fixtures/lodash.set-4.3.2.tgz` and `lodash.set-4.3.2.meta.json` exist
  - Do not run the script, do not download the tarball and do not create these files by hand
  - After the user confirms, read the metadata file, record the fetch date and source URL in `docs/kiro-journal.md` (observed values only), and check that `PREEXISTING.md` names the tarball URL
  - Tasks 15 to 18 depend on this step
  - _Requirements: 14.1, 14.11_

- [ ] 15. Create the lodash.set fixtures
  - [ ] 15.1 Write the hand-written alive resurrection `tests/proof/fixtures/lodash.set-alive/`
    - Extract the Original with `extractTarball` (or `tar -xzf` by hand once) as the starting point; keep the `LICENSE` text, `package.json` author and contributors, `module.exports = set`, function `name` `set` and `length` 3
    - Add the guard in `baseSet`: when a path segment (after key conversion) equals `__proto__`, `constructor` or `prototype`, `set` returns the object unchanged at that point; assignments for earlier segments stay
    - Check the guard against the real lodash 4.17.20 `baseSet` source (the design flags this): fetch the file with `web_fetch` from the lodash GitHub tag 4.17.20 as an agent action (not from a test), compare the guard with the fixture, and write the exact source URL, fetch date and any difference in a comment in the fixture and in `docs/kiro-journal.md`; if the source differs from the design's description, make the fixture document its own rule and update the design text in "Fixtures"
    - The only differences from the Original must be inside the delta region (paths with a dangerous segment)
    - _Requirements: 14.4_

  - [ ] 15.2 Write the deliberately broken resurrection `tests/proof/fixtures/lodash.set-broken/`
    - Same as the alive fixture, plus one change outside the delta: intermediate containers are always `{}` and never `[]` for a numeric next segment, so `set({}, 'a[0]', 1)` returns `{ a: { '0': 1 } }`; the export surface stays unchanged
    - Keep the license and author credits
    - _Requirements: 14.5_

  - [ ] 15.3 Write the fixture integrity test
    - `tests/proof/unit/fixtureIntegrity.test.ts`: the sha512 digest of `lodash.set-4.3.2.tgz` equals `dist.integrity` in `lodash.set-4.3.2.meta.json`, and that equals `versions['4.3.2'].dist.integrity` of the recorded packument `tests/engine/fixtures/lodash.set/npm-449996e32bd2.json`; reads committed files only
    - Required (makes the lodash verdict tests meaningful: they would otherwise run against an unpinned tarball)
    - _Requirements: 14.2, 14.3_

  - [ ]* 15.4 Write fixture content checks
    - License text and author credits present in both resurrection fixtures, same export names and arity as the Original
    - _Requirements: 14.4, 14.5_

- [ ] 16. Implement the lodash.set harness
  - [ ] 16.1 Implement `src/proof/harnesses/lodash.set/config.ts` and `sandbox/pollution.cjs`
    - Generators for object, path (dotted, bracket, array forms) and value arguments; predicate `pathHasDangerousSegment`; the delta generator that builds in-predicate paths by construction; the three explicit delta cases; `caseCount` 100 for the function and the delta phase
    - `pollution.cjs`: plain CommonJS `exports.check = ({ prototypeDelta }) => ...`, reads only the given delta, granted by exact path
    - No lodash-specific code in the engine, only in this directory
    - _Requirements: 14.6, 14.10_

  - [ ]* 16.2 Write property test for delta generators
    - **Property 28: Delta generators satisfy their predicate**
    - **Validates: Requirements 14.6**

- [ ] 17. Implement the Sandbox_Executor
  - [ ] 17.1 Implement `src/proof/shell/executor/sandboxCommand.ts`
    - `buildSandboxArgv` and `buildSandboxEnv` (pure); path rules for `*` and `,` as settled in 1.12; environment set as settled in 1.4; no forbidden `--allow-*` flags
    - _Requirements: 5.2, 5.3, 16.3_

  - [ ]* 17.2 Write property test for the command and environment builders
    - **Property 5: Sandbox command and environment builders**
    - **Validates: Requirements 5.2, 5.3, 16.3**

  - [ ] 17.3 Implement `src/proof/child/runner.ts`
    - NDJSON loop over `SideRuntime`, saves the original `process.stdout.write` for its own messages, then replaces `process.stdout.write`, `process.stderr.write` and `console` methods with no-ops before the package loads, `ready`, `load`, `exports`, `call`, `shutdown`, `fatal`; erasable TypeScript syntax only
    - _Requirements: 5.4, 5.8, 5.10_

  - [ ] 17.4 Implement `src/proof/shell/executor/sandboxExecutor.ts`
    - One child per side with `spawn` options of the design (`shell: false`, `cwd` as settled in 1.5), `probe` (`sandbox-unavailable`), child-side timeout plus parent hard kill after the grace period, `crash`, output-limit kill, respawn, `restoreVerified: false` restart, `SideCounters`, shared `RestartBudget` (`too-many-crashes`), mechanism `node-permission`
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13, 5.14, 16.4_

  - [ ] 17.5 Wire the default executor, the CLI and the `proof:run` script
    - Make the Sandbox_Executor the default `executorFactory` in `orchestrator.ts`; write `src/proof/cli.ts` (`--config`, `--out`, exit codes 0 alive, 1 restless, 2 inconclusive, never writes a report that failed the leak check); add `"proof:run": "tsx src/proof/cli.ts"` to `package.json`
    - _Requirements: 1.3, 1.4, 5.7, 13.23_

- [ ] 18. Write the sandbox integration tests
  - [ ] 18.1 Create the integration helpers and sandbox fixture packages
    - `tests/proof/helpers/sandbox.ts` (create a package in a temp directory, open a side with the Sandbox_Executor, cleanup) and `tests/proof/fixtures/sandbox/` with small CommonJS packages for the tests below
    - _Requirements: 15.1, 15.6_

  - [ ] 18.2 Write the network-denied test
    - `tests/proof/integration/network-denied.test.ts`: a local TCP server in the test process never receives a connection from a package function that tries to connect; the call reports the denial error
    - _Requirements: 15.6_

  - [ ] 18.3 Write the file-read-denied test
    - `tests/proof/integration/fs-denied.test.ts`: reading a file outside the package directory fails with `ERR_ACCESS_DENIED`; a read inside the package succeeds; `process.permission.has` is `false` for write, net, child and worker
    - _Requirements: 15.6_

  - [ ] 18.4 Write the child-process and worker denial tests
    - `tests/proof/integration/child-and-worker-denied.test.ts`: spawning a process fails, creating a worker thread fails (two separate test cases)
    - _Requirements: 15.6_

  - [ ] 18.5 Write the environment-scrubbed test
    - `tests/proof/integration/env-scrubbed.test.ts`: set `GS_TEST_SECRET` in the parent; a package function returning `Object.keys(process.env)` sees no parent variable beyond the allowlist, and the report contains no environment value
    - _Requirements: 5.3, 15.6, 16.3_

  - [ ] 18.6 Write the timeout test
    - `tests/proof/integration/timeout.test.ts`: an async function that never resolves is answered by the child as `timeout` with a Prototype_Delta; a synchronous infinite loop is killed by the parent and recorded as `timeout`; the next call works on a fresh child
    - _Requirements: 5.4, 15.6_

  - [ ] 18.7 Write the `__proto__` isolation test
    - `tests/proof/integration/prototype-isolation.test.ts` (Requirement 5.15): lodash.set on the Original with path `__proto__.polluted` lists the added `Object.prototype` property in the Prototype_Delta of that call; the next call in the same child sees a clean `Object.prototype` and an empty Prototype_Delta; the test process's own `Object.prototype` stays unchanged
    - _Requirements: 5.10, 5.11, 5.15_

  - [ ] 18.8 Write the lodash.set alive test
    - `tests/proof/integration/lodash-alive.test.ts`: Original tarball (fixture) against `lodash.set-alive` with the Sandbox_Executor and the lodash harness gives Verdict `alive` with a Demonstration (property false on the Original, true on the Resurrection, first explicit case `[{}, '__proto__.polluted', 'yes']`)
    - _Requirements: 14.7_

  - [ ] 18.9 Write the lodash.set broken test
    - `tests/proof/integration/lodash-broken.test.ts`: Original against `lodash.set-broken` gives Verdict `restless` with at least one `unexplained` Divergence that has a shrunk counterexample and Replay_Parameters
    - Measure whether the default 100 cases at the default seed find the divergence and log the result (cases, seed, whether found) in `docs/kiro-journal.md`; if not found, add an explicit case or raise `caseCount` in the harness and log why, never weaken the assertion
    - _Requirements: 14.8_

  - [ ]* 18.10 Write the lodash.set self-run test
    - `tests/proof/integration/lodash-self.test.ts`: Original against itself leaves the test process `Object.prototype` unchanged
    - _Requirements: 14.9_

  - [ ]* 18.11 Move the spike scripts into integration tests
    - `smoke` (type stripping under `--permission`), `env-minimum`, `paths-spaces`, and the conditional `other-drive` (reports `skipped: other drive not available` when no other drive exists, never claims it as verified)
    - _Requirements: 5.2, 5.3, 15.1_

  - [ ]* 18.12 Write crash and output-too-large tests
    - `process.exit` and heap exhaustion give `crash` then recovery; a large string gives `output-too-large` and the child survives
    - _Requirements: 5.5, 5.6_

  - [ ]* 18.13 Write restart-event and restart-budget tests
    - A function that freezes `Object.prototype` forces a Restart_Event counted in `restartEvents`; `maxRestarts` exceeded gives `too-many-crashes`
    - _Requirements: 5.12, 5.13, 5.14, 16.4_

- [ ] 19. Measure and log the time budgets
  - [ ] 19.1 Take the first measurement and record it
    - Run `npm test` with `PROOF_LOG_TIMINGS=1 PROOF_BUDGET_MODE=warn` (PowerShell: `$env:PROOF_LOG_TIMINGS='1'; $env:PROOF_BUDGET_MODE='warn'; npm test`), once, and record in `docs/kiro-journal.md`: command, date, Node version, environment, and the wall-clock time of `proof-property` and `proof-integration` as printed
    - Compare against the targets (at most 60 s and at most 120 s). If a target is exceeded, flag the overrun in the journal with the measured value and report it; do not raise the targets and do not state a time that was not measured
    - Also log the child start cost seen by the integration suite next to the spike measurement of 1.13
    - _Requirements: 15.7, 15.8_

- [ ] 20. Update documentation and steering
  - [ ] 20.1 Update README, structure.md and tech.md
    - `README.md`: quick start for `npm run proof:run` and `npm run fixtures:record-tarball`, the three vitest projects, and the sandbox statement (a seat belt against accidental access, not a security boundary against malicious code)
    - `.kiro/steering/structure.md`: add `src/proof/` (modules of the design), `tests/proof/`, `scripts/recordTarball.ts`, `scripts/lib/recordTarball.ts`, `docs/proof-of-life-ordering.md`
    - `.kiro/steering/tech.md`: add `tar` to the stack and the `PROOF_BUDGET_MODE`, `PROOF_LOG_TIMINGS`, `PROOF_TEST_OTHER_DRIVE` test variables; `.env.example` needs no change (no new secrets)
    - Check that `PREEXISTING.md` is complete
    - _Requirements: 14.11, 16.5_

- [ ] 21. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Run the full suite (`npm test`), `npm run typecheck`, `npm run lint` and `npm run build`; record the commands, date, environment and the measured wall-clock times of the two proof suites in `docs/kiro-journal.md` (measured values only; flag any overrun of the 60 s and 120 s targets)
  - Ask the user to review the report of the two lodash.set runs and the journal before the spec is considered done

## Notes

- Tasks marked with `*` are optional sub-tasks. The property tests for Properties 4, 7, 8, 11, 20, 21, 24, 25 and 26 (sub-tasks 9.4, 10.2, 4.3, 5.2, 7.2, 7.6, 11.4, 11.5, 11.6) carry no `*` and are required. The required integration tests are 18.2 to 18.9. The required extras are 3.3, 8.6, 13.2 and 15.3.
- Task 1 (spike) must finish and task 2 (checkpoint) must be approved before anything in tasks 3 to 21 starts. In the dependency graph this is expressed by wave order: no task of tasks 3 to 21 is in a wave earlier than wave 15.
- Spike sub-tasks all append to `docs/kiro-journal.md`, so they run in separate waves.
- Manual steps: 1.7 (optional second drive), 2 (spike review), 14 (user runs `npm run fixtures:record-tarball`), 21 (final review). Waves 23 and later also depend on the user having completed task 14.
- `src/proof/child/` and `child/codec/` use erasable TypeScript syntax only (no enums, parameter properties or namespaces), because Node strips the types natively in the sandbox.
- The InProcess_Executor is used only by tests. The CLI and the default `runProofOfLife` use the Sandbox_Executor.
- Each property test file runs at least 100 generated cases and carries the tag `Feature: proof-of-life-engine, Property N: <text>`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["1.6"] },
    { "id": 6, "tasks": ["1.7"] },
    { "id": 7, "tasks": ["1.8"] },
    { "id": 8, "tasks": ["1.9"] },
    { "id": 9, "tasks": ["1.10"] },
    { "id": 10, "tasks": ["1.11"] },
    { "id": 11, "tasks": ["1.12"] },
    { "id": 12, "tasks": ["1.13"] },
    { "id": 13, "tasks": ["1.14"] },
    { "id": 14, "tasks": ["1.15"] },
    { "id": 15, "tasks": ["3.1", "3.2", "4.1"] },
    { "id": 16, "tasks": ["3.3", "3.4", "4.2"] },
    { "id": 17, "tasks": ["4.3", "4.4", "4.5", "4.6", "5.1", "5.4", "6.1", "9.1", "9.3", "9.5", "9.7", "10.1", "10.3", "10.4"] },
    { "id": 18, "tasks": ["5.2", "5.3", "5.5", "6.2", "7.1", "7.3", "7.5", "9.2", "9.4", "9.6", "9.8", "9.9", "10.2", "10.5", "10.6", "10.7"] },
    { "id": 19, "tasks": ["6.3", "6.4", "6.5", "7.2", "7.4", "7.6", "8.1", "8.2", "10.8"] },
    { "id": 20, "tasks": ["8.3", "8.4", "8.5", "8.6", "8.7", "11.1", "11.3", "13.1"] },
    { "id": 21, "tasks": ["8.8", "11.2"] },
    { "id": 22, "tasks": ["11.4", "11.5", "11.6", "11.7", "11.8", "11.9", "11.10", "11.11", "13.2"] },
    { "id": 23, "tasks": ["15.1", "15.2", "16.1", "17.1", "17.3"] },
    { "id": 24, "tasks": ["15.3", "15.4", "16.2", "17.2", "17.4"] },
    { "id": 25, "tasks": ["17.5", "18.1"] },
    { "id": 26, "tasks": ["18.2", "18.3", "18.4", "18.5", "18.6", "18.7", "18.8", "18.9", "18.10", "18.11", "18.12", "18.13"] },
    { "id": 27, "tasks": ["19.1", "20.1"] }
  ]
}
```
