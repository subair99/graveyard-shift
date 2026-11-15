# Secret scan report

- Date: 2026-11-15 20:02:40 +01:00
- Git HEAD: 1692f15
- Command: `powershell -NoProfile -File spikes/secret-scan/scan.ps1` (from the repository root; `pwsh spikes/secret-scan/scan.ps1` also works where PowerShell 7 is installed)
- Scan duration: 19 s
- External scanners used: none installed (gitleaks, trufflehog not found); built-in patterns only
- Coverage: 27 commits (all refs, reflog, unreachable), 568 distinct blobs (568 scanned, 1 binary-looking, 0 skipped as larger than 5242880 bytes), commit messages, 0 uncommitted working-tree files
- Branches/tags/stashes: 3 branch refs, 2 tags, 0 stashes; unreachable objects: 0
- Output rule: no matched value, user name, e-mail, computer name or home path is written here.

## Verdicts

| # | Category | Verdict |
|---|----------|---------|
| 1 | Secrets by pattern | findings: 2 (plus 24 known fake test values in tests/, 11 placeholders ignored) |
| 2 | .env files and .env.example | no findings |
| 3 | Personal identity in blobs | findings: 75 (kind, file, commit) rows in 18 distinct files; user must judge |
| 4 | Large/binary blobs, unexpected files, .kiro local paths | findings: 2263 |
| 5 | Working tree | findings: 3 |

## 1. Secrets by pattern

Unclassified findings: 2. Known fake test values (path under tests/ and fake-shaped value: contains fake/test/example/dummy/secret/placeholder/sample/mock, a run of x or 0, 1234, abcd, or one repeated character): 24.

| Pattern | Commit | File | Line |
|---|---|---|---|
| aws-secret-key-name | 1692f15 | spikes/secret-scan/scan.ps1 | 85 |
| generic-credential | 366c2e8 | scripts/spike/envMinimum.ts | 13 |

## 2. .env files

- Env-like or key-like paths ever added or touched in history (templates excluded): 0
- Commits touching exactly .env (git log --all -- .env): 0
- Commits containing .env.example: 26; with a non-empty value: 0

## 3. Personal identity

- Identity sources compared (values not shown): env-USERNAME, env-USERPROFILE, env-HOMEPATH, env-COMPUTERNAME, git-user.name, git-user.email; skipped as too short or empty: none
- Variants searched, case-insensitive: raw, forward slashes, escaped back-slashes, percent-encoded.

One row per source and file, over all commits (and the working tree) that contain a match:

| Source | File | Versions with a match | Newest commit | Max matches in one version |
|---|---|---|---|---|
| env-HOMEPATH | docs/kiro-journal.md | 9 | ec10875 | 13 |
| env-HOMEPATH | tests/proof/unit/identity.test.ts | 2 | 8a20612 | 1 |
| env-USERNAME | .kiro/specs/autopsy-engine/design.md | 2 | 8a5e36a | 1 |
| env-USERNAME | .kiro/specs/autopsy-engine/tasks.md | 7 | 7b5581f | 1 |
| env-USERNAME | .kiro/specs/proof-of-life-engine/design.md | 9 | d1cb27f | 2 |
| env-USERNAME | .kiro/specs/proof-of-life-engine/requirements.md | 4 | 75f695a | 1 |
| env-USERNAME | .kiro/specs/proof-of-life-engine/tasks.md | 8 | ec10875 | 1 |
| env-USERNAME | docs/kiro-journal.md | 9 | ec10875 | 13 |
| env-USERNAME | spikes/attest/DECISION.md | 1 | 1692f15 | 12 |
| env-USERNAME | spikes/attest/README.md | 1 | 1692f15 | 17 |
| env-USERNAME | src/engine/sources/depsdev.ts | 1 | f1a7c1e | 6 |
| env-USERNAME | src/engine/sources/github.ts | 1 | f1a7c1e | 10 |
| env-USERNAME | src/engine/sources/npm.ts | 1 | f1a7c1e | 5 |
| env-USERNAME | src/proof/core/identity.ts | 1 | 8a20612 | 1 |
| env-USERNAME | src/proof/shell/treeHash.ts | 1 | 8a20612 | 1 |
| env-USERNAME | tests/engine/fixtures/inflight/github-82243e70e8cd.json | 1 | 2ac4b2d | 2 |
| env-USERNAME | tests/engine/fixtures/ip/github-a1daeafb4c1b.json | 1 | 2ac4b2d | 2 |
| env-USERNAME | tests/engine/fixtures/lodash.set/github-0577e0b4ff3e.json | 1 | 2ac4b2d | 3 |
| env-USERNAME | tests/engine/unit/githubClient.test.ts | 2 | 02235d8 | 2 |
| env-USERNAME | tests/proof/unit/identity.test.ts | 2 | 8a20612 | 5 |
| env-USERPROFILE | docs/kiro-journal.md | 9 | ec10875 | 13 |
| env-USERPROFILE | tests/proof/unit/identity.test.ts | 2 | 8a20612 | 1 |

- Distinct author and committer names: 3 (<name-1> .. <name-3>)
- Distinct author and committer e-mail addresses: 3
- E-mail domains: github.com (1), gmail.com (1), users.noreply.github.com (1)
- Personal-looking domains: yes: gmail.com
- History lines using the e-mail from the current git config: 1

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
| f66501a | 156892 | docs/kiro-journal.md |
| 6fa2173 | 146177 | docs/kiro-journal.md |
| e770120 | 144657 | package-lock.json |
| 7931b17 | 138931 | docs/kiro-journal.md |
| 86a818e | 135451 | docs/kiro-journal.md |
| 7d189eb | 132470 | .kiro/specs/proof-of-life-engine/design.md |
| 2f974e9 | 131046 | docs/kiro-journal.md |
| 770fe89 | 124807 | docs/kiro-journal.md |
| 5afab4d | 109285 | docs/kiro-journal.md |

