# Coroner candidates: shortlist (spike 6)

Fetch date for every source below: **2026-11-15** (registry and downloads read at 18:15 UTC). Any field marked `unverified` was not confirmed. Sizes are `dist.unpackedSize` from the registry (a proxy; lines were not measured). "Dependencies" is the count of keys in `dependencies` of the pinned version (latest). Excluded by request: `ip`, `lodash.set`, `inflight`.

## Table (sorted by recommendation)

| # | Package@latest | License | Deps (read) | Last publish (read) | Advisory | "Fixed version" per advisory | unpackedSize (proxy) | Module | Weekly downloads (read) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | lodash.setwith@4.3.2 | MIT | 0 (field absent) | 2016-08-13 | [GHSA-p6mc-m468-83gw](https://github.com/advisories/GHSA-p6mc-m468-83gw) / CVE-2020-8203 | none: affected range for lodash.setwith ends at `last_affected` 4.3.2 (= latest), no `fixed` event | unverified (registry reports no value) | CommonJS (no `type`; no `main`, defaults to index.js: unverified) | 28,033 |
| 2 | lodash.update@4.10.2 | MIT | 0 (field absent) | 2016-08-13 | GHSA-p6mc-m468-83gw | none: `last_affected` 4.10.2 (= latest) | unverified | CommonJS (no `type`, no `main`) | 8,022 |
| 3 | merge-recursive@0.0.3 | MIT | 0 (field absent) | 2012-07-22 | [GHSA-cvxm-f295-x957](https://github.com/advisories/GHSA-cvxm-f295-x957) / CVE-2018-3751 | none: `last_affected` 0.0.3 (= latest); text says "There is currently no fix available" | unverified | CommonJS, `main` lib/index.js; export is a function with `.recursive` and `.selective` (read from source) | 4,174 |
| 4 | ansi2html@0.0.1 | **unverified**: no `license` field in package.json (embedded README text says MIT) | 0 (`dependencies: {}`) | 2013-09-05 | [GHSA-c2v2-7rcg-2ch7](https://github.com/advisories/GHSA-c2v2-7rcg-2ch7) / CVE-2015-9239 | none: introduced 0.0.0, no `fixed` event; text says all versions remain vulnerable | unverified | CommonJS, `main` ./lib/ ; `module.exports` is a function (read from source) | 1,147 |
| 5 | lodash.updatewith@4.10.2 | MIT | 0 (field absent) | 2016-08-13 | GHSA-p6mc-m468-83gw | none: `last_affected` 4.10.2 (= latest) | unverified | CommonJS (no `type`, no `main`) | 63 |
| 6 | utils-extend@1.0.8 | ISC | 0 (field absent) | 2015-04-12 | [GHSA-6pq3-928q-x6w6](https://github.com/advisories/GHSA-6pq3-928q-x6w6) / CVE-2020-8147 | none: GitHub page shows "Patched versions: None"; OSV text "No fix is currently available" | unverified | CommonJS, `main` index.js | 54,392 |
| 7 | lodash.pick@4.4.0 | MIT | 0 (field absent) | 2016-08-13 | GHSA-p6mc-m468-83gw | none: `last_affected` 4.4.0 (= latest). **Advisory applicability unverified**, see below | unverified | CommonJS (no `type`, no `main`); deprecated on npm | 2,185,415 |
| 8 | safe-eval@0.4.1 | MIT | 0 (field absent) | 2018-07-27 | [GHSA-9pcf-h8q9-63f6](https://github.com/advisories/GHSA-9pcf-h8q9-63f6) | none: introduced 0.0.0, no `fixed` event; text "No fix is currently available" | 7,389 (5 files) | CommonJS, `main` index.js | 30,297 |
| 9 | node-serialize@0.0.4 | **unverified**: no `license` field; only the legacy `licenses` field, value "MIT" | 0 (field absent) | 2014-05-26 | [GHSA-q4v7-4rhw-9hqm](https://github.com/advisories/GHSA-q4v7-4rhw-9hqm) / CVE-2017-5941 | none: `last_affected` 0.0.4 (= latest); "There is no direct patch" | unverified | CommonJS, `main` ./lib/serialize | 8,636 |

All nine have a last publish date more than 730 days before 2026-11-15 (computed from the dates above). Maintainer count (read from the registry): 2 for each of the four `lodash.*` packages (jdalton, mathias), 1 for each of the others. No candidate is "maintainer-gone". Whether the engine reports `runtime-rot` or `unpatched-cve` is for the script to establish (needs the GitHub push date).

Advisory status was read from the OSV record of each advisory (https://api.osv.dev/v1/vulns/<id>), which mirrors the GitHub Advisory Database; for utils-extend the GitHub advisory page was also read. NVD and Snyk pages were **not** read (unverified).

## What each package does, fit, rationale, risks for the harness

### 1. lodash.setwith@4.3.2
- Does: `_.setWith(object, path, value, customizer)`, the same `baseSet` as lodash.set with a customizer. Pure function, mutates and returns `object`.
- Rationale: same advisory and the same `baseSet` code path as lodash.set (the `baseSet` in lodash.update 4.10.2 has no `__proto__`/`constructor`/`prototype` guard: read from source; setwith's own source was not read, **unverified**). The existing lodash.set declared delta (stop at the offending segment, see docs/demo-packages.md) should carry over. Best reuse of the existing harness.
- Risks: needs a customizer argument (a function). Whether the Value_Codec / generators can pass functions was not checked. Path generators must include prototype-key segments. Customizer return values change what containers are built.

### 2. lodash.update@4.10.2
- Does: `_.update(object, path, updater)`: sets a value computed by `updater(oldValue)`. Pure, mutating.
- Rationale: same `baseSet` (guard absent, read from source). Same delta as lodash.set.
- Risks: `updater` is a function argument (same open question as above); generators need deterministic updaters, e.g. a fixed set of named functions.

### 3. merge-recursive@0.0.3
- Does: object merge; `module.exports` is a function (flat merge) with `.recursive`, `.selective`, `.selective.recursive` (read from `lib/index.js`). No requires, no I/O at load, about 1.5 KB of source (read: 1,519 bytes).
- Rationale: different advisory and different code from the lodash family, so it widens the demo. Pollution path: `recurser` recurses into `host[key]` when `key` is `__proto__` (read from source). Declared delta would be "do not merge `__proto__`, `constructor`, `prototype` keys".
- Risks: the pollution payload needs an **own** `__proto__` key (as made by `JSON.parse`), which ordinary generators and `fc.object` do not produce by default; the harness needs an explicit generator. The host argument is mutated in place, so the observation must include the host after the call. Exports are a function plus properties: the engine names a function export `default`; how it handles properties on that function is unverified. Last publish 2012: sparse docs and no tests (`scripts.test` is a placeholder).

### 4. ansi2html@0.0.1
- Does: converts ANSI escape sequences in a string to HTML `<span>` markup; `module.exports` is one function (read from `lib/index.js`). Pure string to string.
- Rationale: the best pure-function fit after the lodash family and a different bug class (ReDoS). Easy generators (strings with escape sequences).
- Risks: (a) the fix is a performance property (bounded time on crafted input), not a change in output. The proof engine's delta model for that is unverified; a differential test would show identical output with different timing. (b) The source shown to me did not display the raw ESC character (0x1B) in the regex; the exact pattern is **unverified**. (c) No `license` field in package.json, so the license gate fails strictly; the README text says MIT. (d) `repository.url` is an empty string, so the engine gets no GitHub signal; the time-of-death rule then relies on the registry date alone. (e) The package ships a `bin` file (not read, unverified). (f) Only 2 versions exist on the registry.

### 5. lodash.updatewith@4.10.2
- Does: `_.updateWith(object, path, updater, customizer)`. Same family as 1 and 2.
- Rationale: same delta as 1 and 2. Only 63 downloads last week, so little real-world value.
- Risks: two function arguments.

### 6. utils-extend@1.0.8
- Does: "Extend nodejs util api": copies every `util` export onto its own exports, then adds `extend` (deep merge), `pick`, `unique`, `escape`, `unescape`, `hrtime`, type checks and path helpers (read from `index.js`).
- Rationale: ISC license, no dependencies, advisory is about `extend` not guarding the prototype.
- Risks: reads `process.platform` at load; `extend(exports, util)` copies the Node `util` surface, so the exported API depends on the Node version running it (the API-surface comparison would be noisy); `hrtime` uses `process.hrtime` (non-deterministic); `extend` walks `for...in`, which includes inherited keys. Wide surface relative to the one buggy function.

### 7. lodash.pick@4.4.0
- Does: `_.pick(object, ...paths)`.
- Rationale: the highest download count of the nine (2,185,415 in the last week, read), deprecated on npm ("Use destructuring assignment syntax instead").
- Risks: **the advisory may not apply to this version.** The `basePick` / `basePickBy` in 4.4.0 read from source copy flat keys (`result[key] = value`) and "do not support individual property identifiers"; the rest of the file was not read. GHSA-p6mc-m468-83gw lists lodash.pick with `last_affected` 4.4.0, but without a path-based set there may be no reproducible pollution, so no meaningful declared delta. Do not pick before reading the full source.

### 8. safe-eval@0.4.1
- Does: evaluates a string of code in a Node `vm` context (the project's issue #5 describes the `vm` module; the source was not read, **unverified**).
- Rationale: advisory "all versions", no fix.
- Risks: any real fix changes the sandboxing approach, which is a behavior change of the whole API. The harness would run `vm` code inside the proof engine's sandbox. The older CVE-2017-16088 (GHSA-ww6v-677g-p656) is reported fixed in 0.4.0 by the project; this advisory is a separate bypass. Poor fit.

### 9. node-serialize@0.0.4
- Does: `serialize(obj)` / `unserialize(str)`; `unserialize` calls `eval` on strings that start with a function flag (read from `lib/serialize.js`).
- Rationale: advisory "no direct patch" (the advisory records the author's advice to isolate the strings).
- Risks: a fix removes the function-restoring feature, which is a public behavior change (necromancy law 1). Uses `eval` on generated input inside the harness. No `license` field. Poor fit; list only for completeness.

## Alternatives and forks
- lodash.* family: the full `lodash` package is patched (fixed 4.17.19; `lodash-es` fixed 4.17.20), as read in the OSV record of GHSA-p6mc-m468-83gw.
- lodash.pick: the npm deprecation message points to destructuring assignment.
- ansi2html: the advisory says alternative modules exist (search "ansi html" on npm); none named, **unverified**.
- merge-recursive, utils-extend, safe-eval, node-serialize: forks or alternatives **unverified** (not searched).

## Recommended order for the first runs
1. lodash.setwith (reuses the lodash.set harness)
2. lodash.update (same code, adds a function argument)
3. merge-recursive (different advisory, small, function export with properties)
4. ansi2html (pure string function; different bug class; license field issue)

Note that 1, 2, 5 and 7 share one advisory and one code lineage, so they add little variety to a demo beyond lodash.set.

## Control note
For control `ip@2.0.1` the registry packument I read lists no `dependencies` field (checked 2026-11-15), which does not match the expectation "blocked, runtime dependencies". The script computes the control from live data and shows the observed result next to the expectation.

## Sources (all fetched 2026-11-15)
- Registry packuments: https://registry.npmjs.org/lodash.pick, /lodash.setwith, /lodash.update, /lodash.updatewith, /merge-recursive, /ansi2html, /utils-extend, /safe-eval, /node-serialize, /ip, /inflight (also the `/latest` documents for the same names).
- Weekly downloads: https://api.npmjs.org/downloads/point/last-week/<name> for each name above (read 2026-11-15 18:15 UTC).
- Advisories (OSV API mirror of GitHub reviewed advisories): https://api.osv.dev/v1/vulns/GHSA-p6mc-m468-83gw, GHSA-cvxm-f295-x957, GHSA-c2v2-7rcg-2ch7, GHSA-6pq3-928q-x6w6, GHSA-9pcf-h8q9-63f6, GHSA-q4v7-4rhw-9hqm.
- GitHub advisory page read: https://github.com/advisories/GHSA-6pq3-928q-x6w6.
- Checked and dropped (advisory has a fixed version or latest is not CommonJS or has dependencies): trim-off-newlines (fixed in 1.0.3, https://api.osv.dev/v1/vulns/GHSA-38fc-wpqx-33j7), rgb2hex (fixed 0.1.6, GHSA-65p8-3hm4-h9h8), js-object-utilities (fixed 2.2.1, GHSA-hpqf-m68j-2pfx), lodash.defaultsdeep (fixed 4.6.1, GHSA-h5mp-5q4p-ggf5), lutils-merge (has a dependency, https://registry.npmjs.org/lutils-merge/latest), djvalidator (GPL, has a dependency, https://registry.npmjs.org/djvalidator/latest), deep-get-set (`"type": "module"`, https://registry.npmjs.org/deep-get-set/latest).
- Source files read (read-only, not executed): https://unpkg.com/merge-recursive@0.0.3/lib/index.js, https://unpkg.com/utils-extend@1.0.8/index.js, https://unpkg.com/ansi2html@0.0.1/lib/index.js, https://unpkg.com/node-serialize@0.0.4/lib/serialize.js, https://unpkg.com/lodash.pick@4.4.0/index.js (excerpt), https://unpkg.com/lodash.update@4.10.2/index.js (excerpt).
- Engine rules: `src/engine/core/causes.ts` (730-day dormancy threshold; causes maintainer-gone, repo-archived, unpatched-cve, runtime-rot) and `docs/demo-packages.md`.
