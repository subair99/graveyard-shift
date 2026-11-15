# Secret scan report

- Date: 2026-11-15 19:19:55 +01:00
- Git HEAD: 52eb99a
- Command: `powershell -NoProfile -File spikes/secret-scan/scan.ps1` (from the repository root; `pwsh spikes/secret-scan/scan.ps1` also works where PowerShell 7 is installed)
- Scan duration: 24 s
- External scanners used: none installed (gitleaks, trufflehog not found); built-in patterns only
- Coverage: 26 commits (all refs, reflog, unreachable), 545 distinct blobs (545 scanned, 1 binary-looking, 0 skipped as larger than 5242880 bytes), commit messages, 18 uncommitted working-tree files
- Branches/tags/stashes: 3 branch refs, 2 tags, 0 stashes; unreachable objects: 0
- Output rule: no matched value, user name, e-mail, computer name or home path is written here.

## Verdicts

| # | Category | Verdict |
|---|----------|---------|
| 1 | Secrets by pattern | findings: 1 (plus 24 known fake test values in tests/, 11 placeholders ignored) |
| 2 | .env files and .env.example | no findings |
| 3 | Personal identity in blobs | findings: 78 (kind, file, commit) rows in 18 distinct files; user must judge |
| 4 | Large/binary blobs, unexpected files, .kiro local paths | findings: 2252 |
| 5 | Working tree | findings: 1 |

## 1. Secrets by pattern

Unclassified findings: 1. Known fake test values (path under tests/ and fake-shaped value: contains fake/test/example/dummy/secret/placeholder/sample/mock, a run of x or 0, 1234, abcd, or one repeated character): 24.

| Pattern | Commit | File | Line |
|---|---|---|---|
| generic-credential | 366c2e8 | scripts/spike/envMinimum.ts | 13 |

## 2. .env files

- Env-like or key-like paths ever added or touched in history (templates excluded): 0
- Commits touching exactly .env (git log --all -- .env): 0
- Commits containing .env.example: 25; with a non-empty value: 0

## 3. Personal identity

- Identity sources compared (values not shown): env-USERNAME, env-USERPROFILE, env-HOMEPATH, env-COMPUTERNAME, git-user.name, git-user.email; skipped as too short or empty: none
- Variants searched, case-insensitive: raw, forward slashes, escaped back-slashes, percent-encoded.

One row per source and file, over all commits (and the working tree) that contain a match:

| Source | File | Versions with a match | Newest commit | Max matches in one version |
|---|---|---|---|---|
| env-HOMEPATH | docs/kiro-journal.md | 10 | ec10875 | 13 |
| env-HOMEPATH | tests/proof/unit/identity.test.ts | 2 | ec10875 | 1 |
| env-USERNAME | .kiro/specs/autopsy-engine/design.md | 2 | 8a5e36a | 1 |
| env-USERNAME | .kiro/specs/autopsy-engine/tasks.md | 7 | 7b5581f | 1 |
| env-USERNAME | .kiro/specs/proof-of-life-engine/design.md | 9 | d1cb27f | 2 |
| env-USERNAME | .kiro/specs/proof-of-life-engine/requirements.md | 4 | 75f695a | 1 |
| env-USERNAME | .kiro/specs/proof-of-life-engine/tasks.md | 8 | ec10875 | 1 |
| env-USERNAME | docs/kiro-journal.md | 10 | ec10875 | 13 |
| env-USERNAME | spikes/attest/DECISION.md | 1 | worktree | 12 |
| env-USERNAME | spikes/attest/README.md | 1 | worktree | 17 |
| env-USERNAME | src/engine/sources/depsdev.ts | 1 | f1a7c1e | 6 |
| env-USERNAME | src/engine/sources/github.ts | 1 | f1a7c1e | 10 |
| env-USERNAME | src/engine/sources/npm.ts | 1 | f1a7c1e | 5 |
| env-USERNAME | src/proof/core/identity.ts | 1 | 8a20612 | 1 |
| env-USERNAME | src/proof/shell/treeHash.ts | 1 | 8a20612 | 1 |
| env-USERNAME | tests/engine/fixtures/inflight/github-82243e70e8cd.json | 1 | 2ac4b2d | 2 |
| env-USERNAME | tests/engine/fixtures/ip/github-a1daeafb4c1b.json | 1 | 2ac4b2d | 2 |
| env-USERNAME | tests/engine/fixtures/lodash.set/github-0577e0b4ff3e.json | 1 | 2ac4b2d | 3 |
| env-USERNAME | tests/engine/unit/githubClient.test.ts | 2 | f1a7c1e | 2 |
| env-USERNAME | tests/proof/unit/identity.test.ts | 2 | ec10875 | 5 |
| env-USERPROFILE | docs/kiro-journal.md | 10 | ec10875 | 13 |
| env-USERPROFILE | tests/proof/unit/identity.test.ts | 2 | ec10875 | 1 |

