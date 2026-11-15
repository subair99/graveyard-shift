# Spike 4: attest a dummy file with a custom predicate

Throwaway. Background and choice of action: `DECISION.md`. Workflow: `.github/workflows/spike-attest.yml`.

## Before you start

- The repository must be **public** (GitHub Free supports attestations on public repositories only).
- The workflow file must be on the **default branch** (for example `main`) to be dispatchable. Commit and push `.github/workflows/spike-attest.yml` there.
- `gh` version **2.67.0 or later** (`gh --version`). Older versions have a bug where verify can succeed with no attestations.
- Logged in: `gh auth status`.

Replace `<owner>/<repo>` below with your repository.

## 1. Dispatch

UI: Actions > spike-attest > Run workflow.

CLI:

```powershell
gh workflow run spike-attest.yml --ref main --repo <owner>/<repo>
gh run list --workflow spike-attest.yml --repo <owner>/<repo> --limit 1
gh run watch <run-id> --repo <owner>/<repo>
```

Expected: jobs `build` and `attest` succeed. The run summary shows the attestation link and the verify commands.

## 2. Download

```powershell
gh run download <run-id> --repo <owner>/<repo> -n spike-attest-result -D spike-attest-result
cd spike-attest-result
dir
```

Expected files: `dummy.txt`, `attestation.sigstore.json`.

## 3. Verify (online)

```powershell
gh attestation verify dummy.txt --repo <owner>/<repo> --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --format json
```

Also with the signer workflow pinned:

```powershell
gh attestation verify dummy.txt --repo <owner>/<repo> --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --signer-workflow <owner>/<repo>/.github/workflows/spike-attest.yml --format json
```

Only the predicate:

```powershell
gh attestation verify dummy.txt --repo <owner>/<repo> --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --format json --jq '.[].verificationResult.statement.predicate'
```

Expected: exit code 0 (`echo $LASTEXITCODE`), and the predicate shows `spike: true`, `medium.mode: local`, `sha256OfDummy` equal to `(Get-FileHash dummy.txt -Algorithm SHA256).Hash` (case aside), `createdBy: spike-attest.yml`.

## 4. Failing case (one byte changed)

```powershell
Copy-Item dummy.txt dummy-tampered.txt
$b = [IO.File]::ReadAllBytes("dummy-tampered.txt")
$b[0] = $b[0] -bxor 1
[IO.File]::WriteAllBytes("dummy-tampered.txt", $b)
gh attestation verify dummy-tampered.txt --repo <owner>/<repo> --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --format json
echo $LASTEXITCODE
```

Expected: an error that no attestation was found for the file's digest, and a non-zero exit code.

Wrong predicate type (should also fail):

```powershell
gh attestation verify dummy.txt --repo <owner>/<repo>
echo $LASTEXITCODE
```

This uses the default SLSA type, which this attestation does not have.

## 5. Offline verification

```powershell
gh attestation trusted-root > trusted_root.jsonl
gh attestation verify dummy.txt --repo <owner>/<repo> --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --bundle attestation.sigstore.json --custom-trusted-root trusted_root.jsonl --format json
echo $LASTEXITCODE
```

Note: the trusted root file written with `>` in Windows PowerShell 5.1 may be UTF-16. If verify reports it cannot read the file, regenerate it with PowerShell 7 or `cmd /c "gh attestation trusted-root > trusted_root.jsonl"`.

Also try the bundle fetched from the GitHub API:

```powershell
gh attestation download dummy.txt --repo <owner>/<repo>
```

and verify with the `sha256:<digest>.jsonl` file it writes as `--bundle`.

Check the repository ID in the certificate against the live repository:

```powershell
gh api repos/<owner>/<repo> --jq .id
gh attestation verify dummy.txt --repo <owner>/<repo> --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --bundle attestation.sigstore.json --custom-trusted-root trusted_root.jsonl --format json --jq '.[].verificationResult.signature.certificate.sourceRepositoryIdentifier'
```

## 6. Paste back

- `gh --version` first line.
- Whether both jobs passed, and any warning in the `attest` job log (especially about `artifact-metadata`). Do not paste tokens.
- The full JSON output of step 3 (first command); it holds no secrets.
- Exit code and error text of the two failing cases in step 4.
- Output and exit code of step 5 (offline) and the two repository IDs.
- Run URL and attestation URL.

## What verification proves and what it does not

Proves: the file you hold has the SHA-256 that a run of `<owner>/<repo>` (and the pinned workflow, if `--signer-workflow` is used) signed together with the predicate, through Sigstore. The certificate and timestamps are not controlled by the workflow.

Does not prove: that the predicate content is true (the workflow author writes it), that the code in the workflow is benign, or, in offline mode, that `<owner>/<repo>` is still the same repository today (use the repository ID check). It says nothing here about differential test results; the real Proof of Life needs the proof report digest in the predicate and a way to re-run the proof.

## Results (user-run, 15 Nov 2026)

Run by the user; copied from the user's report, not re-measured by an agent.

- Run: `spike-attest` run 43759217625 succeeded (build 3 s, attest 9 s).
- `gh` version: 2.104.0 (the user downloaded the artifacts with it).
- Verify command run on the unmodified `dummy.txt`:
  `gh attestation verify .\spike-attest-result\dummy.txt --repo subair99/graveyard-shift --predicate-type https://graveyard-shift.dev/attestation/spike/v1 --signer-workflow subair99/graveyard-shift/.github/workflows/spike-attest.yml`
  - Result: "Verification succeeded!" for digest `sha256:20c719271a03263ac82c7a4f64de88462e4c3b9763b77794711125b172c059ac`, signer workflow `.github/workflows/spike-attest.yml@refs/heads/main`, OIDC issuer `token.actions.githubusercontent.com`.
- Modified file (one line appended to `dummy.txt`; this is not the one-byte change of step 4):
  - New digest `sha256:8c93c519c34c5c99cc9e104a5519dc01c69b846e6955060fd53dccf653fe5049`.
  - Output: "Loading attestations from GitHub API failed", HTTP 404.
  - The user's reading: tampering is detected, because the changed file has no attestation for its digest.
  - Exit code: not provided. Exact JSON: not provided (the first command was run without `--format json`, as pasted).
- Annotation seen on the run: `ubuntu-latest` will migrate to Ubuntu 26. Both workflows (`ci.yml`, `spike-attest.yml`) now pin `ubuntu-24.04`.
- Permissions the `attest` job granted in `spike-attest.yml` (the run succeeded with exactly this set): `id-token: write`, `attestations: write`, `contents: read`. The `build` job granted `contents: read`; the workflow-level default is `permissions: {}`. `artifact-metadata: write` was **not** in the file.
- Not provided / not run: the wrong-predicate-type case, offline verification (`--bundle`, `--custom-trusted-root`), the repository ID check, the JSON field names, and any warning text in the `attest` job log.

## Cleanup

Delete `.github/workflows/spike-attest.yml` and `spikes/attest/` when done. Attestations remain in the repository's attestation list; see https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/manage-attestations to delete them.
