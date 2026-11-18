// Requirements: 1.1, 1.6, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9, 5.11, 10.6, 12.1, 12.6
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeSiteFs } from "../../../src/ui/shell/loadSite";
import { readSite, type SiteFs, type SiteReadDeps } from "../../../src/ui/shell/readSite";
import { readResurrectionVersion } from "../../../src/ui/shell/tarballVersion";
import { FIXTURE_ROOT, makeFixtureTree, type FixtureTree } from "../helpers/fixtureTree";

/** null when this machine can create a directory symlink, else the error code (Windows: EPERM without the privilege). */
const SYMLINK_PROBLEM: string | null = (() => {
  const dir = mkdtempSync(join(tmpdir(), "crypt-symlink-probe-"));
  try {
    symlinkSync(dir, join(dir, "link"), "dir");
    return null;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? "unknown error";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

const FAKE_ROOT = "/repo";
const enc = new TextEncoder();

type Kind = "file" | "directory" | "symlink" | "other";

/** In-memory file system over posix paths below FAKE_ROOT. `special` adds non-regular children. */
class FakeFs implements SiteFs {
  readonly files = new Map<string, Uint8Array>();
  readonly special = new Map<string, Kind>();
  readonly seen: string[] = [];
  reverse = false;

  private children(dir: string): Map<string, Kind> {
    const out = new Map<string, Kind>();
    const prefix = `${dir}/`;
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) out.set(rest, "file");
      else out.set(rest.slice(0, slash), "directory");
    }
    for (const [path, kind] of this.special) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) out.set(path.slice(prefix.length), kind);
    }
    return out;
  }

  listDirs(dir: string): string[] | null {
    this.seen.push(dir);
    const c = this.children(dir);
    if (c.size === 0) return null;
    const names = [...c].filter(([, k]) => k === "directory").map(([n]) => n);
    return this.reverse ? names.reverse() : names;
  }

  listEntries(dir: string): { name: string; kind: Kind }[] {
    this.seen.push(dir);
    return [...this.children(dir)].map(([name, kind]) => ({ name, kind }));
  }

  readBytes(file: string): Uint8Array | null {
    this.seen.push(file);
    return this.files.get(file) ?? null;
  }

  set(path: string, text: string): void {
    this.files.set(`${FAKE_ROOT}/${path}`, enc.encode(text));
  }
  remove(path: string): void {
    this.files.delete(`${FAKE_ROOT}/${path}`);
  }
  text(path: string): string {
    return new TextDecoder().decode(this.files.get(`${FAKE_ROOT}/${path}`));
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

function fakeFrom(root: string): FakeFs {
  const fs = new FakeFs();
  for (const file of walk(root)) {
    fs.files.set(`${FAKE_ROOT}/${relative(root, file).split("\\").join("/")}`, new Uint8Array(readFileSync(file)));
  }
  return fs;
}

function deps(fs: SiteFs, warnings: string[] = []): SiteReadDeps {
  return { root: FAKE_ROOT, fs, resurrectionVersion: readResurrectionVersion, warn: (l) => warnings.push(l) };
}

describe("readSite", () => {
  const trees: FixtureTree[] = [];
  afterEach(async () => {
    await Promise.all(trees.splice(0).map((t) => t.cleanup()));
  });
  async function fixture(nightly?: string): Promise<FakeFs> {
    const tree = await makeFixtureTree(nightly === undefined ? {} : { nightly });
    trees.push(tree);
    return fakeFrom(tree.root);
  }
  async function failure(fs: FakeFs): Promise<string> {
    const r = await readSite(deps(fs));
    if (r.ok) throw new Error("expected readSite to fail");
    return r.error.message;
  }

  it("reads every fixture kind in code-point order whatever the listing order", async () => {
    const fs = await fixture();
    fs.reverse = true;
    const r = await readSite(deps(fs));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.value.entries.map((e) => e.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual([
      "alive-fixture",
      "hostile-fixture",
      "inconclusive-fixture",
      "lodash.set",
      "restless-fixture",
      "retired-fixture",
      "stub-fixture",
    ]);
    const by = Object.fromEntries(r.value.entries.map((e) => [e.name, e]));
    expect(by["alive-fixture"]).toMatchObject({
      kind: "resurrection",
      tarballName: "resurrection.tgz",
      resurrectionVersion: "1.0.1",
      stubMarker: null,
    });
    expect(by["alive-fixture"]!.report?.verdict).toBe("alive");
    expect(by["alive-fixture"]!.deltas).not.toBeNull();
    expect(by["alive-fixture"]!.harness).not.toBeNull();
    expect(by["lodash.set"]!.resurrectionVersion).toBe("4.3.3");
    expect(by["restless-fixture"]!.report?.verdict).toBe("restless");
    expect(by["inconclusive-fixture"]!.report?.verdict).toBe("inconclusive");
    expect(by["retired-fixture"]).toMatchObject({
      kind: "not-resurrected",
      report: null,
      deltas: null,
      harness: null,
      tarballName: null,
      resurrectionVersion: null,
      stubMarker: null,
    });
    expect(by["retired-fixture"]!.files).toEqual(["certificate.json", "eligibility.json"]);
    expect(by["stub-fixture"]!.stubMarker).toEqual({ schemaVersion: 1, mode: "stub", label: "stub run" });
    for (const e of r.value.entries) if (e.name !== "stub-fixture") expect(e.stubMarker).toBeNull();
    expect(r.value.ledger.entries.length).toBeGreaterThan(0);
    expect(r.value.nightly).toBeNull();
  });

  it("reads the hostile fixture without error", async () => {
    const fs = await fixture("hostile");
    const warnings: string[] = [];
    const r = await readSite(deps(fs, warnings));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entries.some((e) => e.name === "hostile-fixture")).toBe(true);
    expect(r.value.nightly).not.toBeNull();
    expect(warnings).toEqual([]);
  });

  it("reads the committed repository root read-only", async () => {
    const r = await readSite({
      root: process.cwd(),
      fs: nodeSiteFs,
      resurrectionVersion: readResurrectionVersion,
      warn: () => undefined,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entries.map((e) => e.name)).toEqual(["inflight", "ip", "lodash.set"]);
    expect(r.value.entries.find((e) => e.name === "inflight")?.kind).toBe("not-resurrected");
    for (const name of ["ip", "lodash.set"]) {
      const e = r.value.entries.find((x) => x.name === name)!;
      expect(e.kind).toBe("resurrection");
      expect(e.resurrectionVersion).not.toBeNull();
    }
  });

  it("touches only graveyard/, ledger.json and .crypt-nightly/", async () => {
    const fs = await fixture("success");
    await readSite(deps(fs));
    expect(fs.seen.length).toBeGreaterThan(0);
    for (const p of fs.seen) {
      const ok =
        p === `${FAKE_ROOT}/graveyard` ||
        p.startsWith(`${FAKE_ROOT}/graveyard/`) ||
        p === `${FAKE_ROOT}/ledger.json` ||
        p.startsWith(`${FAKE_ROOT}/.crypt-nightly/`);
      expect(ok, p).toBe(true);
    }
  });

  describe("graveyard", () => {
    it("a missing graveyard gives zero entries", async () => {
      const fs = new FakeFs();
      fs.set("ledger.json", readFileSync(join(FIXTURE_ROOT, "ledger.json"), "utf8"));
      const r = await readSite(deps(fs));
      expect(r.ok && r.value.entries).toEqual([]);
    });

    it.each(["file", "symlink", "other"] as const)("a %s directly under graveyard/ fails and names the path", async (kind) => {
      const fs = await fixture();
      fs.special.set(`${FAKE_ROOT}/graveyard/linked`, kind);
      expect(await failure(fs)).toBe(`graveyard/linked: not a directory (${kind}); links are not followed`);
    });

    it.skipIf(SYMLINK_PROBLEM !== null)(
      `a symlinked entry directory on the real file system fails and names the path${
        SYMLINK_PROBLEM === null ? "" : ` [SKIPPED: this machine cannot create symlinks (${SYMLINK_PROBLEM})]`
      }`,
      async () => {
      const tree = await makeFixtureTree();
      trees.push(tree);
      symlinkSync(join(tree.root, "graveyard", "alive-fixture"), join(tree.root, "graveyard", "linked"), "dir");
      const r = await readSite({
        root: tree.root,
        fs: nodeSiteFs,
        resurrectionVersion: readResurrectionVersion,
        warn: () => undefined,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toBe("graveyard/linked: not a directory (symlink); links are not followed");
      },
    );
  });

  describe("fails closed on committed input and names the file", () => {
    it("an alive resurrection entry without a tarball names the entry and the missing file", async () => {
      const fs = await fixture();
      fs.remove("graveyard/alive-fixture/resurrection.tgz");
      fs.remove("graveyard/alive-fixture/resurrection.tgz.sigstore.json");
      expect(await failure(fs)).toBe("graveyard/alive-fixture/resurrection.tgz: file is missing");
    });

    it.each(["restless-fixture", "inconclusive-fixture"])("a %s entry without a tarball fails like an alive one", async (name) => {
      const fs = await fixture();
      fs.remove(`graveyard/${name}/resurrection.tgz`);
      expect(await failure(fs)).toBe(`graveyard/${name}/resurrection.tgz: file is missing`);
    });

    it("a file that the entry kind does not have fails and names it", async () => {
      const fs = await fixture();
      fs.set("graveyard/retired-fixture/deltas.json", fs.text("graveyard/alive-fixture/deltas.json"));
      expect(await failure(fs)).toBe("graveyard/retired-fixture/deltas.json: unexpected file in a not-resurrected entry");
      const fs2 = await fixture();
      fs2.set("graveyard/retired-fixture/stub-run.json", fs2.text("graveyard/stub-fixture/stub-run.json"));
      expect(await failure(fs2)).toBe("graveyard/retired-fixture/stub-run.json: unexpected file in a not-resurrected entry");
    });

    it("attestation bundles are not a read failure (shown on the Entry_Page, Requirement 5.6)", async () => {
      const fs = await fixture();
      fs.remove("graveyard/alive-fixture/proof-report.json.sigstore.json");
      fs.set("graveyard/restless-fixture/proof-report.json.sigstore.json", "{}");
      const r = await readSite(deps(fs));
      expect(r.ok).toBe(true);
    });

    it("a missing required file", async () => {
      const fs = await fixture();
      fs.remove("graveyard/restless-fixture/deltas.json");
      expect(await failure(fs)).toBe("graveyard/restless-fixture/deltas.json: file is missing");
    });

    it("malformed JSON and a parser failure name the file", async () => {
      const fs = await fixture();
      fs.set("graveyard/alive-fixture/certificate.json", "{");
      expect(await failure(fs)).toContain("graveyard/alive-fixture/certificate.json: ");
      const fs2 = await fixture();
      fs2.set("graveyard/alive-fixture/proof-report.json", "{}");
      expect(await failure(fs2)).toContain("graveyard/alive-fixture/proof-report.json: ");
      const fs3 = await fixture();
      fs3.set("graveyard/stub-fixture/stub-run.json", '{"schemaVersion":1}');
      expect(await failure(fs3)).toContain("graveyard/stub-fixture/stub-run.json: ");
    });

    it("a certificate for another package than the directory", async () => {
      const fs = await fixture();
      fs.set(
        "graveyard/alive-fixture/certificate.json",
        fs.text("graveyard/restless-fixture/certificate.json"),
      );
      expect(await failure(fs)).toContain("graveyard/alive-fixture/certificate.json: ");
    });

    it("an unsupported directory name", async () => {
      const fs = await fixture();
      for (const file of ["certificate.json", "eligibility.json"]) {
        fs.set(`graveyard/@scoped/${file}`, fs.text(`graveyard/retired-fixture/${file}`));
      }
      expect(await failure(fs)).toContain("graveyard/@scoped: ");
    });

    it.each(["directory", "symlink", "other"] as const)("a %s inside an entry", async (kind) => {
      const fs = await fixture();
      fs.special.set(`${FAKE_ROOT}/graveyard/alive-fixture/linked`, kind);
      const m = await failure(fs);
      expect(m).toContain("graveyard/alive-fixture/linked: ");
      expect(m).toContain(kind);
    });

    it("a second tarball and an unknown file name", async () => {
      const fs = await fixture();
      fs.files.set(`${FAKE_ROOT}/graveyard/alive-fixture/other.tgz`, new Uint8Array([1]));
      expect(await failure(fs)).toContain("graveyard/alive-fixture: more than one tarball");
      const fs2 = await fixture();
      fs2.set("graveyard/alive-fixture/notes.txt", "x");
      expect(await failure(fs2)).toContain("graveyard/alive-fixture: unexpected file name in the entry: notes.txt");
    });

    it("an entry with neither a proof report nor eligible: false", async () => {
      const fs = await fixture();
      fs.remove("graveyard/restless-fixture/proof-report.json");
      expect(await failure(fs)).toContain("graveyard/restless-fixture: ");
    });

    it("an unreadable tarball", async () => {
      const fs = await fixture();
      fs.files.set(`${FAKE_ROOT}/graveyard/alive-fixture/resurrection.tgz`, new Uint8Array([1, 2, 3]));
      expect(await failure(fs)).toContain("graveyard/alive-fixture/resurrection.tgz: ");
    });

    it("a missing and a malformed ledger", async () => {
      const fs = await fixture();
      fs.remove("ledger.json");
      expect(await failure(fs)).toBe("ledger.json: file is missing");
      const fs2 = await fixture();
      fs2.set("ledger.json", "[]");
      expect(await failure(fs2)).toContain("ledger.json: ledger.json is malformed");
    });
  });

  describe("nightly input", () => {
    async function readNightly(c: string) {
      const warnings: string[] = [];
      const r = await readSite(deps(await fixture(c), warnings));
      if (!r.ok) throw new Error(r.error.message);
      return { nightly: r.value.nightly, warnings };
    }

    it("no .crypt-nightly gives null without a warning", async () => {
      const warnings: string[] = [];
      const r = await readSite(deps(await fixture(), warnings));
      expect(r.ok && r.value.nightly).toBeNull();
      expect(warnings).toEqual([]);
    });

    it("a valid report and record are accepted", async () => {
      const { nightly, warnings } = await readNightly("success");
      expect(nightly?.reportState).toBe("accepted");
      expect(nightly?.report).not.toBeNull();
      expect(nightly?.run.conclusion).toBe("success");
      expect(warnings).toEqual([]);
    });

    it.each(["failure-no-report", "undocumented-conclusion"])("%s: record, report missing, no warning", async (c) => {
      const { nightly, warnings } = await readNightly(c);
      expect(nightly).toMatchObject({ reportState: "missing", report: null });
      expect(warnings).toEqual([]);
    });

    it("a report of another repo is rejected with a warning", async () => {
      const { nightly, warnings } = await readNightly("other-repo");
      expect(nightly).toMatchObject({ reportState: "rejected", report: null });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(".crypt-nightly/nightly-report.json: ");
    });

    it.each(["malformed-report-failure", "malformed-report-success"])("%s: rejected with a warning", async (c) => {
      const { nightly, warnings } = await readNightly(c);
      expect(nightly).toMatchObject({ reportState: "rejected", report: null });
      expect(nightly?.run.conclusion).toBe(c.endsWith("failure") ? "failure" : "success");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(".crypt-nightly/nightly-report.json: ");
    });

    it("an unreadable record gives null and a warning naming the file", async () => {
      const fs = await fixture("success");
      fs.set(".crypt-nightly/run.json", "{");
      const warnings: string[] = [];
      const r = await readSite(deps(fs, warnings));
      expect(r.ok && r.value.nightly).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(".crypt-nightly/run.json: ");
    });

    it("a record failing the schema gives null and a warning", async () => {
      const fs = await fixture("success");
      fs.set(".crypt-nightly/run.json", '{"schemaVersion":1,"conclusion":"Success"}');
      const warnings: string[] = [];
      const r = await readSite(deps(fs, warnings));
      expect(r.ok && r.value.nightly).toBeNull();
      expect(warnings[0]).toContain(".crypt-nightly/run.json: ");
    });

    it("a report without a record is ignored with a warning", async () => {
      const fs = await fixture("success");
      fs.remove(".crypt-nightly/run.json");
      const warnings: string[] = [];
      const r = await readSite(deps(fs, warnings));
      expect(r.ok && r.value.nightly).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("nightly-report.json");
    });
  });
});
