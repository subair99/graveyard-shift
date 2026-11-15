# Pre-existing work
This project was created during the Kiroween 2026 submission period (from 30 Oct 2026).
No code, assets or data from projects created before 30 Oct 2026 are used.
Third-party libraries and data sources used are listed here as they are added.

## Libraries
- Next.js (MIT), React and React DOM (MIT), TypeScript (Apache-2.0)
- vitest (MIT), fast-check (MIT), zod (MIT), semver (ISC), @types/semver (MIT)
- tar 7.5.23 (BlueOak-1.0.0), runtime dependency for reading and writing package tarballs. Source: https://github.com/isaacs/node-tar. Its dependencies, with licenses read from each package's `package.json` in `node_modules`:
  - chownr 3.0.0 (BlueOak-1.0.0). Source: git://github.com/isaacs/chownr.git
  - minipass 7.1.3 (BlueOak-1.0.0). Source: https://github.com/isaacs/minipass
  - yallist 5.0.0 (BlueOak-1.0.0). Source: https://github.com/isaacs/yallist
  - @isaacs/fs-minipass 4.0.1 (ISC). Source: https://github.com/npm/fs-minipass
  - minizlib 3.1.0 (MIT). Source: https://github.com/isaacs/minizlib
  - BlueOak-1.0.0 is approved by name for tar, chownr, minipass and yallist (decision D9).
- lodash.set 4.3.2 tarball (MIT), used as a test input for tar handling. Source: https://registry.npmjs.org/lodash.set/-/lodash.set-4.3.2.tgz
- ESLint, @eslint/js (MIT), dev dependencies for the determinism lint rule (task 9.6)
- @babel/eslint-parser, @babel/core, @babel/preset-typescript (MIT), dev dependencies that parse TypeScript in ESLint. typescript-eslint (MIT) was not used because its peer range is typescript <6.1.0 and this project uses TypeScript 7.
- @babel/parser 8.1.2 (MIT), dev dependency used by the proof tests (the `sourceScan` test) to parse source files. Source: https://github.com/babel/babel/tree/main/packages/babel-parser. License read from `node_modules/@babel/parser/package.json`.
- tsx (MIT), dev dependency that runs the fixture recording scripts (`scripts/recordFixtures.ts`, `scripts/recordTarball.ts`) and the Proof of Life CLI (`npm run proof:run`).
- @types/node, @types/react, @types/react-dom (MIT), dev dependencies with type definitions.
- Licenses of the packages above were read from the `package.json` in `node_modules` on 2026-11-15: next 16.4.6, react 19.3.1, @types/node 26.6.6, @types/react 19.3.0, @types/react-dom 19.3.0, tsx 4.23.15, eslint 10.15.0, @eslint/js 10.0.1, @babel/core 8.1.2, @babel/eslint-parser 8.1.2, @babel/preset-typescript 8.0.7, vitest 5.1.0, fast-check 4.10.2, zod 4.6.7 (all MIT); semver 7.8.6 (ISC); typescript 7.0.2 (Apache-2.0).

## CI actions
`.github/workflows/ci.yml` uses these GitHub Actions (both MIT, license text read on 2026-11-15):
- actions/checkout@v7. License: https://raw.githubusercontent.com/actions/checkout/main/LICENSE
- actions/setup-node@v7. License: https://raw.githubusercontent.com/actions/setup-node/main/LICENSE

## Third-party material in test fixtures
- lodash.set 4.3.2 tarball (MIT), committed at `tests/proof/fixtures/lodash.set/`: the Original in the Proof of Life tests, and the base of the hand-written `lodash.set-alive` and `lodash.set-broken` fixtures. Source: https://registry.npmjs.org/lodash.set/-/lodash.set-4.3.2.tgz. The original license and author credits are kept in the fixtures.
- lodash 4.17.20 `baseSet` (MIT): the prototype-pollution guard in `tests/proof/fixtures/lodash.set-alive/` (and the broken fixture) follows this function. Source: https://raw.githubusercontent.com/lodash/lodash/4.17.20/lodash.js, fetched 2026-11-15.

## Data sources
The autopsy engine reads these public services. Every fact taken from them is stored with its source URL and fetch date.
- npm registry: base URL `https://registry.npmjs.org`. Used for package metadata (packuments: versions, release times, maintainers, repository URL, deprecation messages) and for existence checks of successor candidates. Docs: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md. Terms: https://docs.npmjs.com/policies/terms
- npm downloads API: base URL `https://api.npmjs.org/downloads`. Used for last-week download counts. Docs: https://github.com/npm/registry/blob/main/docs/download-counts.md
- OSV: base URL `https://api.osv.dev/v1`. Used to look up known vulnerabilities for a package name and version (ids, aliases, severity, fixed versions). Docs: https://google.github.io/osv.dev/api/
- deps.dev:
  - `https://api.deps.dev/v3`, used for the OpenSSF Scorecard through GetProject (`scorecard.overallScore`).
  - `https://api.deps.dev/v3alpha`, used for the dependents count through GetDependents (`dependentCount`). This is an alpha API and may change.
  - Both were checked against https://docs.deps.dev/api/v3/ and https://docs.deps.dev/api/v3alpha/ on 14 Nov 2026. Terms: https://deps.dev/terms
- GitHub REST API: base URL `https://api.github.com`. Used for repository `archived` and `pushed_at`. Requests are authenticated only when `GITHUB_TOKEN` is set. Docs: https://docs.github.com/en/rest. Terms: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service

## Recorded data
- `tests/engine/fixtures/` holds responses recorded on 14 Nov 2026 from the data sources above
  for ip@2.0.1, lodash.set@4.3.2 and inflight@1.0.6 (19 files, public registry and advisory data),
  using `npm run fixtures:record`. No credentials are stored (checked by `tests/engine/unit/fixtureSecrets.test.ts`).