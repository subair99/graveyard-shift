# Kiro journal

Project rule: never state a number, metric or result that was not measured. Every measurement
is logged here with the command, date and environment. Statements marked "qualitative" are not
measurements.

## Autopsy engine: test and build measurements

Date: 2026-11-14

Environment: Microsoft Windows NT 10.0.26300.0, Node.js v26.13.1, next 16.4.6, vitest 5.1.0,
fast-check 4.10.2 (versions from `node_modules/<package>/package.json`).

Run from the repository root in PowerShell. Wall-clock time comes from `Measure-Command`;
"vitest duration" is the figure vitest prints. Each command was run once per row.

| Command | Result | Duration |
| --- | --- | --- |
| `npm test` (run 1) | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 8.69s; wall 9.67s |
| `npm test` (run 2) | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 9.45s; wall 10.39s |
| `npm test` (run 3) | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 9.13s; wall 10.03s |
| `$env:FC_SEED=12345; npm test` | exit 0; 32 files passed, 0 failed; 302 tests passed, 0 failed | vitest 10.64s; wall 11.62s |
| `npm run typecheck` | exit 0 | wall 0.87s |
| `npm run lint` | exit 0, no output from eslint | wall 2.73s |
| `npm run build` | exit 0; Next.js reported "Compiled successfully in 385ms" | wall 5.25s |

Notes:
- File and test counts (32 files, 302 tests) match the earlier report.
- Earlier reports gave runs of about 7.3 to 7.5 s. The runs above took 8.69 to 9.45 s (vitest) without
  a seed and 10.64 s with `FC_SEED=12345`. The figures above are the ones measured for this entry.
  The cause of the difference was not investigated (different machine load is one possibility, not tested).
- Only one run was made with `FC_SEED=12345`, so no conclusion about seed effect on duration is drawn.
- Next.js also reported "Finished TypeScript in 873ms" and "Generating static pages using 4 workers
  (3/3) in 608ms" during the build.

## Fixtures

Date: 2026-11-14. Method: counted files in each directory under `tests/engine/fixtures/`
with `Get-ChildItem <dir> -File`, and the total with `Get-ChildItem tests/engine/fixtures -Recurse -File`.

| Directory | Files |
| --- | --- |
| `inflight` | 7 |
| `ip` | 6 |
| `lodash.set` | 6 |
| Total | 19 |

Recorded with `npm run fixtures:record` (GitHub requests authenticated with GITHUB_TOKEN).
Checks run on 2026-11-14 in PowerShell:

| Check | Command | Result |
| --- | --- | --- |
| No token in fixtures | `Get-ChildItem tests\engine\fixtures -Recurse -File \| Select-String -Pattern "github_pat_\|ghp_"` | no matches |
| ip advisory present | `... fixtures\ip ... -Pattern "CVE-2024-29415" -List` | match in `osv-9e1a52ddfe4e.json` (GHSA-2p57-rm9w-gvfp, alias CVE-2024-29415, `last_affected: 2.0.1`, no fixed version) |
| lodash.set advisory present | `... fixtures\lodash.set ... -Pattern "CVE-2020-8203" -List` | match in `osv-702cd01e9bf2.json` (GHSA-p6mc-m468-83gw, alias CVE-2020-8203, lodash.set `last_affected: 4.3.2`) |
| inflight successor evidence | `... fixtures\inflight ... -Pattern "lru-cache" -List` | matches in `npm-1c739f1f7040.json` (lru-cache lookup) and `npm-20930bb98bd1.json` (deprecation message) |

## Spec process (autopsy-engine)

Counts below can be checked against `.kiro/specs/autopsy-engine/`.

