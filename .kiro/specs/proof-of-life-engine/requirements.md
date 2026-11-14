# Requirements Document

## Introduction

The Proof of Life Engine is the evidence module of Graveyard Shift (TypeScript, in the existing Next.js project, in `src/proof/` next to `src/engine/`). Given an Original (an integrity-pinned npm tarball) and a Resurrection (a local directory or tarball), the Proof_Engine runs differential property-based tests with fast-check and produces a Proof_Report. The Proof_Engine runs each side in a separate sandboxed child process, compares return values, thrown errors, argument mutations and async outcomes, allows only Declared_Deltas, and reports a verdict of `alive`, `restless` or `inconclusive`. The first test subject is lodash.set@4.3.2 (declared delta in docs/demo-packages.md). The ip package is out of scope for this spec, but the design must not prevent it later. The Proof_Engine makes no LLM calls, and its tests make no network calls.

Per the necromancy laws and honesty rules, every number in a Proof_Report is measured during the run, a failed resurrection is reported as `restless` and never hidden, and a harness failure is never reported as `alive`.

### Verified environment facts (checked on this machine, Node v26.13.1, Windows)

- `node --permission` is available together with `--allow-fs-read`, `--allow-fs-write`, `--allow-net`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`, `--allow-ffi` and `--allow-inspector`.
- Under `node --permission --allow-fs-read=<dir>`: reading a file outside `<dir>` fails with `ERR_ACCESS_DENIED`; `child_process.execSync` fails with `ERR_ACCESS_DENIED`; creating a `worker_threads` Worker fails with `ERR_ACCESS_DENIED`; a TCP connect to 127.0.0.1 fails with `ERR_ACCESS_DENIED`; `process.permission.has('fs.write')`, `has('net')`, `has('child')` and `has('worker')` return `false`.
- The permission model does not scrub `process.env`. A plain `node` child inherited a parent variable, so the Sandbox_Executor must pass an explicit minimal `env`.
- Not yet verified here: that a package directory on a different drive or a path with spaces works with `--allow-fs-read`, and the minimum environment variables Node needs on Windows (for example `SystemRoot`). Integration tests must establish both.
- From the Node.js documentation (not re-verified here): the permission model is a guard against accidental access and is not a security boundary against deliberately malicious code. The Proof_Engine therefore targets non-malicious packages that have passed the autopsy and license gates, and the Proof_Report states the sandbox mechanism it used.
- The recorded packument tests/engine/fixtures/lodash.set/npm-449996e32bd2.json (fetched 2026-11-14T18:29:34Z from https://registry.npmjs.org/lodash.set) lists for version 4.3.2: license MIT, tarball `https://registry.npmjs.org/lodash.set/-/lodash.set-4.3.2.tgz`, and a `dist.integrity` sha512 SRI string. No tarball is committed yet.

### Assumptions

- A1: Code lives in `src/proof/`, tests in `tests/proof/`, fixtures in `tests/proof/fixtures/`. The structure steering file is updated when code is added.
- A2: Scope is CommonJS packages with no runtime dependencies (lodash.set has none). A package that needs a dependency makes the module unloadable and yields `inconclusive`. ESM, native addons, WASM and network-dependent packages are out of scope.
- A3: Harness_Config is trusted code written by the Graveyard Shift team, loaded in the parent process. Generators and input predicates run in the parent. Because closures cannot cross a process boundary, the new-behavior property and any stubs are sandbox-side module files referenced by path in the Harness_Config, and are loaded inside the child process with read access.
- A4: Defaults (all configurable, none measured yet): 100 cases per function, per-call timeout 1000 ms, child heap limit 256 MB, encoded outcome limit 1 MiB. Tarball limits: 5 MiB compressed, 20 MiB uncompressed, 2,000 entries. These are limits, not measurements, and the design may revise them.
- A5: The Resurrection hash is a tree hash over extracted file contents, so a directory and a tarball with the same files get the same hash. The Original's integrity hash is the registry `dist.integrity` string.
- A6: By default the sandbox runner freezes `Date`/`Date.now()` to 2000-01-01T00:00:00.000Z and replaces `Math.random` with a PRNG seeded per case. The Harness_Config can switch this off for a function or exclude the function.
- A7: Function-typed arguments are not generated. Function-typed return values are compared by `typeof`, `name` and `length` only, not by behavior.
- A8: The report has no wall-clock timestamps. It includes the Node version, so it is byte-identical only for the same seed on the same tool versions.
- A9: A function flagged non-deterministic and not excluded by the Harness_Config makes the verdict `inconclusive`, because its behavior was not verified.
- A10: Tarball fetching from the registry is a separate manual, network-gated step. The Proof_Engine never fetches.

