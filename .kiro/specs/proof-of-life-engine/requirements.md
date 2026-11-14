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

### Known limitations

- L1 (reference identity): The Value_Codec encodes shared references by value and does not compare reference identity. Two Outcomes that differ only in whether two slots point to the same object (for example `[o, o]` against `[o, copy(o)]`, or a function that returns its own argument against one that returns a copy) compare as equal. Generated arguments lose their aliasing too, because each side receives independent decoded copies (Requirement 7.7), so a bug that depends on argument aliasing cannot be found. Requirement 6.8 requires the design document to state this limitation.
- L2 (encoding size): A value with many shared paths (a directed acyclic graph) is expanded into a tree, so its encoded size can grow exponentially. Such a value is bounded by the output limit and recorded as `output-too-large` (Requirement 5.6).
- L3 (unencodable values hide comparisons): Where a node is `unencodable`, the comparison covers only the reason (Requirement 6.4), not the content. Requirement 8.11 makes the number of such nodes visible, and Requirement 12.7 prevents a function without any fully comparable Case from supporting an `alive` verdict.
- L4 (machine-specific paths in returned values): The Root_Normalizer removes only the sandbox's own temporary package roots. A returned value, argument post-state or Prototype_Delta value (not error text) that contains any other absolute path, for example the user's home directory or the Node installation directory, is the package's real behavior. It is compared as is, and WHEN it appears in a counterexample, that path appears in the Proof_Report. Error text is different: the Path_Redactor replaces those paths there (Requirement 13.12).
- L5 (normalization blind spot): Because each side's own root becomes `<package>` in every string, a package that returns its own `__dirname` is normalized to `<package>` on both sides, so a behavior difference that depends only on the location of the root cannot be detected. A string that contains a root by coincidence is normalized too, and a string that contains the literal text `<package>` is indistinguishable from a normalized one.
- L6 (key collisions): WHEN normalization makes two keys of one encoded object identical, the harness cannot represent that object; Requirement 13.21 records a harness error for this case.

### Decisions

