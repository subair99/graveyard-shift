// Side-effect imports of stylesheets (src/app/layout.tsx imports './globals.css').
// Committed so that `npm run typecheck` does not depend on the git-ignored, Next-generated next-env.d.ts.
declare module "*.css";
