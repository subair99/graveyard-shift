# Pre-existing work
This project was created during the Kiroween 2026 submission period (from 30 Oct 2026).
Third-party libraries and data sources used are listed here as they are added.

## Libraries
- Next.js (MIT), React and React DOM (MIT), TypeScript (Apache-2.0)
- vitest (MIT), fast-check (MIT), zod (MIT), semver (ISC), @types/semver (MIT)
- ESLint, @eslint/js (MIT), dev dependencies for the determinism lint rule (task 9.6)
- @babel/eslint-parser, @babel/core, @babel/preset-typescript (MIT), dev dependencies that parse TypeScript in ESLint. typescript-eslint (MIT) was not used because its peer range is typescript <6.1.0 and this project uses TypeScript 7.
- tsx (MIT), planned as a dev dependency to run the fixture recording script (task 9.1). Not installed yet.

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
