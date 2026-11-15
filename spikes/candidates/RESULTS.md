# Coroner candidates: autopsy results

Generated 2026-11-15T19:03:21Z by `scripts/spike/coroner-candidates.ts`. GitHub token: set (authenticated requests).
Status, causes, vulnerabilities, time of death, maintainers, weekly downloads and dependents come from the autopsy engine (npm registry, OSV, deps.dev, GitHub REST API). Eligibility columns come from a direct registry packument fetch. Every number is listed with its source URL and fetch date in the Sources section; full facts are in `certificates/<name>.json`.

Eligible means: permitted license (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 as a plain SPDX id), no runtime dependencies, `type` is not `module`, status is not `alive` or `retired-with-successor`, at least one open vulnerability per OSV, and at least one cause of death. Anything that could not be read counts as `no (unverified: ...)`. Size is `dist.unpackedSize` only (a proxy; lines are not measured).

## Candidates

| Package | Status | Causes | Vulnerability ids | Time of death | Maintainers | Weekly downloads | Dependents | Eligible |
|---|---|---|---|---|---|---|---|---|
| lodash.setwith@4.3.2 | dead | unpatched-cve | GHSA-p6mc-m468-83gw | 2016-08-13T17:44:20Z | 2 | 28033 | 207 | yes |
| lodash.update@4.10.2 | dead | unpatched-cve | GHSA-p6mc-m468-83gw | 2016-08-13T17:46:53Z | 2 | 8022 | 34 | yes |
| merge-recursive@0.0.3 | dead | unpatched-cve, runtime-rot | GHSA-cvxm-f295-x957 | 2012-07-22T17:58:49Z | 1 | 4174 | 280 | yes |
| ansi2html@0.0.1 | dead | unpatched-cve, runtime-rot | GHSA-c2v2-7rcg-2ch7 | 2013-09-05T09:09:56Z | 1 | 1147 | 23 | no (license field absent (unverified)) |
| lodash.updatewith@4.10.2 | dead | unpatched-cve | GHSA-p6mc-m468-83gw | 2016-08-13T17:46:57Z | 2 | 63 | 1 | yes |
| utils-extend@1.0.8 | dead | unpatched-cve, runtime-rot | GHSA-6pq3-928q-x6w6, GHSA-7qgg-vw88-cc99 | 2015-04-12T04:39:55Z | 1 | 54392 | 919 | yes |
| lodash.pick@4.4.0 | retired-with-successor | unpatched-cve | GHSA-p6mc-m468-83gw | 2016-08-13T17:43:20Z | 2 | 2185415 | 17484 | no (status retired-with-successor (syntax)) |
| safe-eval@0.4.1 | dead | unpatched-cve, runtime-rot | GHSA-33vh-7x8q-mg35, GHSA-79xf-67r4-q2jj, GHSA-9pcf-h8q9-63f6, GHSA-hcg3-56jf-x4vh, GHSA-hrpq-r399-whgw | 2018-07-27T07:36:17Z | 1 | 30297 | 1753 | yes |
| node-serialize@0.0.4 | dead | unpatched-cve, runtime-rot | GHSA-q4v7-4rhw-9hqm | 2014-05-26T12:10:25Z | 1 | 8636 | 36 | no (license field absent; legacy "licenses" field says MIT (unverified)) |

### Eligibility detail (registry packument)

| Package | License | Runtime dependencies | type | main | unpackedSize (bytes, proxy) | fileCount | Published (pinned version) | Notes |
|---|---|---|---|---|---|---|---|---|
| lodash.setwith@4.3.2 | MIT (permitted) | 0 (absent) | absent (CommonJS) | absent | unavailable | unavailable | 2016-08-13T17:44:20.323Z | "main" absent (Node falls back to index.js; unverified); unpackedSize not reported by the registry for this version; deprecated on npm |
| lodash.update@4.10.2 | MIT (permitted) | 0 (absent) | absent (CommonJS) | absent | unavailable | unavailable | 2016-08-13T17:46:53.974Z | "main" absent (Node falls back to index.js; unverified); unpackedSize not reported by the registry for this version |
| merge-recursive@0.0.3 | MIT (permitted) | 0 (absent) | absent (CommonJS) | lib/index.js | unavailable | unavailable | 2012-07-22T17:58:49.449Z | unpackedSize not reported by the registry for this version |
| ansi2html@0.0.1 | absent (unverified) | 0 (empty) | absent (CommonJS) | ./lib/ | unavailable | unavailable | 2013-09-05T09:09:56.650Z | unpackedSize not reported by the registry for this version; no repository URL in package.json |
| lodash.updatewith@4.10.2 | MIT (permitted) | 0 (absent) | absent (CommonJS) | absent | unavailable | unavailable | 2016-08-13T17:46:57.787Z | "main" absent (Node falls back to index.js; unverified); unpackedSize not reported by the registry for this version |
| utils-extend@1.0.8 | ISC (permitted) | 0 (absent) | absent (CommonJS) | index.js | unavailable | unavailable | 2015-04-12T04:39:55.496Z | unpackedSize not reported by the registry for this version |
| lodash.pick@4.4.0 | MIT (permitted) | 0 (absent) | absent (CommonJS) | absent | unavailable | unavailable | 2016-08-13T17:43:20.352Z | "main" absent (Node falls back to index.js; unverified); unpackedSize not reported by the registry for this version; deprecated on npm |
| safe-eval@0.4.1 | MIT (permitted) | 0 (absent) | absent (CommonJS) | index.js | 7389 | 5 | 2018-07-27T07:36:17.187Z | - |
| node-serialize@0.0.4 | absent; legacy licenses: MIT (unverified) | 0 (absent) | absent (CommonJS) | ./lib/serialize | unavailable | unavailable | 2014-05-26T12:10:25.687Z | unpackedSize not reported by the registry for this version |