- D1 (was Q1): Add the `tar` npm package for extraction. `npm view tar` on this machine reports version 7.5.23 and license BlueOak-1.0.0 (a permissive license, not ISC), so the license must be re-checked against the MIT-compatibility rule when the dependency is added. Only the Tarball_Extractor wrapper imports `tar`, and PREEXISTING.md lists it (Requirement 3.7).
- D2 (was Q2): `inconclusive` stays a third Verdict (`alive`, `restless`, `inconclusive`).
- D3 (was Q3): Time budgets are set after the first measurement. The targets are at most 60 s for the engine-level property tests and at most 120 s for the sandbox integration tests, with measured values logged in docs/kiro-journal.md (Requirement 15.7).
- D4 (was Q4): A later spec adds a read-only dependency root to the inputs, with its own hash in the Proof_Report. That is out of scope here (Requirement 16.6). The run request and Executor interface stay open to this extension, and this spec does not implement it.
- D5 (was Q5): The lodash.set@4.3.2 tarball (MIT) is committed together with a metadata file, and tests verify the tarball against the metadata (Requirement 14.1 to 14.3).
- D6 (value encoding): Only true cycles are `unencodable` with reason `cycle`; shared references are encoded by value as independent copies (Requirement 6.2), cycles are detected from the ancestor path (Requirement 6.7), and reference identity is a documented limitation (L1). This replaces the earlier decision that a shared reference is `unencodable`. The Proof_Report lists all four reasons (`cycle`, `depth`, `getter`, `proxy`) for every tested function, with count 0 where none was observed, so that "none observed" is stated and the schema has a fixed shape (Requirement 8.11).
- D7 (evidence threshold, flagged for the user): A function for which every Case contained an `unencodable` node on either side cannot support an `alive` verdict, and the run is `inconclusive` unless a Divergence or a `not-demonstrated` Declared_Delta makes it `restless` (Requirement 12.7). This is the strictest simple rule, chosen because it needs no tuned number. A proportional threshold (for example "at least X percent of Cases fully comparable") was not chosen because any X would be unmeasured; the report carries the counts needed to add one later. Please confirm or propose a threshold.
- D8 (path handling, flagged for the user): Root normalization applies to all encoded strings and to object keys; the broader redaction of other absolute paths stays limited to error text (Requirement 13.10 to 13.22). The `file://` percent-encoded form and the `\\?\` form of each root are included in normalization (Requirement 13.19).

## Glossary

- **Proof_Engine**: The module in `src/proof/` that accepts a run request and returns a Proof_Report.
- **Original**: The npm package version under test, supplied as a tarball with an expected Integrity_Hash.
- **Resurrection**: The modified package, supplied as a local directory or a tarball.
- **Integrity_Hash**: The registry `dist.integrity` sha512 SRI string (`sha512-<base64>`).
- **Tree_Hash**: A `sha512-<base64>` hash over the files of a package tree, defined in Requirement 4.
- **Tarball_Extractor**: The component that safely extracts a tarball into a temporary directory. It is the only module that imports the `tar` npm package.
- **Prototype_Snapshot**: The record, taken inside a child process, of the own properties (names including symbols, and descriptors or values) of `Object.prototype`, `Array.prototype`, `Function.prototype`, `String.prototype`, `Number.prototype` and `Boolean.prototype`.
- **Prototype_Delta**: The set of properties added, changed or removed on those six prototypes between a Prototype_Snapshot taken before a call and one taken after it.
- **Restart_Event**: A restart of a child process that the Sandbox_Executor performs because a prototype restoration could not be verified.
- **Root_Normalizer**: The pure parent-process component that replaces, in every encoded string of one side's Outcome, that side's own temporary package root (the extraction or copy directory used for that side) with `<package>`, as defined in Requirement 13.18 to 13.22. It runs before the Path_Redactor.
- **Path_Redactor**: The pure component that replaces the remaining absolute paths and temporary directory names in error text (not in other returned values) with placeholders. It runs after the Root_Normalizer.
- **Haunting_Radius**: The list of exported function names that the Proof_Engine tests. The default is every exported function.
- **Harness_Config**: The per-package configuration holding per-function generators, stubs and exclusions, case count, seed, per-call timeout and Declared_Deltas.
- **Executor**: The interface the Proof_Engine uses to load a package side and call functions on it. It accepts an encoded call and returns an Outcome.
- **Sandbox_Executor**: The Executor that runs one side in a separate child process under the Node permission model.
- **InProcess_Executor**: An Executor that runs a side in the test process. It is used only by engine-level property tests.
- **Case**: One generated set of input arguments for one function.
- **Outcome**: The observed result of one call: one of `returned`, `threw`, `rejected`, `timeout`, `crash` or `output-too-large`, together with the encoded value, the encoded post-call state of each argument, and the Prototype_Delta of the call.
- **Value_Codec**: The tagged JSON encoding that carries values between processes and into the report. It encodes a shared reference that is not a cycle (the same object reachable by more than one path, without a path leading back to an ancestor) by value as independent copies, and does not preserve or compare reference identity. A value containing a true cycle (a path leading back to an ancestor of the current node) is encoded as `unencodable` with reason `cycle`.
- **Unencodable_Count**: The number of `unencodable` nodes observed in the compared Outcomes of one function, broken down by reason, as defined in Requirement 8.11.
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
7. THE Proof_Engine SHALL import the `tar` npm package only in the Tarball_Extractor module, and THE repository SHALL list `tar` in PREEXISTING.md with its name, license and source URL.
8. THE test suite SHALL include a test that fails WHEN any source file under `src/proof/` other than the Tarball_Extractor module imports `tar`.

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
10. WHEN the sandbox runner executes a call, THE sandbox runner SHALL take a Prototype_Snapshot immediately before the call, compute the Prototype_Delta immediately after the call (including after a call that throws, rejects or times out where the child is still alive), include the Prototype_Delta in the Outcome of that same call, and then restore the six prototypes to the snapshot.
11. THE sandbox runner SHALL apply the isolation of criterion 10 to both the Original and the Resurrection, for every call, independently of whether a Declared_Delta exists for the function.
12. IF the restoration cannot be verified (a non-configurable property cannot be restored, a prototype is frozen or sealed, or a Prototype_Snapshot taken after restoration differs from the one taken before the call), THEN THE Sandbox_Executor SHALL restart the child process before the next call on that side and SHALL count a Restart_Event.
13. THE Proof_Report `sandbox` entry SHALL contain the mechanism string of criterion 9 and the number of Restart_Events for each side, counted from restarts that occurred during the run.
14. WHEN the Sandbox_Executor restarts a child process because of a Restart_Event, THE Sandbox_Executor SHALL count that restart toward the maximum number of restarts of Requirement 16.4.
15. THE sandbox integration tests SHALL show that, after a call on the Original that pollutes `Object.prototype` through a `__proto__` path (lodash.set), the Prototype_Delta of that call lists the polluted property, and the next call in the same child process observes an `Object.prototype` equal to the clean snapshot and records an empty Prototype_Delta.

### Requirement 6: Value codec

**User Story:** As a maintainer, I want values encoded without loss across the process boundary, so that comparisons see the real types.

#### Acceptance Criteria

1. THE Value_Codec SHALL encode every value as a tagged JSON node with a type tag, covering `undefined`, `null`, boolean, string, number (including `NaN`, `Infinity`, `-Infinity` and `-0`), bigint, symbol (by description), Date (by time value, including invalid dates), RegExp (source and flags), Map, Set, ArrayBuffer, typed arrays (type and bytes), Error (class name, message, own enumerable properties other than `stack`), arrays (including holes), plain objects and class instances (own string keys in code point order, plus the constructor name), and functions (name and arity only).
2. WHEN a value contains a cycle (an object that is reachable from itself, that is, a path from an object back to one of its ancestors on the current encoding path), THE Value_Codec SHALL encode the node that closes the cycle as a node of type `unencodable` with the reason `cycle`. WHEN a value contains a shared reference that is not a cycle (the same object reachable by more than one path without a path leading back to an ancestor, for example `[o, o]` or `{a: x, b: x}`), THE Value_Codec SHALL encode the object by value at each position as independent copies, so that every copy is compared. Buffer and typed arrays keep the encodings of criterion 1.
3. IF a value cannot be encoded for another reason (a Proxy that throws, a getter that throws, or a value deeper than 1,000 nesting levels), THEN THE Value_Codec SHALL encode a node of type `unencodable` with the reason `proxy`, `getter` or `depth` respectively.
4. WHEN comparing two `unencodable` nodes, THE Proof_Engine SHALL treat them as equal if their reasons are equal and as a Divergence-producing difference if their reasons differ.
5. FOR ALL encodable values (values containing no `unencodable` node, including values with shared references), decoding the encoded form of the value SHALL produce a value that the deep-equality function of Requirement 7 reports as equal to the original value (round-trip property).
6. FOR ALL encodable values, encoding the decoded form of an encoded value SHALL produce the same canonical JSON string as the first encoding.
7. THE Value_Codec SHALL detect cycles by tracking the ancestor path of the node being encoded (an object is added to the path when its encoding starts and removed when its encoding finishes), and SHALL NOT use a set of all objects visited so far, so that an object visited earlier on a different branch is encoded again by value.
8. THE design document SHALL state, in a section on limitations, that the Value_Codec does not compare reference identity (limitation L1), including its consequence for argument aliasing and for functions that return their arguments.
9. WHEN the encoded size of a value exceeds the output limit during encoding, THE Value_Codec SHALL stop encoding and THE sandbox runner SHALL report the Outcome `output-too-large` (Requirement 5.6).

### Requirement 7: Comparison semantics

**User Story:** As a maintainer, I want precise rules for what counts as identical behavior, so that equal means equal and nothing is silently ignored.

#### Acceptance Criteria

1. WHEN comparing two encoded values, THE Proof_Engine SHALL treat `NaN` as equal to `NaN`, SHALL treat `-0` as different from `+0`, SHALL treat `undefined` as different from a missing property, and SHALL treat a hole in an array as different from `undefined`.
2. WHEN comparing two encoded objects, THE Proof_Engine SHALL compare the constructor name, the set of own string-keyed properties and the values of those properties, and SHALL ignore property insertion order for plain objects, Maps and Sets.
3. WHEN comparing two Date, RegExp, typed array, ArrayBuffer or bigint values, THE Proof_Engine SHALL compare time value, source and flags, element type and bytes, or exact integer value, respectively.
4. WHEN comparing two function values, THE Proof_Engine SHALL compare `name` and `length` only.
5. WHEN both sides throw or reject, THE Proof_Engine SHALL compare the error class name and the message, and SHALL treat a non-Error thrown value as equal only if the two encoded thrown values are deep-equal. The Proof_Engine SHALL perform this comparison, and every other comparison of encoded strings, after root normalization by the Root_Normalizer (Requirement 13.18), and on error text additionally after redaction by the Path_Redactor (Requirement 13.10).
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
11. THE Proof_Report SHALL record, for each tested function, an Unencodable_Count with these fields, each counted from executed calls and not from configured values: `cases` (the number of Cases for which both sides returned an Outcome, as in criterion 6), `casesWithUnencodable` (the number of those Cases in which at least one `unencodable` node occurs in the Original Outcome or in the Resurrection Outcome), `total` (the number of `unencodable` nodes in both Outcomes of all those Cases, counting every node in the return value, thrown or rejected value, argument post-state and Prototype_Delta of either side), and `reasons` (the number of those nodes for each of the reasons `cycle`, `depth`, `getter` and `proxy`, listing a reason with count 0 and ordered by Unicode code point of the reason). The Proof_Engine SHALL count the compared Outcome pair of each Case only, SHALL NOT count the repeat call of Requirement 9.2 and SHALL NOT count calls made during shrinking.

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
7. THE required property SHALL run inside the same child process as the call it checks, and THE property SHALL receive the Prototype_Delta that the sandbox runner computed for that call under Requirement 5.10, so that the property check and the Outcome use the same snapshot data. The property module SHALL NOT take its own prototype snapshot or restore prototypes, because the restoration is done by the sandbox runner under Requirement 5.10 and 5.12.
8. THE Proof_Report SHALL contain, for each Declared_Delta, its identifier, function, the Demonstration (arguments and the property result on each side), and the number of predicate-satisfying Cases checked on the Resurrection.
9. THE Proof_Engine SHALL evaluate input predicates only on decoded argument copies, and SHALL NOT pass package code or sandbox objects to a predicate.
10. THE Proof_Engine SHALL compare the Prototype_Delta of the Original Outcome with that of the Resurrection Outcome like any other part of the Outcome, and WHEN a Prototype_Delta differs between the two sides, THE Proof_Engine SHALL treat the difference as a Divergence unless a Declared_Delta whose input predicate is satisfied by the Case and whose required property allows that difference accepts it under criterion 2.

### Requirement 12: Verdict and harness errors

**User Story:** As a reviewer, I want a clear verdict that cannot overstate the evidence, so that a Proof of Life means something.

#### Acceptance Criteria

1. WHEN the run completes with zero Divergences, every Declared_Delta demonstrated, no flagged non-deterministic function outside the exclusions, no function lacking evidence under criterion 7, and no harness error, THE Proof_Engine SHALL return Verdict `alive`.
2. WHEN the run completes with one or more Divergences or one or more Declared_Deltas `not-demonstrated`, and no harness error, THE Proof_Engine SHALL return Verdict `restless` and SHALL list every Divergence in the Proof_Report.
3. IF a harness error occurs (integrity mismatch, unsafe or oversized archive, unloadable module, sandbox unavailable, unknown function, missing generator, a normalization collision, a temporary root leak, or a runner protocol error), THEN THE Proof_Engine SHALL return Verdict `inconclusive`, SHALL list the harness errors in the Proof_Report, and SHALL NOT return Verdict `alive`.
4. IF a harness error and a Divergence both occur, THEN THE Proof_Engine SHALL return Verdict `inconclusive` and SHALL list both.
5. THE Proof_Report SHALL include the Seed and, for each Divergence, the Replay_Parameters and the exact shrunk counterexample arguments, the Original Outcome and the Resurrection Outcome.
6. FOR ALL Proof_Reports with Verdict `alive`, THE number of Divergences SHALL be zero, every Declared_Delta SHALL have a Demonstration, and no tested function SHALL lack evidence under criterion 7.
7. WHEN, for a tested function that is not excluded, `cases` is at least 1 and `casesWithUnencodable` equals `cases` (every Case had an `unencodable` node on either side), THE Proof_Engine SHALL treat that function as lacking evidence, SHALL NOT return Verdict `alive`, and SHALL return Verdict `inconclusive` unless a Divergence or a `not-demonstrated` Declared_Delta exists, in which case Requirement 12.2 applies and the Verdict is `restless`. THE Proof_Engine SHALL list each function lacking evidence in the Proof_Report through its Unencodable_Count entry.

### Requirement 13: Proof_Report format and ordering

**User Story:** As a reviewer, I want a byte-stable, validated report, so that two runs can be diffed and a signed report can be verified later.

#### Acceptance Criteria

1. THE Report_Serializer SHALL write the Proof_Report as JSON without insignificant whitespace, with object keys in the order of a single key-order table in `src/proof/serialize/canonicalReport.ts`, and with keys whose value is `undefined` omitted.
2. THE key-order table SHALL begin with these top-level keys in this order: `schemaVersion`, `package`, `original`, `resurrection`, `sandbox`, `functionsTested`, `casesPerFunction`, `unencodableValues`, `excludedFunctions`, `nonDeterministicFunctions`, `divergences`, `deltas`, `harnessErrors`, `verdict`, `seed`, `toolVersions`.
3. THE Report_Serializer SHALL sort functions by name, `unencodableValues` entries by function name, the keys of each `reasons` object by the Unicode code point of the reason, Divergences by function name then kind then the canonical JSON of the shrunk counterexample, Declared_Deltas by identifier, and harness errors by kind then message, all compared by Unicode code point with ties broken by original index.
4. THE Proof_Report SHALL contain no wall-clock timestamp, no temporary directory name, no temporary package root of either side, no absolute file system path in error text, no environment variable value, and no absolute file system path generated by the Proof_Engine itself. An absolute path that the package itself returned in a non-error value is recorded as is under limitation L4.
5. THE Proof_Report `toolVersions` SHALL contain the Node version, the fast-check version and the report schema version, each read at run time from the running installation.
6. THE Proof_Engine SHALL define a zod schema for the Proof_Report in `src/proof/types.ts`, and THE Report_Deserializer SHALL parse canonical JSON and reject input that fails the schema with an error naming the failing path. The schema SHALL include `unencodableValues` as an array of entries with `function`, `cases`, `casesWithUnencodable`, `total` and `reasons` (an object with the non-negative integer counts `cycle`, `depth`, `getter` and `proxy`), and SHALL reject an entry in which `casesWithUnencodable` exceeds `cases`, or in which `total` differs from the sum of `reasons`.
7. FOR ALL valid Proof_Reports, deserializing the canonical JSON of the report and serializing the result SHALL produce the identical string (round-trip property).
8. THE ordering rules SHALL be documented in docs/proof-of-life-ordering.md, including the key-order table, the sort rules and their tie-breakers, the position of `unencodableValues`, and the code point order of its `reasons` keys.
9. THE Proof_Report SHALL state only counts and values observed during the run, and every count SHALL be computed from executed calls and not from configured values.
10. THE Path_Redactor SHALL, in the parent process, process every error text, after the Root_Normalizer has processed it (Requirement 13.18), before that text is compared or serialized, and SHALL NOT process any string that is not error text, where error text means the message and every other string-valued own enumerable property of an encoded Error, every thrown or rejected string value, and the message of every harness error.
11. THE Proof_Engine SHALL NOT record stack traces: the Value_Codec SHALL encode an Error with its class name, message and own enumerable properties other than `stack`, and a `stack` property SHALL never appear in an Outcome or in the Proof_Report.
12. WHEN processing error text that the Root_Normalizer has already processed, THE Path_Redactor SHALL rewrite the remainder of each path that starts with `<package>` with forward slashes (giving `<package>/<relative path>`, or `<package>` alone for the root), SHALL NOT treat the remainder of such a path as a separate absolute path, SHALL replace every other absolute path in that error text, including the temporary root of the Proof_Engine, the Node installation directory and the user's home directory, with `<redacted-path>`, and SHALL replace the name of every temporary directory created by the Proof_Engine, when it appears without its parent path, with `<redacted-path>`.
13. THE Path_Redactor SHALL recognize POSIX absolute paths, Windows drive-letter paths with backslashes or forward slashes, `file://` URLs (with percent-decoding), extended-length `\\?\` paths including `\\?\UNC\` paths, and UNC `\\server\share` paths, and WHILE the parent process runs on Windows, THE Path_Redactor SHALL match package roots and drive letters case-insensitively.
14. FOR ALL error texts and for any two package roots, WHEN the error text from the Original contains its package root and the error text from the Resurrection is identical except that it contains the Resurrection package root at the same positions, THE Path_Redactor SHALL produce the same redacted text for both, so that redaction neither creates nor hides a Divergence.
15. THE Path_Redactor SHALL be a pure function of the text and the set of known roots, and SHALL be applied to the Original and the Resurrection identically.
16. THE test suite SHALL include tests of the Path_Redactor with Windows examples (`C:\Users\x\AppData\Local\Temp\gs-1\pkg\lib\a.js`, `c:/users/x/appdata/local/temp/gs-1/pkg/lib/a.js`, `file:///C:/Users/x/pkg/a.js`, `\\?\C:\Users\x\pkg\a.js`, `\\server\share\pkg\a.js`) and POSIX examples (`/tmp/gs-1/pkg/lib/a.js`, `file:///home/x/pkg/a.js`), including mixed-case drive letters and package roots, and with a property test for criterion 14 that runs at least 100 generated cases.
17. THE test suite SHALL include a test that fails WHEN a serialized Proof_Report produced from an error message containing the temporary root, the Node installation directory or the user's home directory contains any of those strings.
18. THE Root_Normalizer SHALL, in the parent process, before any comparison and before anything enters the Proof_Report, replace the temporary package root of each side (the extraction directory of the Original, and the extraction or copy directory of the Resurrection, Requirement 4.6) in every encoded string of that side's Outcome with `<package>`, where encoded strings are the return value, the thrown or rejected value, the encoded post-call state of each argument, the strings in the Prototype_Delta and the strings in a property result, including strings in error text and in object keys. THE Root_Normalizer SHALL apply to each side only that side's own roots.
19. THE Root_Normalizer SHALL match each root of criterion 18 in these forms: the native form, the forward-slash form, the back-slash form, the `\\?\` extended-length form, and the `file://` URL form with percent-encoded path segments (replacing the whole `file://` URL prefix of the root, with hexadecimal digits matched case-insensitively), and, for a side whose root differs between its created and its real path (a symbolic link or a short name), both paths. WHILE the parent process runs on Windows, THE Root_Normalizer SHALL match roots and drive letters case-insensitively. THE Root_Normalizer SHALL try the candidate forms longest first, ties broken by Unicode code point, and SHALL match a root only where the next character is the end of the string, `/`, `\`, or a character that cannot continue a directory name (a character other than a letter, digit, `.`, `_`, `-` or `~`), so that a root does not match inside a longer sibling directory name.
20. THE Root_Normalizer SHALL leave unchanged every other absolute path in a non-error value, so that the value is compared and, WHEN it appears in a counterexample, recorded as returned (limitation L4), and the Path_Redactor SHALL apply to error text only (criterion 10).
21. IF two keys of one encoded object become identical after root normalization, THEN THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `normalization-collision` that names the function and does not contain a path.
22. THE Root_Normalizer SHALL be a pure function of the encoded Outcome and the set of roots, SHALL be applied to the Original and the Resurrection by the same code, and SHALL run before the Path_Redactor, so that a root is never replaced by `<redacted-path>`. WHEN the same string is returned by both sides from different roots (for example `<root>/lib/a.js` on each side), THE Proof_Engine SHALL compare the two normalized strings as equal.
23. THE report generator SHALL, after normalization and redaction and as a safety check, search the serialized Proof_Report for the temporary package root of each side in every form of criterion 19, and IF any root still appears, THEN THE Proof_Engine SHALL fail with a harness error of kind `temp-root-leak` and return Verdict `inconclusive`. In that case THE Proof_Engine SHALL return a Proof_Report that omits the content of `divergences` and `deltas`, states the harness error (without any path) and is searched again by the same check, so that the leak is not written to disk.
24. THE test suite SHALL include tests of the Root_Normalizer with Windows examples (`C:\Users\x\AppData\Local\Temp\gs-1\pkg\lib\a.js`, `c:/users/x/appdata/local/temp/gs-1/pkg/lib/a.js`, `\\?\C:\Users\x\AppData\Local\Temp\gs-1\pkg\a.js`, `file:///C:/Users/x/AppData/Local/Temp/gs%201/pkg/a.js`) and POSIX examples (`/tmp/gs-1/pkg/lib/a.js`, `file:///tmp/gs-1/pkg/a.js`), including the root in forward-slash and back-slash forms in object keys and in error text, a sibling directory (`/tmp/gs-1/pkg2/a.js`) that is not normalized, a non-root absolute path in a returned value (`C:\Users\x\notes.txt`, `/home/x/notes.txt`) that stays unchanged, the same non-root path in error text that becomes `<redacted-path>`, the key collision of criterion 21, and a test that the same string returned by both sides from two different roots compares equal after normalization. THE test suite SHALL include a test that fails WHEN the safety check of criterion 23 does not detect a root left in a serialized report, and a property test, with at least 100 generated cases, for the following statement: FOR ALL strings and two roots, normalizing a side's string that contains only that side's root at the positions where the other side's string contains the other root SHALL produce equal strings.

