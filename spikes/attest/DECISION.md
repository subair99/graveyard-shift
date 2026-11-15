# Spike 4: which attestation action

Research date (fetch date for every source below): 2026-11-15.
Status: research only. Nothing in this file has been run yet; see "To verify".

## Decision

Use **`actions/attest`** (pinned `v4.2.2`) for the Graveyard Shift pipeline.

Reasons:

1. **Custom predicate.** `actions/attest` accepts `predicate-type` plus `predicate` or `predicate-path` (up to 16 MB). The Proof of Life needs its own fields: original integrity, resurrection Tree_Hash, tarball digest, proof report digest, certificate digest, verdict, seed, medium mode (`headless-actions` or `local`). `actions/attest-build-provenance` cannot carry these.
2. **`attest-build-provenance` is a wrapper.** Since v4 it only wraps `actions/attest` and generates SLSA provenance. Its README says existing users may keep it and new implementations should use `actions/attest`.
3. **SLSA provenance comes for free if wanted.** `actions/attest` with no predicate inputs generates SLSA build provenance, so a second step with the same action can add it. For the spike one predicate is enough. For the pipeline, decide later whether the SLSA statement adds value. It would say "this workflow built this tarball", which the custom predicate can also say through the signer identity in the certificate.
4. **Maintenance.** Both repositories had a v4.2.2 release in August 2026 (attest: 2026-08-04, attest-build-provenance: 2026-08-06), both marked immutable. GitHub's own docs now point to `actions/attest`.

## Sources (fetched 2026-11-15)

- https://raw.githubusercontent.com/actions/attest/main/README.md
- https://raw.githubusercontent.com/actions/attest/v4.2.2/action.yml
- https://raw.githubusercontent.com/actions/attest-build-provenance/main/README.md
- https://api.github.com/repos/actions/attest/releases/latest (v4.2.2, published 2026-08-04)
- https://api.github.com/repos/actions/attest-build-provenance/releases/latest (v4.2.2, published 2026-08-06; release notes repeat the "new implementations should use actions/attest" note)
- https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline
- https://cli.github.com/manual/gh_attestation_verify

## `actions/attest` facts (README main and action.yml at v4.2.2)

| Topic | Fact |
| --- | --- |
| Modes | Provenance (no predicate inputs, SLSA), SBOM (`sbom-path`), Custom (`predicate-type` with `predicate` or `predicate-path`). |
| Subject inputs | `subject-path` (glob or list, max 1024 subjects), `subject-digest` + `subject-name` (digest form `sha256:<hex>`), `subject-checksums`. At most one of the three. With none, subjects come from `$GITHUB_ARTIFACTS_LIST`. |
| Predicate inputs | `predicate-type` (required with `predicate` or `predicate-path`), exactly one of `predicate` / `predicate-path`. Cannot be combined with `sbom-path`. |
| Predicate limit | 16 MB (string or file). |
| Other inputs | `push-to-registry` (default false; single OCI image subject), `create-storage-record` (default true, needs push-to-registry), `subject-version`, `show-summary` (default true), `github-token`. |
| Outputs | `bundle-path` (absolute path to the Sigstore bundle JSON), `attestation-id`, `attestation-url`, `storage-record-ids`. |
| Runtime | `node24`. |
| Permissions (README) | `id-token: write`, `attestations: write`, `artifact-metadata: write` (README says the last is for the artifact storage record). The GitHub docs page lists `id-token: write`, `contents: read`, `attestations: write` for binaries, plus `packages: write` for container images. The docs page says storage records are created only when `push-to-registry` is true and `artifact-metadata: write` is present. |
| Signing | Public repository: Sigstore public-good instance. Private/internal: GitHub's Sigstore instance. |
| Plan | Public repositories on all current plans. Private/internal repositories need GitHub Enterprise Cloud. Not on Enterprise Server. (attest-build-provenance README adds: Free, Pro and Team are public only.) |

`actions/attest-build-provenance` v4: SLSA build provenance only, no custom predicate. The README no longer documents inputs and refers to `actions/attest`.

Decision on `artifact-metadata: write`: the spike workflow does not grant it (no registry push, so no storage record). If the run fails or warns about that permission, add it to the `attest` job and record it here. Marked "to verify".

## `gh attestation verify` facts (manual, fetched 2026-11-15)

- Default predicate type is `https://slsa.dev/provenance/v1`. For a custom predicate you must pass `--predicate-type`.
- One of `--owner` or `--repo` is required. The manual recommends also pinning the signer workflow (`--signer-workflow` or `--cert-identity`).
- Options relevant to us: `--predicate-type`, `-R/--repo`, `-o/--owner`, `--signer-workflow [host/]<owner>/<repo>/<path>`, `--signer-repo`, `--signer-digest`, `--source-ref`, `--source-digest`, `--cert-oidc-issuer` (default `https://token.actions.githubusercontent.com`), `--format json`, `-q/--jq`, `-b/--bundle` (offline), `--custom-trusted-root`, `--deny-self-hosted-runners`, `-L/--limit` (default 30).
- JSON output: an array, one entry per verified attestation, each with `attestation` (bundle) and `verificationResult` containing `signature.certificate`, `verifiedTimestamps` and `statement` (`subject`, `predicateType`, `predicate`).
- Only `signature.certificate` and `verifiedTimestamps` cannot be forged by the workflow. `statement.predicate` is controlled by whoever controls the workflow run.
- Offline: `gh attestation download <file> -R <owner/repo>` writes `sha256:<digest>.jsonl`; `gh attestation trusted-root > trusted_root.jsonl`; then `gh attestation verify <file> -R <owner/repo> --bundle <file>.jsonl --custom-trusted-root trusted_root.jsonl`. With `--bundle`, the repo/owner name is compared only against the names in the certificate at signing time. The docs suggest comparing `signature.certificate.sourceRepositoryIdentifier` with `gh api repos/<owner>/<repo> --jq .id`.