## Controls

| Package | Status | Causes | Vulnerability ids | Time of death | Maintainers | Weekly downloads | Dependents | Eligible |
|---|---|---|---|---|---|---|---|---|
| ip@2.0.1 | dead | unpatched-cve, runtime-rot | GHSA-2p57-rm9w-gvfp | 2024-02-19T05:13:16Z | 5 | 8467504 | 6862 | yes |
| inflight@1.0.6 | retired-with-successor | repo-archived, runtime-rot | none | 2016-10-13T03:53:29Z | 1 | 125317057 | 560887 | no (2 runtime dependencies (once, wrappy); status retired-with-successor (lru-cache); no open vulnerability per the engine (OSV)) |

| Package | License | Runtime dependencies | type | main | unpackedSize (bytes, proxy) | fileCount | Published (pinned version) | Notes |
|---|---|---|---|---|---|---|---|---|
| ip@2.0.1 | MIT (permitted) | 0 (absent) | absent (CommonJS) | lib/ip | 15497 | 3 | 2024-02-19T05:13:16.771Z | - |
| inflight@1.0.6 | ISC (permitted) | 2: once, wrappy | absent (CommonJS) | inflight.js | unavailable | unavailable | 2016-10-13T03:53:29.524Z | unpackedSize not reported by the registry for this version; deprecated on npm |

| Control | Expectation | Observed eligible | Matches |
|---|---|---|---|
| ip | blocked (task expectation: runtime dependencies) | yes | no (control passed the gate) |
| inflight | no resurrection (task expectation: retired-with-successor) | no (2 runtime dependencies (once, wrappy); status retired-with-successor (lru-cache); no open vulnerability per the engine (OSV)) | yes (blocked as expected) |

## Sources

### lodash.setwith@4.3.2

- registry packument (eligibility): https://registry.npmjs.org/lodash.setwith (fetched 2026-11-15T19:03:09Z)
- certificate: `certificates\lodash.setwith.json`
- analysis date: 2026-11-15T19:03:09Z
- days since time of death (engine): 3746
- risk score (engine): 35
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/lodash.setwith/versions/4.3.2:dependents (fetched 2026-11-15T19:03:09Z)
- fact `deprecation`: https://registry.npmjs.org/lodash.setwith (fetched 2026-11-15T19:03:08Z)
- fact `githubRepo`: https://api.github.com/repos/lodash/lodash (fetched 2026-11-15T19:03:09Z)
- fact `maintainers`: https://registry.npmjs.org/lodash.setwith (fetched 2026-11-15T19:03:08Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:09Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Flodash%2Flodash (fetched 2026-11-15T19:03:09Z)
- fact `timeOfDeath`: https://registry.npmjs.org/lodash.setwith (fetched 2026-11-15T19:03:08Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/lodash.setwith (fetched 2026-11-15T19:03:09Z)

### lodash.update@4.10.2

- registry packument (eligibility): https://registry.npmjs.org/lodash.update (fetched 2026-11-15T19:03:10Z)
- certificate: `certificates\lodash.update.json`
- analysis date: 2026-11-15T19:03:10Z
- days since time of death (engine): 3746
- risk score (engine): 35
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/lodash.update/versions/4.10.2:dependents (fetched 2026-11-15T19:03:10Z)
- fact `githubRepo`: https://api.github.com/repos/lodash/lodash (fetched 2026-11-15T19:03:10Z)
- fact `maintainers`: https://registry.npmjs.org/lodash.update (fetched 2026-11-15T19:03:10Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:10Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Flodash%2Flodash (fetched 2026-11-15T19:03:10Z)
- fact `timeOfDeath`: https://registry.npmjs.org/lodash.update (fetched 2026-11-15T19:03:10Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/lodash.update (fetched 2026-11-15T19:03:10Z)

