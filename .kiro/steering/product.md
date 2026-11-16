# Product

Graveyard Shift finds abandoned npm packages that an app depends on, issues each a cited "Death Certificate", and resurrects them on demand. The Medium is the only Kiro agent and runs on the user's machine; the Coroner, the Gravedigger and the Undertaker are deterministic code. A resurrected package is forked, modernized, CVE-patched, and shown to behave identically to the original through differential property-based testing. CI re-runs the Coroner and the Gravedigger, runs the Proof of Life, attests only an `alive` verdict and opens the pull request with a signed "Proof of Life". A nightly CI job re-verifies every committed result without an LLM and without credits. Built for Kiroween 2026 (category: Resurrection).

## User flow
1. **Exhume**: user pastes a public repo URL or lockfile (no login).
2. **The Crypt**: lists dependencies and which are dead.
3. **Death Certificate**: cause and time of death, plus the exact functions the user's code uses.
4. **The graveyard shift**: the Medium (the only Kiro agent, run on demand on the user's machine) writes the resurrection. The Coroner, the Gravedigger and the Undertaker are deterministic code: CI re-runs the Coroner and the Gravedigger, runs the Proof of Life, attests only an `alive` verdict and opens the pull request. A nightly job re-verifies every committed result without an LLM.
5. **Proof of Life**: PR with differential test results and a verifiable signature.

## Rules
- Every fact shown to the user must cite its source (npm registry, OSV, deps.dev, GitHub REST API). Don't present uncited claims.
- Resurrection claims must be backed by test evidence, not assertion.
- Keep the Halloween theme in user-facing naming (Crypt, Death Certificate, Proof of Life). Keep code and docs plain.
- New third-party libraries and data sources go into `PREEXISTING.md`.
- MVP scope: npm only, utility-sized packages (under ~5,000 lines), MIT/ISC/BSD/Apache-2.0 licenses only.