- Distinct author and committer names: 3 (<name-1> .. <name-3>)
- Distinct author and committer e-mail addresses: 2
- E-mail domains: github.com (1), gmail.com (1)
- Personal-looking domains: yes: gmail.com
- History lines using the e-mail from the current git config: 26

## 4. Large blobs and unexpected files

20 largest blobs:

| Blob | Bytes | First path |
|---|---|---|
| aa3158f | 514170 | tests/engine/fixtures/inflight/npm-1c739f1f7040.json |
| d6227ab | 189725 | .kiro/specs/proof-of-life-engine/design.md |
| 68e5c56 | 187899 | .kiro/specs/proof-of-life-engine/design.md |
| ec783e3 | 186156 | .kiro/specs/proof-of-life-engine/design.md |
| 854c888 | 185137 | .kiro/specs/proof-of-life-engine/design.md |
| f8647f1 | 182574 | .kiro/specs/proof-of-life-engine/design.md |
| b34b9b8 | 182013 | .kiro/specs/proof-of-life-engine/design.md |
| 14021d6 | 174852 | .kiro/specs/proof-of-life-engine/design.md |
| 07fe7ca | 161853 | package-lock.json |
| 2c77aa9 | 161819 | package-lock.json |
| 64dbba9 | 159414 | package-lock.json |
| 6fa2173 | 146177 | docs/kiro-journal.md |
| e770120 | 144657 | package-lock.json |
| 7931b17 | 138931 | docs/kiro-journal.md |
| 86a818e | 135451 | docs/kiro-journal.md |
| 7d189eb | 132470 | .kiro/specs/proof-of-life-engine/design.md |
| 2f974e9 | 131046 | docs/kiro-journal.md |
| 770fe89 | 124807 | docs/kiro-journal.md |
| 5afab4d | 109285 | docs/kiro-journal.md |
| 31af374 | 105838 | docs/kiro-journal.md |

- Paths ever in history matching archive/log/build patterns: 1
  - tests/proof/fixtures/lodash.set/lodash.set-4.3.2.tgz (commit d1cb27f)
- Blobs skipped for size: 0
- Paths under .kiro/ ever committed: 16; session-like paths: 0
- Absolute local paths or session ids inside .kiro/ files: 2251 hits
  - absolute local path: .kiro/specs/proof-of-life-engine/design.md, 115 hits in 9 versions, 17 distinct lines (first: 351, 376, 378, 499, 522, 549, 550, 556)
  - absolute local path: .kiro/specs/proof-of-life-engine/requirements.md, 84 hits in 6 versions, 6 distinct lines (first: 267, 286, 294, 306, 314, 319)
  - absolute local path: .kiro/specs/proof-of-life-engine/tasks.md, 48 hits in 8 versions, 2 distinct lines (first: 326, 328)
  - session-id field: .kiro/specs/autopsy-engine/tasks.meta.json, 303 hits in 6 versions, 232 distinct lines (first: 7, 12, 16, 19, 21, 24, 28, 31)
  - session-id field: .kiro/specs/proof-of-life-engine/tasks.meta.json, 1701 hits in 10 versions, 728 distinct lines (first: 7, 12, 17, 19, 24, 29, 31, 36)
- Informational: files outside .kiro/ containing a drive-letter Users path: 30 files (judge: may be test examples)
  - 96529a3 docs/kiro-journal.md (15)
  - d1cb27f docs/kiro-journal.md (14)
  - 0721d16 docs/kiro-journal.md (14)
  - 8a20612 docs/kiro-journal.md (14)
  - 366c2e8 docs/kiro-journal.md (11)
  - 02235d8 docs/kiro-journal.md (15)
  - worktree docs/kiro-journal.md (15)
  - 75f695a docs/kiro-journal.md (14)
  - 52eb99a docs/kiro-journal.md (15)
  - ec10875 docs/kiro-journal.md (15)
  - ec10875 tests/proof/unit/endToEndIdentity.test.ts (3)
  - 8a20612 tests/proof/unit/endToEndIdentity.test.ts (3)
  - ec10875 tests/proof/unit/identity.test.ts (46)
  - 8a20612 tests/proof/unit/identity.test.ts (46)
  - ec10875 tests/proof/unit/identitySafety.test.ts (19)
  - 8a20612 tests/proof/unit/identitySafety.test.ts (19)
  - ec10875 tests/proof/unit/normalize.test.ts (43)
  - 8a20612 tests/proof/unit/normalize.test.ts (43)
  - 75f695a tests/proof/unit/orchestrator.test.ts (1)
  - 8a20612 tests/proof/unit/orchestrator.test.ts (1)
  - 02235d8 tests/proof/unit/orchestrator.test.ts (1)
  - ec10875 tests/proof/unit/orchestrator.test.ts (1)
  - 8a20612 tests/proof/unit/redact.test.ts (14)
  - ec10875 tests/proof/unit/redact.test.ts (14)
  - ec10875 tests/proof/unit/report.test.ts (3)
  - 8a20612 tests/proof/unit/report.test.ts (3)
  - 0721d16 tests/proof/unit/sandboxCommand.test.ts (5)
  - ec10875 tests/proof/unit/sandboxCommand.test.ts (5)
  - 8a20612 tests/proof/unit/tempRootLeak.test.ts (6)
  - ec10875 tests/proof/unit/tempRootLeak.test.ts (6)

