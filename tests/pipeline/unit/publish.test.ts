// Requirements: 13.9, 13.10, 14.1, 14.3, 14.4, 14.7, 14.13, 15.1, 15.6, 15.7, 15.8, 23.11
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildPredicate, printPredicate } from "../../../src/pipeline/undertaker/core/predicate";
import {
  BOT_EMAIL,
  PR_SETTING_NAME,
  type CommandResult,
  type CommandRunner,
} from "../../../src/pipeline/undertaker/shell/ghCli";
import {
  buildEntry,
  pushPr,
  type BuildEntryInput,
  type PublishDeps,
  type PublishFs,
} from "../../../src/pipeline/undertaker/shell/publish";

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

interface Call {
  command: string;
  argv: readonly string[];
}

function fakeRunner(reply: (c: Call) => Partial<CommandResult> = () => ({})): CommandRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async run(command, argv) {
      const c = { command, argv };
      calls.push(c);
      return { code: 0, stdout: "", stderr: "", ...reply(c) };
    },
  };
}

const SRI = `sha512-${"A".repeat(86)}==`;

function predicateText(digests: { tarball: string; proofReport: string; certificate: string }): string {
  const r = buildPredicate({
    package: { name: "ip", version: "2.0.1" },
    original: { integrity: SRI },
    resurrection: { name: "@graveyard-shift/ip", version: "2.0.2", treeHash: SRI },
    digests,
    verdict: "alive",
    seed: 7,
    toolVersions: { node: "26.13.1", fastCheck: "4.0.0", reportSchema: 1 },
    branchCommit: "a".repeat(40),
    run: { id: "1", attempt: "1" },
    medium: { mode: "local" },
  });
  if (!r.ok) throw new Error(r.error.message);
  return printPredicate(r.value.predicate);
}

const SOURCES = {
  "work/certificate.json": "cert",
  "work/eligibility.json": '{"eligible":true}',
  "work/deltas.json": "[]",
  "work/harness.json": "{}",
  "work/ip-2.0.2.tgz": "tarball-bytes",
  "work/proof-report.json": "report",
  "bundles/ip-2.0.2.tgz.sigstore.json": "b1",
  "bundles/proof-report.json.sigstore.json": "b2",
  "bundles/certificate.json.sigstore.json": "b3",
  "graveyard/ip/old-file.json": "old",
};

const goodPredicate = predicateText({
  tarball: sha(enc("tarball-bytes")),
  proofReport: sha(enc("report")),
  certificate: sha(enc("cert")),
});

function input(over: Partial<BuildEntryInput> = {}): BuildEntryInput {
  return {
    package: "ip",
    kind: "resurrection",
    verdict: "alive",
    stub: false,
    tarballName: "ip-2.0.2.tgz",
    sourceDir: "work",
    bundleDir: "bundles",
    predicatePath: "attest/predicate.json",
    entryRoot: "graveyard",
    ...over,
  };
}

function deps(fs: PublishFs, runner: CommandRunner = fakeRunner()): PublishDeps & { summaries: string[] } {
  const summaries: string[] = [];
  return {
    fs,
    sha256: sha,
    runner,
    summary: async (m) => {
      summaries.push(m);
    },
    summaries,
  };
}

const names = (fs: ReturnType<typeof fakeFs>): string[] =>
  [...fs.files.keys()].filter((k) => k.startsWith("graveyard/ip/")).map((k) => k.slice(13)).sort();

