# Implementation Plan: Medium Agent

## Overview

This plan builds the Medium in the order the user asked for: the shared path rules and the pure modules first (with the CI wiring checks of design Component 2), then the Write_Guard, the Context_Server, the Agent_Definition, the Kiro runner and the Local_Runner steps, then documentation and traceability, and last the manual `kiro-cli` tasks in the WSL clone. Language: TypeScript (strict) for `src/pipeline/` and the tests; dependency-free ES module JavaScript (`.mjs` with `.d.mts` declarations) for the three files of the Agent_Directory `src/pipeline/medium/agent/`. Tests use vitest and fast-check under `tests/medium/`: unit and property files in the vitest project `pipeline` (target 90 s), `tests/medium/integration/*.integration.test.ts` in `pipeline-integration` (target 120 s). Targets are targets, not measurements.

Conventions for every task:

- Agents run only `npm run typecheck`, `npm run lint` and one test file at a time (`npx vitest run <path>`, under about 30 seconds, one run per change; if it fails, read the output before running again). Agents never run `npm test`, `npm run test:*`, a whole vitest project or the full suite, and never run a Manual task. When a task needs one of these, the agent stops and writes "Ready for you to run: <exact command>", then waits for the pasted output (Requirement 12.6).
- A task titled "Manual task (yours)" is a Manual_Task done by the user. It needs `kiro-cli`, WSL or a Credit_Meter_Reading. All WSL commands run at the repository root of the separate clone: `cd ~/graveyard-shift` first, never in `/mnt/c/dev/graveyard-shift`, and `npm ci` or `npm install` is never run inside `/mnt/c/...`.
- Every new test file is under `tests/medium/` and starts with `// Requirements: N.M, ...` naming medium-agent criteria, plus `; resurrection-pipeline N.M, ...` where it covers criteria of that spec (Requirement 12.3). Property test files carry `// Feature: medium-agent, Property <n>: <title>` and run at least 100 cases (`numRuns: 100`; Property 1 with 200). Seeds replay through `FC_SEED`.
- Tests make no network call (the network guard stays active), need no `kiro-cli` binary and spend no credit. `kiro-cli`, `git`, the file system, the meter prompt and the clock are fakes in Local_Runner tests (Requirement 12.1).
- Required tests are not marked. Optional property tests (Properties 5, 6, 10, 12, 13, 14) are marked `*`. The Write_Guard tests (Properties 1, 2, 3 and the case table), the path-rules agreement tests (Property 4, Requirement 3.8 inside Property 1), the fail-closed Local_Runner tests (Properties 7, 11, the runner unit test, the secrets test) and every test a criterion names are required.
- Honesty: no run time, credit figure or count enters code, docs or `docs/kiro-journal.md` unless the user ran it and pasted it; each figure names its source run by date and command (Requirement 12.7).
- Do not change anything under `spikes/` (Requirement 13.3), and do not change `requirements.md`, `design.md` or `.config.kiro` of this spec.

**First pass: skip every optional (*) task; the user decides at the end which to add back.**

## Tasks