- Workflow: requirements, then design, then tasks, each reviewed before approval. Requirements were
  revised twice before approval (scope reduced to package.json and package-lock.json; Successor rule
  made deterministic; vulnerability matching by identifier or alias; semver range

## Proof of Life: sandbox spike
Throwaway scripts live in `scripts/spike/`. Each entry below records only observed facts.

### Environment (task 1.1)
| Item | Value | How observed |
| --- | --- | --- |
| Date | 2026-11-14 | `Get-Date -Format yyyy-MM-dd` |
| Node | v26.13.1 | `node -v` |
| OS | Microsoft Windows 11 Pro, version 10.0.26300, build 26300 | `[System.Environment]::OSVersion.VersionString` (`Microsoft Windows NT 10.0.26300.0`) and `Get-CimInstance Win32_OperatingSystem` |
| Drive letters (FileSystem provider) | `C:` only | `Get-PSDrive -PSProvider FileSystem` |
| vitest | 5.1.0 | `node_modules/vitest/package.json` `version` |
| fast-check | 4.10.2 | `node_modules/fast-check/package.json` `version` |

### Scaffolding check (task 1.1)
- Created `scripts/spike/lib.ts`: `runNode(args, { env, cwd, input, timeoutMs })` spawns `process.execPath` with `spawnSync` and `shell: false`, returns `{ status, signal, stdout, stderr }`. Disposition: deleted in 1.15 unless a later kept script needs it.
- `npm run typecheck` first run (2026-11-14): exit 1, `scripts/spike/lib.ts(22,5): error TS2769`, because `{}` is not assignable to `NodeJS.ProcessEnv` (property `NODE_ENV` is required in the project's type setup). Fixed in `lib.ts` with a cast of the env object to `NodeJS.ProcessEnv`. `tsconfig.json` was not changed (its `include` already has `**/*.ts`). Second run: exit 0.
- `npm run lint` (`eslint src tests`, does not cover `scripts/`): exit 0.

### Risk 1: native type stripping under `--permission` (task 1.2)
- Date 2026-11-14, Node v26.13.1, Windows 11 (see Environment above), working directory `C:\dev\graveyard-shift`.
- Files created: `scripts/spike/child/{package.json,a.ts,b.ts,runner.ts}` (erasable syntax only: annotations, `interface`, `import type`; `a.ts` imports `./b.ts`, `runner.ts` imports `./a.ts` and prints `ready hello crypt`) and the driver `scripts/spike/typeStripping.ts`, which uses `runNode` from `lib.ts` (spawnSync, shell false).
- Command: `node scripts/spike/typeStripping.ts`. The driver itself ran under native type stripping, and Node printed a `MODULE_TYPELESS_PACKAGE_JSON` warning for the driver file because the repo `package.json` has no `type` (this is the driver, not the child). Each case below spawned `node --permission --allow-fs-read=<abs dir> <abs entry>`.

| Case | Observed |
| --- | --- |
| 1. `scripts/spike/child` granted, `package.json` `{"type":"module"}` present | exit 0, stdout `ready hello crypt\n`, stderr empty. No experimental warning on stderr. The sibling `./a.ts` and `./b.ts` imports worked. |
| 2. `runner.ts` and `a.ts` in dir `a` (granted, with package.json), `b.ts` in dir `b` (not granted), `a.ts` imports `../b/b.ts` | exit 1, stdout empty, stderr `Error [ERR_ACCESS_DENIED]: Access to this API has been restricted. Use --allow-fs-read to manage permissions.` with `permission: 'FileSystemRead'` and `resource` equal to the path of `b.ts`, thrown from `realpathSync` in the ESM resolver. |
| 3. Same three child files copied to a temp dir with no `package.json` in it (granted dir only) | exit 0, stdout `ready hello crypt\n`, stderr empty (no module-type warning either). I checked that `C:\package.json`, `C:\Users\package.json`, `C:\Users\Owner\package.json` and `C:\Users\Owner\AppData\package.json` do not exist; ancestors under `AppData\Local\Temp` were not checked individually. |
| 4a. `enum Color { Red, Green }` in a granted dir with package.json | exit 1, stderr `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode`. |
| 4b. `class P { constructor(public readonly x: number) {} }` in the same dir | exit 1, stderr `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode`. |

Conclusions (only what was observed):
- The design's assumption held on this machine: Node v26.13.1 ran `.ts` files and a sibling `.ts` import under `--permission` with a single directory grant, without an experimental warning on stderr. The esbuild fallback was not needed.
- An import outside the granted directory fails with `ERR_ACCESS_DENIED` (exit 1), so the child directory must be self-contained under one grant.
- In case 3 the script loaded without a `package.json` and without a warning, so on this machine the child `package.json` was not required for loading. Case 3 does not show what happens in a directory whose ancestors contain a `package.json` with another `type`; keeping `child/package.json` stays the safe choice and is a decision for 1.14.
- Enums and parameter properties fail at load with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. This is what the "erasable syntax only" rule protects against.
- Disposition: `scripts/spike/child/` is kept as the basis of the `smoke` integration test (18.11). `scripts/spike/typeStripping.ts` is deleted in 1.15.
- Typecheck: `npm run typecheck` first failed with exit 1, `TS5097` (import path ending in `.ts` needs `allowImportingTsExtensions`) in `child/a.ts`, `child/runner.ts` and `typeStripping.ts`. Node needs the `.ts` extension in imports, so I added `"allowImportingTsExtensions": true` to `tsconfig.json` (valid because `noEmit` is true). Second run: exit 0. `npm run lint`: exit 0. Task 1.14 should note that the design relies on this tsconfig option.

### Risk 2: CommonJS loading under `--allow-fs-read=<package dir>` (task 1.3)
- Date 2026-11-14, Node v26.13.1, Windows 11, working directory `C:\dev\graveyard-shift`.
- Files created: `scripts/spike/cjsChild/{package.json,runner.ts}` (`{"type":"module"}`, erasable syntax only; `runner.ts` calls `createRequire(<packageDir>/package.json)(<specifier>)` and prints one JSON line `{ok, value | code, name, message}`) and the driver `scripts/spike/cjsLoading.ts`, which builds the packages under `os.tmpdir()/spike-cjs-*` and removes that directory in `finally` (checked afterwards: `Test-Path $env:TEMP\spike-cjs-*` printed `False`).
- Command: `node scripts/spike/cjsLoading.ts` (driver exit 0; the same `MODULE_TYPELESS_PACKAGE_JSON` warning as in 1.2 for the driver file). Every case spawned `node --permission --allow-fs-read=<scripts/spike/cjsChild> --allow-fs-read=<package dir> <runner.ts> <package dir> <specifier>` with an empty environment and `shell: false`. Every child exited 0 with empty stderr; failures appear in the JSON line.

| Case | Package | Observed |
| --- | --- | --- |
| A1 | `main: "entry.js"` (no `index.js` exists), `entry.js` requires `./lib/x.js`; specifier `.` | `ok:true`, value `{main:"ok", x:"from-x"}` |
| A2 | same package, specifier is the absolute path of `entry.js` | same value |
| B | `main: "entry"` (no `.js`) | same value |
| C1 | `main: "lib"`, `lib/index.js` | same value |
| C2 | `main: "./lib/index.js"` | same value |
| C3 | `main: "lib/"` | same value |
| D1 | `index.js` requires `../outside/y.js`, outside dir not granted | `ok:false`, `code: ERR_ACCESS_DENIED`, name `Error`, message `Access to this API has been restricted. Use --allow-fs-read to manage permissions.` |
| D2 | same, with the `outside` dir added as a third `--allow-fs-read` | `ok:true`, value `{y:"from-y"}` |
| E | requires `node:os` and `path` | `ok:true`, `os.EOL` was `\r\n`, `path.sep` was `\`. No grant needed. |
| F | `type:"module"`, `index.js` uses `export` syntax | `ok:true`, value `{__esModule:true, default:1, esm:"yes"}` (require of an ES module worked, no error) |
| G | `type:"module"`, `index.js` uses `module.exports` | `ok:false`, no `code`, name `ReferenceError`, message starts `module is not defined in ES module scope` and says the file is treated as ES module because its `package.json` contains `"type": "module"` |
| H | no `type`, `index.js` uses `export` syntax | `ok:true`, value `{esm:"yes"}` (loaded without error) |

Conclusions (only what was observed):
- The design's assumption held: with the runner dir and the package dir granted, `createRequire` found the package scope, resolved `main` (`entry.js`, `entry`, `lib`, `./lib/index.js`, `lib/`) and loaded a second file through `require('./lib/x.js')`. A1 used a `main` that differs from `index.js`, so the result depends on reading `package.json`.
- Requiring a file outside the grant throws `ERR_ACCESS_DENIED`; granting that directory fixes it (D2). A Node built-in (`node:os`, `path`) needs no grant.
- The design's mapping of a `"type": "module"` package to `unloadable-module` does not match what Node v26.13.1 did here: ES module syntax loaded through `require` (F, H). Only CommonJS syntax inside a `type:module` package failed (G), and that error has no `code`, only name `ReferenceError` and the message above. Top-level await in an ES module package was not tested. For 1.14: detecting `unloadable-module` by error code would miss G, and F/H would load as modules whose exports are namespace-like objects (`__esModule`, `default`).
- Not tested: package paths with spaces or on another drive (Risk 5), a symlinked package dir, `exports` maps and bare-specifier dependencies in `node_modules`.
- Typecheck: `npm run typecheck` exit 0.
- Disposition: `scripts/spike/cjsLoading.ts` and `scripts/spike/cjsChild/` are deleted in 1.15 (real coverage comes from the lodash and synthetic runs).

### Risk 3: minimum Windows environment (`env-minimum`, task 1.4)
- Date 2026-11-14, Node v26.13.1, Windows 11 (see Environment above), working directory `C:\dev\graveyard-shift`. POSIX: not tested (no other platform available).
- Files created: `scripts/spike/envChild/{package.json,runner.ts}` and the driver `scripts/spike/envMinimum.ts`. The child runs under `--permission` and prints one JSON line: `Object.keys(process.env)`, `new Date().getTimezoneOffset()`, a `createRequire` load of a CommonJS package (`main: index.js`, 1.3 approach), a read of a granted file, `os.tmpdir()`, `os.homedir()`, and the text read from stdin (message `ping\n`, passed through `input`). The driver sets `GS_TEST_SECRET` (a dummy sentinel, not a real secret) in its own `process.env`, spawns with `runNode` (spawnSync, `shell: false`) and prints only variable names. Every case spawned `node --permission --allow-fs-read=<scripts/spike/envChild> --allow-fs-read=<package dir> runner.ts <package dir> <granted file>`. `NODE_OPTIONS` was not passed in any case and does not appear in any child key list.
- Commands: `node scripts/spike/envMinimum.ts` (driver exit 0; the same `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr as in 1.2), plus two one-line `node -e` checks described below. `npm run typecheck`: exit 0.

| # | Env passed (names) | Exit | stderr | Package load | Granted file read | Reply to `ping` | `getTimezoneOffset()` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | none (`{}`) | 0 | empty | ok | ok | `ping` | -60 |
| 2 | `TZ=UTC` | 0 | empty | ok | ok | `ping` | 0 |
| 3 | `SystemRoot` | 0 | empty | ok | ok | `ping` | -60 |
| 4 | `SystemRoot`, `TZ=UTC` | 0 | empty | ok | ok | `ping` | 0 |
| 5 | `SystemRoot`, `PATH` | 0 | empty | ok | ok | `ping` | -60 |
| 6 | `SystemRoot`, `TEMP`, `TMP` | 0 | empty | ok | ok | `ping` | -60 |
| 7 | `SystemRoot`, `USERPROFILE`, `HOME` | 0 | empty | ok | ok | `ping` | -60 |
| 8 | `TEMP`, `TMP` (no `SystemRoot`) | 0 | empty | ok | ok | `ping` | -60 |

Observed facts:
- `env: {}` did not give the child an empty environment on this machine. In case 1 the child's `Object.keys(process.env)` was `HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR` (11 names). A spawn of `cmd.exe /c set` with `env: {}` also listed `COMSPEC, HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, PATHEXT, PROMPT, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR`. So Windows or libuv supplies these names when the env block is empty. I did not determine which of the two does it.
- In a one-off check (`GS_TEST_SECRET` set in the parent, `env: {}`), the child's `PATH`, `TEMP` and `USERNAME` values were equal to the parent shell's values, and `PATH` was not empty. This does not show whether the values come from the parent or from the registry defaults, because both can be identical here.
- Cases 3 and 4: passing `SystemRoot` produced the key `SystemRoot` (mixed case) in the child, where cases 1, 2 and 8 produced `SYSTEMROOT`. The other 10 default names were present in every case.
- Every case (1 to 8) started, exited 0, loaded the CommonJS package, read the granted file, returned `os.tmpdir()` = `C:\Users\Owner\AppData\Local\Temp` and `os.homedir()` = `C:\Users\Owner`, and echoed `ping`. Stderr was empty in all cases. `HOME` appeared in the child only when it was passed (case 7).
- `GS_TEST_SECRET` was absent from the child's key list in all 8 cases. `NODE_OPTIONS` was absent in all 8 cases.
- `TZ=UTC` changed `getTimezoneOffset()` from -60 (machine time zone, no `TZ`) to 0 (cases 2 and 4). Only these two values were observed; I did not test other `TZ` values or a different machine time zone.
- `PATH`, `TEMP`/`TMP`, `USERPROFILE`/`HOME` were not needed for loading a package, reading a granted file, `os.tmpdir()` or `os.homedir()`; these calls worked in cases 1 to 4 and 8, where none of them was passed (the OS-provided defaults were present, see above).

Conclusions (only what was observed):
- Smallest set that started and loaded a package: `{}` (case 1). `SystemRoot` was not needed on this machine, with or without `TEMP`/`TMP` (case 8).
- The design's candidate list (`SystemRoot` from the parent plus `TZ=UTC`) started and loaded a package (case 4), so it is sufficient, but `SystemRoot` was not necessary. `TZ=UTC` is the only entry with an observed effect (time zone offset).
- The design's wording "starts the child with `{}`" does not mean an empty child environment on Windows. The `env-scrubbed` test must therefore assert that the sentinel (and any parent-only variable) is absent, not that `Object.keys(process.env)` is empty or equals the allowlist. Whether the OS-supplied names carry secrets was not examined; only the names listed above appeared.
- Not tested: POSIX, a spawn with a non-Windows-default `PATH` that lacks the Node directory, a package that spawns subprocesses, and non-ASCII profile paths.
- Disposition: `scripts/spike/envMinimum.ts` and `scripts/spike/envChild/` are kept as the basis of the `env-minimum` integration test (18.11); the design revision is for 1.14.

### Risk 4: child current directory equal to the package directory (task 1.5)
- Date 2026-11-14, Node v26.13.1, Windows 11, working directory `C:\dev\graveyard-shift`. POSIX: not tested.
- Files created: `scripts/spike/cwdChild/{package.json,runner.ts}` (`{"type":"module"}`, erasable syntax only) and the driver `scripts/spike/cwdPackage.ts`. The runner prints one JSON line with: `process.cwd()`, `fs.realpathSync.native(process.cwd())`, a `createRequire(<packageDir>/package.json)('.')` load (the package's `index.js` does `require('./x.js')`), `fs.readFileSync('./x.js')` (relative to the child's cwd), and `createRequire(<cwd>/noop.js)('./x.js')`.
- Command: `node scripts/spike/cwdPackage.ts` (driver exit 0; the same `MODULE_TYPELESS_PACKAGE_JSON` warning for the driver as in 1.2). The driver creates `os.tmpdir()/spike-cwd-*` (path taken through `realpathSync.native`) and removes it in `finally`; afterwards `Test-Path $env:TEMP\spike-cwd-*` printed `False`. Every case used `spawnSync(process.execPath, ['--permission', '--allow-fs-read=<scripts/spike/cwdChild>', ...grants, runner.ts, <packageDir>], { shell: false, env: {}, cwd })` via `runNode`. All children exited 0 with empty stderr; failures show in the JSON line. `npm run typecheck`: exit 0.
- "Real" below is the `realpathSync.native` form `C:\Users\Owner\AppData\Local\Temp\spike-cwd-lqcnx7\a-long-package-directory-name`. "OK" means `ok:true`.

| # | cwd passed | Grants (besides runner dir) | `process.cwd()` | `realpath.native(cwd)` | package load (`./x.js` inside package) | `readFileSync('./x.js')` | `require('./x.js')` from cwd |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | real package dir | real package dir | equal to real | equal to real | OK `{x:"from-x"}` | OK (33 chars) | OK |
| 2 | other dir (not granted) | real package dir | the other dir path | `ERR_ACCESS_DENIED` | OK | `ERR_ACCESS_DENIED` | `MODULE_NOT_FOUND` (`./x.js` not found; the other dir has no `x.js` and was not readable) |
| 2b | other dir | real package dir + other dir | the other dir path | OK | OK | `ENOENT` (no `x.js` there) | `MODULE_NOT_FOUND` (no `x.js` there) |
| 3a | junction to package dir | real package dir only | the junction path (not the target) | `ERR_ACCESS_DENIED` | OK | `ERR_ACCESS_DENIED` | `ERR_ACCESS_DENIED` |
| 3b | junction | junction only (package arg = junction path) | junction path | OK, returns the real path | `ERR_ACCESS_DENIED` | OK (33) | `ERR_ACCESS_DENIED` |
| 3c | junction | real + junction | junction path | OK, returns the real path | OK (package arg = junction path) | OK (33) | OK |
| 4 | symlink (`dir` type) | - | not tested: `symlinkSync` threw `EPERM: operation not permitted` (no symlink privilege for this user); the junction in 3a to 3c covers a reparse-point path | - | - | - | - |
| 5a | 8.3 short path `C:\Users\Owner\AppData\Local\Temp\SPIKE-~1\A-LONG~1` | real package dir only | the short path as passed | `ERR_ACCESS_DENIED` | OK (package arg = real path) | `ERR_ACCESS_DENIED` | `ERR_ACCESS_DENIED` |
| 5b | short path | short path only | short path | OK, returns the real path | OK (package arg = short path) | OK (33) | OK |
| 5c | short path | real + short | short path | OK, returns the real path | OK | OK (33) | OK |

Observed facts:
- Case 1: Node started with `cwd` = the package dir under `--permission` and `--allow-fs-read=<runner dir>` plus `--allow-fs-read=<package dir>`. `process.cwd()` equalled the parent's `realpathSync.native` path. A relative `require('./x.js')` inside the package, a relative `readFileSync('./x.js')` and a `require('./x.js')` resolved from the cwd all worked.
- Case 2: with `cwd` outside every grant, Node still started (exit 0, empty stderr) and `process.cwd()` returned the path. Only operations that touch the cwd path failed: `realpathSync.native(cwd)` and relative file reads gave `ERR_ACCESS_DENIED`. Loading the package by absolute path still worked. In 2b, granting the cwd made those calls work (the `ENOENT` and `MODULE_NOT_FOUND` there are because that dir has no `x.js`). So the cwd does not have to be granted for Node to start, and it does have to be granted for relative paths to work.
- Junction and short-name cwd (3a, 5a): the cwd is reported as the link or short path as passed, not the real path. A grant on the real path alone did not cover relative reads or `realpathSync.native(cwd)` (`ERR_ACCESS_DENIED`). The grant string and the `cwd` string must be the same form: a grant on the link/short path alone made relative reads work (3b, 5b) but in 3b a package load by the junction path failed with `ERR_ACCESS_DENIED` while 5b (short path) succeeded; with both forms granted everything worked (3c, 5c).
- The 3b failure shows that a junction grant did not cover the package files reached through the real target for `createRequire` resolution; I did not examine why. The 5b short-path grant did cover it. I did not test other drive letters (only `C:` exists) or other link forms.
- Short (8.3) names exist on this machine's volume for `Temp` (`SPIKE-~1`, `A-LONG~1` obtained via `cmd.exe /d /c for %I in ("<path>") do @echo %~sI`).

Conclusions (only what was observed):
- The design's assumption held for the plain case: `cwd: <real package dir>` with the package dir granted starts, `process.cwd()` equals the real path, and relative requires and reads work (R4.6, R5.2).
- It held for link and short-name forms only when the engine uses one consistent form for the grant and the `cwd`, or grants both forms (3c, 5c). The design's rule "the engine uses the real path for the flag, `cwd` and the Root_Normalizer" fits case 1; a `cwd` different from the granted path (3a, 5a) breaks relative reads. Fallback if needed: spawn with a granted `cwd` and `process.chdir` was not tried.
- No design edit made here; design changes are for 1.14.
- Disposition: `scripts/spike/cwdPackage.ts` and `scripts/spike/cwdChild/` are deleted in 1.15 (covered by the `smoke` and `paths-spaces` integration tests).

### Risk 5a: package path that contains spaces (`paths-spaces`, task 1.6)
- Date 2026-11-14, Node v26.13.1, Windows 11, working directory `C:\dev\graveyard-shift`. POSIX: not tested.
- Files created: `scripts/spike/spacesChild/{package.json,runner.ts}` (`{"type":"module"}`, erasable syntax only) and the driver `scripts/spike/pathsSpaces.ts`. The driver creates `os.tmpdir()/spike-spaces-*` (taken through `realpathSync.native`) and removes it in `finally`; afterwards `Test-Path $env:TEMP\spike-spaces-*` printed `False`. For each directory name `<root>/<name>/pkg` it writes a CommonJS package (`main: index.js`), `esm.mjs` (`import './nope.mjs'`), `data.json`, `file.foo` and an empty `sub/`, then runs `spawnSync(process.execPath, ['--permission', '--allow-fs-read=<spacesChild dir>', '--allow-fs-read=<pkg>', runner.ts, <pkg>, <denied file>], { shell: false, env: {}, cwd: <pkg> })` via `runNode`. The grant is one argv element, the whole `--allow-fs-read=<path>` string. `<denied file>` is `<root>/denied/secret.txt`, which no grant covers.
- Names tested (each its own directory name): `gs space`, `gs-ünï-é` (non-ASCII), `gs#hash`, `gs%pct`, `gs%20pct` (extra case: a literal `%20` in the name). The OS allowed all of them.
- Command: `node scripts/spike/pathsSpaces.ts` (driver exit 0, the same `MODULE_TYPELESS_PACKAGE_JSON` warning for the driver as in 1.2). `npm run typecheck`: exit 0. The first run printed the non-ASCII name as mojibake only because the console code page was not UTF-8; the second run set `[Console]::OutputEncoding` to UTF-8 and showed `gs-ünï-é`. The two runs used different random temp suffixes (`vjWszr`, `Q6G6tZ`).
- Mechanisms in the runner: A `import(pathToFileURL(<pkg>/missing.mjs).href)`; B `import()` of `<pkg>/esm.mjs`, which imports a missing `./nope.mjs`; C `createRequire(<pkg>/package.json)('./nope.js')`; D constructed values `pathToFileURL(<pkg>).href` and `new URL('./x.js', pathToFileURL(<pkg> + sep)).href` (not thrown errors); E `readFileSync(new URL('./nope.txt', pathToFileURL(<pkg> + sep)))`; F `import()` of `data.json` without an import attribute; G `import()` of the directory `sub`; H `import()` of `file.foo`; plus denied reads of `secret.txt` by native path, by file URL, and by `import()` of its file URL.

Observed, same for all five directory names unless stated:
- The child started (exit 0, empty stderr, signal null), `process.cwd()` equalled the package dir, and `createRequire(...)('.')` loaded the package (`{"x":"from-index"}`).
- Thrown messages that contain a `file://` URL: only mechanism F (`ERR_IMPORT_ATTRIBUTE_MISSING`). Message for `gs space`: `Module "file:///C:/Users/Owner/AppData/Local/Temp/spike-spaces-Q6G6tZ/gs%20space/pkg/data.json" needs an import attribute of "type: json"`. So the segment appears as `gs%20space` (percent-encoded), the drive letter as `C:` after `file:///`, and separators as `/`.
- Thrown messages that contain a path in native form (backslashes, the space unencoded, no quotes added by the engine): A `Cannot find module 'C:\...\gs space\pkg\missing.mjs' imported from C:\dev\graveyard-shift\scripts\spike\spacesChild\runner.ts`; B `Cannot find module 'C:\...\gs space\pkg\nope.mjs' imported from C:\...\gs space\pkg\esm.mjs` (the path is in single quotes inside the message, a Node quote, not added by us); C `Cannot find module './nope.js'\nRequire stack:\n- C:\...\gs space\pkg\package.json`; E `ENOENT: no such file or directory, open 'C:\...\gs space\pkg\nope.txt'` (a URL was passed in, the message has the native path); G `Directory import 'C:\...\gs space\pkg\sub' is not supported resolving ES modules imported from <runner path>`; H `Unknown file extension ".foo" for C:\...\gs space\pkg\file.foo` (no quotes).
- Mechanism D: `pathToFileURL(<pkg>).href` gave `file:///C:/Users/Owner/AppData/Local/Temp/spike-spaces-.../gs%20space/pkg`.
- Denied read (`secret.txt` outside every grant), all three forms (native path, file URL, `import()` of the URL): `code: ERR_ACCESS_DENIED`, message `Access to this API has been restricted. Use --allow-fs-read to manage permissions.` The message contains no path (in 1.2 the same error carried a `resource` property with the path; that property was not printed here).
- Note on runner paths: A, B, G and the `imported from` part show the runner script path (`C:\dev\graveyard-shift\scripts\spike\spacesChild\runner.ts`) as a native path outside the package root.

Characters in `file://` URLs (mechanism D and F, same encoding in both):

| Directory name | Segment in the URL | Segment in native error text |
| --- | --- | --- |
| `gs space` | `gs%20space` | `gs space` |
| `gs-ünï-é` | `gs-%C3%BCn%C3%AF-%C3%A9` (UTF-8 bytes, uppercase hex) | `gs-ünï-é` |
| `gs#hash` | `gs%23hash` | `gs#hash` |
| `gs%pct` | `gs%25pct` | `gs%pct` |
| `gs%20pct` | `gs%2520pct` | `gs%20pct` |

- Every URL form came from Node (`pathToFileURL` or Node's own message), and all used uppercase hex digits. I did not observe lowercase hex from Node. All five names loaded the package, so `#` and `%` in a directory name did not break `--allow-fs-read` matching or `createRequire` loading.
- Cases not run: names with `?`, a trailing space or dot, very long paths, and names with spaces on a drive other than `C:`.

Conclusions (only what was observed):
- The design's assumption held: a package directory with a space, passed as one argv element with `shell: false` and used as `cwd`, starts the child and loads the package, and the file URL form of the space is `%20`.
- Most Node error text carries the native path (spaces, `#`, `%` and non-ASCII unencoded), so the Root_Normalizer must match the native form with unencoded special characters as well as the `file://` form (13.19). The `file://` form appeared in one tested message (F) and in `pathToFileURL`, with `%20`, `%23`, `%25` and UTF-8 percent-encoded bytes. A root containing a literal `%20` appears as `%2520` in a URL and as `%20` in native text, so a normalizer that decodes before matching could confuse the two; that is for 13.19 and the property tests, not decided here.
- No design edit made here; design changes are for 1.14.
- Disposition: `scripts/spike/pathsSpaces.ts` and `scripts/spike/spacesChild/` are kept as the basis of the integration test `paths-spaces` (18.11).

### Risk 5b: package path on another drive (`other-drive`, task 1.7)
- Date 2026-11-14, Node v26.13.1, Windows 11 (10.0.26300), working directory `C:\dev\graveyard-shift`.
- Command: `Get-PSDrive -PSProvider FileSystem`. Observed: one drive, `C` (root `C:\`). Repository drive `C:\`; `os.tmpdir()` is `C:\Users\Owner\AppData\Local\Temp` (drive `C:\`). `$env:PROOF_TEST_OTHER_DRIVE` was empty.
- The user was asked once whether they can provide a directory on another drive and answered no.
- Created `scripts/spike/otherDrive.ts` (reuses `runNode` and `scripts/spike/cjsChild/runner.ts`). It takes a writable directory from `PROOF_TEST_OTHER_DRIVE` (ignored if on the repository drive) or, on Windows, the first other drive letter `A:` to `Z:` that exists and accepts a probe directory. It builds the 1.3 package (`main: entry.js`, requires `./lib/x.js`) in a temp directory there, runs `node --permission --allow-fs-read=<cjsChild dir> --allow-fs-read=<pkg> runner.ts <pkg> .` with `cwd` = the package and `shell: false`, prints the result and removes the temp directory. With no other drive it prints `other drive not available` and exits 0.
- Command: `node scripts/spike/otherDrive.ts` (same `MODULE_TYPELESS_PACKAGE_JSON` warning as in 1.2). Observed stdout: `date: 2026-11-14`, `node: v26.13.1`, `repository drive: C:\`, `os.tmpdir(): C:\Users\Owner\AppData\Local\Temp (drive C:\)`, `other drive letters present: (none)`, `other drive not available`. Exit 0. `npm run typecheck`: exit 0.
- other drive not available (observed drive list: `C` only, 2026-11-14). This case is NOT verified. Risk stays unverified: a package directory on a different drive than the runner directory has not been tested. Addendum: verified in CI run 2 on the GitHub Windows runner (checkout on D:, temp on C:, per the user; the sandbox tests passed in CI runs 1 and 2; see "Proof of Life: CI run 1"). It remains not verified on the user's own machine (drive C: only). The integration test `other-drive` (18.11) is conditional and will report "skipped" when no other drive exists and `PROOF_TEST_OTHER_DRIVE` is unset.
- Check that the script's load path runs (not a verification of the risk): I created a virtual drive with `subst X: <temp dir on C:>`, set `PROOF_TEST_OTHER_DRIVE=X:\` and ran `node scripts/spike/otherDrive.ts`. Observed: `package root (PROOF_TEST_OTHER_DRIVE): X:\spike-otherdrive-gf4jx8 (drive X:\)`, `runner dir: ...\cjsChild (drive C:\)`, `exit=0 signal=null`, stdout `{"ok":true,"value":{"main":"ok","x":"from-x"}}`, stderr empty; driver exit 0. Afterwards `subst X: /d` removed the mapping and the temp directory was deleted; `Get-PSDrive -PSProvider FileSystem` showed `C` only. `subst` maps a letter onto a directory of the same physical volume, so this does not test a real second drive (different volume or filesystem), and Node may or may not treat it differently from one; that was not examined.
- Disposition: `scripts/spike/otherDrive.ts` is kept as the basis of the conditional integration test `other-drive` (18.11).

### Risk 6a: fast-check 4.10 `RunDetails` field names (task 1.8)
- Date 2026-11-14, Node v26.13.1, fast-check 4.10.2 (`fc.__version` printed `4.10.2`), Windows 11, working directory `C:\dev\graveyard-shift`.
- The path in the task (`lib/types/check/runner/reporter/RunDetails.d.ts`) does not exist. `Get-ChildItem node_modules/fast-check -Recurse -Filter "RunDetails*.d.ts"` found nothing. The types are bundled in `node_modules/fast-check/lib/fast-check.d.ts` (region `src/check/runner/reporter/RunDetails.d.ts` from line 604; `Parameters` from line 870; `VerbosityLevel` enum in the same file).
- Script: `scripts/spike/fcRunDetails.ts`. Command: `node scripts/spike/fcRunDetails.ts` (native type stripping, the usual `MODULE_TYPELESS_PACKAGE_JSON` warning). The first run was killed after 15 s (see case E0). `npm run typecheck`: exit 0 (after typing `show` generically).

**Types (from `fast-check.d.ts`).** `RunDetails<Ts>` is a union of four interfaces that all extend `RunDetailsCommon<Ts>`:

| Variant | `failed` | `interrupted` | `counterexample` | `counterexamplePath` | `errorInstance` |
| --- | --- | --- | --- | --- | --- |
| `RunDetailsFailureProperty` | `true` | `boolean` | `Ts` | `string` | `unknown` |
| `RunDetailsFailureTooManySkips` | `true` | `false` | `null` | `null` | `null` |
| `RunDetailsFailureInterrupted` | `true` | `true` | `null` | `null` | `null` |
| `RunDetailsSuccess` | `false` | `boolean` | `null` | `null` | `null` |

`RunDetailsCommon<Ts>` fields: `failed: boolean`, `interrupted: boolean`, `numRuns: number`, `numSkips: number`, `numShrinks: number`, `seed: number`, `counterexample: Ts | null`, `errorInstance: unknown | null`, `counterexamplePath: string | null`, `failures: Ts[]`, `executionSummary: ExecutionTree<Ts>[]`, `verbose: VerbosityLevel`, `runConfiguration: Parameters<Ts>`. There is no declared field `error`. `Ts` is the tuple of argument types (for `fc.asyncProperty(fc.integer(), ...)` it is `[number]`). `numRuns` is documented as runs up to and including the first failure (failed) or successful executions (otherwise); `numSkips` counts skips before the first failure.

**Observed runs** (all `seed: 42`; every result has `verbose: 0` unless stated; `failures` and `executionSummary` lengths are 0 unless stated):

| Case | `failed` | `interrupted` | `numRuns` | `numSkips` | `numShrinks` | `counterexample` | `counterexamplePath` | `errorInstance` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A `asyncProperty(integer, n => n < 10)`, `numRuns: 100` | true | false | 7 | 0 | 29 | `[10]` (array, 1 element) | `"6:1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:1:0:0"` | `Error` with message `Property failed by returning false` |
| B passing (`n === n`), `numRuns: 100` | false | false | 100 | 0 | 0 | `null` | `null` | `null` |
| C same property as A, `numRuns: 1` | false | false | 1 | 0 | 0 | `null` | `null` | `null` |
| D property throws `new Error('boom')` for `n > 5` | true | false | 1 | 0 | 2 | `[6]` | `"0:2:0"` | `Error` with message `boom` |
| D2 throws the string `'plain-string'` | true | false | 1 | 0 | 2 | `[6]` | `"0:2:0"` | the string `plain-string` (`typeof` string) |
| D3 throws `{ code: 'X' }` | true | false | 1 | 0 | 2 | `[6]` | `"0:2:0"` | the object `{"code":"X"}` |

- Keys of the returned object, failed runs (A, D, D2, D3, E6, F, G): `failed, interrupted, numRuns, numSkips, numShrinks, seed, counterexample, counterexamplePath, errorInstance, failures, executionSummary, verbose, runConfiguration` (13 keys).
- Keys of the returned object, runs without a failing property (B, C, E, E2 to E5, H, H2, H3): the same 13 keys plus an extra key `error` placed between `counterexamplePath` and `errorInstance`; its value was `null` in B, C and E to E5 (the log printed `error key present: true value: null` for those; I did not print it for H to H3). `error` is not in the `RunDetails` type declarations. Failed-property runs have no `error` key (`'error' in details` was `false`).
- A returns `false` and fast-check records an `Error` instance with message `Property failed by returning false` in `errorInstance`. A thrown value of any kind (Error, string, object) is stored unchanged in `errorInstance`.
- Case A shrank from the first failure at run index 7 to `[10]`, the smallest failing value, in 29 shrink steps. The case-A counterexample `[10]` is an array of length 1, and `counterexamplePath` is a colon-separated string of integers.
- Case C: with `numRuns: 1` and the same seed, the run passed (`failed: false`, `numRuns: 1`), so a too-small `numRuns` hides the failure that case A found at run index 7.
- `runConfiguration` keys (all cases): `seed, randomType, numRuns, maxSkipsPerRun, timeout, skipAllAfterTimeLimit, interruptAfterTimeLimit, markInterruptAsFailure, skipEqualValues, ignoreEqualValues, path, logger, unbiased, verbose, examples, endOnFailure, reporter, asyncReporter, includeErrorInReport, plugins`.

**Filter and skip behavior (the `generator-exhausted` question).**
- E0: `fc.asyncProperty(fc.integer().filter(() => false), async () => true)` with `fc.check(..., { seed: 42, numRuns: 100 })` never returned. The process was killed after 15 s with no output for that case (first run of the script, started with `Start-Process` and killed). So an arbitrary-level `.filter` that never accepts does not produce a failed `RunDetails`; it hangs. The call was removed from the script and not re-run to measure how long it would take.
- E5: `fc.integer().filter(n => n % 1000 === 0)` with `maxSkipsPerRun: 1` returned `failed: false`, `numRuns: 100`, `numSkips: 0`. Arbitrary `.filter` retries inside the arbitrary and does not count as a skip.
- The too-many-skips failure comes from `fc.pre(...)` inside the predicate. E: `fc.pre(n < 0 && n > 0)` (never true), `numRuns: 100`, default `maxSkipsPerRun`: `failed: true`, `interrupted: false`, `numRuns: 0`, `numSkips: 10001`, `numShrinks: 0`, `counterexample: null`, `counterexamplePath: null`, `errorInstance: null`, extra key `error: null`. E2 (same, `maxSkipsPerRun: 1`): `numRuns: 0`, `numSkips: 101`, same nulls. The default `maxSkipsPerRun` is therefore 100 (10001 = 100 x 100 + 1, observed 10001 for `numRuns: 100`; the `.d.ts` states `maxSkips = maxSkipsPerRun * numRuns`).
- E4: `fc.pre(n % 7 === 0)` with `maxSkipsPerRun: 1` and `numRuns: 100`: `failed: true`, `numRuns: 25`, `numSkips: 101`, nulls. E3 (same predicate, default `maxSkipsPerRun`): `failed: false`, `numRuns: 100`, `numSkips: 598`.
- E6: `fc.pre(n % 2 === 0)` then `return n < 10`: `failed: true`, `numRuns: 5`, `numSkips: 2`, `numShrinks: 13`, `counterexample: [1077566108]`, `counterexamplePath: "6:9:1:4:1:0:0:2:0:0:0:0:0:0"`. A pre-condition skip does not end the run.
- The "error text" for a too-many-skips failure is not in `RunDetails` (`errorInstance` is `null`, `error` is `null`). It is the output of `fc.defaultReportMessage(details)` and of the error thrown by `fc.assert`, both observed as: `Failed to run property, too many pre-condition failures encountered\n{ seed: 42 }\n\nRan 0 time(s)\nSkipped 101 time(s)\n\nHint (1): ...` (three hint lines follow; this output was from `maxSkipsPerRun: 1`).
- Observed discriminator for the driver: `failed === true && counterexample === null && interrupted === false` was the too-many-skips outcome (E, E2, E4); `failed === true && interrupted === true && counterexample === null` was the interrupted outcome (H2, H3).

**Options.**
- `endOnFailure` (F vs F2, property counting predicate calls): default run: `numRuns: 7`, `numShrinks: 29`, `counterexample: [10]`, path `6:1:0:...:1:0:0`, 39 predicate calls in total. `endOnFailure: true`: `numRuns: 7`, `numShrinks: 0`, `counterexample: [1080227326]`, `counterexamplePath: "6"`, 7 predicate calls. So it stops at the first failure and returns the unshrunk value with a path that has one component.
- `verbose` (G, G2, G3): `VerbosityLevel.None` is `0`, `Verbose` is `1`, `VeryVerbose` is `2`; `RunDetails.verbose` echoed the level. With `Verbose` (and with `verbose: true`, which printed `verbose: 1`) `failures` had 30 entries and `executionSummary` 1 entry; with `VeryVerbose` `failures` had 30 and `executionSummary` 7 entries. At `None` both are empty. `counterexample`, `numRuns`, `numShrinks` and `counterexamplePath` were the same as in case A at all levels.
- `maxSkipsPerRun`: see E to E4 (budget `maxSkipsPerRun * numRuns` skips; one more skip fails the run).
- `interruptAfterTimeLimit` (with `fc.asyncProperty` that sleeps 20 ms, `numRuns: 1000`): `interruptAfterTimeLimit: 100` gave `failed: false`, `interrupted: true`, `numRuns: 3` (H). Adding `markInterruptAsFailure: true` gave `failed: true`, `interrupted: true`, `numRuns: 3`, `counterexample: null`, `counterexamplePath: null` (H2). `interruptAfterTimeLimit: 1` without `markInterruptAsFailure` gave `failed: true`, `interrupted: true`, `numRuns: 0` (H3), which matches the `.d.ts` note that an interrupt with no success is always a failure. The type file marks `interruptAfterTimeLimit`, `markInterruptAsFailure`, `timeout`, `skipAllAfterTimeLimit`, `skipEqualValues`, `ignoreEqualValues`, `unbiased`, `reporter` and `asyncReporter` as `@deprecated` in favor of plugins (`fc.interruptAfterTimeLimit`, `fc.timeout`, ...), and `Parameters` has a new `plugins` field (since 4.10.0). The plugin forms were not run. The time limit "relies on `Date.now()`" per the type comment, so these options do not fit the pure-core determinism rule and the design's attempt-based shrink budget does not use them.

**Differences from the design** (for 1.14; design.md not edited here):
1. Fields `failed`, `counterexample`, `counterexamplePath`, `numRuns`, `numShrinks`, `numSkips`, `seed`, `errorInstance` exist with the names and types the design uses (`details.failed`, `details.counterexample`, `details.counterexamplePath`). The task list's `error` is not a declared field; it appears at runtime only on non-failing runs, with value `null`. The driver should use `errorInstance` (type `unknown`: an `Error`, a string or any thrown value) and must not rely on `error`.
2. The design says a failed `fc.check` with a null counterexample means "the arbitrary exhausted its filter (`too many pre-condition failures`)". Observed: an arbitrary-level `.filter` that never accepts hangs, and an `.filter` with low acceptance does not raise `numSkips`. The too-many-skips failure arises only from `fc.pre` in the predicate (or `maxSkipsPerRun`). A null counterexample with `failed: true` can also mean `interrupted: true`, so `generator-exhausted` must be detected with `interrupted === false` (the type guarantees this for the too-many-skips variant). The design's "Avoiding filter exhaustion" paragraph (never-accepting `.filter` yields a harness error) does not match the observed hang.
3. The error text of a too-many-skips failure is not in `RunDetails`; it comes only from `fc.defaultReportMessage`/`fc.assert`. The driver's `generator-exhausted` harness error should carry its own text (and may include `numSkips`).
4. `check(...)` of an async property returns `Promise<RunDetails<Ts>>` where `Ts` is a tuple `[A]`, so the design's `counterexample` is `[readonly unknown[]]` (the arguments array wrapped in a 1-tuple), not the arguments array itself. Observed `counterexample` values were arrays with one element for a one-arbitrary property.
5. `numRuns` in the failed `RunDetails` is the index count at the failure (7 in case A), not the configured number; the design's "counting" rule uses its own attempt log and does not depend on it.
6. The design's `verbose: fc.VerbosityLevel.None` is valid (`None = 0`).
- Not tested: `fc.assert`, the plugin forms, `examples`, `path`/`seed` replay (task 1.9), async properties with real concurrency.
- Disposition: `scripts/spike/fcRunDetails.ts` is deleted in 1.15 (the driver tests in task 11 cover this).

### Risk 6b: `path` replay with `numRuns` smaller than the recorded run index (task 1.9)
- Date 2026-11-14, Node v26.13.1, fast-check 4.10.2, Windows 11, working directory `C:\dev\graveyard-shift`.
- Script: `scripts/spike/fcReplay.ts`. Command: `node scripts/spike/fcReplay.ts` (output taken from this run; the only change after it was a type-only edit for `npm run typecheck`, which then exited 0). The script scans seeds 1, 2, ... for the first seed whose failure is found at a run index (`numRuns` of the failed details) of at least 5 with `numRuns: 100`, then replays. "Same" means `fc.stringify(counterexample)` equals that of the original.
- Properties: P1 `fc.asyncProperty(fc.integer(), async n => n < 10)`, seed 20. P2 `fc.asyncProperty(fc.string(), fc.array(fc.integer()), fc.anything(), ...)` failing when `s.length >= 3 && sum(a) > 100`, seed 2. P3 the same predicate with `fc.tuple(fc.string(), fc.array(fc.integer()), fc.anything())` as one arbitrary, seed 2 (counterexample is wrapped one level more: `[["   ",[75,26],[]]]`).

| | P1 | P2 | P3 |
| --- | --- | --- | --- |
| Original (`numRuns: 100`): `numRuns` (failing run index), `numShrinks` | 7, 27 | 8, 34 | 8, 34 |
| Shrunk counterexample | `[10]` | `["   ",[75,26],[]]` | `[["   ",[75,26],[]]]` |
| `counterexamplePath` | `6:1:0:...:0` (28 components) | `7:1:0:1:3:4:7:5:...:12` (35 components) | same as P2 |

**Replay with `{ seed, path, ... }`** (identical in P1, P2 and P3): for `numRuns` of 1, 100, 1000, 0, index-1, index, and with `numRuns` omitted: `failed: true`, `interrupted: false`, `numRuns: 1`, `numShrinks: 0`, same counterexample, same `counterexamplePath` string. The minimum `numRuns` that reproduced (scan 1..index+1) was 1. A path recorded from a run with `numRuns` equal to the failing index (7 and 8) and replayed with `numRuns: 1` also reproduced. A replay with a path ran exactly one case and did not shrink, because the path points at the already-shrunk case.

**`{ seed, path, endOnFailure: true }`** (also with `numRuns: 1`): returned the shrunk counterexample (`[10]` in P1, the same as above in P2 and P3), `numShrinks: 0`, `numRuns: 1`. In these runs `endOnFailure` changed nothing visible when a path was given.

**Same seed, no path, different `numRuns`:**

| `numRuns` | P1 (index 7) | P2 and P3 (index 8) |
| --- | --- | --- |
| 1 | `failed: false`, `numRuns: 1`, no counterexample | `failed: false`, `numRuns: 1`, no counterexample |
| index-1 (6 and 7) | `failed: false`, `numRuns: 6` | `failed: false`, `numRuns: 7` |
| index (7 and 8) | failed, same counterexample, `numShrinks: 27`, same path | failed, same counterexample, `numShrinks: 34`, same path |
| index+1, 50, 100, 1000 | failed, same counterexample, `numRuns: 7`, `numShrinks: 27`, same path | failed, same counterexample, `numRuns: 8`, `numShrinks: 34`, same path |

- So without a path, the seed alone reproduced the same shrunk counterexample and path for every `numRuns` of at least the failing run index, and did not find the failure for a smaller `numRuns`. With `numRuns` larger than recorded, the shrunk result was identical (same `numShrinks`).
- Not tested: a path replay on a changed predicate, a path replay after the property changed its arbitraries, a seed or path for a property run through `fc.assert`, and `fc.pre` skips combined with a path.

**Whether the design's assumption held** (design "Replay (R8.8)": `fc.check(sameProperty, { seed: replay.seed, path: replay.path })` re-runs only the shrunk case): it held for all three properties, and also with `numRuns` of 1 or 0 or omitted. `Replay_Parameters` as `seed` and `path` need no `numRuns` for path replay. A seed-only replay does need a `numRuns` of at least the failing run index, so the design's `Replay` type (`seed`, `path`) is sufficient and no change to R8.8 follows from this spike. The replay returns `counterexample` in the same shape as the original (the tuple of arguments, wrapped once more for `fc.tuple`).
- Disposition: `scripts/spike/fcReplay.ts` is deleted in 1.15.

### Extra risk: vitest 5 `projects`, `globalSetup` and per-project timing (task 1.10)
- Date 2026-11-14; vitest 5.1.0 (`node_modules/vitest/package.json`), Node v26.13.1, Windows, PowerShell. Real `vitest.config.mts` (one flat `test` block with `include`, `environment`, `setupFiles: ["tests/setup/networkGuard.ts"]`) and `package.json` (`"test": "vitest --run"`) were not changed.
- Scratch files: `scripts/spike/vitest.config.mts` (two inline projects, `spike-a` and `spike-b`, both built with `defineProject` inside `defineConfig({ test: { projects: [...] } })`), `scripts/spike/vitestScratch/{budgetSetup.ts,a/a.test.ts,b/b.test.ts}`. Each test sleeps 500 ms (`SPIKE_SLEEP_MS`), then asserts and prints whether `globalThis.fetch` is the network guard. Both projects use the same `globalSetup` file `budgetSetup.ts`: `setup(project: TestProject)` stores `performance.now()`, `teardown()` prints the elapsed time. `tsc --noEmit` reported no errors in `scripts/spike`.
- **Key names.** `test.projects` is the key. The type definitions (`vitest/dist/chunks/plugin.d.*.d.ts`) declare `projects?: TestProjectConfiguration[]` and `globalSetup?: string | string[]`; `defineProject` is exported from `vitest/config`. `test.workspace` is rejected at startup: `The `test.workspace` option was removed in Vitest 4. Please, migrate to `test.projects` instead.` (exit 1). The project name is `test.name`. Inline project configs have `extends?: string | boolean`, documented default `true`.
- Command: `npx vitest --run --config scripts/spike/vitest.config.mts` gave exit 0, `Test Files 2 passed (2)`, `Duration 1.29s`, output (verbose reporter shows `|spike-a|` and `|spike-b|` prefixes):
  ```
  [spike] setup spike-a
  [spike] setup spike-b
  [spike] teardown call #1 pid=4776
  [spike] teardown spike-b: 1222 ms wall-clock
  [spike] teardown call #1 pid=4776
  [spike] teardown spike-a: 1233 ms wall-clock
  ```
- **Per-project timing.** Measured by recording a clock value in `setup(project)` and reading it in `teardown()`. Each project got its own module instance of the shared file (the call counter was `#1` in both teardowns, and each teardown printed only its own project). Setup and teardown both ran in the main process (same pid). The setup and teardown timestamps are in the main process, so the interval includes worker start-up, not only test run time. `teardown()` receives no project argument in these runs, so the project name must be stored at setup time. The projects ran in parallel: the two 500 ms tests finished in 509 ms and 510 ms and the whole run took 1.28 s, and the two intervals (1222 ms and 1233 ms) overlap. A per-project wall-clock is therefore not additive, and the sum over projects exceeds the run time.
- **Failing teardown.** With `SPIKE_FAIL_TEARDOWN=1` the tests passed (`Tests 2 passed (2)`), both teardowns still printed, then `error during close Error: spike: deliberate teardown failure` was printed once per project and the process exit code was 1. So a throwing teardown fails the run (exit code only; the test summary still says passed).
- **`setupFiles` and the network guard.** In 5.1.0 an inline project inherits the root `test` options by default (`extends` defaults to `true`). Observed with `setupFiles: ["tests/setup/networkGuard.ts"]` at the root and none on the projects: both projects reported `fetch guarded: true`. With `extends: false` on `spike-a` and the same root setting: `spike-a` reported `fetch guarded: false`, `spike-b` (default) `true`. A project-level `setupFiles` also worked (first run: `spike-a` with project-level `setupFiles` guarded, `spike-b` with none was not guarded, `fetch.name` `fetch`). Not tested: whether root and project `setupFiles` arrays are merged or replaced when both are set, and `globalSetup` inheritance from the root.
- **CLI.** `npx vitest --run --project spike-a --config ...` ran only `spike-a` (`Test Files 1 passed (1)`, only its setup and teardown printed, exit 0). `--project nope` failed at startup with `No projects were found. ... The filter matched no projects: nope.` (exit 1). Without `--project`, `vitest --run --config ...` (what `npm test` runs) ran both projects.
- Observed limitation: some invocations of `npx vitest ... *>&1` in this shell returned empty output on the first call and worked on a repeat; commands were re-run unchanged.
- Disposition: findings drive task 3.2 (use `test.projects` with `defineProject`; set `name`, `include`, `globalSetup`; keep `setupFiles` for `tests/setup/networkGuard.ts` on the root or on each project, and do not set `extends: false` without repeating it; the budget setup must store the start time in `setup` and use a per-project module state). The scratch config and `scripts/spike/vitestScratch/` are deleted in 1.15.

### Extra risk: `tar` 7.5.23 API and licenses (task 1.11)
- Date 2026-11-14, Node v26.13.1, Windows 11, working directory `C:\dev\graveyard-shift`. POSIX: not tested, but see the platform note below.
- Commands: `npm install --no-save tar@7.5.23` (exit 0, output `found 0 vulnerabilities`); `node -p "require('./node_modules/tar/package.json').version"` printed `7.5.23`; `npm ls tar --all` printed `graveyard-shift@0.1.0 └── tar@7.5.23 extraneous`; `git status --short package.json package-lock.json` before and after the install printed nothing, so neither file changed. `node scripts/spike/tarApi.ts` (the same `MODULE_TYPELESS_PACKAGE_JSON` warning as in 1.2); `$env:TESTING_TAR_FAKE_PLATFORM='linux'; node scripts/spike/tarApi.ts` for the platform check; `npx tsc --noEmit -p .` printed nothing (the script typechecks, no `any`).
- File created: `scripts/spike/tarApi.ts`. It hand-builds ustar headers (typeflag, name, linkname, size, checksum), joins them, compresses with `zlib.gzipSync`, feeds the bytes to `new tar.Parser(options)` with `write()` and `end()`, and logs entries and events. Disposition: deleted in 1.15.
- npm printed a warning that 1 package (`esbuild@0.28.2`) has install scripts not covered by `allowScripts`. This was printed by the install and not examined further.

**API names observed in the installed types (`node_modules/tar/dist/commonjs/*.d.ts`)**
- `tar.Parser` is exported (`typeof tar.Parser` is `function`); `tar.Parse` is `undefined`. `Parser extends EventEmitter`, with `write(buffer: Uint8Array | string, cb?)`, `end(cb?)` and `abort(error: Error)`. It is not a `Writable` stream, so it has no `destroy()`. Constructor options include `strict`, `filter`, `onReadEntry`, `onwarn`, `maxMetaEntrySize`, `brotli`, `zstd`, `preservePaths`, `maxDepth` (`options.d.ts`); `parse.js` also reads `maxDecompressionRatio`, default 1000 (`parse.js` line 63). There is no option for compressed size, uncompressed size or entry count.
- Events seen: `entry` (a `ReadEntry`), `ignoredEntry`, `warn` (`code`, `message`, `data`), `error`, `abort`, `finish`, `end`, `close`. `ReadEntry` fields used: `type` (`EntryTypeName` string), `path`, `size`, `linkpath` (optional), `absolute` (optional).
- `EntryTypeName` values (`types.d.ts`): `File`, `OldFile`, `Link`, `SymbolicLink`, `CharacterDevice`, `BlockDevice`, `Directory`, `FIFO`, `ContiguousFile`, `GlobalExtendedHeader`, `ExtendedHeader`, `SolarisACL`, `GNUDumpDir`, `Inode`, `NextFileHasLongLinkpath`, `NextFileHasLongPath`, `ContinuationFile`, `OldGnuLongPath`, `SparseFile`, `TapeVolumeHeader`, `OldExtendedHeader`, `Unsupported`.
- An entry body must be consumed (`entry.resume()` in the script) for the parser to continue.

**Entry types and paths (hand-built archive, 15 entries; same output with default options, `preservePaths: true` and `strict: true`)**
| Archive entry (raw name, typeflag) | `type` | `path` as reported | other |
| --- | --- | --- | --- |
| `package/` dir (`5`) | `Directory` | `package/` | size 0 |
| `package/index.js` (`0`) | `File` | `package/index.js` | size 20 |
| `package/link-sym` (`2`, linkname `index.js`) | `SymbolicLink` | `package/link-sym` | `linkpath` `index.js` |
| `package/link-hard` (`1`, linkname `package/index.js`) | `Link` | `package/link-hard` | `linkpath` `package/index.js` |
| `package/dev-char` (`3`) | `CharacterDevice` | `package/dev-char` | |
| `package/fifo` (`6`) | `FIFO` | `package/fifo` | |
| `package/../evil-dotdot.txt` | `File` | `package/../evil-dotdot.txt` | unchanged |
| `../evil-leading-dotdot.txt` | `File` | `../evil-leading-dotdot.txt` | unchanged |
| `/abs/evil-absolute.txt` | `File` | `/abs/evil-absolute.txt` | unchanged, `absolute` undefined |
| `C:\evil\drive-backslash.txt` | `File` | `C:/evil/drive-backslash.txt` | backslashes became `/` |
| `C:/evil/drive-slash.txt` | `File` | `C:/evil/drive-slash.txt` | unchanged |
| `package\back\slash.txt` | `File` | `package/back/slash.txt` | backslashes became `/` |
| `package/sym-to-outside` (`2`, `../../outside`) | `SymbolicLink` | same | `linkpath` `../../outside` |
| `package/Dup.txt` and `package/dup.txt` | `File` | both reported as given | no warning for the case-only duplicate |

- The parser reports the raw `path` without removing `..`, a leading `/` or a drive prefix, and emitted no `warn` for these entries. `preservePaths` and `strict` made no difference to what the parser emitted: `parse.js` has no reference to `preservePaths`, and no `warn` or `error` was emitted in any of the three runs. `absolute` was `undefined` on every entry. So path sanitizing is not done by the parser in this version; the extractor must check the reported `path` itself.
- Backslash conversion depends on the platform: `normalize-windows-path.js` replaces `\` with `/` only when `process.env.TESTING_TAR_FAKE_PLATFORM || process.platform` is `win32` (called from `read-entry.js` for `path` and `linkpath`). With `TESTING_TAR_FAKE_PLATFORM=linux` the same archive gave `path="C:\\evil\\drive-backslash.txt"` and `path="package\\back\\slash.txt"` (backslashes kept). On this Windows machine, a check for a `\` in an entry name can never fire, because `\` is already `/` when the extractor sees it; the raw name is not exposed on `ReadEntry` in what I read (`path`, `size`, `type`, `linkpath`, `absolute`).
- Type names for a link or device entry come through as `type`, not as an error, so the extractor sees them and can abort.

**Licenses (read from `node_modules/<name>/package.json`, `license` field)**
| Package | Version | `license` | `dependencies` |
| --- | --- | --- | --- |
| `tar` | 7.5.23 | BlueOak-1.0.0 | `@isaacs/fs-minipass ^4.0.0`, `chownr ^3.0.0`, `minipass ^7.1.2`, `minizlib ^3.1.0`, `yallist ^5.0.0` |
| `@isaacs/fs-minipass` | 4.0.1 | ISC | `minipass ^7.0.4` |
| `chownr` | 3.0.0 | BlueOak-1.0.0 | none |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | none |
| `minizlib` | 3.1.0 | MIT | `minipass ^7.1.2` |
| `yallist` | 5.0.0 | BlueOak-1.0.0 | none |
- `tar`'s own `engines` is `node >=18`. `npm ls tar --all` shows only `tar@7.5.23` (extraneous, installed with `--no-save`), no other package in the project depends on `tar`; `npm ls tar --all` printed no nested tree under `tar`; I did not determine why. The dependency list above comes from `tar`'s own `package.json` and the installed packages in `node_modules`.
- Licenses present: BlueOak-1.0.0 (tar, chownr, minipass, yallist), ISC (`@isaacs/fs-minipass`), MIT (`minizlib`). No license outside these three. ISC and MIT are named in the product rules. BlueOak-1.0.0 is not in the product rule list (MIT, ISC, BSD, Apache-2.0); it is a permissive license (D1 calls it so), but whether it counts as MIT-compatible under the repository rule is a human decision and is flagged here, not decided. PREEXISTING.md must list all six packages with their licenses when `tar` is added (3.7).

**Early abort (compressed bytes counted by the caller, since the parser has no limit options)**
| Case | Observed |
| --- | --- |
| 2a. 50 entries (700 bytes each), one `write`, no abort | 50 `entry` events, then `finish`, `end`, `close` |
| 2b. `parser.abort(new Error('limit exceeded'))` in the 3rd `entry` handler, one `write` | 3 entries emitted, then `abort` event, then `error` event (`code=TAR_ABORT`), no exception, no `end` or `close`. 0 entries after the abort. |
| 2c/2d. 50 entries of about 5,960 bytes, 2,812 compressed bytes, 1,024-byte chunks; abort in the 3rd entry handler; the writer keeps calling `write` for all chunks | 3 entries, `abort`, `error` (`TAR_ABORT`), no exception; the further `write` calls did not emit more entries (reference run 2c emitted 50). |
| 2e. `throw new Error(...)` in the 3rd `entry` handler | the exception propagated out of `parser.write()` to the caller (`threw: Error: limit exceeded (thrown)`); 3 entries; I then called `parser.end()`, which led to `abort "zlib: unexpected end of file"` and an `error` event with `code=Z_BUF_ERROR`. |
| 2f. caller sets a flag in the handler, calls `abort` and stops writing | 3 entries seen, 0 emitted after the abort call, 1 of 3 chunks written (the chunk counts are for this 2,812-byte archive). |
- `abort()` emits `abort` and then an `error` event with `code` `TAR_ABORT` (`parse.js` lines 375 to 392). With an `error` listener installed there was no exception. Without an `error` listener (case 3e, zlib error) the error was thrown synchronously to the caller (`ZlibError: zlib: unexpected end of file`); I did not run `abort()` without an `error` listener, so what happens in that case is not observed.
- Highly compressible archive (30 MiB of zeros, 30,673 compressed bytes, 4,096-byte chunks): the `entry` event for `package/zeros.bin` carried `size=31457280` (the header size, available before the body is read), and then `abort "max decompression ratio exceeded: 1004.00 > 1000"` and `error` (`TAR_ABORT`). With `maxDecompressionRatio: 1e9` the same input produced 1 entry and `finish`, `end`, `close`.
- Header `size` is visible on the `entry` event, so an uncompressed-size limit can be checked in the `entry` handler before reading the body. The entry count can be counted in the same handler. The compressed limit can only be a count of the bytes passed to `write` by the caller.

**Corrupt or truncated input**
| Input | Observed |
| --- | --- |
| Truncated gzip (first 1,406 of 2,812 bytes) | 19 entries emitted first, then `abort "zlib: unexpected end of file"`, then `error` (`code=Z_BUF_ERROR`); no exception with an `error` listener; no `end`. |
| 10 bytes flipped in the middle (offsets 2000 to 2009) | 33 entries emitted, then `abort "zlib: incorrect data check"`, `error` (`code=Z_DATA_ERROR`). |
| Valid gzip header plus garbage | `abort "zlib: invalid block type"`, `error` (`Z_DATA_ERROR`), 0 entries. |
| Same truncated gzip, no `error` listener | `abort` event, then `ZlibError: zlib: unexpected end of file` thrown to the caller. |
| Text that is neither gzip nor tar | no entries, 4 `warn` events (`TAR_ENTRY_INVALID`, `checksum failure`), 1 `warn` (`TAR_BAD_ARCHIVE`, `Unrecognized archive format`), then `finish`, `end`, `close`. No `error`, no exception. |
| Empty input | 1 `warn` (`TAR_BAD_ARCHIVE`, `Unrecognized archive format`), then `finish`, `end`, `close`. |
- Entries before the corruption point were already emitted (19 and 33 in the two cases). So a corrupt gzip is reported as an `error` event after earlier entries; a non-archive input is only a `warn`, with zero entries.

**Differences from the design and consequences for task 9.5 (design.md not edited)**
- The design says "parses with `tar`'s parser": confirmed, the class is `tar.Parser` (`Parse` does not exist in 7.5.23). It is an `EventEmitter` with `write`/`end`/`abort`, not a stream.
- The design lists rejections for `:` and `\` in a segment and for an absolute path or `..`: the parser reports the raw path for absolute and `..` and drive-colon names, so those checks work on `path`. The `\` check cannot see raw backslashes on Windows (see above); a `:` check still catches `C:/...`.
- The design's `archive-too-large` has three limits. The parser has none of them; the extractor counts bytes written to `write`, counts `entry` events and sums `size`, and calls `abort` (or stops writing) when a limit is exceeded. An 'error' listener must be installed to avoid exceptions from `abort` and from corrupt gzip.
- A non-archive input ends with `warn` and no entries, so an extractor that only listens to `entry` and `error` will treat random bytes as an empty archive; a check for at least one entry or for `warn` events is needed (decision for 9.5, not made here).
- A case-only duplicate (`Dup.txt` and `dup.txt`) is not warned about by the parser; the design's case-folded duplicate check must be done in the extractor.

### Extra risk: `--allow-fs-read` syntax for `,` and `*` in paths (task 1.12)

- Date 2026-11-14, Node v26.13.1, Windows 11 (10.0.26300), working directory `C:\dev\graveyard-shift`. POSIX: not tested.
- Command: `node scripts/spike/fsReadSyntax.ts` (child: `scripts/spike/fsSyntaxChild/runner.ts`). The driver makes `os.tmpdir()/spike-fsread-*` (realpath.native), removes it in `finally` (afterwards `Test-Path $env:TEMP\spike-fsread-*` printed `False`), and for each case runs `spawnSync(process.execPath, ['--permission', '--allow-fs-read=<fsSyntaxChild dir>', '--allow-fs-read=<value>'..., runner.ts, <JSON list of probes>], { shell: false, env: {}, cwd: <fsSyntaxChild dir> })`. The child reads each probe (`statSync` + `readFileSync` for files, `readdirSync` for a path ending in a separator) and prints `ok` or the error code. Every case exited 0. `npm run typecheck`: exit 0. The only stderr text was the `MODULE_TYPELESS_PACKAGE_JSON` warning.
- Directories under the temp root: `pkg`, `pkg2`, `a,b`, `a`, `b`, `parent/child` (plus `parent/top.txt`), `single` (`one.txt`, `two.txt`), `wild` (`x.txt`, `sub/y.txt`), `wild2`. Each holds a small file; `<root>` is the temp root below. Observed results (probe -> result):

| Flag value(s) after `--allow-fs-read=` | Probes and results |
| --- | --- |
| `<root>\pkg` | `pkg\f.txt` ok; `pkg2\f.txt` ERR_ACCESS_DENIED |
| `<root>\pkg\` (trailing separator) | `pkg\f.txt` ok; `pkg2\f.txt` ERR_ACCESS_DENIED |
| `<root>\pkg2` | `pkg\f.txt` ERR_ACCESS_DENIED; `pkg2\f.txt` ok |
| two flags: `<root>\pkg`, `<root>\pkg2` | `pkg\f.txt` ok; `pkg2\f.txt` ok; `a\f.txt` ERR_ACCESS_DENIED |
| one flag `<root>\a,<root>\b` (comma-separated, no commas in the directory names) | `a\f.txt` ERR_ACCESS_DENIED; `b\f.txt` ERR_ACCESS_DENIED; `pkg\f.txt` ERR_ACCESS_DENIED (neither directory granted) |
| `<root>\a,b` (literal directory name with a comma, one flag) | `a,b\f.txt` ok; `a\f.txt` ERR_ACCESS_DENIED; `b\f.txt` ERR_ACCESS_DENIED |
| one flag `<root>\a,b,<root>\pkg` (comma syntax with a comma-named directory) | `a,b\f.txt`, `a\f.txt`, `b\f.txt`, `pkg\f.txt`: all ERR_ACCESS_DENIED |
| two flags: `<root>\a,b` and `<root>\pkg` (repeated flag syntax) | `a,b\f.txt` ok; `pkg\f.txt` ok; `a\f.txt` ERR_ACCESS_DENIED; `b\f.txt` ERR_ACCESS_DENIED |
| `<root>\parent\child` (parent not granted) | `parent\child\f.txt` ok; `parent\child\` listing ok; `parent\top.txt` ERR_ACCESS_DENIED; `parent\` listing ERR_ACCESS_DENIED |
| `<root>\single\one.txt` (a file) | `one.txt` ok; `two.txt` ERR_ACCESS_DENIED; `single\` listing ERR_ACCESS_DENIED |
| `<root>\wild\*` (glob) | `wild\x.txt` ok; `wild\sub\y.txt` ok; `wild2\z.txt` ERR_ACCESS_DENIED; `pkg\f.txt` ERR_ACCESS_DENIED |
| `<root>\wild*` (glob, prefix) | `wild\x.txt` ok; `wild\sub\y.txt` ok; `wild2\z.txt` ok; `pkg\f.txt` ERR_ACCESS_DENIED |
| `<root>\pk*` (glob, prefix) | `pkg\f.txt` ok; `pkg2\f.txt` ok; `a\f.txt` ERR_ACCESS_DENIED |

- A directory with `*` in its name: `mkdirSync('<root>\st*r')` failed with `code=EINVAL`, message `EINVAL: invalid argument, mkdir '<root>\st*r'`. A literal `*` directory is not testable on Windows (on POSIX not tested). Only the glob use of `*` in the flag value was tested (rows above).
- Observations: a grant of `pkg` (with or without a trailing separator) did not grant `pkg2`. The repeated-flag syntax granted both directories. In this Node version the comma-separated single flag granted neither directory, so a comma in the value was not treated as a documented multi-path separator in the cases tested; a directory named `a,b` was granted correctly by one flag value, and with the repeated-flag syntax next to another path. A `*` in the value acted as a wildcard: `wild\*` granted files below `wild` but not `wild2`; `wild*` and `pk*` also granted the sibling directories `wild2` and `pkg2`. A directory grant did not grant its parent; a file grant granted only that file (its sibling file and the directory listing were denied).
- Consequences for 17.1 (design.md not edited; decision for 1.14): the observed results support rejecting `*` (the wildcard widens the grant to siblings) and show that rejecting `,` is not needed when each path is its own `--allow-fs-read=` argv element. Not tested: `?`, `[`, `]`, `{`, `}`; a `*` inside the middle of a path; the comma-separated syntax on other Node versions or on POSIX.
- Disposition: `scripts/spike/fsReadSyntax.ts` and `scripts/spike/fsSyntaxChild/` are deleted in 1.15.

### Extra measurement: cost of one child process start (task 1.13)
- Date 2026-11-14, Node v26.13.1, Windows 11 (10.0.26300), working directory `C:\dev\graveyard-shift`. Measured on this machine, once, under normal load, antivirus state unknown. These numbers are not a benchmark. POSIX: not tested.
- Command: `node scripts/spike/startCost.ts` (exit 0; `npm run typecheck` exit 0). The script uses `process.hrtime.bigint()` from just before `child_process.spawn` to the first stdout line starting with `ready` (read as it arrives), then kills the child and waits for `close`. Spawn options: `shell: false`, `stdio: 'pipe'`, `env: {}`, `cwd: <scripts/spike/child>`. Blocks run one after another (not alternated), 10 starts each, in the order A, B, C, D.
- Observed output (ms, in start order):

| Block | argv (after `node`) | Individual times (ms) | min / median / max (from those values) |
| --- | --- | --- | --- |
| A | `--permission --allow-fs-read=C:\dev\graveyard-shift\scripts\spike\child C:\dev\graveyard-shift\scripts\spike\child\runner.ts` | 214.2, 375.7, 198.9, 453.6, 454.0, 466.9, 439.6, 374.5, 287.8, 314.6 | 198.9 / 375.1 / 466.9 |
| B | `C:\dev\graveyard-shift\scripts\spike\child\runner.ts` (no `--permission`) | 283.9, 226.3, 240.3, 170.0, 199.7, 266.1, 279.1, 258.9, 197.6, 188.7 | 170.0 / 233.3 / 283.9 |
| C | `-e ""` (no `--permission`; measured to process close, there is no ready line) | 161.4, 163.2, 165.8, 140.8, 188.4, 149.8, 158.3, 162.0, 158.9, 158.5 | 140.8 / 160.2 / 188.4 |

- Single starts under `--permission --allow-fs-read=<temp dir>` with a copy of the entry in a temp dir containing `package.json` `{"type":"module"}` (block D, one run each, not repeated): `r.ts` (with a type annotation) 252.7 ms; `r.js` 165.2 ms.
- Variation between runs is large: in block A the values range from 198.9 to 466.9 ms, and the order of blocks A and B (permission slower or faster) was not stable across runs. Two earlier runs of the same script during development, before I fixed a cleanup and a typing problem, gave block A medians of 249.2 and 440.7 ms and block B medians of 284.5 and 281.6 ms. Those runs are not tabulated above (the first printed blocks A to D and then failed at cleanup with `EPERM` on the temp directory, because a killed child still held it as cwd; the second printed all blocks, with the script not yet type-clean). From a single set of 10 values, no difference between block A and block B can be stated.
- Not tested: alternating blocks, a warm-up run, more than 10 runs, a runner that stays alive after `ready`, antivirus exclusions.
- Disposition: the numbers feed the time budget discussion in task 19; `scripts/spike/startCost.ts` is deleted in 1.15. design.md not edited.

### Design edits from the spike (task 1.14)

- Date 2026-11-14. Only `.kiro/specs/proof-of-life-engine/design.md` was edited. `requirements.md` and `tasks.md` were not edited. Every statement added to the design was checked against the entries above; nothing was measured in this task. Open observations stay open: whether the child's `PATH`, `TEMP` and `USERNAME` come from the parent or from Windows defaults is unsettled, and the design does not rely on either.

**Sections of design.md edited, and why**

| Design section | Change | Journal entry |
| --- | --- | --- |
| Key design decisions (last row) | Type stripping verified; rules: erasable syntax only, imports stay in `child/` with `.ts` extension, `tsconfig.json` must keep `allowImportingTsExtensions: true`; esbuild fallback not needed | Risk 1 (1.2) |
| Research summary (spike results, fast-check, tar bullets) | "Not verified yet" replaced by spike results; fast-check field names and the filter hang; `tar.Parser` and licenses; BlueOak decision pending | 1.2 to 1.11 |
| Module layout (`child/package.json`) | File kept although loading worked without it in one case | Risk 1 (1.2) |
| Sandbox_Executor: cost of a start | Measured values with the caveat (permission 198.9 to 466.9 ms, median 375.1; without flag 170.0 to 283.9, median 233.3; `node -e ""` 140.8 to 188.4); no difference can be stated | 1.13 |
| Sandbox_Executor: Command line | Repeated `--allow-fs-read=` flags only, never the comma form; reject `*`, `?`, `[`, `]`, `{`, `}`, allow `,`; `cwd` and grant in the same form (real path), both forms granted when they differ | 1.12, Risk 4 (1.5) |
| Sandbox_Executor: How files become readable | Observed CommonJS loading; `unloadable-module` detection in three parts (pre-check of `type: "module"`, any load-time exception mapped, ES syntax without `type` not detected) | Risk 2 (1.3) |
| Sandbox_Executor: Environment | Engine passes only `TZ=UTC`, no parent copy; OS-supplied names listed as not relied on; `env-minimum` and `env-scrubbed` test text: parent-only names absent, sentinel and a random-name variable, no empty-key-set assertion on Windows | Risk 3 (1.4) |
| Sandbox_Executor: Package directory addressing | Table extended (special characters, junction, 8.3 names, other drive "not tested"); forms of a root in text; `%20` vs `%2520` caution | Risk 4 (1.5), Risk 5a (1.6), Risk 5b (1.7) |
| Root_Normalizer: matcher construction | Percent-encoded form rules, native form unencoded, forms built by encoding, never by decoding the text | Risk 5a (1.6) |
| Harness_Config interface | Added `FunctionHarness.accept`; no unbounded `.filter` in `args` and `generator` | Risk 6a (1.8) |
| Fast-check driver | Observed `RunDetails` facts; `counterexample[0]`; `errorInstance`; three-way classification of a failed run; driver's own `generator-exhausted` text; `maxSkipsPerRun` set explicitly; `accept` through `fc.pre`; replay text with observed results; "Avoiding filter exhaustion" rewritten | Risk 6a (1.8), Risk 6b (1.9) |
| Tarball_Extractor | `tar.Parser` event API, own counters and `abort`, `error` listener required, own path and case-fold checks, backslash platform difference, `invalid-archive` added for corrupt or non-archive input | Extra risk tar (1.11) |
| Proof_Report (`HarnessErrorKind`), Error Handling table, Resolved ambiguities | Added `invalid-archive`; `unloadable-module` and `generator-exhausted` rows rewritten | 1.3, 1.8, 1.11 |
| Orchestrator step 5 | `type: "module"` decided from `package.json` before any child starts | Risk 2 (1.3) |
| Correctness Properties 3 and 5 | Property 3: backslash note and `invalid-archive`; Property 5: repeated flags, character rules, only `TZ=UTC` | 1.11, 1.12, Risk 3 (1.4) |
| Time budgets | `test.projects` with `defineProject`; teardown has no arguments; parallel projects must not be summed; network guard stays in the root `setupFiles`; budgets still set after the first full measurement; config file is `vitest.config.mts` | Extra risk vitest (1.10) |
| Compliance notes (PREEXISTING.md additions) | Licenses observed; decision pending the user | 1.11 |
| Risks to verify | Each item marked verified, differed, failed or not tested with a journal pointer; items 7 to 10 added for the extra checks | all |

Result per original risk: 1 verified; 2 verified for CommonJS and differed for `unloadable-module` detection; 3 differed; 4 differed; 5 spaces and special characters verified, other drive not tested; 6 field names differed (generator-exhausted detection was wrong), replay verified. No risk "failed" in the sense of needing the esbuild fallback.

**Conflicts with requirements.md (not edited): raise at the checkpoint**

1. R5.2 (flags): lists `--allow-fs-read=<runner file>`; the design grants the runner directory, because the child must be self-contained under one directory grant (an import outside the grant fails with `ERR_ACCESS_DENIED`). The design also now requires repeated `--allow-fs-read=` flags (never the comma form) and refuses `*`, `?`, `[`, `]`, `{`, `}`. Raise at the checkpoint.
2. R5.3 (environment): "only the variables that Node needs to start" and "not copy any variable of the parent by default". On Windows `env: {}` does not give an empty environment: the OS supplies 11 names, and no variable was needed to start. The design passes only `TZ=UTC`, which Node does not need to start, and no parent value. The wording "variables Node needs to start" does not describe what the engine does. Raise at the checkpoint.
3. R3.5 (`unloadable-module`): "fails to load as CommonJS". A `type: "module"` package with ES syntax, and an ES-syntax file in a package without `type`, load through `require` without an error, and the second case is not detected. The design decides `type: "module"` from `package.json` and maps load-time exceptions, but the second case remains a known gap. Raise at the checkpoint.
4. R8.8 (Replay_Parameters): no conflict. `seed` and `path` reproduced the shrunk counterexample for every `numRuns` tried, so R8.8 stays. Mentioned here only because the task listed it. Not raised.
5. R12.3 and the generator-exhaustion handling: the design's `generator-exhausted` error is now raised only from the `accept` skip budget. An unbounded arbitrary `.filter` hangs, and the engine cannot detect it. This is a rule for harness authors, not a requirement text change, but R8.5 is the cited requirement for that error row. Raise at the checkpoint.
6. R3.1, R3.2, R3.3 (extraction): the design adds the harness error kind `invalid-archive` for corrupt, truncated or non-archive input, which R12.3's list does not name (as with the other added kinds). Also, a backslash in an entry name is rejected on POSIX but accepted as a separator on Windows because `tar` converts it before the extractor sees it; R3.2 does not name backslashes. Raise at the checkpoint.
7. Dependency license rule (D1, R3.7, product rule): `tar`, `chownr`, `minipass`, `yallist` are BlueOak-1.0.0, which is not in the product rule's list (MIT, ISC, BSD, Apache-2.0). This is a human decision and is not made here. The design states that the decision is pending the user's approval. Raise at the checkpoint.
8. R5.2 and the cwd rule: no requirement conflict, but R4.6 notes (child `cwd` equal to the package directory) now depend on the grant and `cwd` being the same path form. Informational.

**Journal facts that did not map to a design section, or only partly**

- 1.1 scaffolding (`lib.ts` typing fix) and the `MODULE_TYPELESS_PACKAGE_JSON` warning on the spike drivers: spike tooling only, no design section. The `tsconfig.json` change is recorded under Key design decisions.
- 1.5: why a junction grant did not cover `createRequire` loading by the junction path while an 8.3 grant did was not examined; the design records only the observation. The untried fallback (granted `cwd` plus `process.chdir`) is noted there.
- 1.6: a denied read carried no path in its message; whether `resource` carries it was observed only in 1.2. The design records this and does not rely on it. The Path_Redactor and normalizer lists of runner-path text are unchanged (the runner path is outside the package root and is handled by the redactor).
- 1.8: `numRuns` of a failed run is the failing index, not the configured count; the driver counts from its own attempt log, so no change. `verbose` levels and `failures`/`executionSummary` sizes: no design use.
- 1.10: the 1.28 s run time, per-project intervals and the `extends` behavior are in the design; the warning that some `npx vitest` invocations returned empty output on the first call has no design section.
- 1.11: the `npm install` warning that `esbuild@0.28.2` has install scripts not covered by `allowScripts` was not examined and maps to no design section. `npm ls tar --all` showing no nested tree was not explained.
- 1.13: block D single starts (`r.ts` 252.7 ms, `r.js` 165.2 ms, one run each) are not in the design.

### Spike cleanup (task 1.15)

Date: 2026-11-14.

Kept in `scripts/spike/` (moved to `tests/proof/integration/` by task 18.11; not imported by `src/` or `tests/`, checked with a search):
- `child/` (`a.ts`, `b.ts`, `package.json`, `runner.ts`): basis of the `smoke` test.
- `envMinimum.ts` and `envChild/` (`package.json`, `runner.ts`): basis of `env-minimum`.
- `pathsSpaces.ts` and `spacesChild/` (`package.json`, `runner.ts`): basis of `paths-spaces`.
- `otherDrive.ts`: basis of the conditional `other-drive` test.
- `lib.ts`: kept because `envMinimum.ts`, `pathsSpaces.ts` and `otherDrive.ts` import `runNode` from it (its disposition said "deleted unless a later kept script needs it").
- `cjsChild/` (`package.json`, `runner.ts`): kept because `otherDrive.ts` uses `cjsChild/runner.ts` as its runner.

Deleted from `scripts/spike/`:
- `typeStripping.ts`, `cjsLoading.ts`, `cwdPackage.ts`, `cwdChild/`, `fcRunDetails.ts`, `fcReplay.ts`, `vitest.config.mts`, `vitestScratch/`, `tarApi.ts`, `fsReadSyntax.ts`, `fsSyntaxChild/`, `startCost.ts`.

Not touched: the journal entries above, `design.md`, the `tsconfig.json` change. `package.json` and `package-lock.json` are unchanged (`git diff --stat` empty). The `tar` package is still in `node_modules` as an extraneous install (`--no-save`); it was left alone.

### Spike results and design alignment (task 1.14 reopened)

- Date 2026-11-15, Node v26.13.1, npm 11.20.0, Windows 11 (10.0.26300), working directory `C:\dev\graveyard-shift`. Only `design.md` was edited among the spec files (and this journal). `requirements.md`, `tasks.md`, `package.json` and `package-lock.json` were not edited (`git hash-object package.json package-lock.json` printed `549426739b34890bc94a6465b4213cc075bc06af` and `64dbba9dc8cc2c20db8f0e9d2335d4a7484fdaf8` before and after the install check below). `.env` was not read.
- Throwaway scripts created for this entry: `scripts/spike/jxDriver.mjs` and `scripts/spike/jxChild/runner.mjs`. **Both were deleted after the run** (checked: `scripts/spike/` holds only the files kept in task 1.15). The first run of the driver failed before its `try` block (my `cmd.exe for %~sI` quoting returned `C:\"C:\...\"` as the short path), left `spike-jx-GSWucF` in the temp directory, and I deleted that directory by hand; I replaced the short-path lookup by `(New-Object -ComObject Scripting.FileSystemObject).GetFolder(<path>).ShortPath`. The second run removed its own temp directory (`cleanup exists: false`; `Test-Path $env:TEMP\spike-jx-*` printed `False`) and the junction.

**Item 1: junction grant versus 8.3 short-name grant (`createRequire`).**
- Command: `node scripts/spike/jxDriver.mjs`. It creates `<tmp>\spike-jx-rKenNn\a-long-package-directory-name` (real; `package.json` `{"main":"index.js"}`, `x.js`, `index.js` exporting `{file: __filename, x: require('./x.js')}`), a junction `link-to-package` made with `New-Item -ItemType Junction` (exit 0), and the short path `C:\Users\Owner\AppData\Local\Temp\SPIKE-~1\A-LONG~1`. The child runs `node --permission --allow-fs-read=<runner dir> [--allow-fs-read=<grant>...] runner.mjs <pkg>` with `shell: false`, `env: {}` and `cwd` equal to the package argument. The runner prints `cwd`, then each step with `ok` or `code`, `resource`, `permission`: relative read of `./x.js`, `statSync`, `realpathSync` (JS), `realpathSync.native`, `readFileSync` of `<pkg>\index.js`, `createRequire(<pkg>\package.json)(<pkg>)` and a require of a missing file.
- Parent-side `realpath` values: `fs.realpathSync.native(junction)` and `fs.realpathSync.native(short)` both returned the long real path. `fs.realpathSync(junction)` (JS) returned the long real path (the target). `fs.realpathSync(short)` (JS) returned the short path unchanged.

| Case (cwd = load path form) | Grants | Observed |
| --- | --- | --- |
| J1 junction | junction only | relative read, `statSync`, `realpathSync` (JS; returned the target path), `realpathSync.native` (returned the target path) and `readFileSync` ok; **`load` failed `ERR_ACCESS_DENIED` with `resource` `\\?\C:\Users\Owner\AppData\Local\Temp\spike-jx-rKenNn\a-long-package-directory-name\index.js`** (the junction target, not granted) |
| J2 junction | real only | relative read, `stat`, both `realpath`s and `read` failed `ERR_ACCESS_DENIED` with `resource` ending `\link-to-package\...` (junction form); `load` failed with `resource` `...\link-to-package\package.json` |
| J3 junction | junction + real | everything ok; `load` returned `file` = the real `index.js` path |
| S1 short | short only | everything ok; `realpathSync` (JS) returned the short path; `realpathSync.native` returned the long path; `load` returned `file` = `...\SPIKE-~1\A-LONG~1\index.js` |
| S2 short | real only | everything failed `ERR_ACCESS_DENIED` with `resource` in the short form |
| S3 short | short + real | everything ok |

- Explanation, supported by the `resource` fields and the `realpath` return values: the permission check reported the path in the form in which the access was made. A direct access used the junction or short form as given, so a grant on that form covered it. The CommonJS load of a package through a junction ended in a read of `index.js` below the junction target (the JS `realpathSync` returns the target for a junction), which was not covered by the junction-only grant. For a short path the JS `realpathSync` keeps the short form, so the load read under the granted short form. I did not read Node's loader source to confirm that it calls `fs.realpathSync`; this is the explanation for these cases only. A symbolic link was not tested (no privilege, see 1.5).

**Item 2: the `esbuild@0.28.2` install-scripts warning.**
- Commands: `npm ls esbuild`, `npm ls esbuild --all`, `npx esbuild --version`, `npm config get allow-scripts`, `npm config get allowScripts`, `npm install --no-save tar@7.5.23` (exit 0, `changed 6 packages, and audited 196 packages in 6s`, `found 0 vulnerabilities`), `npm install-scripts ls`, `npx tsx -e "console.log('tsx ok', process.version)"`, `node -e "...require('esbuild')...transformSync('let x:number=1',{loader:'ts'})..."`, and the npm documentation files `docs/content/using-npm/config.md` and `docs/content/commands/npm-install-scripts.md` under `C:\Program Files\nodejs\node_modules\npm`.
- Exact warning text (stderr of the install, line breaks as printed): `npm warn install-scripts 1 package has install scripts not yet covered by allowScripts:`, `npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)`, `npm warn install-scripts`, ``npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.``. `npm install-scripts ls` printed `1 package has install scripts not yet covered by allowScripts:` and `esbuild@0.28.2 (postinstall: node install.js)`.
- `allowScripts` is a setting of this npm version (11.20.0): the config doc lists `allow-scripts` (default empty, "can be set multiple times", for one-off and global contexts), points to the `allowScripts` field of `package.json` for project policy, and the `npm install-scripts` doc says dependency install scripts are blocked by default and that install commands skip them and list the skipped packages. `npm config get allow-scripts` printed an empty line; `npm config get allowScripts` printed `undefined`. `package.json` contains no `allowScripts` (`Select-String` found nothing).
- `npm ls esbuild` (and with `--all`): `tsx@4.23.15` -> `esbuild@0.28.2`, and `vitest@5.1.0` -> `vite@8.3.8` -> `esbuild@0.28.2 deduped`. So esbuild comes in as a dependency of `tsx` (and of vite).
- Effect: none observed. `npx esbuild --version` printed `0.28.2`, `transformSync` printed `0.28.2 let x = 1;`, `npx tsx -e` printed `tsx ok v26.13.1`. Whether the skipped `install.js` would change anything (for example an optimization) was not examined.

**Item 3: `npm ls tar --all` printed no nested tree.**
- `npm ls tar --all`, `npm ls tar --all --depth=Infinity` and `npm ls tar` each printed `graveyard-shift@0.1.0 C:\dev\graveyard-shift` and one line `tar@7.5.23 extraneous` (exit 0). `npm ls tar --all --json` printed one `dependencies.tar` entry (`version` 7.5.23, `resolved` https://registry.npmjs.org/tar/-/tar-7.5.23.tgz, `extraneous: true`) and `problems: ["extraneous: tar@7.5.23 C:\\dev\\graveyard-shift\\node_modules\\tar"]`. (One call of `npm ls tar` in my shell hung with no output and I repeated it; the repeat gave the output above.)
- `npm ls chownr minipass yallist minizlib @isaacs/fs-minipass --all` printed those five at the top level as `extraneous`, and under `tar@7.5.23 extraneous` it listed `@isaacs/fs-minipass@4.0.1 deduped`, `chownr@3.0.0 deduped`, `minipass@7.1.3 deduped`, `minizlib@3.1.0 deduped` and `yallist@5.0.0 deduped`. `node_modules/tar/node_modules` does not exist; `node_modules/{chownr,minipass,yallist,minizlib,@isaacs/fs-minipass}` all exist; `package-lock.json` has no entries for them (grep printed nothing). `tar`'s `dependencies` (from its `package.json`): `@isaacs/fs-minipass ^4.0.0`, `chownr ^3.0.0`, `minipass ^7.1.2`, `minizlib ^3.1.0`, `yallist ^5.0.0`.
- Explanation, only as far as observed: `tar` is extraneous (installed with `--no-save`), its dependencies are flattened to the top level (no nested `node_modules`), and `npm ls <name>` printed only the node that matches the name. A query that names the dependencies showed them under `tar` as deduped. That `npm ls` filters this way by design was not checked in npm's source.

**Item 4: always grant the `fs.realpathSync.native` path.**
- Same driver, cases R1, R2, R3: the engine input is the junction path, the 8.3 path and the real path; `fs.realpathSync.native(input)` returned `C:\Users\Owner\AppData\Local\Temp\spike-jx-rKenNn\a-long-package-directory-name` for all three. The child was started with `cwd`, the only `--allow-fs-read` (besides the runner directory) and the load path all set to that string. For all three inputs: exit 0, empty stderr, relative read ok (25 bytes), `statSync`, both `realpath`s and `readFileSync` ok, `createRequire` load ok (`file` = the real `index.js`, `x` = `from-x`), and the missing-file error text `Cannot find module './missing.js'` with the real path in `Require stack`. The three outputs were identical in everything except the label.
- The child never received the junction or short form, so a message containing the user-supplied form was not observed; the Root_Normalizer's matching of the created form (R13.19) stays untested by this spike.

**Sections of `design.md` edited (task 1.14 reopened)**

| Section | Change |
| --- | --- |
| Overview | Pure core never reads `process.env` (environment snapshot read once in the shell); `emit` listed in the shell |
| Key design decisions | Two rows added: identity redaction after the comparison, one `emit` function |
| Research summary | `tar` bullet: BlueOak-1.0.0 APPROVED (D1, D9), distinction between packages we publish and our own dependencies; spike bullet points to the new "Spike results" section |
| Architecture (diagram) | Identity_Redactor, Identity_Scanner backstop, `ProofDeps.env` snapshot and `emit` added |
| Module layout | `core/identity.ts`, `core/redact.ts` (Identity_Redactor, `redactionMaskedDifference`), `shell/emit.ts` |
| Request and library API | `ProofDeps.env` and `ProofDeps.sink`, `knownPaths` without the home directory; new paragraphs "Environment snapshot" and "One output function" |
| Sandbox_Executor | R5.16 to R5.18 wording in "Command line"; "Current directory and path form": rule to always grant the `fs.realpathSync.native` path, observed explanation of the junction/8.3 difference; "unloadable-module detection": R3.5, R3.9, R3.11, L12; "Environment": documented platform behavior (R5.19) and the link to Identity_Values |
| Root_Normalizer and Path_Redactor | Order of operations extended (compare, then identity); Path_Redactor passes: temp root and Node directory replaced even under an Identity_Value path, paths that begin with an Identity_Value path left unchanged; `PathContext.identity` |
| Identity redaction (new) | Identity_Values, matching rules (R13.27), order inside a run (R13.30), `redactionMaskedDifference`, backstop and `identity-leak`, key collision, counterexample and replay note, `emit` |
| Fast-check driver | `MAX_SKIPS_PER_RUN` in every `fc.check`, delta phase by construction plus assertion, R8.12 to R8.15 and L13 references, replay compares the raw counterexample |
| Tarball_Extractor | Boundaries of `unsafe-archive`, `archive-too-large` and `invalid-archive` (R3.10) |
| Proof_Report, serialization | `redactionMaskedDifference` in both Divergence variants, key order, sort by the redacted counterexample, schema requirement, `identity-leak` added to the kinds |
| Known limitations | L4 reworded; L6 extended; L12, L13, L14 added |
| Correctness Properties | Properties 5, 14, 15 extended; optional Property 29 (idempotence and comparison before redaction) added; nothing renumbered |
| Error Handling | Rows for identity redaction collision, `identity-leak`, `emit` |
| Testing Strategy | Identity tests (R13.29 a to h), source scans for `process.env` and output paths |
| Compliance notes, Risks to verify | BlueOak "pending" language replaced by APPROVED (D1, D9); item 4 and 8 updated |
| Spike results (new) | Per-item table and the four loose ends |
| Resolved ambiguities | R12.3 kind list updated, divergence list after an identity key collision |
| Open disagreements with the requirements (new) | Twelve items, listed in the final report of the task |

**Remaining disagreements between the design and requirements.md / tasks.md** (nothing edited there):
1. R12.3 lacks `harness-config-error`, `property-error`, `irreproducible-divergence`, `no-functions-tested`.
2. R5.1 and R11.7 name "run a delta property" as an Executor operation; the design runs it inside the call (`CallRequest.properties`).
3. R8.12 names Declared_Delta Cases among the `fc.pre` regions; the design uses a constructive generator plus the R8.14 assertion for the delta phase and `fc.pre` only for `accept`.
4. R7.5 (class and message) versus the design's comparison of own enumerable error properties (stricter).
5. R13.19 has no escaped back-slash form for roots; the design adds it.
6. R13.23 and R13.26 fallback omit `divergences` and `deltas`; the design also omits the cases of `nonDeterministicFunctions`.
7. R12.4 versus R13.25: after an identity key collision the design returns the fallback report (no `divergences`).
8. R13.12: the design replaces `os.tmpdir()` as part of the temporary root; the requirement names only the Proof_Engine's temporary root and the Node directory.
9. tasks.md 8.10 says the identity redaction property has no property number; the design adds it as optional Property 29.
10. tasks.md does not list the scans for `process.env` in the pure directories and for output outside `emit`.
11. `shell/emit.ts` and `ProofDeps.sink` are design choices; tasks.md names `emit` and `ProofDeps.env` only.
12. `ProofDeps.knownPaths` has no `homeDir` in the design (the home directory is an Identity_Value).

## Proof of Life: pure core and in-process engine checkpoint (task 12)

> **Status:** the full-suite figures below were measured by an agent run before the testing-workflow rule was adopted (2026-11-15). Per the rule and the honesty rules they are NOT accepted as journal timings. They are kept for reference only and will be superseded by the three runs the user pastes (two default seeds, one FC_SEED=12345). Do not cite them as results.

Date 2026-11-15, Node v26.13.1, Windows, working directory `C:\dev\graveyard-shift`, vitest 5.1.0. No agents were running and no network command was run. Every number below was read from the output of these runs. Per-file durations are the vitest JSON reporter's `endTime - startTime` per test file (includes import time); files run in parallel, so they do not sum to the wall-clock.

**User-run timings**

Measured by the user in their own PowerShell; copied from the user's message; vitest durations and per-run wall-clock were not provided, so those cells are empty (do not invent). The runs were made after the budget changes: `testTimeout` 60000 for the proof projects, `p25` split into `p25a` to `p25d`, `p24b` split out, smaller inner packages, and `p26b` at `numRuns` 100. Commands the user was asked to run (PowerShell):

```
Remove-Item Env:PROOF_BUDGET_MODE -ErrorAction SilentlyContinue; npm test
Remove-Item Env:PROOF_BUDGET_MODE -ErrorAction SilentlyContinue; npm test
$env:FC_SEED=12345; npm test; Remove-Item Env:FC_SEED
```

| run | seed | vitest duration | proof-property (seconds, as reported by the user) | files | tests | skipped | failures |
|---|---|---|---|---|---|---|---|
| 1 | default | | 45.3 s | 78 | 1042 passed | 3 | 0 |
| 2 | default | | 46.5 s | 78 | 1042 passed | 3 | 0 |
| 3 | `FC_SEED=12345` | | 41.9 s | 78 | 1042 passed | 3 | 0 |

All 78 files passed in each run. Slowest files reported by the user: `p24` 34.7 s to 38.4 s in the property, `p26b` 23.4 s to 34.7 s, `p26` 25.6 s to 28.9 s. All three runs are under the 60 s target, so option (d) (a separate `proof-heavy` project) was not needed and was not done.

**The 3 skipped tests** (determined by reading the code, no run; confirmed by the user's `--reporter=verbose` run, see the block below; item 2 corrected after the user's verbose run):
1. `tests/proof/unit/treeHash.test.ts`, the symlink test: `ctx.skip` when symlink creation fails (Windows without the privilege).
2. `tests/proof/unit/endToEndIdentity.test.ts`, the bare-name `<user>` test (`it.skipIf(!wordMatchable || homes.length === 0)`): skipped when the user name is short or generic. (Corrected after the user's verbose run: the earlier text named the `it.runIf(!wordMatchable)` placeholder as skipped for a long, non-generic name. That was the wrong way round.)
3. `tests/proof/unit/identitySafety.test.ts`, the `it.runIf(!runnable)` placeholder: skipped when `USERNAME` or a home variable is set.

**Full-suite run after tasks 15.1 to 17.3 (user-run)**

Measured by the user in their own PowerShell; copied from the user's message; not re-measured. The user ran `npm test`.
- 84 files passed; 1097 tests passed, 3 skipped (1100 total).
- Duration: 39.64 s. Budget line: `[budget] proof-property: 39.6 s (target 60 s)`.
- Slowest files reported by the user: `p24` 31.4 s in the property, `p26b` 29.7 s, `p26` 23.7 s.
- The new files `p23b`, `lodashAliveFixture`, `lodashBrokenFixture`, `lodashHarness`, `runner` and `sandboxCommand` all pass.

**The 3 skipped tests, confirmed by the user's `--reporter=verbose` run** (as told by the user; not re-measured):
1. `identitySafety.test.ts` > real machine identity (L14) > "is skipped because neither a home path variable nor USERNAME is set": the placeholder `it.runIf(!runnable)`; skipped because an identity variable IS set.
2. `treeHash.test.ts` > computeDirectoryTreeHash > "rejects a symbolic link with unsafe-archive": skipped because symlink creation is not permitted on that Windows account.
3. `endToEndIdentity.test.ts` > "diverging sides carry identity values (cases a and c)" > "shows <user> for the bare user name in the thrown message (name is long and not generic)": `it.skipIf(!wordMatchable || homes.length === 0)`; skipped because the user's name is short or generic (the L14 case). On that machine the test that runs instead is the placeholder `it.runIf(!wordMatchable)` in `tests/proof/unit/endToEndIdentity.test.ts` ("the bare-name check is not made: the user name is short, generic or unset, so a bare occurrence may remain (L14); path-context checks still run"); it runs when the user's name is short, generic or unset (checked by reading the code, line 237).

**Decisions**
- The p26 main property keeps `caseCount` 4 (not 3). Reason: with 3 generated cases the engine could not be shown to still catch every non-witness mutation (no measurement exists for `caseCount` 3). The user decided to keep 4.
- The delta variant `p26b` runs at `numRuns` 100.

**Static checks**
- `npm run typecheck`: exit 0, no output after the script banner.
- `npm run lint` (`eslint src tests`): exit 0, no errors, no warnings.
- `npm run build`: exit 0, routes `/` and `/_not-found` prerendered.
- `npx tsx scripts/recordTarball.ts --dry-run`: exit 0, printed "no network requests made, nothing written."

**First three `npm test` runs (before any change; not official) (agent-run, superseded)**
- Run A, run B and run C (C with `FC_SEED=12345`): each 73 files, 1 failed file, 1043 tests: 1039 passed, 1 failed, 3 skipped. The failure was `tests/proof/unit/syntheticPackage.test.ts` "extracts through the real extractor and verifies against its SRI" ("Test timed out in 5000ms"; 6709 ms and 7474 ms in two runs where the duration was shown, one 76-test file taking 22.4 s to 24.3 s). Budget lines: `proof-property: 60.9 s`, `69.0 s`, `62.3 s`.
- These three runs were made with `PROOF_BUDGET_MODE=warn` set in the shell environment of the tool session, which I did not set and only noticed afterwards (`echo` showed `warn`). They are reported for the failure only, not as official budget numbers.
- Each of these runs left two `gs-synth-test-*` directories in the temp directory (six directories after three runs: `gs-synth-test-CwuCqy`, `-gQChWz`, `-kH4Nam`, `-uANlAS`, `-VwgDcT`, `-ZuRp0q`). I removed those six after the runs.
- Two further runs were started concurrently by mistake (an orphaned vitest process kept running after a tool call ended) and are discarded: they showed a 5 s timeout in another `syntheticPackage` test (mutate), a 10 s hook timeout in `p24`, and 96.2 s. They are not used anywhere else.

**Change made in this task**: `tests/proof/unit/syntheticPackage.test.ts`, the "extracts through the real extractor" test now has an explicit 60 s timeout (it runs a 100-run fast-check property and the default 5 s timeout is shorter than its measured 6.7 s to 7.5 s under load).

**Official runs after the change (agent-run, superseded)** (`PROOF_BUDGET_MODE` unset inside the command, `npx vitest --run --reporter=default --reporter=json`)
| Run | Command env | Exit | Files | Tests | Duration (vitest) | Budget line |
|---|---|---|---|---|---|---|
| 1 | default seed | 0 | 73 passed | 1040 passed, 3 skipped (1043) | 55.46 s | `[budget] proof-property: 55.6 s wall-clock (target 60 s)` |
| 2 | default seed | not recorded; tests all passed and the budget check threw | 73 passed | 1040 passed, 3 skipped | 64.21 s | `[budget] proof-property: 64.2 s wall-clock (target 60 s)` |
| 3 | `FC_SEED=12345` | 1 (budget error only) | 73 passed | 1040 passed, 3 skipped | 62.83 s | `[budget] proof-property: 62.8 s wall-clock (target 60 s)`, then `error during close Error: [budget] proof-property took 62.8 s, over the 60 s target` |
| 4 | `PROOF_BUDGET_MODE=warn`, default seed | 0 | 73 passed | 1040 passed, 3 skipped | 56.14 s | `[budget] proof-property: 56.1 s wall-clock (target 60 s)` (no warning, under the target) |
- Per project from the JSON reporter (identical in runs 1 to 3): engine 32 files, 302 tests, 0 failed, 0 skipped; proof-property 41 files, 741 tests, 0 failed, 3 skipped. There is no `tests/proof/integration/` directory yet, so the proof-integration project has no files and printed no budget line.
- Skipped tests: "real machine identity (L14) is skipped because neither a home path variable nor USERNAME is set"; "computeDirectoryTreeHash rejects a symbolic link with unsafe-archive"; "diverging sides carry identity values (cases a and c) shows <user> for the bare user name ...".
- (agent-run, superseded) Per-project counts, skipped tests and the per-file durations below come from the same agent-run full-suite runs.
- Slowest proof-property files, run 1 / run 2 / run 3 (ms) (agent-run, superseded): `p25-alive-against-itself` (this file was later deleted and split into `p25a` to `p25d`) 49490 / 55476 / 55286; `p24-same-seed-same-bytes` 41276 / 48819 / 49223; `p26-injected-changes` 34068 / 41454 / 41915; `unit/syntheticPackage` 19082 / 23199 / 23244; `p04-tree-hash` 10588 / 14278 / 11797. Every other file took 2.5 s or less in all three runs.
- `[p26]` lines (agent-run, superseded): injected-change property 27182 / 34077 / 34175 ms; delta variant 6881 / 7370 / 7735 ms.

**Temp directory (`gs-*` in the OS temp dir)** (observed around the agent-run suite runs above; not timings)
- Before the first run: `gs-ZUFLfO` (not created by this task; left in place).
- After official runs 1, 3 and 4: only `gs-ZUFLfO`. The temp state after run 2 was not listed.

## Proof of Life: core modules built (tasks 3 to 11)

Written at the task 12 follow-up. Module lists and file counts come from a directory listing of `src/proof` and `tests/proof` on this date. No timings are recorded here; timings come only from the user's pasted runs.

**Modules present in `src/proof`**
- `types.ts`, `index.ts`.
- `core/`: `seeds`, `equal`, `normalize`, `redact`, `identity`, `delta`, `apiSurface`, `verdict`, `report`.
- `serialize/`: `canonicalReport`, `deserialize`.
- `shell/`: `driver`, `orchestrator`, `emit`, `entry`, `integrity`, `treeHash`, `workDir`, `tarball/tarballExtractor`, `executor/types`, `executor/inProcessExecutor`.
- `child/`: `protocol`, `prototypes`, `sideRuntime`, `stubs`, `package.json`, and `codec/` (`nodes`, `order`, `encode`, `decode`, `canonical`).

**Not present yet (by listing):** `child/runner.ts`, the Sandbox_Executor and `sandboxCommand`, `cli.ts`, `harnesses/`, `tests/proof/integration/`, `tests/proof/fixtures/`.

**Tests (count of files by directory listing, not test counts):** `tests/proof/unit` 32 files, `tests/proof/property` 14 files (`p04`, `p07`, `p08`, `p11`, `p20`, `p21`, `p24`, `p24b`, `p25a` to `p25d`, `p26`, `p26b`, named `p*-*.test.ts`), `tests/proof/helpers` 10 files. The former `p25-alive-against-itself.test.ts` no longer exists; its cases are in `p25a` to `p25d`.

**Decisions and deviations recorded in this follow-up**
- `@babel/parser` 8.1.2 (MIT, the version already installed) was added as an exact-version devDependency and listed in PREEXISTING.md. It is used by the `sourceScan` test.
- Delta classification, rule 3: the `unexplained` divergence is added only when no delta is applicable. With applicable deltas whose properties all fail on the Resurrection, only the `delta-violation` is reported. The code already did this; design.md and Property 20 now say so.
- Tarball_Extractor: the extractor gunzips with `node:zlib` and `maxOutputLength`, rejects a nested gzip or zstd layer, and creates the parser with `{ zstd: false, brotli: false }`. A truncated gzip gives `corrupt` before any entry is parsed. design.md now matches `tarballExtractor.ts`. The per-entry allowance in the code is `(maxEntries + 2) * 1536`.
- `child/runner.ts` (not yet written) is the second allowed user of process streams besides `shell/emit.ts`, as the `sourceScan` test already encodes. design.md states this.
- `PathContext` in design.md now matches `core/redact.ts` (`caseInsensitive`, `knownPaths`, `identityPaths`). `Difference` in design.md is `{part, path}`; the richer `NodeDifference` from `firstDifference` is not in the report.
- Ordering discrepancies 2 to 6 of `docs/proof-of-life-ordering.md`: the code was judged reasonable and design.md was changed to match it.
- (Superseded by the user's tie-break decision, see design.md R13.3 wording: ties after the documented keys are broken by `deltaId`, then `function`, then canonical JSON.) Open code gap (code not changed at that time): `canonicalReport` is not permutation-invariant for Divergences that tie on function, kind and rendered counterexample but differ in content, and for harness errors that tie on kind and message but differ in function. R13.3 breaks ties by original index, so the code follows the requirement text, but Property 23 and the "same data gives same bytes" goal would need extra tie-breakers. This is listed in `docs/proof-of-life-ordering.md` under "Discrepancies" for the orchestrator.

## Proof of Life: lodash.set@4.3.2 tarball recorded (task 14, user step)

All facts below are as told by the user; not re-measured by the agent.
- The user ran `npm run fixtures:record-tarball`. The output said "Integrity verified (8049 bytes)".
- Files: `tests\proof\fixtures\lodash.set\lodash.set-4.3.2.tgz` (8049 bytes) and `tests\proof\fixtures\lodash.set\lodash.set-4.3.2.meta.json` (1325 bytes).
- The user checked that the JSON has no identity values or tokens, and committed the files.

## Proof of Life: lodash.set fixtures (tasks 15.1, 15.2)

Written from reading the fixture files and READMEs; nothing was run.
- Alive fixture (`tests/proof/fixtures/lodash.set-alive/`): the guard was copied from the real lodash 4.17.20 `baseSet`. Source: https://raw.githubusercontent.com/lodash/lodash/4.17.20/lodash.js, fetched 2026-11-15 (recorded in the fixture's `index.js` comment and `README.md` by the task agent; both re-read to confirm the URL and date).
- The guard returns `object` at the offending segment, so assignments for earlier segments stay. For example `set({}, 'a.__proto__.x', 1)` gives `{ a: {} }`. This is not all-or-nothing.
- The only difference of the alive `index.js` from the original 4.3.2 is the guard block.
- Broken fixture (`tests/proof/fixtures/lodash.set-broken/`): changes ordinary behavior. Intermediate containers are always `{}`, so `set({}, 'a[0]', 1)` gives `{ a: { '0': 1 } }`, not `{ a: [1] }`. It also carries the same guard. It still contains the unused `isIndex` helper from the original.
- Not checked: whether `.gitattributes` affects the line endings of the `LICENSE` copies in the fixtures.
- Task 18.9 detail (as told by the user/agent report; not re-measured here): the default 100 cases at seed 20260101 found the divergence in the generated phase with the numeric explicit cases removed.

## Proof of Life: decisions after tasks 15.1 to 17.3 (user, 2026-11-15)

1. The alive fixture keeps the real lodash 4.17.20 `baseSet` behavior (return at the offending segment; earlier assignments stay). `docs/demo-packages.md` and the declared-delta wording are updated by another agent to describe exactly that.
2. The broken fixture keeps the unused `isIndex` helper; a one-line comment in `tests/proof/fixtures/lodash.set-broken/index.js` says why.
3. `.gitattributes` has `tests/**/fixtures/** -text` (added by the user; `git check-attr` shows `text: unset` for the tarball), so Git never changes fixture bytes. Task 15.3 checks fixture bytes against recorded hashes, so a line-ending change fails loudly.
4. CI plan (written first, since run on GitHub Actions: see "Proof of Life: CI run 1"; `.github/workflows/ci.yml`, task 20.2): each of the 3 skipped tests runs in at least one CI job. Update: the three tests that are skipped on the user's machine now run in CI (symlink and bare-name `<user>` tests in `test-linux`, L14 placeholder in `test-no-identity`), and all three jobs were green in CI run 2 (commit ec10875), as reported by the user. Green means the jobs passed; the job logs were not inspected by the agent and the test names in the logs were not checked.
   - Symlink test (`treeHash.test.ts`, 'rejects a symbolic link with unsafe-archive'): job `test-linux` (ubuntu-latest; full suite after `npm run typecheck` and `npm run lint`).
   - L14 placeholder test (`identitySafety.test.ts`, 'is skipped because neither a home path variable nor USERNAME is set'): job `test-no-identity` (ubuntu-latest). `npm ci` runs with the normal environment (npm needs HOME for its cache). Only the vitest step runs under `env -u USERNAME -u USERPROFILE -u HOME -u HOMEPATH`, and it calls `node_modules/.bin/vitest run tests/proof/unit/identitySafety.test.ts` instead of `npx`, because npx is npm and expects HOME. Read from the test file: with the four variables unset, `identityValuesFromEnv` returns no path values and no name, so `runnable` is false, the real-machine test skips and the `it.runIf(!runnable)` placeholder runs.
   - Bare-name `<user>` test (`endToEndIdentity.test.ts`, 'shows <user> for the bare user name in the thrown message (name is long and not generic)'): job `test-linux`, with job `env` `USERNAME: graveyard_ci_runner`. Read from the code: `defaultProofDeps()` copies `process.env`; `identity.ts` reads `USERPROFILE`, `HOMEPATH`, `HOME` and `USERNAME` on every platform (exact names on posix); the runner's `HOME` gives `homes.length > 0`; `graveyard_ci_runner` has 18 characters and is not in `GENERIC_USER_NAMES`, so `wordMatchable` is true and the skip condition `!wordMatchable || homes.length === 0` is false. That HOME is set on GitHub Linux runners is an assumption about the runner, not checked here.
   - Addition not in the task text: job `test-windows` (windows-latest, `npm ci`, `npm test`), because the project's primary environment is Windows and the sandbox and path tests are Windows-sensitive. It is not needed for any of the three tests.
   - Actions pinned to a major version tag: `actions/checkout@v7` (latest release v7.0.1, published 2026-07-20, https://github.com/actions/checkout/releases/tag/v7.0.1) and `actions/setup-node@v7` (latest release v7.1.0, published 2026-10-08, https://github.com/actions/setup-node/releases/tag/v7.1.0). Source: the GitHub releases API (`/releases/latest` of each repository), fetched 2026-11-15. Whether the floating `v7` tags exist was not checked separately. `node-version: 26`.
   - `PROOF_BUDGET_MODE: warn` is set for all jobs: the 60 s and 120 s targets were set for the user's machine, and a slower hosted runner should print the budget lines without failing the build. This is a decision, not a measurement.
   - `timeout-minutes` (30, 15, 45), `concurrency` (cancel superseded runs per ref) and `permissions: contents: read` are set. The timeout values are generous limits, not measurements.
   - The workflow uses no secrets and no `.env`, runs no recorder and prints no environment variables.

## Proof of Life: time budgets, first measurement (task 19.1, user-run)

Measured by the user in their own PowerShell; copied from the user's message; not re-measured.
- Command: `$env:PROOF_LOG_TIMINGS='1'; $env:PROOF_BUDGET_MODE='warn'; npm test; Remove-Item Env:PROOF_LOG_TIMINGS, Env:PROOF_BUDGET_MODE`.
- Environment: Node v26.13.1, Microsoft Windows 11 Pro 10.0.26300, vitest 5.1.0 (from "Environment (task 1.1)" above, observed 2026-11-14; not re-observed for this run).
- 97 files passed; 1180 tests passed, 3 skipped (1183 total); duration 49.61 s. All integration files pass.
- Budget lines: `[budget] proof-integration: 49.6 s (target 120 s)` and `[budget] proof-property: 49.6 s (target 60 s)`.
- Child environment printed by the integration test (names only): HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, TZ, USERDOMAIN, USERNAME, USERPROFILE, WINDIR. These are the 11 launcher names plus TZ.
- Both budget lines show the same 49.6 s because each project's `globalSetup` measures the whole run's wall-clock, and the projects run in parallel. They are whole-run wall-clock upper bounds and do not show the cost of each project. The reporter text now says so (`whole-run wall-clock, upper bound for this project`) and, from `vitest.config.mts`, it also prints a second line per proof project with the sum of the file durations (`TestModule.diagnostic().duration`, the accumulated duration of the tests and hooks in each file; files run in parallel, so the sum can exceed the wall-clock). The per-project sum comes with the next user run. Targets are unchanged (60 s proof-property, 120 s proof-integration), and the pass/fail check still uses the whole-run wall-clock.

Timing lines appended automatically by `PROOF_LOG_TIMINGS=1` during this run (moved here from the end of the "lodash.set harness key (default)" section; text unchanged):

- Timing 2026-11-15T13:10:13.925Z: project proof-integration, 49.6 s wall-clock, target 120 s (includes worker start-up; projects run in parallel, do not sum).

- Timing 2026-11-15T13:10:13.931Z: project proof-property, 49.6 s wall-clock, target 60 s (includes worker start-up; projects run in parallel, do not sum).

## Proof of Life: lodash.set harness key (default)

Finding: `lodashSetHarness` keyed the function and the declared delta as `set`, but lodash.set@4.3.2 has `module.exports = set`, which the engine lists as the export `default` (design, "Exports"). Against the real tarball this produced `missing-generator: default` and a `harness-config-error` for the delta, so the verdict was `inconclusive`. Three integration tests (alive, broken, identity) found it; the last two had worked around it with local harness copies. Decision: the design wins, so the harness now uses `default` for both. The broken and identity tests use the shipped harness key, and the alive test expects `functionsTested` to equal `["default"]`.

## Proof of Life: optional integration tests: built and skipped (task 18.11 partial, user decision)

Built (each file run once on its own; both passed; typecheck and lint clean):
- `env-minimum`: `tests/proof/integration/envMinimum.integration.test.ts`. It asserts that `buildSandboxEnv()` has exactly one key, `TZ=UTC`, and that the real Sandbox_Executor started with that environment starts, loads a package, lists exports and answers (child `TZ` is `UTC`, offset 0). It also runs the spike's candidate sets `{}`, `{TZ}`, `{SystemRoot}`, `{SystemRoot, TZ}` under `--permission` with a small CommonJS runner: each starts, exits 0 with empty stderr, loads the package and echoes `ping`; the two `TZ` sets give offset 0. The two `SystemRoot` sets are skipped on non-Windows platforms (the variable is a Windows one). The test does not assert which set is the smallest that starts: the spike observed `{}` starts too, because Windows supplies defaults. `TZ=UTC` is the only entry with an observed effect, and `{TZ}` and `{SystemRoot, TZ}` observe the same, so the production set is the minimal one the engine passes. That the parent's variables do not reach the child stays in `envScrubbed.integration.test.ts` (18.5).
- `paths-spaces`: `tests/proof/integration/pathsSpaces.integration.test.ts`. For the directory names `gs space`, `gs-ünï-é`, `gs#hash`, `gs%pct` and `gs%20pct` (each in its own temp parent), the real Sandbox_Executor starts, loads, lists exports and calls a function. The child's `process.cwd()` equals the package `realpathSync.native` path (case-insensitive on Windows). A thrown `__dirname` message carries the native path unencoded; a thrown `pathToFileURL(__dirname).href` message is percent-encoded (`%20`, `%23`, `%25`, `%2520`, UTF-8 bytes in uppercase hex); `normalizeOutcome` turns both into `at <package>`. One full `runProofOfLife` run uses a temp root named `gs space` with a Resurrection that throws both path forms: the report has `<package>` and none of the temp root, its base, `gs space`, `gs%20space` in native, forward-slash, JSON-escaped or URL form. Not covered: names with `?`, a trailing space or dot, very long paths (as in the spike).
- Spike files moved into these tests and deleted: `scripts/spike/envMinimum.ts`, `scripts/spike/envChild/`, `scripts/spike/pathsSpaces.ts`, `scripts/spike/spacesChild/`. Kept: `scripts/spike/lib.ts` and `scripts/spike/cjsChild/` (still used by `otherDrive.ts`), `scripts/spike/otherDrive.ts`, `scripts/spike/child/`.

Not built (skipped by user decision):
- `smoke` (type stripping under `--permission`): every sandbox integration test already runs the `.ts` runner (`src/proof/child/runner.ts`) under `--permission`, so a dedicated smoke test adds nothing. `scripts/spike/child/` stays in place as its basis.
- `other-drive`: only drive `C:` exists on this machine (spike 1.7), so the case stays not verified on the user's own machine; the spike entry says so. Update: verified in CI run 2 on the GitHub Windows runner (checkout on D:, temp on C:; the sandbox tests passed in CI runs 1 and 2). `scripts/spike/otherDrive.ts` (with `lib.ts` and `cjsChild/`) remains as its basis.
- 18.10 lodash self-run (the Original against itself with the real sandbox): partially covered. `lodashAlive.integration.test.ts` runs the Original against the hand-written alive fixture through the real engine and sandbox and checks that `Object.prototype` has the same keys before and after (so the user's own prototype check is covered). The properties `p25a` to `p25d` use `aliveAgainstItself.ts` with synthetic packages and the InProcess_Executor, not lodash.set. Missing: lodash.set@4.3.2 compared with itself.
- 18.12 crash and output-too-large: covered by `tests/proof/unit/sandboxExecutor.test.ts`, which uses real children for a crash (exit code 7, `crash` outcome, next call served after restart) and for `output-too-large` (child survives, no restart counted).
- 18.13 restart events and budget: restart events are covered by `tests/proof/integration/protoIsolation.integration.test.ts` (frozen prototype gives `restoreVerified: false`, counters `restartEvents: 1` then 2, shared budget `used()` 1 then 2) and by `sandboxExecutor.test.ts` (`restart()` counted separately from other restarts). The budget limit is covered by `sandboxExecutor.test.ts` (`too-many-crashes` with a budget of 1). Partially covered: I did not find a test that exhausts a budget shared by both sides with a larger maximum.
- These coverage claims come from reading the test files and grepping them; I did not run the other test files for this entry.

## Proof of Life: final checkpoint (task 21): typecheck/lint/build and audit

- `npm run typecheck`: exit 0, no output beyond the command banner. The earlier `phases` error in lodashBroken is gone.
- `npm run lint`: exit 0, no warnings.
- `npm run build` (Next.js 16.4.6): exit 0, no warnings; routes `/` and `/_not-found` prerendered.
- design.md: replaced the "Deviation from the requirements text" paragraph (CLI section) with one sentence saying requirement 1.4 and task 17.5 now match the implemented options. Searches for `--config`, the `set` function key, "ignores the whole assignment", the old index tie-break and `restart-budget-exhausted` found no other stale statements.
- Audit (read-only): all required property, integration and unit test files exist (p04, p07, p08, p11, p20, p21, p23b, p24, p24b, p25a to p25d, p26, p26b; the eleven integration tests; the seven unit tests). All files in `tests/proof/property` use `fcParams()` (numRuns 100; p24 and p24b use max(100, fcParams)). Exceptions to numRuns >= 100 outside the property directory: `tests/proof/unit/sandboxCommand.test.ts` (numRuns 50) and `lodashHarness.test.ts` (`fc.sample`, not a property run).
- Grep checks: no `process.env` in `src/proof/core`, `serialize` or `child/codec`; no import leaving `src/proof/child/`; no console or process.stdout/stderr use outside `shell/emit.ts`, `child/runner.ts` and `cli.ts` (only a comment in `core/report.ts` and a probe string in `shell/executor/sandboxExecutor.ts`, which runs in a child). `.env` is read by `tests/engine/unit/fixtureSecrets.test.ts` (the engine suite, to find the token for a secrets check); no proof test references it.
- Optional property tests with no file (unchecked in tasks.md): P1, P2, P3, P5, P6, P9, P10, P12 to P19, P22, P27 to P29; also optional tasks 17.2, 18.10, 18.12, 18.13 and the other-drive test (the other-drive case is not verified on the user's own machine, journal Risk 5b; update: verified in CI run 2 on the GitHub Windows runner, checkout on D:, temp on C:).
- Open limitations: L12 (ES module syntax without `"type": "module"` is not detected), L13 (an unbounded `.filter` is not detected), L14 (a redacted counterexample cannot be pasted back as an explicit Case). The sandbox is a seat belt, not a security boundary. `.github/workflows/ci.yml` had not been run on GitHub when this entry was written (it has since: see "Proof of Life: CI run 1").
- full-suite numbers: pending the user's run

## Proof of Life: CI run 1 (user-run, GitHub Actions)
- Results as reported by the user. test-windows: FAILED, 1 test failing (1193 passed, 3 skipped). test-linux: green (54 s). test-no-identity: green (20 s). test-windows: red (1m 18s; 1 test, sideRuntime). (Times as reported by the user.)
- CI run 2 (commit ec10875): all three jobs green, 1m 7s (as reported by the user).
- Runner checkout: `D:/a/graveyard-shift/graveyard-shift`. All `proof-integration` sandbox tests passed on the same runner (user-reported).
- Failing test: `tests/proof/unit/sideRuntime.test.ts` > "restoration that cannot be verified (spawned child under --permission)" > "reports restoreVerified false when the package freezes Array.prototype" (line about 303). Expected `{ loaded: true, kind: 'returned', restoreVerified: false }`, received `{ loaded: false, kind: 'crash', restoreVerified: true }`. stderr was empty (that assertion passed).
- User's hypothesis: the runner's `os.tmpdir()` is on `C:` with an 8.3 short name (`C:\Users\RUNNER~1\...`) while the checkout is on `D:`. tmpdir on `C:` with an 8.3 name is the user's hypothesis, not observed in the logs.
- Cause per reading the code: the test granted `fs.realpathSync.native` (long) paths for the child directory and the package directory, but passed the non-real `join(tmpdir(), ...)` path as `packageDir`, ran the script through its non-real path, and built its own argv and environment (`{PATH, NODE_ENV}`) instead of using `buildSandboxArgv` / `buildSandboxEnv`. The production Sandbox_Executor resolves the package directory once with `realpathSync.native` and uses that string for `cwd`, grant and load path. This is consistent with spike 1.5 (a grant on the real path alone does not cover reads through the short form: `ERR_ACCESS_DENIED`). The load failure (`loaded: false`) fits that, but the load error text was not in the CI output. Cause CONFIRMED by CI run 2 (commit ec10875): the fix (realpath-only grants and the production argv builder) turned test-windows green. The 8.3 / short tmpdir name hypothesis is confirmed by the fix turning the job green, not by a logged path.
- Fix: (1) `sideRuntime.test.ts` now resolves package dir, script and child dir with `realpathSync.native` first, uses only those strings, builds argv with `buildSandboxArgv` and env with `buildSandboxEnv()`, spawns with the builder's `cwd` and `shell: false`, and prints `loadError` and `crashReason` in the assertion message. (2) `buildSandboxArgv` takes an optional injected `realpath` (default identity) applied to runner directory, package directory and every extra grant before validation; `cwd` equals the resolved package directory; a throwing `realpath` leaves the path unchanged. `sandboxExecutor.ts` passes `fs.realpathSync.native` in both calls. (3) New tests in `sandboxCommand.test.ts`: injected fake realpath; throwing realpath; a real 8.3 test (Windows only, skipped when no short name can be obtained).
- Consequence to note: because the builder now resolves every extra grant, the created (non-real) form of the package directory no longer produces a second grant when it is an 8.3 form or link of the real path (it resolves to the same string). Requirement 5.17 and tasks.md 17.1 still say "grant both forms"; the user decides whether to amend them (not edited).
- Local single-file runs after the change (my own, one per file): `sideRuntime.test.ts` 19 passed; `sandboxCommand.test.ts` 20 passed, 0 skipped (the real 8.3 test ran: this machine generates short names for Temp). `typecheck` and `lint` exit 0. Not run: `runner.test.ts`, `sandboxExecutor.test.ts`, the integration tests and the full suite.
- Other-drive open item (Risk 5b): the GitHub Windows runner has the checkout on `D:` and the temp directory on `C:` (per the user), so a package under tmp (`C:`) with the runner/child directory on `D:` has now run in CI: all `proof-integration` sandbox tests passed on that runner (user-reported). This covers the other-drive case in CI. VERIFIED in CI run 2 (sandbox tests passed in runs 1 and 2). On the user's own machine it is not verified (only drive `C:`); that is a fact, not an open item.
## Proof of Life: full-suite run after the sideRuntime/8.3 fix (user-run)

Measured by the user in their own PowerShell; copied from the user's message; not re-measured by the agent. Filed under task 17.1.
- Full suite after the fix (commit ec10875, pushed): 99 files passed; 1200 tests passed, 3 skipped (1203); duration 53.61 s.
- Budget lines: `[budget] proof-property: 224.3 s sum of file durations`; `[budget] proof-integration: 37.2 s sum of file durations`; `[budget] proof-integration: 53.6 s whole-run wall-clock, upper bound (target 120 s)`; `[budget] proof-property: 53.6 s whole-run wall-clock, upper bound (target 60 s)`.
- The per-project sums (224.3 s and 37.2 s) add up the durations of files that run in parallel, so they exceed the whole-run wall-clock (53.6 s). They are not wall-clock times.
- `sideRuntime` (19 tests), `sandboxCommand` (20), `sandboxExecutor` (5) and all 13 integration files pass with realpath-only grants (user-reported).
- CI: run 1 test-linux green (54 s), test-no-identity green (20 s), test-windows red (1m 18s; 1 test, sideRuntime). Run 2 (ec10875): all three jobs green, 1m 7s. Details in "Proof of Life: CI run 1".

## Proof of Life: traceability and hygiene follow-ups (task 21)
- Requirement trace (light): every `tests/proof/**/*.test.ts` file (67) now has a `// Requirements: N.M, ...` header line. The numbers come from the matching task's `_Requirements:_` lines, the existing `Validates:` lines (kept) and my reading of each file; I listed only what the tests appear to exercise. `scripts/trace.ts` (`npm run trace`) reads those headers and the criteria of `.kiro/specs/proof-of-life-engine/requirements.md` and writes `docs/traceability.md`. A citation shows which tests claim to cover a criterion; it does not prove coverage.
- Counts from one run of `npm run trace`: 165 acceptance criteria, 132 cited by at least one test file, 33 with no citing test file, 0 cited numbers that do not exist in requirements.md. The 33 gaps are listed in `docs/traceability.md` (section Gaps); they are not padded or hidden.
- `tests/engine/unit/fixtureSecrets.test.ts`: confirmed that failure messages are fixed text (file name and keyword label only) and that neither the token value nor its length is printed. It was the only file that loads `.env` (`process.loadEnvFile`); `fixtureIntegrity`, `endToEndIdentity` and `identitySafety` do not, and no other file under `tests`, `src` or `scripts` calls `loadEnvFile`. Changed: the loader is now an exported helper `loadOptionalEnvToken(loadEnvFile, env)`. A missing `.env` (code `ENOENT`) returns the environment as is, and any other loader error is rethrown with a fixed message that carries no content (the old code swallowed every error). Three unit tests cover ENOENT, another error (fixed message, no token) and a token already set. `.env` was not read, renamed or moved.
- README: the `Known gaps` subsection became one `## Known limitations` section (L12, L13, L14, L1, sandbox seat belt, other drive, CI first run recorded in this journal, D10/D11).
- No suite timings in this entry.

## Proof of Life: traceability gap classification and engine headers
- `scripts/trace.ts` now writes one section per spec to `docs/traceability.md`: `autopsy-engine` (`tests/engine/**/*.test.ts`) and `proof-of-life-engine` (`tests/proof/**/*.test.ts`). Gap classes for the proof spec live in `docs/traceability-gaps.json` (class and evidence per criterion); the script reports unclassified gaps, classified criteria that do not exist and stale entries, and exits 1 on any of them. Autopsy gaps are listed as "unclassified (not requested)".
- I read the text of each of the 33 earlier proof gaps and searched `tests`, `src`, `docs`, `README.md` and `PREEXISTING.md`. Ten were covered by an existing test whose header lacked the number (1.3, 4.5, 8.1, 8.2, 9.2, 9.5, 11.1, 13.7, 13.9, 14.9); I added them to the `// Requirements:` header of `lodashAlive.integration`, `orchestrator`, `sideRuntime`, `driver`, `p25d-flaky-negative-control`, `lodashHarness`, `p23b-canonical-permutation` (header lines only, no test code). 14.9 is exercised by the Original-versus-alive-fixture run, not an Original-against-itself run.
- Engine headers: a `// Requirements:` line before the first import in 32 files under `tests/engine` (31 test files plus `helpers/fc.test.ts`). Numbers come from tasks.md, existing `Validates:` lines and the test titles and assertions I read. Not every assertion was re-read, so these are claims, not proof of coverage.
- One run of `npm run trace` after the edits: autopsy-engine 107 criteria, 103 cited, 4 gaps (4.13, 5.9, 8.6, 12.7); proof-of-life-engine 165 criteria, 142 cited, 23 gaps, 0 cited numbers that do not exist.
- Proof gaps by class: needs a test 13 (1.6, 2.4, 3.8, 7.10, 8.9, 8.10, 12.5, 13.5, 13.15, 13.17, 15.8, 16.1, 16.5); documentation only 8 (3.7, 3.11, 6.8, 8.15, 13.8, 14.11, 15.7, 16.6); covered, header missing 2 (15.5, 15.9: the covering tests are `tests/engine/helpers/fc.test.ts` and `tests/engine/unit/networkGuard.test.ts`, which cite the autopsy-engine numbering, so no proof header was added).
- `src/proof/shell/executor/sandboxExecutor.ts`: the header comment now says the created form is also passed in the extra read paths but collapses into the real path, because `buildSandboxArgv` resolves every entry through `fs.realpathSync.native` (comment only; the code is unchanged).
- No suite timings in this entry. No test or suite was run by me; `npm run typecheck`, `npm run lint` and `npm run trace` were.

## Proof of Life: full-suite run before closing the spec (user-run)
Measured by the user in their own PowerShell; copied from the user's message; not re-measured by the agent.
- 99 files passed; 1200 tests passed, 3 skipped (1203); duration 53.67 s.
- Budget lines: `[budget] proof-property: 227.8 s sum of file durations`; `[budget] proof-integration: 38.0 s sum of file durations`; `[budget] proof-integration: 53.7 s whole-run wall-clock, upper bound (target 120 s)`; `[budget] proof-property: 53.7 s whole-run wall-clock, upper bound (target 60 s)`.
- `npm run trace` (exit 0, user-run): autopsy-engine: criteria 107, cited 103, gaps 4, unknown citations 0; proof-of-life-engine: criteria 165, cited 142, gaps 23, unknown citations 0, classes: needs a test 13; documentation only 8; covered, header missing 2.
- The user committed and pushed.

## CI run 3 (user-reported)
- CI result for this push: not provided (placeholder in the message).

## Proof of Life: closing decisions (user, this round)
- Cross-spec citations are allowed: a test that covers a criterion counts whichever spec it was written for. Header syntax: `// Requirements: 1.2, 4.3; proof-of-life-engine 15.5, 15.9` (bare list = the test's own spec; groups separated by semicolons). `scripts/trace.ts` parses it, credits the named spec's table, and lists an unknown spec name or number under "Cited numbers that do not exist".
- Tests were written only for 1.6 and 16.1 (no network imports or globals under src/proof), 3.8 (only the Tarball_Extractor imports tar) and 15.8 (budget overrun branch: strict fails, warn warns).
- `sandboxExecutor.ts` no longer pushes the created form into extraReadPaths; the builder's realpath step stays.
- The unclassified-gap and stale-entry checks of `npm run trace` now apply to both specs (exit 1 and listed); the "unclassified (not requested)" wording for autopsy-engine is gone.
- Cited from engine tests: `tests/engine/helpers/fc.test.ts` cites proof 15.5 (asserts numRuns >= 100 of the shared `fcParams()` that the proof property tests use) and 15.9 (FC_SEED replay); `tests/engine/unit/networkGuard.test.ts` cites proof 15.9 (offline guard).
- Autopsy-engine gaps (4.13, 5.9, 8.6, 12.7), read against the tests: 4.13 covered by `status.test.ts` (each of the four statuses returned as the single `status`), 5.9 covered by `causes.test.ts` ('returns empty when no condition holds', and `certificate.ts` passes that list to the certificate), 8.6 covered by `risk.test.ts` (unavailable signs listed by name and absent from contributions); their numbers were added to those headers (header edits only). 12.7 stays 'needs a test': the engine project has no time target and no engine timing is recorded.
- After these changes, one `npm run trace` run by the agent: autopsy-engine: criteria 107, cited 106, gaps 1, unknown citations 0, classes: needs a test 1; documentation only 0; covered, header missing 0. proof-of-life-engine: criteria 165, cited 149, gaps 16, unknown citations 0, classes: needs a test 9 (2.4, 7.10, 8.9, 8.10, 12.5, 13.5, 13.15, 13.17, 16.5); documentation only 7 (3.7, 3.11, 6.8, 8.15, 13.8, 14.11, 16.6); covered, header missing 0. 15.7 became cited by `budgetReporter.test.ts` and its entry was dropped. The remaining 'needs a test' count is 9, not the ten in the request: 13 minus 1.6, 3.8, 15.8, 16.1.
- No suite timings in this entry from the agent. No test or suite was run by me; `npm run typecheck`, `npm run lint` and `npm run trace` were.

## Proof of Life: proof-heavy project (option 1d of checkpoint 12, user decision)
- Reason: the user's own run showed `proof-property` at 55.9 s (55.92 s, user-reported) against its 60 s target, a 4.1 s margin.
- Change: `p24-same-seed-same-bytes`, `p26-injected-changes` and `p26b-declared-delta` moved into a new vitest project `proof-heavy` with its own target of 90 s. Config: `proof-heavy` includes exactly those three files in `tests/proof/property/`; `proof-property` keeps its include globs and excludes the same three (plus vitest's default excludes). `p24b` and the other files stay in `proof-property`.
- `numRuns` unchanged (>= 100 everywhere); only project membership changed. The 60 s target of `proof-property` and the 120 s target of `proof-integration` are unchanged.
- The 90 s target is a TARGET chosen by the user, not a measurement. The first measurement of the new project will come from the user's next run (pending).
- Files: `vitest.config.mts`, `tests/proof/helpers/budgetGlobalSetup.ts` (target table), `tests/proof/unit/budgetReporter.test.ts` (proof-heavy cases), `.github/workflows/ci.yml` (comment only), `README.md`, `.kiro/steering/structure.md`, `.kiro/steering/tech.md`, design.md "Time budgets".

## Proof of Life: first proof-heavy measurement (user-run)
- Measured by the user in their own PowerShell; copied from the user's message; not measured by the agent. The 'Test Files / Tests / Duration' lines were NOT provided (the user's message had a placeholder), so none are recorded here.
- `[budget] proof-heavy: 104.8 s sum of file durations`
- `[budget] proof-property: 129.2 s sum of file durations`
- `[budget] proof-integration: 36.3 s sum of file durations`
- `[budget] proof-integration: 54.7 s whole-run wall-clock, upper bound (target 120 s)`
- `[budget] proof-heavy: 54.7 s whole-run wall-clock, upper bound (target 90 s)`
- `[budget] proof-property: 54.7 s whole-run wall-clock, upper bound (target 60 s)`
- These are sums of file durations and whole-run values. The per-project pass/fail check that printed the whole-run lines is replaced by the span check (next entry). No per-project span was measured in this run, so none is stated.

## Proof of Life: per-project budget check (span), user decision
- Reason: the check in `teardown()` used the whole run's wall-clock, so every proof project was judged on the same time (54.7 s in the user's run). Moving files out of `proof-property` therefore could not change its check against 60 s. Earlier whole-run numbers in this journal ('whole-run wall-clock, upper bound') were upper bounds, not per-project measurements.
- Decision: the check is per project, on its span (first test file start to last test file end). Targets unchanged (60 s, 90 s, 120 s).
- Where pass/fail lives: one place, the custom reporter `tests/proof/helpers/budgetReporter.ts` in `onTestRunEnd`. A `globalSetup` `teardown()` receives no arguments and cannot see reporter data, so the `globalSetup` entries and `tests/proof/helpers/budgetGlobalSetup.ts` were removed. The reporter is loaded by path from `vitest.config.mts` (the inline reporter object was replaced, so the config no longer holds logic). A strict overrun prints the error and sets `process.exitCode = 1`; in vitest 5.1.0 the run already sets that code for failed tests and the CLI exits through `process.exit()` without an argument. `PROOF_BUDGET_MODE=warn` only warns. `PROOF_LOG_TIMINGS=1` appends the checked value.
- Fields: span from `onTestModuleStart` (first) to `onTestModuleEnd` (last) with `performance.now()` in the main process, per `TestModule.project.name`. `onTestModuleQueued` is not used: files are queued at the start of the run, so the span would equal the whole run. The span therefore excludes the import time of the first file. Sum: `TestModule.diagnostic().duration` (info only). Whole-run: `onTestRunStart` to `onTestRunEnd` (info only, and the fallback when no span exists for a project). Projects without files in the run are not evaluated.
- Output lines (each starts `[budget] <project>:`): span (checked), sum (info only), whole-run (info only); on fallback one line, 'span unavailable; checked against target'.
- Tests: `tests/proof/unit/budgetReporter.test.ts` rewritten for the span check and the span tracker; one run of that file by the agent: 28 passed (the three `[budget] proof-property` lines of that single-file run printed through the real reporter; they are not a suite timing).
- Not verified without a real multi-project run: span values with parallel projects, that the exit code is 1 on a strict overrun, and the `PROOF_LOG_TIMINGS` append. The first span measurements come from the user's next run (pending).
## Proof of Life: first span measurements (user-run)
- Measured by the user in their own PowerShell; copied from the user's message; not measured by the agent.
- Run 1, `npm test`: Test Files 100 passed (100); Tests 1260 passed | 3 skipped (1263); Duration 56.01s; exit code 0.
  - `[budget] proof-heavy: 43.5 s span (target 90 s); sum 106.8 s; whole-run 56.0 s`
  - `[budget] proof-integration: 14.1 s span (target 120 s); sum 39.3 s; whole-run 56.0 s`
  - `[budget] proof-property: 36.1 s span (target 60 s); sum 131.1 s; whole-run 56.0 s`
- Run 2, `npx vitest run --project proof-heavy`: Test Files 3 passed (3); Tests 3 passed (3); Duration 20.95s; exit code 0.
  - `[budget] proof-heavy: 20.2 s span (target 90 s); sum 53.1 s; whole-run 21.0 s` (only proof-heavy was evaluated)
- Run 3, `npx vitest run tests/proof/unit/executorTypes.test.ts`: Test Files 1 passed (1); Tests 7 passed (7); Duration 379ms; exit code 0.
  - `[budget] proof-property: 0.0 s span (target 60 s); sum 0.0 s; whole-run 0.4 s` (only proof-property was evaluated)
- User observations (the user's reading, not verified by an agent): no fallback line appeared in any run, so the module hooks fired for every file; proof-heavy alone took 20.2 s span against 43.5 s in the full run, so the full-run time is mostly CPU sharing between parallel projects.
- Margins as printed (arithmetic on the user's numbers: target minus printed span): proof-property 60 - 36.1 = 23.9 s; proof-heavy 90 - 43.5 = 46.5 s; proof-integration 120 - 14.1 = 105.9 s.
- These are the first per-project span measurements. The earlier whole-run figures in this journal were upper bounds.
## Proof of Life: PROOF_BUDGET_SCALE (test aid, user decision)
- Purpose: confirm that a strict overrun gives exit code 1 and warn mode gives exit code 0, without a slow suite.
- Rules: a number, default 1, multiplies every target; it must be finite and > 0 (strict parse, not parseFloat); a rejected value prints `[budget] PROOF_BUDGET_SCALE rejected: must be a positive number (got <JSON string>)`, sets exit code 1 whatever PROOF_BUDGET_MODE is, and evaluates nothing; never set in CI; with a scale other than 1 nothing is written to this journal (a note goes to stderr).
- Commands given to the user (single file `tests/proof/unit/executorTypes.test.ts`, scale 0.000001 so the 60 s target is 60 microseconds): strict expects exit code 1; with PROOF_BUDGET_MODE=warn expects 0; an invalid scale expects 1 and the rejection message. See the agent's report for the exact commands.
- Results: pending the user's run.