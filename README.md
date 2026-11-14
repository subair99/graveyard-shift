# Graveyard Shift

**Dead code, raised overnight, with proof you can verify.**

Graveyard Shift finds the abandoned npm packages holding up your app, issues each a cited
Death Certificate, then Kiro agents resurrect them overnight: forked, modernized, CVE-patched,
and proven identical to the original via differential property-based testing, with a signed
Proof of Life.

Built for **Kiroween 2026** · Category: **Resurrection**

- Live demo: _coming soon_
- Demo video: _coming soon_

## How it works
1. **Exhume**: paste a public repo URL or lockfile (no login).
2. **The Crypt**: see which dependencies are dead, with every fact cited to its source.
3. **Death Certificate**: cause and time of death, plus the exact functions your code uses.
4. **The graveyard shift**: Kiro agents (Coroner, Gravedigger, Medium, Undertaker) resurrect the package overnight.
5. **Proof of Life**: a pull request with differential test results and a verifiable signature.

## Quick start
Requires Node.js LTS and npm.

```
npm install
npm run dev     # http://localhost:3000
npm run build
```

Copy `.env.example` to `.env` and fill in `GITHUB_TOKEN` (and `KIRO_API_KEY` for resurrections).

## How Kiro is used
See [`.kiro/`](.kiro/) for specs, steering, hooks and agents. A full write-up will follow.

## Data sources
npm registry · OSV · deps.dev · GitHub REST API

## Pre-existing work
See [PREEXISTING.md](PREEXISTING.md).

## License
MIT