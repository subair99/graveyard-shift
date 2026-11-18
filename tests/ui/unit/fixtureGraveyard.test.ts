// Requirements: 10.1, 10.2
// The Fixture_Graveyard parses with the real parsers and schemas; the tree helper adds tarballs and bundles.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deserialize } from "../../../src/engine/serialize/deserialize";
import { deserializeEligibilityRecord } from "../../../src/pipeline/gravedigger/core/eligibility";
import { parseHarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import { parseDeltasFile } from "../../../src/pipeline/harness/core/deltas";
import { parseLedger } from "../../../src/pipeline/local/core/ledger";
import { supportedPackageNameProblem } from "../../../src/pipeline/common/packageNames";
import { NightlyReportSchema } from "../../../src/pipeline/undertaker/core/nightlyReport";
import { deriveEntryKind, StubMarkerSchema } from "../../../src/pipeline/undertaker/core/layout";
import { REPO } from "../../../src/pipeline/common/constants";
import { deserializeReport } from "../../../src/proof/serialize/deserialize";
import { extractTarball, DEFAULT_EXTRACT_LIMITS } from "../../../src/proof/shell/tarball/tarballExtractor";
import { NightlyRunRecordSchema } from "../../../src/ui/core/nightlyRun";
import { checkEntryFileNames } from "../../../src/ui/core/entryFiles";
import { FIXTURE_ROOT, makeFixtureTree, type FixtureTree } from "../helpers/fixtureTree";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const text = (...p: string[]): string => readFileSync(join(FIXTURE_ROOT, ...p), "utf8");
const names = (dir: string): string[] => readdirSync(join(FIXTURE_ROOT, dir)).sort();

describe("Fixture_Graveyard", () => {
  const trees: FixtureTree[] = [];
  afterEach(async () => {
    await Promise.all(trees.splice(0).map((t) => t.cleanup()));
  });

  it("every entry parses with the real parsers and its directory is the package name", () => {
    const entries = names("graveyard");
    expect(entries).toEqual(
      ["alive-fixture", "hostile-fixture", "inconclusive-fixture", "lodash.set", "restless-fixture", "retired-fixture", "stub-fixture"].sort(),
    );
    const verdicts: Record<string, string> = {};
    for (const name of entries) {
      expect(supportedPackageNameProblem(name)).toBeNull();
      const files = names(`graveyard/${name}`);
      const cert = deserialize(text("graveyard", name, "certificate.json"));
      expect(cert.ok && cert.value.package.name).toBe(name === "lodash.set" ? "lodash.set" : name);
      const el = deserializeEligibilityRecord(text("graveyard", name, "eligibility.json"));
      expect(el.ok).toBe(true);
      if (!el.ok) continue;
      const kind = deriveEntryKind(files, el.value);
      expect(kind.ok).toBe(true);
      if (files.includes("proof-report.json")) {
        const rep = deserializeReport(text("graveyard", name, "proof-report.json"));
        expect(rep.ok).toBe(true);
        if (rep.ok) verdicts[name] = rep.value.verdict;
        expect(parseDeltasFile(text("graveyard", name, "deltas.json")).ok).toBe(true);
        expect(parseHarnessFile(text("graveyard", name, "harness.json")).ok).toBe(true);
      }
      if (files.includes("stub-run.json")) {
        expect(StubMarkerSchema.safeParse(JSON.parse(text("graveyard", name, "stub-run.json"))).success).toBe(true);
      }
    }
    expect(verdicts).toMatchObject({
      "alive-fixture": "alive",
      "restless-fixture": "restless",
      "inconclusive-fixture": "inconclusive",
      "stub-fixture": "alive",
      "lodash.set": "alive",
    });
  });

  it("the ledger parses and has local, stub and `not provided` rows", () => {
    const l = parseLedger(text("ledger.json"));
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(new Set(l.value.entries.map((e) => e.mode))).toEqual(new Set(["local", "stub"]));
    expect(l.value.entries.some((e) => e.mode === "local" && e.creditBefore === "not provided")).toBe(true);
  });

  it("the nightly cases have the documented states", () => {
    const run = (c: string) => NightlyRunRecordSchema.safeParse(JSON.parse(text("nightly", c, "run.json")));
    const report = (c: string) => {
      const r = NightlyReportSchema.safeParse(JSON.parse(text("nightly", c, "nightly-report.json")));
      return r.success ? r.data : null;
    };
    expect(names("nightly")).toEqual(
      ["failure-no-report", "hostile", "malformed-report-failure", "malformed-report-success", "other-repo", "success", "undocumented-conclusion"],
    );
    for (const c of names("nightly")) expect(run(c).success).toBe(true);
    expect(run("success").data?.conclusion).toBe("success");
    expect(run("failure-no-report").data?.conclusion).toBe("failure");
    expect(report("success")?.repo).toBe(REPO);
    expect(report("other-repo")?.repo).not.toBe(REPO);
    expect(report("other-repo")).not.toBeNull();
    expect(report("malformed-report-failure")).toBeNull();
    expect(report("malformed-report-success")).toBeNull();
    expect(run("malformed-report-failure").data?.conclusion).toBe("failure");
    expect(run("malformed-report-success").data?.conclusion).toBe("success");
    expect(names("nightly/failure-no-report")).toEqual(["run.json"]);
    expect(run("undocumented-conclusion").data?.conclusion).toBe("startup_failure");
  });

  it("the hostile entry, its ledger rows and its nightly case parse with the real parsers", () => {
    const el = deserializeEligibilityRecord(text("graveyard", "hostile-fixture", "eligibility.json"));
    expect(el.ok).toBe(true);
    if (!el.ok) return;
    const kind = deriveEntryKind(names("graveyard/hostile-fixture"), el.value);
    expect(kind.ok).toBe(true);
    if (kind.ok) expect(kind.value).toBe("resurrection");
    const l = parseLedger(text("ledger.json"));
    expect(l.ok).toBe(true);
    if (l.ok) expect(l.value.entries.some((e) => e.package === "hostile-fixture")).toBe(true);
    expect(NightlyRunRecordSchema.safeParse(JSON.parse(text("nightly", "hostile", "run.json"))).success).toBe(true);
    expect(NightlyReportSchema.safeParse(JSON.parse(text("nightly", "hostile", "nightly-report.json"))).success).toBe(true);
  });

  it("the tree helper adds a readable tarball and bundles for alive entries only, and the file names pass", async () => {
    const tree = await makeFixtureTree({ nightly: "success" });
    trees.push(tree);
    for (const name of names("graveyard")) {
      const dir = join(tree.root, "graveyard", name);
      const files = readdirSync(dir).sort();
      const checked = checkEntryFileNames(files);
      expect(checked.ok).toBe(true);
      const bundles = files.filter((f) => f.endsWith(".sigstore.json"));
      const alive = ["alive-fixture", "stub-fixture", "lodash.set"].includes(name);
      expect(bundles.length).toBe(alive ? 3 : 0);
    }
    const scratch = mkdtempSync(join(tmpdir(), "crypt-fixture-x-"));
    try {
      const bytes = readFileSync(join(tree.root, "graveyard", "alive-fixture", "resurrection.tgz"));
      const extracted = await extractTarball(new Uint8Array(bytes), scratch, DEFAULT_EXTRACT_LIMITS);
      expect(extracted.ok).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    expect(readdirSync(join(tree.root, ".crypt-nightly")).sort()).toEqual(["nightly-report.json", "run.json"]);
  });
});
