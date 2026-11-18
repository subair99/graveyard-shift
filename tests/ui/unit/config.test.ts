// Requirements: 1.2, 1.4, 1.7, 1.8, 11.5
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_PATH } from "../../../src/ui/core/site";

const root = join(__dirname, "..", "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("Crypt UI configuration", () => {
  it("exports a static site under the Base_Path with trailing slashes (1.2)", async () => {
    const mod = (await import(pathToUrl(join(root, "next.config.mjs")))) as { default: Record<string, unknown> };
    const config = mod.default;
    expect(config.basePath).toBe(BASE_PATH);
    expect(config.output).toBe("export");
    expect(config.trailingSlash).toBe(true);
    expect(config.reactStrictMode).toBe(true);
    expect(config).not.toHaveProperty("serverExternalPackages");
  });

  it("changes only the build and start scripts (1.7, 1.8)", () => {
    expect(pkg.scripts.build).toBe("next build && tsx scripts/ui/copyEntryFiles.ts");
    expect(pkg.scripts.start).toBe("node scripts/ui/startNotice.mjs");
    expect(pkg.scripts.dev).toBe("next dev");
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
    expect(pkg.scripts.lint).toBe("eslint src tests scripts");
  });

  it("keeps the dependency names unchanged (1.8)", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["next", "react", "react-dom", "semver", "tar", "zod"]);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      "@babel/core",
      "@babel/eslint-parser",
      "@babel/parser",
      "@babel/preset-typescript",
      "@eslint/js",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "@types/semver",
      "eslint",
      "fast-check",
      "tsx",
      "typescript",
      "vitest",
      "yaml",
    ]);
  });

  it("ignores the build output and the nightly download (11.5)", () => {
    const lines = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/);
    expect(lines).toContain("/out/");
    expect(lines).toContain("/.crypt-nightly/");
  });

  it("startNotice.mjs exits 1 with the notice on standard error and prints nothing else (1.7)", () => {
    const r = spawnSync(process.execPath, [join(root, "scripts", "ui", "startNotice.mjs")], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("`npm run start` does not serve the Crypt_Site.");
    expect(r.stderr).toContain("npm run dev");
    expect(r.stderr).toContain("http://localhost:3000/graveyard-shift/");
    expect(r.stderr).toContain("`out/`");
  });

  it("declares *.css in a committed file that tsconfig includes, so typecheck does not need next-env.d.ts", () => {
    const decl = readFileSync(join(root, "src", "types", "assets.d.ts"), "utf8");
    expect(decl).toMatch(/^declare module "\*\.css";$/m);
    // tsconfig.json may carry comments; strip them outside strings before parsing.
    const raw = readFileSync(join(root, "tsconfig.json"), "utf8");
    const json = raw.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : ""));
    const include = (JSON.parse(json) as { include: string[]; compilerOptions: Record<string, unknown> }).include;
    expect(include).toContain("**/*.ts");
    const parsed = JSON.parse(json) as { compilerOptions: Record<string, unknown> };
    expect(parsed.compilerOptions.noUncheckedSideEffectImports).not.toBe(false);
  });

  it("copyEntryFiles.ts does not read process.env (1.5)", () => {
    expect(readFileSync(join(root, "scripts", "ui", "copyEntryFiles.ts"), "utf8")).not.toMatch(/process\.env/);
  });
});

function pathToUrl(p: string): string {
  return new URL(`file:///${p.replace(/\\/g, "/")}`).href;
}