### Requirement 14: lodash.set fixtures and harness config

**User Story:** As a developer, I want lodash.set@4.3.2 with a good and a broken resurrection, so that tests demonstrate both `alive` and `restless`.

#### Acceptance Criteria

1. THE Fixture_Recorder SHALL, when run manually with network access through `npm run fixtures:record-tarball`, download the `dist.tarball` URL of lodash.set@4.3.2, verify it against the recorded `dist.integrity`, and write the tarball to tests/proof/fixtures/lodash.set-4.3.2.tgz together with a committed metadata file tests/proof/fixtures/lodash.set-4.3.2.meta.json holding the package name, version, `dist.tarball` URL, `dist.integrity`, source URL, fetch date, license (MIT) and the author credits.
2. THE test suite SHALL read the Original tarball from the committed fixture and SHALL make no network request.
3. THE test suite SHALL include a test that computes the sha512 digest of the committed tarball and compares it with the `dist.integrity` in the metadata file, and a test that compares the `dist.integrity` of version 4.3.2 in the recorded packument tests/engine/fixtures/lodash.set/npm-449996e32bd2.json with the `dist.integrity` in the metadata file.
4. THE tests/proof/fixtures directory SHALL contain a hand-written resurrection `lodash.set-alive` that preserves the MIT license text and the original author credits, keeps the exported names and function `length` of the Original, and ignores the path segments `__proto__`, `constructor` and `prototype` as declared in docs/demo-packages.md.
5. THE tests/proof/fixtures directory SHALL contain a deliberately broken resurrection `lodash.set-broken` that keeps the exported API surface and changes ordinary behavior, in at least one way inside no Declared_Delta predicate (for example creating objects instead of arrays for numeric intermediate path segments).
6. THE Harness_Config for lodash.set SHALL define generators for the object argument, for the path argument (dotted strings, bracket strings and arrays of strings and integers, including segments `__proto__`, `constructor` and `prototype`), and for the value argument, and SHALL define one Declared_Delta whose input predicate selects paths containing one of those three segments and whose property module checks, from the Prototype_Delta that the sandbox runner computed for the call (Requirement 5.10), that `Object.prototype` has no added own property. THE isolation of Requirement 5.10 to 5.12 applies to every call on both sides and does not depend on this Declared_Delta.
7. WHEN the Proof_Engine runs the Original against `lodash.set-alive` with the Sandbox_Executor, THE Proof_Engine SHALL return Verdict `alive` with a Demonstration for the lodash.set Declared_Delta in which the property fails on the Original and passes on the Resurrection.
8. WHEN the Proof_Engine runs the Original against `lodash.set-broken` with the Sandbox_Executor, THE Proof_Engine SHALL return Verdict `restless` with at least one `unexplained` Divergence that has a shrunk counterexample and Replay_Parameters.
9. WHEN the Proof_Engine runs the Original against itself, THE lodash.set property module SHALL leave the test process `Object.prototype` unchanged, because the pollution occurs only inside the child process.
10. THE design SHALL keep the Harness_Config schema, the setup-module mechanism and the Executor interface independent of lodash.set so that an ip harness (with the CVE-2024-29415 explicit Cases 127.1, 01200034567, 012.1.2.3, 000:0:0000::01, ::fFFf:127.0.0.1, 0 and 017700000001) can be added without engine changes.
11. WHEN a third-party tarball or library is added, THE repository SHALL list it in PREEXISTING.md with its name, license and source URL, and THE repository SHALL list at least the `tar` npm package and the lodash.set@4.3.2 tarball.

