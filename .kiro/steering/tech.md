# Tech

## Stack (decided)
- Next.js + TypeScript (strict mode) for the web app ("The Crypt") and API routes.
- Node.js LTS; npm as package manager.
- fast-check for property-based and differential testing.
- ts-morph for static analysis (Haunting Radius).
- The autopsy engine is deterministic: no LLM calls. Facts come only from the npm registry, OSV, deps.dev and the GitHub REST API, each stored with its source URL and fetch date.
- Resurrections run via Kiro CLI headless mode in GitHub Actions; results are signed with GitHub Artifact Attestations.

## Known external dependencies
- Data sources: npm registry, OSV, deps.dev, GitHub REST API.
- Target ecosystem: npm packages and lockfiles.
- Testing approach: differential property-based testing, comparing the resurrected package against the original.
- Output: signed, verifiable Proof of Life attached to a pull request.

## Configuration
- Secrets live in `.env` (gitignored). Variables are documented in `.env.example`: `GITHUB_TOKEN`, `KIRO_API_KEY`.
- Never commit, log, or print secret values. Add any new variable to `.env.example` with an empty value.

## Commands
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: not defined yet (added with vitest in the autopsy-engine spec, task 1.2)

## Conventions
- License is MIT. Keep dependencies MIT-compatible.
- Environment is Windows with PowerShell. Use PowerShell-compatible commands, or cross-platform scripts.