- Paths ever in history matching archive/log/build patterns: 1
  - tests/proof/fixtures/lodash.set/lodash.set-4.3.2.tgz (commit d1cb27f)
- Blobs skipped for size: 0
- Paths under .kiro/ ever committed: 16; session-like paths: 0
- Absolute local paths or session ids inside .kiro/ files: 2262 hits
  - absolute local path: .kiro/specs/proof-of-life-engine/design.md, 115 hits in 9 versions, 17 distinct lines (first: 351, 376, 378, 499, 522, 549, 550, 556)
  - absolute local path: .kiro/specs/proof-of-life-engine/requirements.md, 84 hits in 6 versions, 6 distinct lines (first: 267, 286, 294, 306, 314, 319)
  - absolute local path: .kiro/specs/proof-of-life-engine/tasks.md, 48 hits in 8 versions, 2 distinct lines (first: 326, 328)
  - session-id field: .kiro/specs/autopsy-engine/tasks.meta.json, 303 hits in 6 versions, 232 distinct lines (first: 7, 12, 16, 19, 21, 24, 28, 31)
  - session-id field: .kiro/specs/proof-of-life-engine/tasks.meta.json, 1712 hits in 10 versions, 729 distinct lines (first: 7, 12, 17, 19, 24, 29, 31, 36)
- Informational: files outside .kiro/ containing a drive-letter Users path: 31 files (judge: may be test examples)
  - 0721d16 docs/kiro-journal.md (14)
  - 52eb99a docs/kiro-journal.md (15)
  - 366c2e8 docs/kiro-journal.md (11)
  - 1692f15 docs/kiro-journal.md (2)
  - 8a20612 docs/kiro-journal.md (14)
  - 75f695a docs/kiro-journal.md (14)
  - 02235d8 docs/kiro-journal.md (15)
  - d1cb27f docs/kiro-journal.md (14)
  - ec10875 docs/kiro-journal.md (15)
  - 96529a3 docs/kiro-journal.md (15)
  - 8a20612 tests/proof/unit/endToEndIdentity.test.ts (3)
  - ec10875 tests/proof/unit/endToEndIdentity.test.ts (3)
  - 8a20612 tests/proof/unit/identity.test.ts (46)
  - ec10875 tests/proof/unit/identity.test.ts (46)
  - 1692f15 tests/proof/unit/identity.test.ts (46)
  - ec10875 tests/proof/unit/identitySafety.test.ts (19)
  - 8a20612 tests/proof/unit/identitySafety.test.ts (19)
  - 8a20612 tests/proof/unit/normalize.test.ts (43)
  - ec10875 tests/proof/unit/normalize.test.ts (43)
  - ec10875 tests/proof/unit/orchestrator.test.ts (1)
  - 75f695a tests/proof/unit/orchestrator.test.ts (1)
  - 02235d8 tests/proof/unit/orchestrator.test.ts (1)
  - 8a20612 tests/proof/unit/orchestrator.test.ts (1)
  - ec10875 tests/proof/unit/redact.test.ts (14)
  - 8a20612 tests/proof/unit/redact.test.ts (14)
  - ec10875 tests/proof/unit/report.test.ts (3)
  - 8a20612 tests/proof/unit/report.test.ts (3)
  - 0721d16 tests/proof/unit/sandboxCommand.test.ts (5)
  - ec10875 tests/proof/unit/sandboxCommand.test.ts (5)
  - 8a20612 tests/proof/unit/tempRootLeak.test.ts (6)
  - ec10875 tests/proof/unit/tempRootLeak.test.ts (6)

## 5. Working tree

- .env is ignored: True; .env is tracked: False
- git status summary: 0 modified/staged, 0 untracked-not-ignored entries, 5 ignored entries
- Ignored entries (names): .env, .next/, next-env.d.ts, node_modules/, tsconfig.tsbuildinfo
- Untracked-not-ignored files: 0
- Modified tracked files: 0
- Sensitive-looking names among untracked-not-ignored: 0; among tracked: 3
  - spikes/secret-scan/REPORT.md
  - spikes/secret-scan/scan.ps1
  - tests/engine/unit/fixtureSecrets.test.ts
- Uncommitted files content-scanned: 0 (spikes/secret-scan/ excluded; .env never read)

## Recommendations (generated from the verdicts above)

1. Review the 2 unclassified secret-pattern rows in section 1. If any is a real credential: STOP, rotate it first, then choose between (a) rotate and accept the history as is (the revoked value is harmless) or (b) rewrite history with git filter-repo (for example --replace-text or --invert-paths on the file), force-push, and have every clone re-cloned. Not run by this scan.
2. Review section 3: rows naming a home path or computer name are the ones worth fixing going forward (edit the file in a new commit; old versions stay in history). A match on the short user name alone may be a generic word.
3. Commit e-mails with a personal domain become public with the repo. If that is not wanted, set a GitHub no-reply address for new commits (git config user.email <id>+<login>@users.noreply.github.com, and the GitHub setting 'Keep my email addresses private'). Old commits keep the old address unless history is rewritten (git filter-repo --mailmap), which this scan does not recommend without a real secret.
4. Section 4 lists .kiro/ files with session ids or local paths. Decide whether to keep them; for new commits, regenerate or strip those fields. Old versions stay in history.
5. Confirm that each archive/log/build path in section 4 is intended (the recorded lodash.set tarball is a test fixture).

Limits: pattern based, no entropy analysis; text is matched as ISO-8859-1, so non-ASCII UTF-8 identity values and UTF-16 files are not matched; blobs above the size limit are listed, not scanned; no external scanner ran unless listed above.
