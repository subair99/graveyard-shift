/**
 * Documentation checks (task 13.2): the paths of the crypt-ui lines of structure.md exist, .gitignore, the README site
 * section, PREEXISTING.md entries of the three Pages actions, the trace mapping and the budget entry.
 * Criterion 9.9 (README "Live demo" line after a reported deployment) stays a manual gap and is not cited here.
 */
// Requirements: 10.8, 10.9, 11.1, 11.4, 11.5, 11.6, 11.9
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTEMPTS_NOTE } from "../../../src/ui/core/texts";
import { BUDGET_SECONDS } from "../../proof/helpers/budgetReporter";

const root = resolve(__dirname, "..", "..", "..");
const read = (p: string): string => readFileSync(resolve(root, p), "utf8").replace(/\r\n/g, "\n");

/** The text of a markdown section from its heading line up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const level = (heading.match(/^#+/)?.[0] ?? "").length;
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  expect(start, `heading ${heading}`).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(/^(#+) /);
    if (m && (m[1] ?? "").length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("structure.md lines of crypt-ui", () => {
  const structure = read(".kiro/steering/structure.md");
  const lines = structure.split("\n");
  // Lines for new files only: each starts with a repository path of the Site.
  const prefixes = ["src/app/", "src/ui/", "scripts/ui/", "tests/ui/", ".github/workflows/pages.yml"];
  const siteLines = lines.filter((l) => prefixes.some((p) => l.startsWith(p)));

  it("finds the Site lines", () => {
    expect(siteLines.length).toBeGreaterThanOrEqual(8);
  });

  it("names only paths that exist (the first path of each line, and every file name it lists)", () => {
    const missing: string[] = [];
    for (const line of siteLines) {
      const first = line.split(/\s+/)[0] ?? "";
      if (!existsSync(resolve(root, first))) missing.push(first);
      const dir = first.endsWith("/") ? first : dirname(first);
      // File names with a source extension; a bare extension (".test.ts" of a glob) and the workflow named in a
      // sentence ("pages.yml") are not path claims.
      const names = line.match(/[\w./[\]-]+\.(?:tsx?|mjs|css)\b/g) ?? [];
      for (const name of names) {
        if (name === first || name.startsWith(".")) continue;
        const candidates = [resolve(root, dir, name), resolve(root, name)];
        if (!candidates.some((c) => existsSync(c))) missing.push(`${first} -> ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("lists the output directories, which are not committed and so are checked in .gitignore instead", () => {
    expect(structure).toContain("\nout/ ");
    expect(structure).toContain("\n.crypt-nightly/ ");
  });
});

describe(".gitignore", () => {
  it("ignores the Site_Output and the Nightly_Input", () => {
    const lines = read(".gitignore").split("\n").map((l) => l.trim());
    expect(lines).toContain("/out/");
    expect(lines).toContain("/.crypt-nightly/");
  });
});

describe("README site section", () => {
  const readme = read("README.md");
  const site = section(readme, "### The Crypt site");

  it("describes dev, build, the check script and the manual Pages setting", () => {
    expect(site).toContain("`npm run dev`");
    expect(site).toContain("http://localhost:3000/graveyard-shift/");
    expect(site).toContain("`npm run build`");
    expect(site).toContain("node scripts/ui/checkSite.mjs");
    expect(site).toContain("GitHub Actions");
    expect(site).toMatch(/manual step by the repository owner/);
  });

  it("states the preview text that scripts/ui/startNotice.mjs prints", () => {
    const run = spawnSync(process.execPath, [resolve(root, "scripts/ui/startNotice.mjs")], { encoding: "utf8" });
    expect(run.status).toBe(1);
    const notice = run.stderr.trim();
    const at = notice.indexOf("then serve the directory");
    expect(at).toBeGreaterThan(0);
    const previewText = notice.slice(at);
    expect(site).toContain(previewText);
    expect(site).toContain("`npm run start` does not serve the site");
  });

  it("states the ledger meaning as the Site shows it, with the source of the statement and no cost figure", () => {
    expect(ATTEMPTS_NOTE).toBe("credit meter readings as typed by the user (the meter shows credits used)");
    const ledger = section(readme, "### Ledger and credits");
    expect(ledger).toContain("credit meter readings");
    expect(ledger).toContain("as typed by the user");
    expect(ledger).toContain("the credit meter shows credits used (the user's statement, 2026-11-17)");
    // The cost of a run is not stated (the 150-credit ceiling is a rule, not a measured cost).
    expect(ledger).toContain("no figure is stated here");
  });
});

describe("PREEXISTING.md", () => {
  const text = read("PREEXISTING.md");
  const actions: Array<[string, string]> = [
    ["actions/configure-pages", "v6.0.0"],
    ["actions/upload-pages-artifact", "v5.0.0"],
    ["actions/deploy-pages", "v5.0.1"],
  ];
  it.each(actions)("lists %s %s with the MIT license and its source", (name, tag) => {
    const line = text.split("\n").find((l) => l.startsWith(`- ${name} `));
    expect(line, name).toBeDefined();
    expect(line).toContain(`${name} ${tag} (MIT`);
    expect(line).toContain(`https://github.com/${name}`);
  });
});

describe("trace mapping and budget", () => {
  it("maps tests/ui to crypt-ui in scripts/trace.ts, in SPECS and in the header-syntax sentence", () => {
    const trace = read("scripts/trace.ts");
    expect(trace).toMatch(
      /name:\s*"crypt-ui",\s*requirements:\s*"\.kiro\/specs\/crypt-ui\/requirements\.md",\s*testsDir:\s*"tests\/ui",/,
    );
    expect(trace).toContain("`tests/ui` is crypt-ui");
  });

  it("has the vitest project ui over tests/ui and the 60 s target", () => {
    expect(BUDGET_SECONDS.ui).toBe(60);
    const config = read("vitest.config.mts");
    expect(config).toMatch(/name:\s*"ui",\s*include:\s*\["tests\/ui\/\*\*\/\*\.test\.ts"\]/);
  });
});
