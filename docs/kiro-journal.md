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