describe("buildEntry", () => {
  it("replaces the entry completely and copies bytes unchanged (alive)", async () => {
    const fs = fakeFs({ ...SOURCES, "attest/predicate.json": goodPredicate });
    const r = await buildEntry(input(), deps(fs));
    expect(r.ok).toBe(true);
    expect(names(fs)).toEqual([
      "certificate.json",
      "certificate.json.sigstore.json",
      "deltas.json",
      "eligibility.json",
      "harness.json",
      "ip-2.0.2.tgz",
      "ip-2.0.2.tgz.sigstore.json",
      "proof-report.json",
      "proof-report.json.sigstore.json",
    ]);
    expect(names(fs)).not.toContain("old-file.json");
    expect(fs.files.get("graveyard/ip/ip-2.0.2.tgz")).toBe(fs.files.get("work/ip-2.0.2.tgz"));
  });

  it("fails on a digest mismatch before writing anything", async () => {
    const bad = predicateText({
      tarball: "0".repeat(64),
      proofReport: sha(enc("report")),
      certificate: sha(enc("cert")),
    });
    const fs = fakeFs({ ...SOURCES, "attest/predicate.json": bad });
    const r = await buildEntry(input(), deps(fs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("digest mismatch for ip-2.0.2.tgz");
    expect(names(fs)).toEqual(["old-file.json"]);
  });

  it("writes the stub marker only for a stub run", async () => {
    const fs = fakeFs({ ...SOURCES, "attest/predicate.json": goodPredicate });
    await buildEntry(input({ stub: true }), deps(fs));
    expect(names(fs)).toContain("stub-run.json");
    const fs2 = fakeFs({ ...SOURCES, "attest/predicate.json": goodPredicate });
    await buildEntry(input({ stub: false }), deps(fs2));
    expect(names(fs2)).not.toContain("stub-run.json");
  });

  it("writes no bundle for restless", async () => {
    const fs = fakeFs(SOURCES);
    const r = await buildEntry(input({ verdict: "restless" }), deps(fs));
    expect(r.ok).toBe(true);
    expect(names(fs).some((n) => n.endsWith(".sigstore.json"))).toBe(false);
    expect(names(fs)).toContain("proof-report.json");
  });

  it("writes only certificate and eligibility for a not-resurrected entry", async () => {
    const fs = fakeFs({ ...SOURCES, "work/eligibility.json": '{"eligible":false}' });
    const r = await buildEntry(
      input({ kind: "not-resurrected", verdict: null, tarballName: null }),
      deps(fs),
    );
    expect(r.ok).toBe(true);
    expect(names(fs)).toEqual(["certificate.json", "eligibility.json"]);
  });

  it("names a missing source file", async () => {
    const fs = fakeFs({ ...SOURCES, "attest/predicate.json": goodPredicate });
    fs.files.delete("work/harness.json");
    const r = await buildEntry(input(), deps(fs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("work/harness.json");
  });
});

const PUSH = {
  package: "lodash.set",
  runId: 4376,
  runAttempt: 2,
  title: "lodash.set 4.3.3: alive",
  body: "body text",
  bodyFile: "pr-body.md",
  entryRoot: "graveyard",
};

describe("pushPr", () => {
  it("runs the commands in order, commits only the entry, never forces or merges", async () => {
    const fs = fakeFs({});
    const runner = fakeRunner((c) =>
      c.command === "gh" && c.argv[1] === "create" ? { stdout: "https://github.com/x/y/pull/5\n" } : {},
    );
    const d = deps(fs, runner);
    const r = await pushPr(PUSH, d);
    expect(r).toEqual({
      ok: true,
      value: { branch: "publish/lodash-set-run4376-a2", url: "https://github.com/x/y/pull/5" },
    });
    const texts = runner.calls.map((c) => [c.command, ...c.argv].join(" "));
    expect(texts).toEqual([
      "git config user.name github-actions[bot]",
      `git config user.email ${BOT_EMAIL}`,
      "gh auth setup-git",
      "git ls-remote --heads origin publish/lodash-set-run4376-*",
      "git checkout -b publish/lodash-set-run4376-a2",
      "git add --all -- graveyard/lodash.set/",
      "git commit -m graveyard: lodash.set",
      "git push origin publish/lodash-set-run4376-a2",
      "gh pr create --base main --head publish/lodash-set-run4376-a2 --title lodash.set 4.3.3: alive --body-file pr-body.md",
      "gh pr list --search head:publish/lodash-set- --state open --json number,title,url,headRefName",
    ]);
    const all = runner.calls.flatMap((c) => [...c.argv]);
    expect(all).not.toContain("merge");
    expect(all).not.toContain("--auto");
    expect(all.some((a) => a.includes("force") || a === "-f")).toBe(false);
    expect(new TextDecoder().decode(fs.files.get("pr-body.md"))).toBe("body text");
  });

  it("fails with the branch name and the delete command on a collision, before any push", async () => {
    const runner = fakeRunner((c) =>
      c.argv[0] === "ls-remote"
        ? { stdout: `${"a".repeat(40)}\trefs/heads/publish/lodash-set-run4376-a1\n` }
        : {},
    );
    const r = await pushPr(PUSH, deps(fakeFs({}), runner));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("publish/lodash-set-run4376-a1");
      expect(r.error).toContain("git push origin --delete publish/lodash-set-run4376-a1");
    }
    expect(runner.calls.some((c) => c.argv[0] === "push" || c.argv[0] === "commit")).toBe(false);
  });

  it("prints the setting name when gh pr create fails", async () => {
    const runner = fakeRunner((c) => (c.argv[1] === "create" ? { code: 1, stderr: "denied" } : {}));
    const r = await pushPr(PUSH, deps(fakeFs({}), runner));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(PR_SETTING_NAME);
  });

  it("lists open publish pull requests in the job summary", async () => {
    const list = JSON.stringify([
      { number: 3, title: "older", url: "https://github.com/x/y/pull/3", headRefName: "publish/lodash-set-run1-a1" },
    ]);
    const runner = fakeRunner((c) => (c.argv[1] === "list" ? { stdout: list } : {}));
    const d = deps(fakeFs({}), runner);
    await pushPr(PUSH, d);
    expect(d.summaries.join("")).toContain("#3 older (publish/lodash-set-run1-a1)");
  });

  it("names the failing command", async () => {
    const runner = fakeRunner((c) => (c.argv[0] === "push" ? { code: 1 } : {}));
    const r = await pushPr(PUSH, deps(fakeFs({}), runner));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("git push origin publish/lodash-set-run4376-a2");
  });
});