### Open questions for the user

- Q1: Tarball parsing: add the `tar` package (ISC, MIT-compatible, listed in PREEXISTING.md) or write a minimal ustar reader on `node:zlib`? Default if unanswered: add `tar`, extract only through the Tarball_Extractor wrapper.
- Q2: Should `inconclusive` be a third verdict (current choice) or should harness failures use a separate `error` field with verdict `null`?
- Q3: What time budget is acceptable for the engine-level property tests and the sandbox integration tests? It must be set after the first measurement and logged in docs/kiro-journal.md.
- Q4: ip has runtime dependencies (jsbn, sprintf-js). Should a later spec add a read-only dependency root to the inputs, with its own hash in the report?
- Q5: Is committing the lodash.set@4.3.2 tarball (MIT, listed in PREEXISTING.md) acceptable, or should tests rebuild it from a locally stored copy?

## Glossary

- **Proof_Engine**: The module in `src/proof/` that accepts a run request and returns a Proof_Report.
- **Original**: The npm package version under test, supplied as a tarball with an expected Integrity_Hash.
- **Resurrection**: The modified package, supplied as a local directory or a tarball.
- **Integrity_Hash**: The registry `dist.integrity` sha512 SRI string (`sha512-<base64>`).
- **Tree_Hash**: A `sha512-<base64>` hash over the files of a package tree, defined in Requirement 4.
- **Tarball_Extractor**: The component that safely extracts a tarball into a temporary directory.
- **Haunting_Radius**: The list of exported function names that the Proof_Engine tests. The default is every exported function.
- **Harness_Config**: The per-package configuration holding per-function generators, stubs and exclusions, case count, seed, per-call timeout and Declared_Deltas.
- **Executor**: The interface the Proof_Engine uses to load a package side and call functions on it. It accepts an encoded call and returns an Outcome.
- **Sandbox_Executor**: The Executor that runs one side in a separate child process under the Node permission model.
- **InProcess_Executor**: An Executor that runs a side in the test process. It is used only by engine-level property tests.
- **Case**: One generated set of input arguments for one function.
- **Outcome**: The observed result of one call: one of `returned`, `threw`, `rejected`, `timeout`, `crash` or `output-too-large`, together with the encoded value and the encoded post-call state of each argument.
- **Value_Codec**: The tagged JSON encoding that carries values between processes and into the report.
- **Divergence**: A difference between the Original Outcome and the Resurrection Outcome that no Declared_Delta explains, or an API-surface difference.
- **Declared_Delta**: An allowed behavior change with a function name, an input predicate and a required new-behavior property.
- **Demonstration**: A concrete Case for a Declared_Delta that fails the required property on the Original and passes it on the Resurrection.
- **Proof_Report**: The deterministic JSON document that the Proof_Engine produces.
- **Report_Serializer**: The component that writes a Proof_Report as canonical JSON.
- **Report_Deserializer**: The component that parses and validates canonical JSON into a Proof_Report.
- **Verdict**: One of `alive`, `restless` or `inconclusive`.
- **Seed**: The integer fast-check seed of a run.
- **Replay_Parameters**: The Seed and fast-check path that reproduce one shrunk counterexample.
- **Fixture_Recorder**: The manual, network-gated script that downloads a registry tarball and records its metadata.

## Requirements

### Requirement 1: Library entry point and thin CLI

**User Story:** As a Graveyard Shift developer, I want a single library function and a thin command line, so that agents and scripts can request a Proof of Life.