### merge-recursive@0.0.3

- registry packument (eligibility): https://registry.npmjs.org/merge-recursive (fetched 2026-11-15T19:03:11Z)
- certificate: `certificates\merge-recursive.json`
- analysis date: 2026-11-15T19:03:11Z
- days since time of death (engine): 5229
- risk score (engine): 62
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/merge-recursive/versions/0.0.3:dependents (fetched 2026-11-15T19:03:11Z)
- fact `githubRepo`: https://api.github.com/repos/UmbraEngineering/node-merge-recursive (fetched 2026-11-15T19:03:11Z)
- fact `maintainers`: https://registry.npmjs.org/merge-recursive (fetched 2026-11-15T19:03:11Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:11Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2FUmbraEngineering%2Fnode-merge-recursive (fetched 2026-11-15T19:03:11Z)
- fact `timeOfDeath`: https://registry.npmjs.org/merge-recursive (fetched 2026-11-15T19:03:11Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/merge-recursive (fetched 2026-11-15T19:03:11Z)

### ansi2html@0.0.1

- registry packument (eligibility): https://registry.npmjs.org/ansi2html (fetched 2026-11-15T19:03:12Z)
- certificate: `certificates\ansi2html.json`
- analysis date: 2026-11-15T19:03:12Z
- days since time of death (engine): 4819
- risk score (engine): 45
- GitHub token used by the engine: no
- GitHub skipped: no github.com repository URL was available
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/ansi2html/versions/0.0.1:dependents (fetched 2026-11-15T19:03:12Z)
- fact `maintainers`: https://registry.npmjs.org/ansi2html (fetched 2026-11-15T19:03:12Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:12Z)
- fact `timeOfDeath`: https://registry.npmjs.org/ansi2html (fetched 2026-11-15T19:03:12Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/ansi2html (fetched 2026-11-15T19:03:12Z)

### lodash.updatewith@4.10.2

- registry packument (eligibility): https://registry.npmjs.org/lodash.updatewith (fetched 2026-11-15T19:03:13Z)
- certificate: `certificates\lodash.updatewith.json`
- analysis date: 2026-11-15T19:03:13Z
- days since time of death (engine): 3746
- risk score (engine): 35
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/lodash.updatewith/versions/4.10.2:dependents (fetched 2026-11-15T19:03:13Z)
- fact `githubRepo`: https://api.github.com/repos/lodash/lodash (fetched 2026-11-15T19:03:13Z)
- fact `maintainers`: https://registry.npmjs.org/lodash.updatewith (fetched 2026-11-15T19:03:13Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:13Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Flodash%2Flodash (fetched 2026-11-15T19:03:13Z)
- fact `timeOfDeath`: https://registry.npmjs.org/lodash.updatewith (fetched 2026-11-15T19:03:13Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/lodash.updatewith (fetched 2026-11-15T19:03:13Z)

### utils-extend@1.0.8

- registry packument (eligibility): https://registry.npmjs.org/utils-extend (fetched 2026-11-15T19:03:14Z)
- certificate: `certificates\utils-extend.json`
- analysis date: 2026-11-15T19:03:14Z
- days since time of death (engine): 4235
- risk score (engine): 67
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/utils-extend/versions/1.0.8:dependents (fetched 2026-11-15T19:03:14Z)
- fact `githubRepo`: https://api.github.com/repos/douzi8/utils-extend (fetched 2026-11-15T19:03:14Z)
- fact `maintainers`: https://registry.npmjs.org/utils-extend (fetched 2026-11-15T19:03:14Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:14Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Fdouzi8%2Futils-extend (fetched 2026-11-15T19:03:14Z)
- fact `timeOfDeath`: https://registry.npmjs.org/utils-extend (fetched 2026-11-15T19:03:14Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/utils-extend (fetched 2026-11-15T19:03:14Z)

### lodash.pick@4.4.0

- registry packument (eligibility): https://registry.npmjs.org/lodash.pick (fetched 2026-11-15T19:03:16Z)
- certificate: `certificates\lodash.pick.json`
- analysis date: 2026-11-15T19:03:16Z
- days since time of death (engine): 3746
- risk score (engine): 35
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/lodash.pick/versions/4.4.0:dependents (fetched 2026-11-15T19:03:15Z)
- fact `githubRepo`: https://api.github.com/repos/lodash/lodash (fetched 2026-11-15T19:03:15Z)
- fact `maintainers`: https://registry.npmjs.org/lodash.pick (fetched 2026-11-15T19:03:15Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:15Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Flodash%2Flodash (fetched 2026-11-15T19:03:15Z)
- fact `successor`: https://registry.npmjs.org/syntax (fetched 2026-11-15T19:03:16Z)
- fact `successorLookup:destructuring`: https://registry.npmjs.org/destructuring (fetched 2026-11-15T19:03:16Z)
- fact `successorLookup:syntax`: https://registry.npmjs.org/syntax (fetched 2026-11-15T19:03:16Z)
- fact `timeOfDeath`: https://registry.npmjs.org/lodash.pick (fetched 2026-11-15T19:03:15Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/lodash.pick (fetched 2026-11-15T19:03:15Z)