### Requirement 15: Engine property tests and executor separation

**User Story:** As a maintainer, I want the engine tested against itself, so that a wrong comparator cannot produce a false Proof of Life.

#### Acceptance Criteria

1. THE Proof_Engine SHALL run engine-level property tests against the InProcess_Executor and SHALL run sandbox integration tests against the Sandbox_Executor, with both suites using the same Executor interface.
2. FOR ALL generated synthetic packages and Seeds, running the Proof_Engine twice with the same Seed, request and Executor SHALL produce byte-identical canonical JSON.
3. FOR ALL generated synthetic packages whose compared Outcomes are not all `unencodable`, running the Proof_Engine with a Resurrection identical to the Original SHALL return Verdict `alive` with zero Divergences.
4. FOR ALL generated synthetic packages and injected behavior changes (a changed return value, a changed thrown message or class, an added or removed argument mutation, a changed async outcome, a changed export name or function arity) that fall outside every Declared_Delta, running the Proof_Engine SHALL return Verdict `restless` with at least one Divergence for the changed function.
5. EACH engine-level property test SHALL run at least 100 generated cases.
6. WHEN the Sandbox_Executor is exercised by integration tests, THE tests SHALL show that a network connection attempt fails, a file read outside the package directory fails, a parent environment variable is absent in the child, a hung call is killed and recorded as `timeout`, and a spawn of a child process or worker thread fails.
7. THE tests SHALL record in docs/kiro-journal.md the measured wall-clock time of the engine-level property tests and of the sandbox integration tests, THE time budget for each suite SHALL be set after the first measurement, and THE budget SHALL equal the targets of at most 60 seconds for the engine-level property tests and at most 120 seconds for the sandbox integration tests.
8. WHEN the measured wall-clock time of a suite exceeds its target, THE test run SHALL fail or flag the overrun in its output, and THE measured value SHALL be logged in docs/kiro-journal.md.
9. THE tests SHALL run offline, and WHERE `FC_SEED` is set, THE tests SHALL replay that fast-check Seed.
10. FOR ALL generated synthetic packages whose functions return values with shared references, cycles, throwing getters or throwing proxies, THE `unencodableValues` entry of the Proof_Report SHALL equal the counts obtained by independently scanning the compared Outcomes for `unencodable` nodes, and a shared reference that is not a cycle SHALL NOT be counted.
11. FOR ALL generated values containing shared references but no cycle, the Value_Codec SHALL encode the value without an `unencodable` node, and WHEN a synthetic Resurrection differs from the Original only inside one copy of a shared object, THE Proof_Engine SHALL record a Divergence for that copy.
12. THE tests SHALL include unit tests that `[o, o]` and `{a: x, b: x}` are encoded by value, that `o.self = o` yields `unencodable` with reason `cycle`, that a value reachable twice on different branches that does not contain itself is not a cycle, and that a function whose every Case contains an `unencodable` node yields Verdict `inconclusive` (Requirement 12.7).