#### Acceptance Criteria

1. THE Proof_Engine SHALL export `runProofOfLife(request)`, where the request contains the Original (name, exact version, tarball path, expected Integrity_Hash), the Resurrection (directory or tarball path), an optional Haunting_Radius, the Harness_Config, and an Executor factory.
2. WHEN `runProofOfLife` completes, THE Proof_Engine SHALL return the Proof_Report object and the canonical JSON string of that Proof_Report.
3. WHEN a request contains no Executor factory, THE Proof_Engine SHALL use the Sandbox_Executor.
4. THE Proof_Engine SHALL provide the script `npm run proof:run -- --config <file>` that calls `runProofOfLife` with the Sandbox_Executor and writes the canonical JSON to a path given by `--out`.
5. IF the request is malformed (missing Original, missing Resurrection, case count below 1, per-call timeout below 1 ms, or a Seed that is not a 32-bit integer), THEN THE Proof_Engine SHALL reject the request with a validation error naming the invalid field before any child process starts.
6. THE Proof_Engine SHALL expose no function that performs a network request.

### Requirement 2: Original integrity verification

**User Story:** As a maintainer, I want the Original verified against the registry hash, so that the proof compares against the real published package.

#### Acceptance Criteria

1. WHEN the Original tarball is loaded, THE Proof_Engine SHALL compute the sha512 digest of the tarball bytes and compare the `sha512-<base64>` string with the expected Integrity_Hash before extracting any file.
2. IF the computed digest differs from the expected Integrity_Hash, THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `integrity-mismatch` that contains both strings, and SHALL start no child process.
3. IF the expected Integrity_Hash is not a valid `sha512-` SRI string, THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `invalid-integrity`.
4. THE Proof_Report SHALL contain the Original name, exact version and verified Integrity_Hash.

### Requirement 3: Safe extraction and entry resolution

**User Story:** As a maintainer, I want tarballs extracted safely and entry points resolved like Node does, so that untrusted archives cannot escape or crash the harness.

#### Acceptance Criteria

1. WHEN the Tarball_Extractor extracts a tarball, THE Tarball_Extractor SHALL write only regular files and directories under a newly created temporary directory, after removing the leading `package/` path component.
2. IF a tarball entry has an absolute path, a `..` path segment, a drive prefix, a symbolic link, a hard link, or a device or FIFO type, THEN THE Tarball_Extractor SHALL abort extraction and THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `unsafe-archive` naming the entry.
3. IF a tarball exceeds the compressed-size, uncompressed-size or entry-count limit, THEN THE Tarball_Extractor SHALL abort extraction and THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `archive-too-large`.
4. WHEN the package root is known, THE Proof_Engine SHALL resolve the entry module with the CommonJS `require` conditions applied to the `exports` field of package.json, then the `main` field, then `index.js`.
5. IF the package.json declares `"type": "module"` or the resolved entry file fails to load as CommonJS, THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `unloadable-module` that includes the load error message.
6. WHEN the run finishes or fails, THE Proof_Engine SHALL delete every temporary directory it created.

### Requirement 4: Resurrection input and Tree_Hash

**User Story:** As a reviewer, I want the Resurrection identified by a reproducible hash, so that the report names exactly what was tested.

#### Acceptance Criteria

1. WHEN the Resurrection is a tarball, THE Proof_Engine SHALL extract it with the Tarball_Extractor and compute the Tree_Hash over the extracted tree.
2. WHEN the Resurrection is a directory, THE Proof_Engine SHALL compute the Tree_Hash over the files of that directory, excluding `node_modules` and `.git` directories, and SHALL reject any symbolic link inside the directory with a harness error of kind `unsafe-archive`.
3. THE Proof_Engine SHALL compute the Tree_Hash as the sha512 digest of the concatenation, for each regular file in order of its POSIX-style relative path compared by Unicode code point, of: the UTF-8 relative path, a 0x00 byte, the decimal byte length, a 0x00 byte, the raw file bytes, and a 0x00 byte, rendered as `sha512-<base64>`.
4. FOR ALL file trees, THE Proof_Engine SHALL produce the same Tree_Hash for a directory and for a tarball containing the same relative paths and bytes, and for any enumeration order of the files.
5. THE Proof_Report SHALL contain the Tree_Hash of the Resurrection.
6. THE Proof_Engine SHALL execute the Resurrection from a copy of the tree inside a temporary directory, so that the original directory is never granted to a child process.

