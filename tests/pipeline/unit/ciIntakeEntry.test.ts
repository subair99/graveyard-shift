// Requirements: 9.1, 9.2, 9.3, 9.4, 9.10, 10.8, 11.1, 11.2, 11.3, 11.12, 11.15, 12.6
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PINNED_NODE_VERSION } from "../../../src/pipeline/common/constants";
import type { EligibilityRecord } from "../../../src/pipeline/gravedigger/core/eligibility";
import type { IntakeEntry } from "../../../src/pipeline/intake/core/types";
import { extractTarball, packTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import {
  checkPublishBranchStep,
  coronerStep,
  createRedactingIo,
  fetchAndValidateStep,
  packStep,
  planStep,
  resolveBranchStep,
  runStep,
  validateInputsStep,
} from "../../../scripts/ci/lib/intakeSteps";
import type { Env, IntakeDeps } from "../../../scripts/ci/lib/intakeSteps";
import { tarballOf } from "../../proof/helpers/buildTarball";
import { IP_CERT } from "../helpers/gravediggerCerts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const SHA = "a".repeat(40);
const BASE_ENV: Env = {
  GS_REF: "refs/heads/main",
  GS_PACKAGE: "ip",
  GS_VERSION: "2.0.1",
  GS_BRANCH: "resurrect/ip",
  GS_MEDIUM_MODE: "local",
};

interface Captured {
  logs: string[];
  errors: string[];
  outputs: Record<string, string>;
  summary: string[];
}

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "gs-intake-test-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const exists = (rel: string): Promise<boolean> =>
  stat(join(cwd, rel)).then(
    () => true,
    () => false,
  );

function record(eligible: boolean): EligibilityRecord {
  return {
    schemaVersion: 1,
    package: { name: "ip", version: "2.0.1" },
    eligible,
    integrity: { expected: "sha512-x", computed: "sha512-x", matches: true },
    rules: [],
    failedRules: [],
    facts: [],
  };
}

const originalTar = tarballOf([
  { path: "package.json", bytes: enc(JSON.stringify({ name: "ip", version: "2.0.1", license: "MIT", author: "A B" })) },
  { path: "LICENSE", bytes: enc("MIT text\n") },
]);

function goodEntries(over: Record<string, unknown> = {}): IntakeEntry[] {
  const manifest = {
    name: "@graveyard-shift/ip",
    version: "2.0.2",
    license: "MIT",
    author: "A B",
    ...over,
  };
  const file = (path: string, text: string): IntakeEntry => ({
    path,
    type: "file",
    size: text.length,
    bytes: enc(text),
  });
  return [
    file("resurrection/package.json", JSON.stringify(manifest)),
    file("resurrection/index.js", "module.exports = 1;\n"),
    file("resurrection/LICENSE", "MIT text\n"),
    file("deltas.json", '{"deltas":[]}'),
    file("harness.json", '{"preset":"x"}'),
  ];
}

function makeDeps(
  env: Env,
  cap: Captured,
  over: Partial<IntakeDeps> = {},
): IntakeDeps {
  return {
    cwd,
    env,
    io: {
      log: (l) => cap.logs.push(l),
      error: (l) => cap.errors.push(l),
      setOutput: (k, v) => void (cap.outputs[k] = v),
      summary: (m) => cap.summary.push(m),
    },
    nodeVersion: `v${PINNED_NODE_VERSION}`,
    coroner: () => Promise.resolve({ certificates: [IP_CERT], errors: [], notes: [] }),
    gravedigger: () => Promise.resolve({ record: record(true), tarball: originalTar.bytes }),
    runGh: () => Promise.resolve({ code: 0, stdout: `${SHA}\n`, stderr: "" }),
    runGit: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    readGitEntries: () => Promise.resolve({ ok: true, value: goodEntries() }),
    extractOriginal: async (bytes) => {
      const dir = await mkdtemp(join(tmpdir(), "gs-intake-extract-"));
      try {
        const r = await extractTarball(bytes, dir);
        return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error.kind };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    packTarball,
    ...over,
  };
}

const fresh = (): Captured => ({ logs: [], errors: [], outputs: {}, summary: [] });

describe("validate-inputs", () => {
  it("accepts valid inputs and writes enumerated outputs", async () => {
    const cap = fresh();
    expect(await validateInputsStep(makeDeps(BASE_ENV, cap))).toBe(0);
    expect(cap.outputs).toEqual({ package: "ip", version: "2.0.1", medium_mode: "local", has_branch: "true" });
  });

  it("rejects a ref other than main, a foreign branch and an inexact version, listing every problem", async () => {
    const cap = fresh();
    const env = { ...BASE_ENV, GS_REF: "refs/heads/x", GS_BRANCH: "resurrect/other", GS_VERSION: "^2.0.1" };
    expect(await validateInputsStep(makeDeps(env, cap))).toBe(1);
    expect(cap.summary.join("\n")).toMatch(/ref must be[\s\S]*version must be[\s\S]*branch must be/);
    expect(cap.outputs).toEqual({});
  });

  it("fails when process.version differs from the pinned version", async () => {
    const cap = fresh();
    expect(await validateInputsStep(makeDeps(BASE_ENV, cap, { nodeVersion: "v22.0.0" }))).toBe(1);
    expect(cap.summary.join("\n")).toContain(`v${PINNED_NODE_VERSION}`);
  });
});

describe("check-publish-branch", () => {
  const env: Env = { ...BASE_ENV, GITHUB_RUN_ID: "4376", GITHUB_RUN_ATTEMPT: "2" };
  const earlier = "publish/ip-run4376-a1";

  it("passes when no branch matches, asking ls-remote with the run glob and no token", async () => {
    const cap = fresh();
    const calls: { argv: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    const deps = makeDeps({ ...env, GITHUB_TOKEN: "tok" }, cap, {
      runGit: (argv, e) => {
        calls.push({ argv, env: e });
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
    });
    expect(await checkPublishBranchStep(deps)).toBe(0);
    expect(calls).toEqual([
      { argv: ["ls-remote", "--heads", "origin", "publish/ip-run4376-*"], env: { GIT_TERMINAL_PROMPT: "0" } },
    ]);
  });

  it("fails with the branch name and the delete command when an earlier attempt left a branch", async () => {
    const cap = fresh();
    const deps = makeDeps(env, cap, {
      runGit: () => Promise.resolve({ code: 0, stdout: `${SHA}\trefs/heads/${earlier}\n`, stderr: "" }),
    });
    expect(await checkPublishBranchStep(deps)).toBe(1);
    const text = cap.errors.join("\n");
    expect(text).toContain(earlier);
    expect(text).toContain(`git push origin --delete ${earlier}`);
    expect(cap.outputs).toEqual({});
  });

  it("fails closed when ls-remote fails or the run id is invalid", async () => {
    const failing = makeDeps(env, fresh(), { runGit: () => Promise.resolve({ code: 128, stdout: "", stderr: "x" }) });
    expect(await checkPublishBranchStep(failing)).toBe(1);
    const cap = fresh();
    expect(await checkPublishBranchStep(makeDeps({ ...env, GITHUB_RUN_ID: "" }, cap))).toBe(1);
    expect(cap.errors.join("\n")).toContain("GITHUB_RUN_ID");
  });
});

describe("coroner", () => {
  it("runs the Coroner with the token, then the Gravedigger, and writes the three files", async () => {
    const cap = fresh();
    let seen: unknown[] = [];
    const deps = makeDeps({ ...BASE_ENV, GITHUB_TOKEN: "tok" }, cap, {
      coroner: (...args) => {
        seen = args;
        return Promise.resolve({ certificates: [IP_CERT], errors: [], notes: [] });
      },
    });
    expect(await coronerStep(deps)).toBe(0);
    expect(seen).toEqual(["ip", "2.0.1", "tok"]);
    expect(cap.outputs["eligible"]).toBe("true");
    expect(cap.outputs["certificate_digest"]).toBe(
      createHash("sha256").update(await readFile(join(cwd, "certificate.json"))).digest("hex"),
    );
    expect(JSON.parse(await readFile(join(cwd, "certificate.json"), "utf8")).package.name).toBe("ip");
    expect(JSON.parse(await readFile(join(cwd, "eligibility.json"), "utf8")).eligible).toBe(true);
    expect(Buffer.from(await readFile(join(cwd, "original.tgz"))).equals(Buffer.from(originalTar.bytes))).toBe(true);
  });

  it("writes no original.tgz when the Gravedigger kept no tarball", async () => {
    const cap = fresh();
    const deps = makeDeps(BASE_ENV, cap, {
      gravedigger: () => Promise.resolve({ record: record(false), tarball: null }),
    });
    expect(await coronerStep(deps)).toBe(0);
    expect(cap.outputs["eligible"]).toBe("false");
    expect(await exists("original.tgz")).toBe(false);
    expect(await exists("eligibility.json")).toBe(true);
  });

  it("fails when the certificate is for another version or missing", async () => {
    const cap = fresh();
    const other = { ...IP_CERT, package: { name: "ip", version: "9.9.9" } };
    const wrong = makeDeps(BASE_ENV, cap, {
      coroner: () => Promise.resolve({ certificates: [other], errors: [], notes: [] }),
    });
    expect(await coronerStep(wrong)).toBe(1);
    const none = makeDeps(BASE_ENV, fresh(), {
      coroner: () => Promise.resolve({ certificates: [], errors: [{ kind: "parse", message: "nope" }], notes: [] }),
    });
    expect(await coronerStep(none)).toBe(1);
    expect(await exists("certificate.json")).toBe(false);
  });
});

describe("plan", () => {
  async function planWith(eligible: boolean, branch: string): Promise<{ code: number; cap: Captured }> {
    await writeFile(join(cwd, "eligibility.json"), JSON.stringify(record(eligible)));
    const cap = fresh();
    return { code: await planStep(makeDeps({ ...BASE_ENV, GS_BRANCH: branch }, cap)), cap };
  }

  it("not eligible gives not-resurrected, with or without a branch", async () => {
    expect((await planWith(false, "")).cap.outputs["kind"]).toBe("not-resurrected");
    expect((await planWith(false, "resurrect/ip")).cap.outputs["kind"]).toBe("not-resurrected");
  });

  it("eligible with a branch gives resurrection", async () => {
    const r = await planWith(true, "resurrect/ip");
    expect(r.code).toBe(0);
    expect(r.cap.outputs["kind"]).toBe("resurrection");
  });

  it("eligible without a branch fails with the Resurrection_Branch message", async () => {
    const r = await planWith(true, "");
    expect(r.code).toBe(1);
    expect(r.cap.errors.join("\n")).toContain("a Resurrection_Branch is required");
  });
});

describe("resolve-branch", () => {
  it("asks gh for the ref SHA with only GH_TOKEN and outputs the commit", async () => {
    const cap = fresh();
    const calls: { argv: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    const deps = makeDeps({ ...BASE_ENV, GITHUB_TOKEN: "tok" }, cap, {
      runGh: (argv, env) => {
        calls.push({ argv, env });
        return Promise.resolve({ code: 0, stdout: `${SHA}\n`, stderr: "" });
      },
    });
    expect(await resolveBranchStep(deps)).toBe(0);
    expect(cap.outputs["branch_commit"]).toBe(SHA);
    expect(calls).toEqual([
      {
        argv: ["api", "repos/subair99/graveyard-shift/git/ref/heads/resurrect/ip", "--jq", ".object.sha"],
        env: { GH_TOKEN: "tok" },
      },
    ]);
  });

  it("fails on a gh error or an answer that is not a 40-hex SHA", async () => {
    for (const result of [
      { code: 1, stdout: "", stderr: "boom" },
      { code: 0, stdout: "not-a-sha", stderr: "" },
    ]) {
      const cap = fresh();
      expect(await resolveBranchStep(makeDeps(BASE_ENV, cap, { runGh: () => Promise.resolve(result) }))).toBe(1);
      expect(cap.outputs).toEqual({});
    }
  });
});

describe("fetch-and-validate and pack", () => {
  const env: Env = { ...BASE_ENV, GS_BRANCH_COMMIT: SHA, GITHUB_TOKEN: "tok", GH_TOKEN: "tok" };

  async function withOriginal(): Promise<void> {
    await writeFile(join(cwd, "original.tgz"), originalTar.bytes);
  }

  it("reads the branch at the resolved commit without any token, then writes work/medium", async () => {
    await withOriginal();
    const cap = fresh();
    let options: Parameters<IntakeDeps["readGitEntries"]>[0] | undefined;
    const deps = makeDeps(env, cap, {
      readGitEntries: (o) => {
        options = o;
        return Promise.resolve({ ok: true, value: goodEntries() });
      },
    });
    expect(await fetchAndValidateStep(deps)).toBe(0);
    expect(options?.expectedSha).toBe(SHA);
    expect(options?.branchRef).toBe("refs/heads/resurrect/ip");
    expect(options?.env?.["GITHUB_TOKEN"]).toBeUndefined();
    expect(options?.env?.["GH_TOKEN"]).toBeUndefined();
    expect(await readFile(join(cwd, "work/medium/resurrection/index.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(await exists("work/medium/deltas.json")).toBe(true);
  });

  it("lists violations in the summary, exits 1 and writes nothing", async () => {
    await withOriginal();
    const cap = fresh();
    const bad: IntakeEntry[] = [...goodEntries(), { path: ".github/workflows/x.yml", type: "file", size: 1 }];
    const code = await fetchAndValidateStep(makeDeps(env, cap, { readGitEntries: () => Promise.resolve({ ok: true, value: bad }) }));
    expect(code).toBe(1);
    expect(cap.summary.join("\n")).toMatch(/bad-path \.github\/workflows\/x\.yml/);
    expect(await exists("work/medium")).toBe(false);
  });

  it("lists failed necromancy checks in the summary, exits 1 and writes nothing", async () => {
    await withOriginal();
    const cap = fresh();
    const entries = goodEntries({ name: "ip", version: "2.0.1" });
    const code = await fetchAndValidateStep(makeDeps(env, cap, { readGitEntries: () => Promise.resolve({ ok: true, value: entries }) }));
    expect(code).toBe(1);
    expect(cap.summary.join("\n")).toMatch(/- name: /);
    expect(cap.summary.join("\n")).toMatch(/- version: /);
    expect(await exists("work/medium")).toBe(false);
  });

  it("fails when the branch moved or the commit is missing", async () => {
    await withOriginal();
    const moved = makeDeps(env, fresh(), {
      readGitEntries: () => Promise.resolve({ ok: false, error: "branch changed during intake" }),
    });
    expect(await fetchAndValidateStep(moved)).toBe(1);
    const cap = fresh();
    expect(await fetchAndValidateStep(makeDeps({ ...env, GS_BRANCH_COMMIT: "" }, cap))).toBe(1);
  });

  it("packs work/medium into resurrection.tgz under package/ and copies the two control files", async () => {
    await withOriginal();
    expect(await fetchAndValidateStep(makeDeps(env, fresh()))).toBe(0);
    const cap = fresh();
    expect(await packStep(makeDeps(env, cap))).toBe(0);
    const tgz = new Uint8Array(await readFile(join(cwd, "resurrection.tgz")));
    const out = await extractTarball(tgz, join(cwd, "unpacked"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.map((f) => f.path).sort()).toEqual(["LICENSE", "index.js", "package.json"]);
    expect(await readFile(join(cwd, "deltas.json"), "utf8")).toBe('{"deltas":[]}');
    expect(await readFile(join(cwd, "harness.json"), "utf8")).toBe('{"preset":"x"}');
    // the same input packs to the same bytes
    expect(await packStep(makeDeps(env, fresh()))).toBe(0);
    expect(Buffer.from(await readFile(join(cwd, "resurrection.tgz"))).equals(Buffer.from(tgz))).toBe(true);
    expect(cap.outputs["tarball_digest"]).toBe(createHash("sha256").update(tgz).digest("hex"));
  });

  it("pack refuses a work/medium that is no longer valid intake", async () => {
    await mkdir(join(cwd, "work/medium/resurrection"), { recursive: true });
    await writeFile(join(cwd, "work/medium/resurrection/package.json"), "{}");
    const cap = fresh();
    expect(await packStep(makeDeps(env, cap))).toBe(1);
    expect(await exists("resurrection.tgz")).toBe(false);
  });
});

describe("output redaction and runStep", () => {
  it("redacts credentials in log, error and summary and rejects multi-line outputs", () => {
    const out: string[] = [];
    const io = createRedactingIo(
      {
        stdout: (t) => out.push(t),
        stderr: (t) => out.push(t),
        appendOutput: (t) => out.push(t),
        appendSummary: (t) => out.push(t),
      },
      { pathValues: [], userName: undefined },
      "posix",
    );
    const secret = `ghp_${"A".repeat(36)}`;
    io.log(`token ${secret}`);
    io.error(`token ${secret} at /home/runner/x`);
    io.summary(`Bearer abc.def ${secret}`);
    io.setOutput("kind", "resurrection");
    expect(out.join("")).not.toContain(secret);
    expect(out.join("")).not.toContain("/home/runner");
    expect(out.join("")).toContain("kind=resurrection");
    expect(() => io.setOutput("kind", "a\nb=c")).toThrow();
  });

  it("turns an unexpected throw into exit code 1", async () => {
    const cap = fresh();
    const deps = makeDeps(BASE_ENV, cap, {
      coroner: () => Promise.reject(new Error("network down with ghp_secret")),
    });
    expect(await runStep("coroner", deps)).toBe(1);
    expect(cap.errors.join("")).not.toContain("ghp_secret");
  });
});