- [x] 1. Shared path rules: one source, unchanged results (design Component 2)
  - [x] 1.1 Include `tests/medium/` in the existing vitest projects
    - In `vitest.config.mts`, add `tests/medium/**/*.test.ts` to the `include` of project `pipeline` and exclude `tests/medium/integration/**`; add `tests/medium/integration/**/*.integration.test.ts` to project `pipeline-integration`. Targets and `BUDGET_SECONDS` stay unchanged.
    - Done first (the user's order lists it with the docs) so that `npx vitest run <path>` finds every new test file of the later tasks.
    - _Requirements: 12.2_

  - [x] 1.2 Create the Path_Rules_File
    - Create `src/pipeline/medium/agent/pathRules.mjs` (no imports) and `pathRules.d.mts` with the outline of design Component 2: `ALLOWED_MEDIUM_PATHS` (readonly tuple in the declaration), `RESURRECTION_DIR`, `CONTROL_FILES`, `FORBIDDEN_SEGMENTS`, `CONTROL_CHARACTER_PATTERN`, `codePointLabel`, `firstControlCharacter`, `escapeControlCharacters`, `badPathReason`, `isAllowlisted`, `pathRuleProblem`. Copy the bodies and messages verbatim from `validator.ts`, `safePath.ts`, `limits.ts` and `constants.ts`.
    - Add `src/pipeline/medium/agent/pathRules.mjs` to `deterministicFiles` in `eslint.config.mjs`.
    - Write `tests/medium/unit/pathRules.test.ts`: the runtime export names of `pathRules.mjs` equal the names declared in `pathRules.d.mts`.
    - Run `npm run typecheck`, `npm run lint`, `npx vitest run tests/medium/unit/pathRules.test.ts`.
    - _Requirements: 3.11, 13.1_

  - [x] 1.3 Move the intake path arbitraries into a shared helper
    - Move the path generators of `tests/pipeline/property/p13-intake-paths.test.ts` into `tests/pipeline/helpers/intakePathArbitraries.ts`; `p13` imports them with unchanged assertions.
    - Run `npx vitest run tests/pipeline/property/p13-intake-paths.test.ts`.
    - _Requirements: 3.8; resurrection-pipeline 9.5, 9.6_

  - [x] 1.4 Write property test for the path-rules move (before the move)
    - **Property 4: Moving the path rules keeps every path result**
    - **Validates: Requirements 3.11, 3.12**
    - File: `tests/medium/property/p04-path-rules-oracle.test.ts`. Freeze copies of the pre-move `badPathReason` and `isAllowlisted` (`validator.ts`), `isAllowlisted` (`fsEntries.ts`, `gitEntries.ts`), `isAllowedCommitPath` (`pushPlan.ts`) and `safePathForLog` (`safePath.ts`) in the test as oracles, and compare with the Path_Rules_File over `intakePathArbitraries` and arbitrary strings. Write and pass this test before task 1.5 changes the sources.

  - [x] 1.5 Take the rules from the Path_Rules_File in intake, entry readers and push plan
    - Apply the table of design Component 2: `validator.ts` imports `badPathReason` and `isAllowlisted`; `safePath.ts` re-exports `CONTROL_CHARACTER_PATTERN`, `firstControlCharacter`, `codePointLabel` and defines `safePathForLog` as `escapeControlCharacters`; `limits.ts` re-exports `FORBIDDEN_SEGMENTS`; `constants.ts` re-exports `ALLOWED_MEDIUM_PATHS` (header comment names it); `fsEntries.ts`, `gitEntries.ts` import `isAllowlisted`; `pushPlan.ts` `isAllowedCommitPath` calls the imported `isAllowlisted`. Delete the local copies. TypeScript imports use the real extension (`.../medium/agent/pathRules.mjs`).
    - CI wiring checks, each once: `npm run typecheck`; `npm run lint`; `npx tsx scripts/ci/intake.ts` with no argument must exit with code 64 (it loads the intake import graph under tsx); then one file at a time `npx vitest run tests/pipeline/unit/intakeValidator.test.ts`, `tests/pipeline/unit/fsEntries.test.ts`, `tests/pipeline/unit/push.test.ts`, `tests/pipeline/integration/gitEntries.integration.test.ts`, `tests/medium/property/p04-path-rules-oracle.test.ts`. Expected values of existing tests stay unchanged; if one would need a change, stop and ask the user.
    - _Requirements: 3.11, 3.12; resurrection-pipeline 9.5, 9.6_

- [x] 2. Medium core helpers (pure)
  - [x] 2.1 Implement `src/pipeline/medium/core/mediumEnv.ts`
    - `MEDIUM_ENV_KEYS` (`PATH`, `HOME`, `USER`, `LANG`, `TERM`, with the comment that keys are added only from the Journal records of Requirements 11.8 and 11.7), `SECRET_KEY_PATTERN`, `MEDIUM_ADDED_KEYS`, `buildMediumEnv(caller, added)` with the three steps of design Component 5.
    - _Requirements: 11.1, 11.2_

  - [x] 2.2 Implement `src/pipeline/medium/core/presetMenu.ts` and its example test
    - `buildPresetMenu`, `deltaKindsOf`, `printPresetMenu` (`canonicalJsonText(orderKeys(...))` plus a final line feed), `parsePresetMenu` (strict zod), with the key orders and list orders of the design's Data Models table.
    - Write `tests/medium/unit/presetMenu.test.ts`: the printed menu built from `PRESETS`, `DeltaSchema` and `CI_OWNED_KEYS` names every preset, function, delta function, class name, delta kind and CI-owned key of the code and nothing else.
    - _Requirements: 5.3, 5.4_

  - [ ]* 2.3 Write property test for the Preset_Menu_File
    - **Property 5: Preset_Menu_File round trip and determinism**
    - **Validates: Requirements 5.4**
    - File: `tests/medium/property/p05-preset-menu-roundtrip.test.ts`.

  - [x] 2.4 Implement `src/pipeline/medium/core/guardLog.ts`
    - `summarizeGuardLog(text)`: line count of non-empty lines and the DENY lines (second space-separated field `DENY`), in order.
    - _Requirements: 10.3, 10.4_

- [x] 3. Local_Runner core helpers (pure)
  - [x] 3.1 Implement `src/pipeline/local/core/porcelain.ts`
    - `GIT_STATUS_ARGV` (`status --porcelain -z --untracked-files=all`), `LEDGER_FIRST_MESSAGE` (`commit ledger.json first`), `parsePorcelainZ` (rename and copy records yield both paths), `unexpectedChangedPaths`, `dirtyTreeLines` (paths escaped with `safePathForLog`).
    - _Requirements: 10.1, 10.2, 10.5_

  - [ ]* 3.2 Write property test for the porcelain reader
    - **Property 10: Changed paths are read and classified exactly**
    - **Validates: Requirements 10.2, 10.5**
    - File: `tests/medium/property/p10-porcelain.test.ts`.

  - [x] 3.3 Implement `src/pipeline/local/core/mediumContext.ts`
    - `MEDIUM_CONTEXT_DIR`, `GUARD_LOG_FILE_REL`, `measurementFilePath`, `planMediumContext` and `contextScanFindings` as in design Component 7: generated files get the full `redactionScanFindsAnything` scan; Original files only `findIdentity`; findings returned as `rel` in plan order.
    - _Requirements: 5.1, 5.2, 5.5_

  - [ ]* 3.4 Write property test for the Medium_Context plan
    - **Property 6: The Medium_Context plan holds exactly the inputs, byte for byte**
    - **Validates: Requirements 5.1, 5.2**
    - File: `tests/medium/property/p06-context-plan.test.ts`.

- [x] 4. Write_Guard (design Component 3)
  - [x] 4.1 Implement `src/pipeline/medium/agent/writeGuard.mjs` and `writeGuard.d.mts`
    - Imports only `node:fs`, `node:path`, `node:url` and `./pathRules.mjs`; reads only `process.env.GUARD_LOG_FILE`.
    - Export `WRITE_TOOLS`, `PATH_KEYS`, `decide(eventText, fs)` with the nine decision steps and the Root_Relative_Form of design Component 3 (no fallback to `process.cwd()`), and `formatLogLine(decision, at)` (200 code-unit cut, then `escapeControlCharacters`; internal errors logged by code or name only).
    - `main` runs only when the file is the process entry: read standard input, `decide` with the real file system, write `stderrLine`, append the log line when `GUARD_LOG_FILE` is non-empty (append failure ignored), exit with `exitCode`; any exception exits 2; nothing on standard output.
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 11.3_

  - [x] 4.2 Write property test for the guard paths
    - **Property 1: The Write_Guard allows exactly the paths the Shared_Path_Rules accept**
    - **Validates: Requirements 3.2, 3.3, 3.8**
    - File: `tests/medium/property/p01-guard-paths.test.ts`, in-process `decide` on an empty temporary root with the real file system, 200 runs, generators from `tests/pipeline/helpers/intakePathArbitraries.ts` plus `./`, absolute inside and outside, `//`, `~` and `.graveyard-work/` paths. Checks both directions against the Intake_Validator path checks.

  - [x] 4.3 Write property test for malformed events
    - **Property 2: The Write_Guard is total and fails closed on malformed events**
    - **Validates: Requirements 3.4, 3.6**
    - File: `tests/medium/property/p02-guard-total.test.ts`, fake `GuardFs`.

  - [x] 4.4 Write property test for Guard_Log lines
    - **Property 3: Guard_Log lines are well formed and round trip through the Local_Runner reader**
    - **Validates: Requirements 4.1, 4.2, 4.3, 10.3**
    - File: `tests/medium/property/p03-guard-log.test.ts`, `formatLogLine` with `summarizeGuardLog` (task 2.4).

  - [x] 4.5 Write the Write_Guard case-table integration test
    - File: `tests/medium/integration/writeGuard.integration.test.ts`. Start the guard as a child process (`node src/pipeline/medium/agent/writeGuard.mjs`) for every case of `spikes/kiro-agent/hooks/pre-tool-write-guard.test-cases.json` with its `expect`, counted from the file, plus new cases for each condition of Requirement 3.3 and for 3.4 to 3.6 (invalid JSON, non-object, missing and non-string `tool_name`, no target path, empty path, missing or non-existent `cwd`, non-write tool). Assert the exit code, the `write-guard: blocked:` prefix for blocked cases, empty standard output and no file other than the Guard_Log in the temporary root. Report `needs: symlink` cases as skipped where links cannot be created and `needs: posix` cases as skipped on Windows.
    - Run `npx vitest run tests/medium/integration/writeGuard.integration.test.ts`.
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9_

  - [x] 4.6 Write the Guard_Log integration test
    - File: `tests/medium/integration/guardLog.integration.test.ts`, child process with `GUARD_LOG_FILE` in a temporary directory: an allowed write, a blocked write, a non-Write_Tool call, invalid JSON, a missing `tool_name`, a path of more than 200 code units, a path with a control character, an existing log that is only appended to, and an unwritable Guard_Log (missing parent, a directory) with unchanged exit code and standard error.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_

- [x] 5. Checkpoint: path-rules move and Write_Guard
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings.
  - Ready for you to run: `npx vitest run --project pipeline --project pipeline-integration`. Paste the output. Existing intake, entry-reader and push-plan tests must pass with unchanged expected values (Requirement 3.12). Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 3.12, 12.6_

- [x] 6. Context_Server (design Component 4)
  - [x] 6.1 Implement `src/pipeline/medium/agent/contextServer.mjs` and `contextServer.d.mts`
    - Imports only `node:fs`, `node:path`, `node:url`; no write, rename, delete, network or child-process call; no `process.env`.
    - `--context <dir>` only, relative paths resolved against the repository root from `import.meta.url`; start failures exit 1 with a reason on standard error and nothing on standard output.
    - Newline-delimited JSON-RPC 2.0 from `spikes/kiro-agent/mcp-stub/server.mjs`: `initialize` (protocol negotiation as the stub), `ping`, `tools/list`, `tools/call`, no reply to notifications; errors `-32700` (id `null`), `-32600`, `-32601`, `-32602` `Invalid params`, `-32603`; continue after an error; exit on a line over 1,048,576 bytes.
    - The six tools with `additionalProperties: false` schemas; `MAX_FILE_BYTES = 1048576` checked with `fstatSync` before reading; strict UTF-8 for `read_original_file`; containment by `realpath` inside `original/` with the fixed text `path not found or not allowed`; exported pure `buildAdvisories(certificateText, measurementText | null)` as in the design.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 11.3_

  - [x] 6.2 Check the server constants against the TypeScript sources
    - Extend `tests/medium/unit/pathRules.test.ts`: the server's `MAX_FILE_BYTES` equals `INTAKE_LIMITS.maxFileBytes`, and its six tool names equal the list of Requirement 6.2.
    - _Requirements: 6.2, 6.5_

  - [x] 6.3 Write the Context_Server integration test
    - File: `tests/medium/integration/contextServer.integration.test.ts`, child process against a temporary Medium_Context, no network: tool list and each tool output; `get_advisories` with and without `measurement.json`; containment errors of 6.3 (`..`, absolute, U+0000, missing, directory, link outside `original/`, links skipped where unsupported); the size limit on each tool and the UTF-8 error; the protocol errors of 6.6 each followed by an answered valid request; the start failures of 6.7 (missing argument, not a directory); the over-long line of 6.8.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [ ]* 6.4 Write property test for the Context_Server protocol
    - **Property 12: The Context_Server answers every request and only requests**
    - **Validates: Requirements 6.1, 6.6**
    - Added to `tests/medium/integration/contextServer.integration.test.ts`, one long-lived process.

  - [ ]* 6.5 Write property test for `read_original_file` containment
    - **Property 13: `read_original_file` never returns bytes from outside the Original files**
    - **Validates: Requirements 6.3**
    - Added to `tests/medium/integration/contextServer.integration.test.ts`, one long-lived process.

  - [ ]* 6.6 Write property test for `get_advisories`
    - **Property 14: `get_advisories` copies advisories and the measurement unchanged**
    - **Validates: Requirements 6.2**
    - File: `tests/medium/property/p14-advisories.test.ts`, in-process `buildAdvisories`.

- [x] 7. Agent_Definition and Agent_Prompt (design Components 1 and 6)
  - [x] 7.1 Create `.kiro/agents/medium.json`
    - The JSON of design Component 1 (server key `mediumcontext`, six `@mediumcontext/...` tools, `excludedTools`, `includeMcpJson` and `includePowers` false, the two steering `resources`, the permission rules, the PreToolUse hook `node src/pipeline/medium/agent/writeGuard.mjs` with the anchored matcher) and the inline Agent_Prompt of design Component 6. No `model`, `trust`, `allowedTools`, `toolsSettings`; no `spikes/` substring. Place nothing under `~/.kiro/`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 13.1, 13.4_

  - [x] 7.2 Write the agent definition test
    - File: `tests/medium/unit/agentDefinition.test.ts`: a checker over the parsed JSON that names each broken criterion or path, plus a table of single mutations of the committed file (one per criterion of 1.1 to 1.6, 2.1 to 2.5 and 3.1, a `file://` or non-string prompt, a missing or `spikes/` script path, the `spikes/` substring), each of which the checker must reject. Also checks that exactly one Agent_Definition for `medium` exists outside `spikes/`, that both steering files exist, and that the matcher matches every Write_Tool name. No `kiro-cli`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 13.4_

  - [x] 7.3 Write the Agent_Prompt test
    - File: `tests/medium/unit/agentPrompt.test.ts`: one list of required phrases (at least one per statement of 7.1 to 7.7), compared with whitespace runs collapsed; every `DeltaSchema` kind and every `CI_OWNED_KEYS` key named; every backtick token in the allowed set of 7.8; every Context_Server tool name (plain or `@<server>/<tool>`) in the Agent_Prompt and in `buildMediumPrompt` output is one of the six.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.4_

- [x] 8. Kiro argument list and Medium_Environment (resurrection-pipeline Property 33 as amended)
  - [x] 8.1 Change `kiroArgs.ts` and `kiroRunner.ts`, and update their existing tests
    - `buildKiroArgs` returns the seven-element list with `--require-mcp-startup`; `prompt.ts` unchanged.
    - `kiroRunner.ts`: `KiroRunnerDeps` gains `cwd` and `added`; `run()` builds `buildMediumEnv(deps.env, deps.added)`, prints `Medium environment keys: <sorted names>` through `deps.err` (names only), and calls `deps.spawn(KIRO_COMMAND, buildKiroArgs(name), { env, cwd, shell: false, stdio })` once. Remove `scrubMediumEnv`. The usage-limit text match stays as is.
    - Update `tests/pipeline/unit/kiroRunner.test.ts` in its own file: seven elements; "keeps only Medium_Env_Keys" replaces the `GITHUB_TOKEN` scrub test; spawn receives `GRAVEYARD_CERTIFICATE_PATH`, `GUARD_LOG_FILE` and `cwd`. Run that file once.
    - _Requirements: 2.6, 8.5, 8.6, 10.7, 11.1, 11.2, 11.6; resurrection-pipeline 6.6, 6.7_

  - [x] 8.2 Write property test for the Task_Prompt and argument list
    - **Property 8: The Task_Prompt and argument list carry only the package name**
    - **Validates: Requirements 2.6, 8.2, 8.3, 8.5**
    - File: `tests/medium/property/p08-task-prompt.test.ts`; the no-`--trust` check also runs on the argument list that `createKiroRunner` passes to a fake `spawn` (Requirement 2.6).

  - [x] 8.3 Write property test for the Medium_Environment
    - **Property 9: The Medium_Environment is an allowlist**
    - **Validates: Requirements 11.1, 11.2, 11.6**
    - File: `tests/medium/property/p09-medium-env.test.ts`; the printed key line is read from a fake `spawn` run of `createKiroRunner`.

- [x] 9. Local_Runner before the Medium starts (`src/pipeline/local/shell/resurrect.ts`)
  - [x] 9.1 Add the new deps and the pre-run steps
    - `ResurrectDeps` gains `gitStatus`, `extract`, `identity`, `platform`; `ResurrectFs` gains `readOptional`, `removeTree` (refuses a link), `writeBytes`, `truncate`. Wire production in `createResurrectDeps` (`nodeCommandRunner` with `GIT_STATUS_ARGV` at the repository root; `extractTarball` with `DEFAULT_EXTRACT_LIMITS`, as `extractOriginal` in `scripts/ci/intake.ts`; `identityValuesFromEnv`).
    - Step 7 for a run without `--stub`, in the order of the design flowchart: `git status` clean check (dirty paths escaped, `commit ledger.json first` when only `ledger.json`; read failure fails closed); plan the Medium_Context (no-tarball check, `extract` error with `kind` and `reason`, preset menu, Measurement_File by name and certificate version); scan the plan before writing; remove the old context and write the new one; create or empty `.graveyard-work/guard.log`. Any failure: no Medium, no reading, no Ledger entry, non-zero exit, cause named with `safePathForLog`, no matched text printed. The stub path stays unchanged.
    - Update `tests/pipeline/unit/resurrect.test.ts` for the new deps (a non-stub run needs a clean `gitStatus` fake). Run that file once.
    - _Requirements: 4.5, 4.6, 5.1, 5.2, 5.5, 5.6, 5.7, 9.7, 10.1, 10.2, 10.6, 13.6_

- [x] 10. Local_Runner Medium step and checks after the run
  - [x] 10.1 Implement the Medium step, the Ledger entry, the interrupt and the post-run checks
    - Print the Credit_Ceiling statement once, ask the first reading, call `deps.kiro` (spawn exactly once) with the absolute paths of the certificate file and the Guard_Log, then the second reading. `not-found` and `failed-to-start`: no second reading, no Ledger entry, no push, cause printed, non-zero exit. A rejected second reading (readline `SIGINT` or `close`) is an interrupt: no Ledger entry, no push, a note that the readings go into the Journal by hand, exit 130. No SIGINT handler is installed.
    - `exited`: append one `buildLocalEntry` entry (readings as typed, `not provided` for empty, no `cliUsage` key), then the checks in the order 10.7, 10.3, 10.4, 10.5 (with 10.6), 10.8, stopping at the first failure and deleting no file; when all pass, call the Push_Script once and exit with its code. The 10.8 check (intake plus `parseDeltasFile` and `parseHarnessFile`) replaces today's step 9 and also runs for a stub run.
    - Extend `tests/pipeline/unit/resurrect.test.ts` for the changed step order. Run that file once.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8, 9.9, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10; resurrection-pipeline 6.8, 6.9, 6.10, 7.1, 7.2, 7.6_

  - [x] 10.2 Write the Local_Runner Medium unit test
    - File: `tests/medium/unit/localRunnerMedium.test.ts` with a fake `spawn` through `createKiroRunner`, fake git, fake file system, fake prompt and fake clock: Guard_Log path and emptying (4.5), Guard_Log creation failure (4.6), Medium_Context with and without a Measurement_File (5.1), no tarball, extract error and write error (5.6), no commit path under `.graveyard-work/` (5.7), an unsupported package name with zero spawns (8.3), argv array and `cwd` (8.6), each `createKiroRunner` outcome kind, the interrupt at the second reading, the stub run with no spawn and no context (9.1 to 9.10), the dirty tree with `commit ledger.json first` and the failed first read with zero spawns and no Ledger entry, each failing post-run check with zero pushes, and the passing path with one push (10.1 to 10.11).
    - _Requirements: 4.5, 4.6, 5.1, 5.6, 5.7, 8.3, 8.6, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 10.1, 10.11_

  - [x] 10.3 Write property test for the context scan
    - **Property 7: The context scan stops the run on generated-file findings and on identity values only**
    - **Validates: Requirements 5.5**
    - File: `tests/medium/property/p07-context-scan.test.ts`, Local_Runner with fakes.

  - [x] 10.4 Write property test for the run sequence
    - **Property 11: The Local_Runner makes one attempt and pushes only when every check passes**
    - **Validates: Requirements 4.6, 5.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 10.9, 10.10**
    - File: `tests/medium/property/p11-local-runner-checks.test.ts`, model-based with fakes.

  - [x] 10.5 Write the secrets integration test
    - File: `tests/medium/integration/secrets.integration.test.ts`: sentinel values in `GITHUB_TOKEN`, one other variable and a `.env` file at the working directory; run the Local_Runner with fakes, the Write_Guard and the Context_Server as child processes; no sentinel in standard output, standard error, the Guard_Log, the Ledger entry or any Medium_Context file.
    - _Requirements: 11.4; resurrection-pipeline 6.7_

- [x] 11. Source scans for the Medium side
  - [x] 11.1 Write `tests/medium/unit/sourceScan.test.ts`
    - Reads every `.mjs` file of the Agent_Directory. Checks: Write_Guard imports only `node:` modules and `./pathRules.mjs` (3.7); the five files of 3.11 import the Path_Rules_File, and no file of `src/pipeline/intake/core/`, none of the five and not the Write_Guard defines its own control-character pattern, forbidden segment list or allowed-path check (3.11); the Context_Server imports no network or child-process module and calls no write, rename or delete function (6.4); only `prompt.ts` and `kiroArgs.ts` under `src/` and `scripts/` hold the `MEDIUM_PROMPT_PREFIX` text or the literal `--agent` (8.1); `process.env` use (11.3); no LLM client import in the agent files (11.5); no import of `src/pipeline/undertaker/` or `src/pipeline/gravedigger/` from the agent files or `src/pipeline/medium/`, naming file and import (13.5); only the Local_Runner receives the Gravedigger result on the Medium side (13.6); the guard and server import only Node built-ins and Agent_Directory files, and `package.json` has no new dependency for them (13.7).
    - _Requirements: 3.7, 3.11, 6.4, 8.1, 11.3, 11.5, 13.5, 13.6, 13.7_

- [x] 12. Checkpoint: code complete
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings.
  - Ready for you to run: `npx vitest run --project pipeline --project pipeline-integration`. Paste the output. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 12.1, 12.6_

- [x] 13. Documentation and traceability
  - [x] 13.1 Write the README subsection and the Enforcement_Test_Doc
    - `README.md`: a subsection under "Running the Medium in WSL" with the content of design Component 9 (the Medium runs only on the user's machine in WSL; the Write_Guard is the enforcement and the model's refusals are not; `kiro-cli agent validate --path .kiro/agents/medium.json`; the enforcement test in `docs/medium-enforcement-test.md`; the `kiro-cli whoami` check of 11.8 before the first real run; readings of an interrupted run recorded in the Journal by hand).
    - `docs/medium-enforcement-test.md`: steps 1 to 6 of design Component 9 against `.kiro/agents/medium.json`, only `--agent medium`, with meter readings before and after the run and the list of what to record.
    - _Requirements: 1.8, 3.10, 9.9, 13.9, 13.10_

  - [x] 13.2 Update steering and the Journal
    - `.kiro/steering/structure.md`: one line each for `.kiro/agents/medium.json`, `src/pipeline/medium/agent/writeGuard.mjs`, `contextServer.mjs`, `pathRules.mjs`, `docs/medium-enforcement-test.md`, the new core modules and `tests/medium/`. `.kiro/steering/tech.md`: the `pipeline` and `pipeline-integration` project lines name `tests/medium`.
    - `docs/kiro-journal.md`: an entry for this change with no number that the user did not paste. `PREEXISTING.md` stays unchanged (no new dependency or data source).
    - _Requirements: 12.7, 13.2, 13.8_

  - [x] 13.3 Map `tests/medium/` in the trace and classify the manual criteria
    - `scripts/trace.ts`: add `{ name: "medium-agent", requirements: ".kiro/specs/medium-agent/requirements.md", testsDir: "tests/medium" }` to `SPECS`.
    - `docs/traceability-gaps.json`: entries with class `manual` for 1.8, 2.7, 3.10, 11.7 and 11.8. Other uncited criteria are classified after the user's `npm run trace` output in task 14.
    - _Requirements: 12.4_

  - [x] 13.4 Write the docs test
    - File: `tests/medium/unit/docs.test.ts`: every path of 13.2 is in `structure.md` and exists; the README subsection contains `kiro-cli agent validate`, `.kiro/agents/medium.json` and `docs/medium-enforcement-test.md`; the Enforcement_Test_Doc names `.kiro/agents/medium.json` and no `--agent` value other than `medium`; `.gitignore` keeps `/.graveyard-work/`; the spike files of 13.3 exist with pinned sha256 values; no file of this spec lies under `~/.kiro/`.
    - _Requirements: 5.7, 13.1, 13.2, 13.3, 13.9, 13.10_

  - [x] 13.5 Write the requirements header test
    - File: `tests/medium/unit/requirementsHeader.test.ts`: every test file under `tests/medium/` starts with a `// Requirements:` line whose bare list names existing medium-agent criteria and whose `; resurrection-pipeline` group names existing criteria of that spec; files under `tests/medium/integration/` are named `*.integration.test.ts`.
    - _Requirements: 12.2, 12.3_

- [-] 14. Checkpoint: full suite and trace, run by the user
  - Agent: run `npm run typecheck` and `npm run lint` and fix findings. Do not run `npm test`.
  - Ready for you to run: `npm test`, then `npm run trace`. Paste both outputs. The agent then adds a `docs/traceability-gaps.json` entry for each medium-agent criterion the trace reports as unclassified, and asks the user to run `npm run trace` again until it exits with code 0. Journal spans of `pipeline` and `pipeline-integration` come only from the pasted `npm test` output.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 12.4, 12.6, 12.7_

- [ ] 15. Manual tasks in the WSL clone (Kiro CLI)
  - [ ] 15.1 Manual task (yours): login check with the Medium_Environment keys (before any real run)
    - Credit-free in intent; whether `kiro-cli whoami` spends credits is not documented, so the readings are recorded. In WSL:
      `cd ~/graveyard-shift && git pull origin main`
      Note your credit meter reading, then run
      `env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG="$LANG" TERM="$TERM" kiro-cli whoami; echo "exit=$?"`
      and note the meter reading again.
    - Paste back: the output, the exit code and both readings. Record them in `docs/kiro-journal.md` (dated, with the command). The check passes only if the output shows a logged-in account. If it fails, stop: a key is added to `MEDIUM_ENV_KEYS` only on the basis of this record (or the 11.7 record), by a later agent change that names the record.
    - _Requirements: 11.8, 12.5_

  - [ ] 15.2 Manual task (yours): agent validation and enforcement run (spends credits)
    - Start only after 15.1 passed and this spec's changes are on `main`. In WSL:
      `cd ~/graveyard-shift && git pull origin main`
      `kiro-cli agent validate --path .kiro/agents/medium.json; echo "exit=$?"`
      `kiro-cli agent list`
      Validation passes only with exit code 0, no reported error, and `medium` shown as `Workspace (v3 format)`.
    - Then follow `docs/medium-enforcement-test.md` steps 2 to 6 at the repository root, without any `--trust-*` flag: prepare the test Medium_Context, create the sentinel outside the clone, note the credit meter reading, run the `GUARD_LOG_FILE="$PWD/.graveyard-work/guard.log" kiro-cli chat --v3 --no-interactive --require-mcp-startup --agent medium "<test instruction from the doc>"` command, note the reading again, then clean up.
    - Paste back and record in `docs/kiro-journal.md` (dated, with the commands): the validate output and exit code, the `agent list` output, both meter readings, and every item of Requirement 3.10 (Guard_Log lines; permission deny, guard block or both per refused write; the `tool_input` key of each path; matcher semantics; whether `GUARD_LOG_FILE` reached the hook; the agent's tool list compared with 1.2 and 1.3; whether the Context_Server call ran without a refusal; the sentinel read result and whether its content appeared).
    - _Requirements: 1.8, 2.7, 3.10, 12.5, 12.7_

  - [ ] 15.3 Apply the recorded results (agent, after the pasted records)
    - Read the Journal records of 15.1 and 15.2. If a result contradicts the design (for example the hook matcher matched nothing, a write was allowed outside the three paths, the `mcp` match form refused the tools, the login check failed, or the sentinel content appeared), stop and ask the user before changing code. Otherwise change nothing; the deferred points of requirements.md ("Deferred to recorded runs") stay deferred.
    - The first real Medium run, which also records Requirement 11.7, is resurrection-pipeline task 16.1 (M9). It is not repeated here.
    - _Requirements: 3.10, 11.1, 11.7, 11.8_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP (Properties 5, 6, 10, 12, 13, 14). Properties 1, 2, 3, 4, 7, 8, 9 and 11 are required.
- The vitest glob change (task 1.1) is done first instead of with the docs, so that each new test file can be run alone from the start.
- Property 4 (task 1.4) is written against frozen copies of the pre-move code before task 1.5 changes the sources, so the oracle is the old behaviour and not the new one.
- Manual tasks: 15.1 (Requirement 11.8, before any real run) and 15.2 (Requirements 1.8, 2.7, 3.10). The first real Medium run and the 11.7 record are resurrection-pipeline task 16.1 (M9), which needs this spec and is not part of this list.
- Existing tests changed by this spec stay in their files: `tests/pipeline/unit/kiroRunner.test.ts` (resurrection-pipeline Property 33 as amended), `tests/pipeline/unit/resurrect.test.ts`, `tests/pipeline/property/p13-intake-paths.test.ts` (arbitraries moved, assertions unchanged).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1", "2.2", "2.4", "3.1", "3.3"] },
    { "id": 1, "tasks": ["1.4", "2.3", "3.2", "3.4", "4.1", "8.1"] },
    { "id": 2, "tasks": ["1.5", "4.2", "4.3", "4.4", "6.1", "8.2", "8.3"] },
    { "id": 3, "tasks": ["4.5", "4.6", "6.2", "6.3", "6.6", "7.1", "9.1"] },
    { "id": 4, "tasks": ["6.4", "7.2", "7.3", "10.1"] },
    { "id": 5, "tasks": ["6.5", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 6, "tasks": ["11.1", "13.1", "13.2", "13.3", "13.5"] },
    { "id": 7, "tasks": ["13.4"] },
    { "id": 8, "tasks": ["15.1"] },
    { "id": 9, "tasks": ["15.2"] },
    { "id": 10, "tasks": ["15.3"] }
  ]
}
```