### Requirement 5: Executor interface and Sandbox_Executor

**User Story:** As a maintainer, I want each side run in an isolated child process with no network, no secrets and a timeout, so that a package cannot affect the host or the other side.

#### Acceptance Criteria

1. THE Proof_Engine SHALL define an Executor interface with operations to load a package side, to discover its exports, to call one exported function with encoded arguments, to run a delta property, and to dispose.
2. THE Sandbox_Executor SHALL start the Original and the Resurrection in two separate child processes, each launched with `process.execPath` and the flags `--permission`, `--allow-fs-read=<runner file>`, `--allow-fs-read=<package directory>` and a `--max-old-space-size` limit, and with no `--allow-net`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-fs-write` or `--allow-inspector` flag.
3. THE Sandbox_Executor SHALL pass an explicit environment object containing only the variables that Node needs to start, and SHALL NOT copy any variable of the parent environment into that object by default.
4. WHEN a call does not finish within the per-call timeout, THE Sandbox_Executor SHALL kill the child process, record the Outcome `timeout` for that call, and start a fresh child process for the next call.
5. IF a child process exits unexpectedly or exceeds the heap limit, THEN THE Sandbox_Executor SHALL record the Outcome `crash` for the call in progress and start a fresh child process for the next call.
6. IF the encoded Outcome of a call exceeds the output limit, THEN THE Sandbox_Executor SHALL record the Outcome `output-too-large` for that call.
7. IF the Sandbox_Executor cannot start a child process with the permission flags (for example the Node version lacks `--permission`), THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `sandbox-unavailable` and SHALL NOT run the package unsandboxed.
8. THE Sandbox_Executor SHALL exchange messages with each child process over stdin and stdout as newline-delimited JSON, and SHALL discard any child output that is not a well-formed message.
9. THE Proof_Report SHALL record the sandbox mechanism as the string `node-permission` for the Sandbox_Executor and `in-process` for the InProcess_Executor.

### Requirement 6: Value codec

**User Story:** As a maintainer, I want values encoded without loss across the process boundary, so that comparisons see the real types.

#### Acceptance Criteria

1. THE Value_Codec SHALL encode every value as a tagged JSON node with a type tag, covering `undefined`, `null`, boolean, string, number (including `NaN`, `Infinity`, `-Infinity` and `-0`), bigint, symbol (by description), Date (by time value, including invalid dates), RegExp (source and flags), Map, Set, ArrayBuffer, typed arrays (type and bytes), Error (class name, message, own enumerable properties), arrays (including holes), plain objects and class instances (own string keys in code point order, plus the constructor name), and functions (name and arity only).
2. WHEN a value contains a cycle or a shared reference, THE Value_Codec SHALL encode the cycle and the sharing with reference indices, so that the decoded structure preserves them.
3. IF a value cannot be encoded (a Proxy that throws, a getter that throws, or a value deeper than 1,000 nesting levels), THEN THE Value_Codec SHALL encode a node of type `unencodable` with the reason, and THE comparison SHALL treat two `unencodable` nodes with the same reason as equal.
4. FOR ALL encodable values, decoding the encoded form of the value SHALL produce a value that the deep-equality function of Requirement 7 reports as equal to the original value (round-trip property).
5. FOR ALL encodable values, encoding the decoded form of an encoded value SHALL produce the same canonical JSON string as the first encoding.

### Requirement 7: Comparison semantics

**User Story:** As a maintainer, I want precise rules for what counts as identical behavior, so that equal means equal and nothing is silently ignored.

#### Acceptance Criteria

1. WHEN comparing two encoded values, THE Proof_Engine SHALL treat `NaN` as equal to `NaN`, SHALL treat `-0` as different from `+0`, SHALL treat `undefined` as different from a missing property, and SHALL treat a hole in an array as different from `undefined`.
2. WHEN comparing two encoded objects, THE Proof_Engine SHALL compare the constructor name, the set of own string-keyed properties and the values of those properties, and SHALL ignore property insertion order for plain objects, Maps and Sets.
3. WHEN comparing two Date, RegExp, typed array, ArrayBuffer or bigint values, THE Proof_Engine SHALL compare time value, source and flags, element type and bytes, or exact integer value, respectively.
4. WHEN comparing two function values, THE Proof_Engine SHALL compare `name` and `length` only.
5. WHEN both sides throw or reject, THE Proof_Engine SHALL compare the error class name and the message, and SHALL treat a non-Error thrown value as equal only if the two encoded thrown values are deep-equal.
6. WHEN the Original returns normally and the Resurrection throws, or the reverse, THE Proof_Engine SHALL record a difference between the two Outcomes.
7. WHEN a call receives arguments, THE Proof_Engine SHALL give each side an independent decoded copy of the same encoded arguments, and SHALL compare the encoded post-call state of every argument between the two sides.
8. WHEN an exported function returns a Promise, THE Proof_Engine SHALL await the Promise inside the child process within the per-call timeout and SHALL compare the resolved or rejected value.
9. WHEN both sides record `timeout`, both record `crash`, or both record `output-too-large`, THE Proof_Engine SHALL treat the Outcomes as equal, and WHEN only one side records one of these kinds, THE Proof_Engine SHALL record a difference.
10. THE comparison functions SHALL be pure functions of their inputs, and SHALL read neither the system clock nor the file system.

### Requirement 8: Haunting Radius, generators and run execution

**User Story:** As a maintainer, I want the tested functions and inputs defined explicitly and run reproducibly, so that the proof can be replayed.

#### Acceptance Criteria

1. WHEN the request contains no Haunting_Radius, THE Proof_Engine SHALL load the Original in the sandbox, enumerate its own enumerable exports whose value is a function, and use those names as the Haunting_Radius.
2. WHEN the module itself is a function (`module.exports = fn`), THE Proof_Engine SHALL test it under the export name `default` and SHALL use the same name for the Resurrection.
3. IF a name in the Haunting_Radius is not an exported function on the Original, THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `unknown-function` naming the function.
4. IF the Harness_Config defines no generator for a function in the Haunting_Radius and the function is not excluded, THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `missing-generator` naming the function.
5. WHEN testing a function, THE Proof_Engine SHALL run the number of Cases set by the Harness_Config, generating arguments with fast-check in the parent process from the Seed, with the Seed derived per function so that the order of functions does not change another function's Cases.
6. THE Proof_Report SHALL record, for each tested function, the number of Cases for which both sides returned an Outcome, counted during execution, and SHALL record each excluded function with its reason from the Harness_Config.
7. WHEN a Case produces a Divergence, THE Proof_Engine SHALL use fast-check shrinking to reduce the Case, and SHALL record the shrunk counterexample with the Replay_Parameters (Seed and fast-check path) of the shrunk Case.
8. FOR ALL recorded Divergences, re-running fast-check with the recorded Replay_Parameters SHALL reproduce the same shrunk counterexample on unchanged inputs.
9. THE Harness_Config SHALL allow a sandbox-side setup module per side, which runs before the package loads, so that the harness can stub machine-dependent APIs.
10. WHERE a harness for the ip package replaces `os.networkInterfaces()` for `ip.address()`, THE Harness_Config SHALL support doing so through the setup module, applied identically to both sides.

### Requirement 9: Determinism control and self-consistency

**User Story:** As a maintainer, I want flaky functions reported instead of producing false divergences, so that every reported divergence is real.

#### Acceptance Criteria

1. WHEN a sandbox runner starts a side, THE sandbox runner SHALL apply the default time and random stubs of assumption A6 unless the Harness_Config turns them off for the function.
2. WHEN testing a function that is not excluded, THE Proof_Engine SHALL call the Original twice with identical decoded arguments for each Case, and SHALL compare the two Outcomes.
3. IF the two Original Outcomes for a Case differ, THEN THE Proof_Engine SHALL flag the function as `non-deterministic`, SHALL record the Case that exposed it, and SHALL NOT record Divergences for that function.
4. WHILE a function is flagged `non-deterministic` and is not excluded by the Harness_Config, THE Proof_Engine SHALL return Verdict `inconclusive`.
5. THE Proof_Report SHALL list every function flagged `non-deterministic`.

### Requirement 10: Public API surface check

**User Story:** As a maintainer bound by the necromancy laws, I want API changes detected, so that a resurrection never changes the public API.

#### Acceptance Criteria

1. WHEN both sides are loaded, THE Proof_Engine SHALL compare the sorted set of exported own property names and, for each exported function, its `length` and its `name`.
2. IF the Resurrection lacks an export that the Original has, or has an additional export, or has a different function `length`, THEN THE Proof_Engine SHALL record a Divergence of kind `api-surface` naming the export and both values.
3. THE Proof_Engine SHALL compare the `typeof` of each non-function export and, for primitive exports, their values.
4. WHEN an `api-surface` Divergence exists, THE Proof_Engine SHALL return Verdict `restless`.

### Requirement 11: Declared deltas and demonstrations

**User Story:** As a maintainer, I want allowed behavior changes declared and proven, so that every difference is either explained or reported.

#### Acceptance Criteria

1. THE Harness_Config SHALL define each Declared_Delta with an identifier, a function name, an input predicate function evaluated in the parent process on the decoded arguments, a path to a sandbox-side property module, and zero or more explicit Cases.
2. WHEN a Case satisfies the input predicate of a Declared_Delta for its function and the two Outcomes differ, THE Proof_Engine SHALL accept the difference only if the required property holds on the Resurrection for that Case.
3. WHEN a Case satisfies the input predicate, THE Proof_Engine SHALL run the required property on the Resurrection, inside the Resurrection's sandboxed child process, for every such Case, and SHALL record a Divergence of kind `delta-violation` if the property does not hold.
4. WHEN a Case does not satisfy the input predicate of any Declared_Delta for its function and the two Outcomes differ, THE Proof_Engine SHALL record a Divergence of kind `unexplained`.
5. WHEN a Declared_Delta is evaluated, THE Proof_Engine SHALL run the required property on both the Original and the Resurrection for the explicit Cases and for generated Cases that satisfy the predicate, and SHALL record as the Demonstration the first Case, in execution order, where the property fails on the Original and passes on the Resurrection.
6. IF no Case yields a Demonstration for a Declared_Delta, THEN THE Proof_Engine SHALL record the Declared_Delta as `not-demonstrated` and SHALL return Verdict `restless`.
7. THE required property SHALL run inside the same child process as the call it checks, and WHERE the property alters global state (for example `Object.prototype`), THE property module SHALL snapshot that state before the call, compare it after the call, and restore it before returning.
8. THE Proof_Report SHALL contain, for each Declared_Delta, its identifier, function, the Demonstration (arguments and the property result on each side), and the number of predicate-satisfying Cases checked on the Resurrection.
9. THE Proof_Engine SHALL evaluate input predicates only on decoded argument copies, and SHALL NOT pass package code or sandbox objects to a predicate.

### Requirement 12: Verdict and harness errors

**User Story:** As a reviewer, I want a clear verdict that cannot overstate the evidence, so that a Proof of Life means something.

#### Acceptance Criteria

1. WHEN the run completes with zero Divergences, every Declared_Delta demonstrated, no flagged non-deterministic function outside the exclusions, and no harness error, THE Proof_Engine SHALL return Verdict `alive`.
2. WHEN the run completes with one or more Divergences or one or more Declared_Deltas `not-demonstrated`, and no harness error, THE Proof_Engine SHALL return Verdict `restless` and SHALL list every Divergence in the Proof_Report.
3. IF a harness error occurs (integrity mismatch, unsafe or oversized archive, unloadable module, sandbox unavailable, unknown function, missing generator, or a runner protocol error), THEN THE Proof_Engine SHALL return Verdict `inconclusive`, SHALL list the harness errors in the Proof_Report, and SHALL NOT return Verdict `alive`.
4. IF a harness error and a Divergence both occur, THEN THE Proof_Engine SHALL return Verdict `inconclusive` and SHALL list both.
5. THE Proof_Report SHALL include the Seed and, for each Divergence, the Replay_Parameters and the exact shrunk counterexample arguments, the Original Outcome and the Resurrection Outcome.
6. FOR ALL Proof_Reports with Verdict `alive`, THE number of Divergences SHALL be zero and every Declared_Delta SHALL have a Demonstration.

### Requirement 13: Proof_Report format and ordering

**User Story:** As a reviewer, I want a byte-stable, validated report, so that two runs can be diffed and a signed report can be verified later.

#### Acceptance Criteria

1. THE Report_Serializer SHALL write the Proof_Report as JSON without insignificant whitespace, with object keys in the order of a single key-order table in `src/proof/serialize/canonicalReport.ts`, and with keys whose value is `undefined` omitted.
2. THE key-order table SHALL begin with these top-level keys in this order: `schemaVersion`, `package`, `original`, `resurrection`, `sandbox`, `functionsTested`, `casesPerFunction`, `excludedFunctions`, `nonDeterministicFunctions`, `divergences`, `deltas`, `harnessErrors`, `verdict`, `seed`, `toolVersions`.
3. THE Report_Serializer SHALL sort functions by name, Divergences by function name then kind then the canonical JSON of the shrunk counterexample, Declared_Deltas by identifier, and harness errors by kind then message, all compared by Unicode code point with ties broken by original index.
4. THE Proof_Report SHALL contain no wall-clock timestamp, no absolute file system path, no temporary directory name and no environment variable value.
5. THE Proof_Report `toolVersions` SHALL contain the Node version, the fast-check version and the report schema version, each read at run time from the running installation.
6. THE Proof_Engine SHALL define a zod schema for the Proof_Report in `src/proof/types.ts`, and THE Report_Deserializer SHALL parse canonical JSON and reject input that fails the schema with an error naming the failing path.
7. FOR ALL valid Proof_Reports, deserializing the canonical JSON of the report and serializing the result SHALL produce the identical string (round-trip property).
8. THE ordering rules SHALL be documented in docs/proof-of-life-ordering.md, including the key-order table, the sort rules and their tie-breakers.
9. THE Proof_Report SHALL state only counts and values observed during the run, and every count SHALL be computed from executed calls and not from configured values.

### Requirement 14: lodash.set fixtures and harness config

**User Story:** As a developer, I want lodash.set@4.3.2 with a good and a broken resurrection, so that tests demonstrate both `alive` and `restless`.

#### Acceptance Criteria

1. THE Fixture_Recorder SHALL, when run manually with network access through `npm run fixtures:record-tarball`, download the `dist.tarball` URL of lodash.set@4.3.2, verify it against the recorded `dist.integrity`, and write the tarball to tests/proof/fixtures/lodash.set-4.3.2.tgz together with a metadata file holding the source URL, the Integrity_Hash and the fetch date.
2. THE test suite SHALL read the Original tarball from the committed fixture and SHALL make no network request.
3. THE tests/proof/fixtures directory SHALL contain a hand-written resurrection `lodash.set-alive` that preserves the MIT license text and the original author credits, keeps the exported names and function `length` of the Original, and ignores the path segments `__proto__`, `constructor` and `prototype` as declared in docs/demo-packages.md.
4. THE tests/proof/fixtures directory SHALL contain a deliberately broken resurrection `lodash.set-broken` that keeps the exported API surface and changes ordinary behavior, in at least one way inside no Declared_Delta predicate (for example creating objects instead of arrays for numeric intermediate path segments).
5. THE Harness_Config for lodash.set SHALL define generators for the object argument, for the path argument (dotted strings, bracket strings and arrays of strings and integers, including segments `__proto__`, `constructor` and `prototype`), and for the value argument, and SHALL define one Declared_Delta whose input predicate selects paths containing one of those three segments and whose property module checks that `Object.prototype` has no new own property after the call.
6. WHEN the Proof_Engine runs the Original against `lodash.set-alive` with the Sandbox_Executor, THE Proof_Engine SHALL return Verdict `alive` with a Demonstration for the lodash.set Declared_Delta in which the property fails on the Original and passes on the Resurrection.
7. WHEN the Proof_Engine runs the Original against `lodash.set-broken` with the Sandbox_Executor, THE Proof_Engine SHALL return Verdict `restless` with at least one `unexplained` Divergence that has a shrunk counterexample and Replay_Parameters.
8. WHEN the Proof_Engine runs the Original against itself, THE lodash.set property module SHALL leave the test process `Object.prototype` unchanged, because the pollution occurs only inside the child process.
9. THE design SHALL keep the Harness_Config schema, the setup-module mechanism and the Executor interface independent of lodash.set so that an ip harness (with the CVE-2024-29415 explicit Cases 127.1, 01200034567, 012.1.2.3, 000:0:0000::01, ::fFFf:127.0.0.1, 0 and 017700000001) can be added without engine changes.
10. WHEN a third-party tarball or library is added, THE repository SHALL list it in PREEXISTING.md with its license and source URL.

### Requirement 15: Engine property tests and executor separation

**User Story:** As a maintainer, I want the engine tested against itself, so that a wrong comparator cannot produce a false Proof of Life.

#### Acceptance Criteria

1. THE Proof_Engine SHALL run engine-level property tests against the InProcess_Executor and SHALL run sandbox integration tests against the Sandbox_Executor, with both suites using the same Executor interface.
2. FOR ALL generated synthetic packages and Seeds, running the Proof_Engine twice with the same Seed, request and Executor SHALL produce byte-identical canonical JSON.
3. FOR ALL generated synthetic packages, running the Proof_Engine with a Resurrection identical to the Original SHALL return Verdict `alive` with zero Divergences.
4. FOR ALL generated synthetic packages and injected behavior changes (a changed return value, a changed thrown message or class, an added or removed argument mutation, a changed async outcome, a changed export name or function arity) that fall outside every Declared_Delta, running the Proof_Engine SHALL return Verdict `restless` with at least one Divergence for the changed function.
5. EACH engine-level property test SHALL run at least 100 generated cases.
6. WHEN the Sandbox_Executor is exercised by integration tests, THE tests SHALL show that a network connection attempt fails, a file read outside the package directory fails, a parent environment variable is absent in the child, a hung call is killed and recorded as `timeout`, and a spawn of a child process or worker thread fails.
7. THE tests SHALL record in docs/kiro-journal.md the measured wall-clock time of the engine-level property tests and of the sandbox integration tests, and THE time budget for each suite SHALL be set from those measurements.
8. THE tests SHALL run offline, and WHERE `FC_SEED` is set, THE tests SHALL replay that fast-check Seed.

### Requirement 16: Non-functional requirements and scope

**User Story:** As a maintainer, I want the engine to be deterministic, secret-free and bounded, so that its reports can be trusted and attested later.

#### Acceptance Criteria

1. THE Proof_Engine SHALL make no LLM call and, outside the Fixture_Recorder script, no network request.
2. THE pure comparison, Value_Codec and Report_Serializer modules SHALL NOT import or call the system clock, and a determinism lint test SHALL verify that, as the autopsy engine does for its core.
3. THE Proof_Engine SHALL NOT write the value of `GITHUB_TOKEN`, `KIRO_API_KEY` or any other environment variable to a Proof_Report, a log line or an error message.
4. THE Proof_Engine SHALL bound the total run by the sum of per-call timeouts and a configurable maximum number of child process restarts, and WHEN the restart maximum is exceeded, THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `too-many-crashes`.
5. THE Proof_Engine SHALL keep the scope of this feature to the library, the thin CLI and the fixtures above, and SHALL NOT sign reports with GitHub Artifact Attestations, open pull requests, call Kiro agents, support ESM, load native addons, or run packages that need network access.