## 5. Working tree

- .env is ignored: True; .env is tracked: False
- git status summary: 3 modified/staged, 4 untracked-not-ignored entries, 5 ignored entries
- Ignored entries (names): .env, .next/, next-env.d.ts, node_modules/, tsconfig.tsbuildinfo
- Untracked-not-ignored files: 17
  - .github/workflows/spike-attest.yml
  - .github/workflows/spike-kiro.yml
  - scripts/spike/coroner-candidates.ts
  - spikes/attest/DECISION.md
  - spikes/attest/README.md
  - spikes/candidates/SHORTLIST.md
  - spikes/kiro-agent/FIELDS.md
  - spikes/kiro-agent/README.md
  - spikes/kiro-agent/fixtures/certificate.sample.json
  - spikes/kiro-agent/hooks/pre-tool-write-guard.mjs
  - spikes/kiro-agent/hooks/pre-tool-write-guard.test-cases.json
  - spikes/kiro-agent/hooks/run-cases.mjs
  - spikes/kiro-agent/mcp-stub/server.mjs
  - spikes/kiro-agent/medium.json
  - spikes/kiro-headless/README.md
  - spikes/secret-scan/REPORT.md
  - spikes/secret-scan/scan.ps1
- Modified tracked files: 3
  - .kiro/specs/proof-of-life-engine/tasks.md
  - .kiro/specs/proof-of-life-engine/tasks.meta.json
  - docs/kiro-journal.md
- Sensitive-looking names among untracked-not-ignored: 0; among tracked: 1
  - tests/engine/unit/fixtureSecrets.test.ts
- Uncommitted files content-scanned: 18 (spikes/secret-scan/ excluded; .env never read)

## Recommendations (generated from the verdicts above)

1. Review the 1 unclassified secret-pattern rows in section 1. If any is a real credential: STOP, rotate it first, then choose between (a) rotate and accept the history as is (the revoked value is harmless) or (b) rewrite history with git filter-repo (for example --replace-text or --invert-paths on the file), force-push, and have every clone re-cloned. Not run by this scan.
2. Review section 3: rows naming a home path or computer name are the ones worth fixing going forward (edit the file in a new commit; old versions stay in history). A match on the short user name alone may be a generic word.
3. Commit e-mails with a personal domain become public with the repo. If that is not wanted, set a GitHub no-reply address for new commits (git config user.email <id>+<login>@users.noreply.github.com, and the GitHub setting 'Keep my email addresses private'). Old commits keep the old address unless history is rewritten (git filter-repo --mailmap), which this scan does not recommend without a real secret.
4. Section 4 lists .kiro/ files with session ids or local paths. Decide whether to keep them; for new commits, regenerate or strip those fields. Old versions stay in history.
5. Confirm that each archive/log/build path in section 4 is intended (the recorded lodash.set tarball is a test fixture).

Limits: pattern based, no entropy analysis; text is matched as ISO-8859-1, so non-ASCII UTF-8 identity values and UTF-16 files are not matched; blobs above the size limit are listed, not scanned; no external scanner ran unless listed above.

## Manual triage of this run (hand-written after the scan; not regenerated by the script)

- Section 1, the one unclassified row (scripts/spike/envMinimum.ts line 13, commit 366c2e8): the value is a 32-character lowercase words-and-dashes string assigned to an environment variable named GS_TEST_SECRET. It has the shape of a canary phrase, not a credential. Judged not a real secret; no rotation needed.
- Section 1, other rows: the short values (1 to 7 characters) assigned to GITHUB_TOKEN or a Bearer header in tests/engine/unit/fixtureSecrets.test.ts are placeholders and are ignored by the script.
- Section 3: the user-name hits in src/, tests/engine/fixtures and the specs are most likely the same word used in another sense (a generic English word in GitHub `<home>` data and spec text), not the account name. The home-path and profile hits in docs/kiro-journal.md (10 versions) and tests/proof/unit/identity.test.ts (2 versions) are the ones to judge.
- Section 4: the .kiro/ "absolute local path" rows are not the machine's home path (the home-path identity patterns do not match those files). The session-id rows are the `sessionId`-style fields in the two tasks.meta.json files.