Minimum `gh` version: the attestation command exists from 2.49.0 (Marketplace page for attest-build-provenance says verification requires 2.49.0 or later; https://github.com/marketplace/actions/generate-build-provenance). A bug (CVE-2025-25204) in versions 2.49.0 up to but excluding 2.67.0 makes `gh attestation verify` return exit status 0 when no attestations are present (https://github.com/microsoft/AzureLinuxVulnerabilityData/blob/main/osv/AZL-56885.json, https://www.sentinelone.com/vulnerability-database/cve-2025-25204/; search snippets only, advisory page not read). **Require `gh` >= 2.67.0** and check the JSON output rather than only the exit code.

## Pinned SHAs

Method: for each tag, `GET https://api.github.com/repos/<owner>/<repo>/git/ref/tags/<tag>` on 2026-11-15. All three returned `object.type = "commit"` (lightweight tags), so no dereference through `/git/tags/<sha>` was needed. The tag names are the `tag_name` of each repository's `releases/latest`.

| Action | Tag | Commit SHA | URL |
| --- | --- | --- | --- |
| actions/attest | v4.2.2 | `1e69f48acb82d1966a394da916b4c1698aa569d6` | https://api.github.com/repos/actions/attest/git/ref/tags/v4.2.2 |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v7.0.2 |
| actions/download-artifact | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | https://api.github.com/repos/actions/download-artifact/git/ref/tags/v8.0.2 |

Majors: the latest release of upload-artifact is v7 and of download-artifact is v8. The two repositories release together and use different major numbers. Same major number is not possible. These are the current latest of each, which GitHub ships as a pair.

Not checked: that the SHAs are reachable from each repository's default branch (a tag can point to a commit off the branch). To verify with `git merge-base --is-ancestor` or the compare API.

## How a stranger verifies

Requirements: `gh` >= 2.67.0, a copy of the artifact, network access (online mode).

```bash
gh --version   # must be 2.67.0 or later
gh attestation verify dummy.txt \
  --repo <owner>/<repo> \
  --predicate-type https://graveyard-shift.dev/attestation/spike/v1 \
  --signer-workflow <owner>/<repo>/.github/workflows/spike-attest.yml \
  --format json
```

Expected output shape: exit code 0, a JSON array with one object:

```json
[
  {
    "attestation": { "bundle": { "...": "Sigstore bundle" } },
    "verificationResult": {
      "signature": { "certificate": { "sourceRepositoryURI": "https://github.com/<owner>/<repo>", "...": "..." } },
      "verifiedTimestamps": [ { "...": "..." } ],
      "statement": {
        "subject": [ { "name": "dummy.txt", "digest": { "sha256": "<hex>" } } ],
        "predicateType": "https://graveyard-shift.dev/attestation/spike/v1",
        "predicate": { "spike": true, "medium": { "mode": "local" }, "sha256OfDummy": "<hex>", "createdBy": "spike-attest.yml" }
      }
    }
  }
]
```

The exact field names under `signature.certificate` are to verify against a real run. The `subject.name` value is expected to be the file's base name; to verify.

If any byte of `dummy.txt` changes, no attestation matches its digest and the command exits non-zero with a "no attestations found" style error. The exact message is to verify.

Offline: see README.md in this folder.

## What this proves and does not prove

Proves: a workflow run of the named repository (and, with `--signer-workflow`, the named workflow file) signed a statement that links the file's SHA-256 to the predicate; the signing certificate and timestamps come from Sigstore, not from the workflow.

Does not prove: that the predicate content is true. The workflow author writes it. The Proof of Life must therefore also be checkable by re-running the proof engine on the tarball, and the predicate should carry digests that let a stranger do that.

## To verify (after the user's run)

1. Run succeeds without `artifact-metadata: write`.
2. Real JSON field names and `subject.name`.
3. Failure message and exit code for a modified file.
4. Offline verification with `--bundle` and `--custom-trusted-root` on the downloaded `attestation.sigstore.json` (a single-bundle file; the offline doc shows `.jsonl` from `gh attestation download`; the manual says `--bundle` accepts a single bundle JSON or JSON lines).
5. Whether `--signer-workflow` accepts `<owner>/<repo>/.github/workflows/spike-attest.yml` without a ref, as the manual's format suggests.
6. SHAs reachable from default branches.
7. Whether the attest-build-provenance and attest repositories document anything about a predicate size below 16 MB in practice (not tested).