### Requirement 16: Non-functional requirements and scope

**User Story:** As a maintainer, I want the engine to be deterministic, secret-free and bounded, so that its reports can be trusted and attested later.

#### Acceptance Criteria

1. THE Proof_Engine SHALL make no LLM call and, outside the Fixture_Recorder script, no network request.
2. THE pure comparison, Value_Codec and Report_Serializer modules SHALL NOT import or call the system clock, and a determinism lint test SHALL verify that, as the autopsy engine does for its core.
3. THE Proof_Engine SHALL NOT write the value of `GITHUB_TOKEN`, `KIRO_API_KEY` or any other environment variable to a Proof_Report, a log line or an error message. This requirement, Requirement 13.4 and the root normalization and redaction of Requirement 13.10 to 13.24 apply together: root normalization removes the temporary package roots from all encoded strings, redaction removes other absolute paths and temporary directory names from error text, and the minimal child environment of Requirement 5.3 keeps environment values out of the child.
4. THE Proof_Engine SHALL bound the total run by the sum of per-call timeouts and a configurable maximum number of child process restarts, and WHEN the restart maximum is exceeded, THE Proof_Engine SHALL return Verdict `inconclusive` with a harness error of kind `too-many-crashes`.
5. THE Proof_Engine SHALL keep the scope of this feature to the library, the thin CLI and the fixtures above, and SHALL NOT sign reports with GitHub Artifact Attestations, open pull requests, call Kiro agents, support ESM, load native addons, encode cycles (a true cycle stays `unencodable`) or compare reference identity in the Value_Codec, or run packages that need network access.
6. THE Proof_Engine SHALL treat the following as out of scope for this feature: a read-only dependency root in the run request (planned for a later spec, with its own hash in the Proof_Report, for packages such as ip that have runtime dependencies), and the ip harness. The request schema, the Executor interface and the Harness_Config SHALL allow such an extension later, and this feature SHALL NOT implement it.