### safe-eval@0.4.1

- registry packument (eligibility): https://registry.npmjs.org/safe-eval (fetched 2026-11-15T19:03:17Z)
- certificate: `certificates\safe-eval.json`
- analysis date: 2026-11-15T19:03:17Z
- days since time of death (engine): 3033
- risk score (engine): 77
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/safe-eval/versions/0.4.1:dependents (fetched 2026-11-15T19:03:17Z)
- fact `githubRepo`: https://api.github.com/repos/hacksparrow/safe-eval (fetched 2026-11-15T19:03:17Z)
- fact `maintainers`: https://registry.npmjs.org/safe-eval (fetched 2026-11-15T19:03:17Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:17Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Fhacksparrow%2Fsafe-eval (fetched 2026-11-15T19:03:17Z)
- fact `timeOfDeath`: https://registry.npmjs.org/safe-eval (fetched 2026-11-15T19:03:17Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/safe-eval (fetched 2026-11-15T19:03:17Z)

### node-serialize@0.0.4

- registry packument (eligibility): https://registry.npmjs.org/node-serialize (fetched 2026-11-15T19:03:18Z)
- certificate: `certificates\node-serialize.json`
- analysis date: 2026-11-15T19:03:18Z
- days since time of death (engine): 4556
- risk score (engine): 61
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/node-serialize/versions/0.0.4:dependents (fetched 2026-11-15T19:03:18Z)
- fact `githubRepo`: https://api.github.com/repos/luin/serialize (fetched 2026-11-15T19:03:18Z)
- fact `maintainers`: https://registry.npmjs.org/node-serialize (fetched 2026-11-15T19:03:18Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:18Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Fluin%2Fserialize (fetched 2026-11-15T19:03:18Z)
- fact `timeOfDeath`: https://registry.npmjs.org/node-serialize (fetched 2026-11-15T19:03:18Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/node-serialize (fetched 2026-11-15T19:03:18Z)

### ip@2.0.1

- registry packument (eligibility): https://registry.npmjs.org/ip (fetched 2026-11-15T19:03:19Z)
- certificate: `certificates\ip.json`
- analysis date: 2026-11-15T19:03:19Z
- days since time of death (engine): 1000
- risk score (engine): 60
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/ip/versions/2.0.1:dependents (fetched 2026-11-15T19:03:19Z)
- fact `githubRepo`: https://api.github.com/repos/indutny/node-ip (fetched 2026-11-15T19:03:19Z)
- fact `maintainers`: https://registry.npmjs.org/ip (fetched 2026-11-15T19:03:19Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:19Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Findutny%2Fnode-ip (fetched 2026-11-15T19:03:19Z)
- fact `timeOfDeath`: https://registry.npmjs.org/ip (fetched 2026-11-15T19:03:19Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/ip (fetched 2026-11-15T19:03:19Z)

### inflight@1.0.6

- registry packument (eligibility): https://registry.npmjs.org/inflight (fetched 2026-11-15T19:03:21Z)
- certificate: `certificates\inflight.json`
- analysis date: 2026-11-15T19:03:21Z
- days since time of death (engine): 3685
- risk score (engine): 49
- GitHub token used by the engine: yes
- fact `dependents`: https://api.deps.dev/v3alpha/systems/npm/packages/inflight/versions/1.0.6:dependents (fetched 2026-11-15T19:03:20Z)
- fact `githubRepo`: https://api.github.com/repos/npm/inflight (fetched 2026-11-15T19:03:20Z)
- fact `maintainers`: https://registry.npmjs.org/inflight (fetched 2026-11-15T19:03:19Z)
- fact `openVulnerabilities`: https://api.osv.dev/v1/query (fetched 2026-11-15T19:03:20Z)
- fact `scorecard`: https://api.deps.dev/v3/projects/github.com%2Fnpm%2Finflight (fetched 2026-11-15T19:03:20Z)
- fact `successor`: https://registry.npmjs.org/lru-cache (fetched 2026-11-15T19:03:21Z)
- fact `successorLookup:lru-cache`: https://registry.npmjs.org/lru-cache (fetched 2026-11-15T19:03:21Z)
- fact `timeOfDeath`: https://registry.npmjs.org/inflight (fetched 2026-11-15T19:03:19Z)
- fact `weeklyDownloads`: https://api.npmjs.org/downloads/point/last-week/inflight (fetched 2026-11-15T19:03:20Z)

