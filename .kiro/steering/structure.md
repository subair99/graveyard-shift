# Structure

## Current layout
```
.kiro/steering/   Steering rules (product.md, tech.md, structure.md)
src/app/          Next.js App Router: layout.tsx and page.tsx (minimal)
src/engine/types.ts  Shared engine types, zod schemas (certificate, upstream responses), Result helper
tests/engine/unit/  Engine unit tests (types.test.ts)
package.json      Scripts and dependencies (npm)
tsconfig.json     TypeScript config (strict)
next.config.mjs   Next.js config
docs/             Project docs (demo-packages.md)
.env.example      Documented environment variables (committed)
.env              Local secrets (gitignored, never commit)
README.md         Project overview and flow
PREEXISTING.md    Third-party libraries and data sources
LICENSE           MIT
```
Specs, hooks, and agents are planned under `.kiro/` (see README). Only `src/app` exists so far; engine code goes in `src/engine/` and tests in `tests/` (see the autopsy-engine spec).

## Guidelines
- Put Kiro specs, hooks, and agent definitions in `.kiro/`, not at the repo root.
- When adding source code, update this file with the new layout.
- Keep the four agent roles (Coroner, Gravedigger, Medium, Undertaker) as distinct units of code or config, not one merged module.
- Update `README.md` quick start when setup steps exist.
- Update `PREEXISTING.md` when adding a third-party library or data source.
