# Pre-existing work
This project was created during the Kiroween 2026 submission period (from 30 Oct 2026).
No code, assets or data from projects created before 30 Oct 2026 are used.
Third-party libraries and data sources used are listed here as they are added.

## Libraries
- Next.js (MIT), React and React DOM (MIT), TypeScript (Apache-2.0)
- vitest (MIT), fast-check (MIT), zod (MIT), semver (ISC), @types/semver (MIT)
- semver ^7.8.6 (ISC, 7.8.6 installed), direct runtime dependency used by the necromancy gate (version comparison). Source: https://github.com/npm/node-semver. License read from `node_modules/semver/package.json` on 2026-11-15.
- yaml ^2.9.1 (ISC, 2.9.1 installed), dev dependency that parses the workflow files in `tests/pipeline/unit/workflowLint.test.ts`. Source: https://github.com/eemeli/yaml. License read from `node_modules/yaml/package.json`.
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
- Licenses of the packages above were read from the `package.json` in `node_modules` on 2026-11-15: next 16.4.6, react 19.3.1, @types/node 26.6.6, @types/react 19.3.0, @types/react-dom 19.3.0, tsx 4.23.15, eslint 10.15.0, @eslint/js 10.0.1, @babel/core 8.1.2, @babel/eslint-parser 8.1.2, @babel/preset-typescript 8.0.7, vitest 5.1.0, fast-check 4.10.2, zod 4.6.7 (all MIT); semver 7.8.6, yaml 2.9.1 (ISC); typescript 7.0.2 (Apache-2.0).

### Known advisory (accepted)

- GHSA-fc5q-39xc-vjpf (picomatch ReDoS), reported by `npm audit` on 2026-11-17 (user-run): 5 high findings, all this one dev-only advisory, through vitest -> vite -> tinyglobby -> fdir -> picomatch. `npm audit --omit=dev` found 0 vulnerabilities. No new dependency is added.
- Accepted for now (user decision, 2026-11-17): the only offered fix, `npm audit fix --force`, downgrades vitest to 3.1.4 (breaking). picomatch only matches the project's own test globs, never package input.
- Action: recheck before submission for a patched picomatch; if one exists, add an npm `overrides` entry for it.

## CI actions
`.github/workflows/ci.yml`, `resurrect.yml` and `nightly.yml` use these GitHub Actions (all MIT; license as reported by the GitHub API `/repos/<repo>/license` on 2026-11-15). `resurrect.yml` and `nightly.yml` pin each to a full commit SHA.
- actions/checkout (MIT). Source: https://github.com/actions/checkout. License: https://raw.githubusercontent.com/actions/checkout/main/LICENSE
- actions/setup-node (MIT). Source: https://github.com/actions/setup-node. License: https://raw.githubusercontent.com/actions/setup-node/main/LICENSE
- actions/upload-artifact (MIT). Source: https://github.com/actions/upload-artifact. License: https://raw.githubusercontent.com/actions/upload-artifact/main/LICENSE
- actions/download-artifact (MIT). Source: https://github.com/actions/download-artifact. License: https://raw.githubusercontent.com/actions/download-artifact/main/LICENSE
- actions/attest (MIT). Source: https://github.com/actions/attest. License: https://raw.githubusercontent.com/actions/attest/main/LICENSE

## Tools used by the pipeline
- GitHub CLI `gh` (MIT), preinstalled on GitHub-hosted runners; the publish step uses it to create pull requests and the nightly uses `gh attestation verify`. Source: https://github.com/cli/cli. License: https://raw.githubusercontent.com/cli/cli/trunk/LICENSE
- Sigstore (Apache-2.0), as used by GitHub Artifact Attestations (`actions/attest` signs with a Sigstore certificate and records the signature in a transparency log). Graveyard Shift does not install or import Sigstore code; it consumes the signed bundles. Sources: https://github.com/sigstore/cosign, https://github.com/sigstore/fulcio, https://github.com/sigstore/rekor (each Apache-2.0 per the GitHub API license endpoint, 2026-11-15). Docs: https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- Kiro CLI (user-side): a proprietary tool the user runs locally (in WSL) for the Medium. It is not a dependency, is not bundled or redistributed, and is not run in CI. Site: https://kiro.dev

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
  The nightly also reads attestations through `gh attestation verify` (GitHub attestations API, needs `attestations: read`). Docs: https://docs.github.com/en/rest/users/attestations

## Recorded data
- `tests/engine/fixtures/` holds responses recorded on 14 Nov 2026 from the data sources above
  for ip@2.0.1, lodash.set@4.3.2 and inflight@1.0.6 (19 files, public registry and advisory data),
  using `npm run fixtures:record`. No credentials are stored (checked by `tests/engine/unit/fixtureSecrets.test.ts`).