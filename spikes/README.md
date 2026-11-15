# Spikes

Throwaway checks that settle open questions before the pipeline specs are written. Written 2026-11-15. Spikes 1, 3, 4, 5, 6 and 8 have been run by the user (results in `docs/kiro-journal.md`). Spikes 2 and 7 were skipped: app.kiro.dev has no "API Keys" page on the user's account, so headless Kiro in Actions is not available and nothing needs the `medium` environment. Delete each spike's files when it is done.

| Spike | Purpose | Files | Who runs it | Status |
|---|---|---|---|---|
| 1 secret scan | Look for secrets and personal identity items in all commits before the repo goes public | `spikes/secret-scan/` | Agent ran the scan; user reads `REPORT.md` and decides | Run by the user; re-run done |
| 2 headless Kiro | Check that Kiro CLI headless mode works in GitHub Actions with an API key, and what one call costs in credits | `spikes/kiro-headless/` (docs only; `.github/workflows/spike-kiro.yml` removed) | User | Skipped, unavailable: no "API Keys" page at app.kiro.dev on the user's account |
| 3 custom agent | Check the draft Medium agent, a read-only MCP stub and the write guard hook | `spikes/kiro-agent/` | User, in WSL | Run by the user 15 Nov 2026; results in `docs/kiro-journal.md` |
| 4 attestation | Attest a dummy file with a custom predicate and verify it, online and offline | `.github/workflows/spike-attest.yml`, `spikes/attest/` | User | Run by the user 15 Nov 2026; verification succeeded and the tamper check failed as expected; results in `spikes/attest/README.md` and `docs/kiro-journal.md` |
| 5 local WSL mode | Check the Medium running locally in WSL and pushing to `resurrect/<package>` | No files | User | Run by the user 15 Nov 2026; results in `docs/kiro-journal.md` |
| 6 Coroner candidates | Pick packages for the Coroner and check the `ip` control | `scripts/spike/coroner-candidates.ts`, `spikes/candidates/` | User runs the script; shortlist read from docs | Run by the user |
| 7 GitHub settings | Set up the repository settings the pipeline needs (for example the `medium` environment and its secret) | No files | User | Skipped: nothing needs the `medium` environment |
| 8 npm org (stretch) | Create the `@graveyard-shift` npm org for publishing | No files | User | Done: the user created the `@graveyard-shift` npm org |

## Notes
- A workflow can be dispatched only after it is on the default branch (`main`). Merge it first, then run it from the Actions tab or with `gh workflow run <file> --ref main`.
- `spike-attest` needs a public repository. GitHub Free supports attestations on public repositories only.
- Every third-party action in the spike workflows is pinned to a full commit SHA.
