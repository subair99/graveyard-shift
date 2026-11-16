// Requirements: 14.6
// R14.6: the Pipeline does not delete, hide or relabel an entry with the Verdict restless or inconclusive.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEntry,
  pushPr,
  type BuildEntryInput,
  type PublishDeps,
  type PublishFs,
} from "../../../src/pipeline/undertaker/shell/publish";
import type { CommandResult, CommandRunner } from "../../../src/pipeline/undertaker/shell/ghCli";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function fakeFs(initial: Record<string, string>): PublishFs & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([k, v]) => [k, enc(v)]));
  return {
    files,
    async readFile(p) {
      const b = files.get(p);
      if (b === undefined) throw new Error("ENOENT");
      return b;
    },
    async writeFile(p, b) {
      files.set(p, b);
    },
    async removeDir(p) {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
    },
    async makeDir() {},
    async listFiles(p) {
      return [...files.keys()]
        .filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes("/"))
        .map((k) => k.slice(p.length + 1));
    },
  };
}

function deps(fs: PublishFs, runner?: CommandRunner & { calls: string[][] }): PublishDeps {
  return {
    fs,
    sha256: sha,
    runner: runner ?? { async run() { return { code: 0, stdout: "", stderr: "" }; } },
    summary: async () => {},
  };
}

const REPORT = '{"verdict":"restless"}';
const SOURCES: Record<string, string> = {
  "work/certificate.json": "cert",
  "work/eligibility.json": '{"eligible":true}',
  "work/deltas.json": "[]",
  "work/harness.json": "{}",
  "work/ip-2.0.2.tgz": "tarball",
  "work/proof-report.json": REPORT,
};

function input(over: Partial<BuildEntryInput> = {}): BuildEntryInput {
  return {
    package: "ip",
    kind: "resurrection",
    verdict: "restless",
    stub: false,
    tarballName: "ip-2.0.2.tgz",
    sourceDir: "work",
    bundleDir: "bundles",
    predicatePath: "attest/predicate.json",
    entryRoot: "graveyard",
    ...over,
  };
}

/** Snapshot of the files under a prefix as name -> text. */
function snapshot(fs: { files: Map<string, Uint8Array> }, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of [...fs.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (k.startsWith(prefix)) out[k] = new TextDecoder().decode(v);
  }
  return out;
}

async function withRestlessIp(extra: Record<string, string> = {}) {
  const fs = fakeFs({ ...SOURCES, ...extra });
  const built = await buildEntry(input(), deps(fs));
  expect(built.ok).toBe(true);
  return fs;
}

describe("an existing restless entry is kept (R14.6)", () => {
  it("writes the restless proof report byte for byte, with no bundle, and does not present it as alive", async () => {
    const fs = await withRestlessIp({ "bundles/proof-report.json.sigstore.json": "b" });
    const names = [...fs.files.keys()].filter((k) => k.startsWith("graveyard/ip/"));
    expect(names.some((n) => n.endsWith(".sigstore.json"))).toBe(false);
    expect(new TextDecoder().decode(fs.files.get("graveyard/ip/proof-report.json"))).toBe(REPORT);
  });

  it("a later publish for another package leaves the restless entry untouched", async () => {
    const fs = await withRestlessIp();
    const before = snapshot(fs, "graveyard/ip/");
    for (const [k, v] of Object.entries(SOURCES)) fs.files.set(k.replace("ip-2.0.2", "other-1.0.1"), enc(v));
    const r = await buildEntry(
      input({ package: "other", verdict: "restless", tarballName: "other-1.0.1.tgz" }),
      deps(fs),
    );
    expect(r.ok).toBe(true);
    expect(snapshot(fs, "graveyard/ip/")).toEqual(before);
  });

  it("a later alive attempt that fails its digest check leaves the restless entry untouched", async () => {
    const fs = await withRestlessIp();
    const before = snapshot(fs, "graveyard/ip/");
    const predicate = JSON.stringify({ not: "a valid predicate" });
    fs.files.set("attest/predicate.json", enc(predicate));
    fs.files.set("bundles/ip-2.0.2.tgz.sigstore.json", enc("b1"));
    fs.files.set("bundles/proof-report.json.sigstore.json", enc("b2"));
    fs.files.set("bundles/certificate.json.sigstore.json", enc("b3"));
    const r = await buildEntry(input({ verdict: "alive" }), deps(fs));
    expect(r.ok).toBe(false);
    expect(snapshot(fs, "graveyard/ip/")).toEqual(before);
  });

  it("a later attempt with a missing source file leaves the restless entry untouched", async () => {
    const fs = await withRestlessIp();
    const before = snapshot(fs, "graveyard/ip/");
    fs.files.delete("work/proof-report.json");
    const r = await buildEntry(input(), deps(fs));
    expect(r.ok).toBe(false);
    expect(snapshot(fs, "graveyard/ip/")).toEqual(before);
  });

  it("the pull request of another package stages only its own entry path and never rewrites history", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner & { calls: string[][] } = {
      calls,
      async run(command, argv): Promise<CommandResult> {
        calls.push([command, ...argv]);
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const r = await pushPr(
      { package: "other", runId: 9, runAttempt: 1, title: "t", body: "b", bodyFile: "pr-body.md", entryRoot: "graveyard" },
      deps(fakeFs({}), runner),
    );
    expect(r.ok).toBe(true);
    const add = calls.find((c) => c[0] === "git" && c[1] === "add");
    expect(add).toEqual(["git", "add", "--all", "--", "graveyard/other/"]);
    const flat = calls.flat();
    for (const word of ["rm", "reset", "rebase", "--amend", "--force", "-f", "--force-with-lease", "clean"]) {
      expect(flat).not.toContain(word);
    }
    expect(calls.some((c) => c.some((a) => a.includes("graveyard/ip")))).toBe(false);
  });
});
