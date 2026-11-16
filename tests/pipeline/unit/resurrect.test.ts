// Requirements: 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.10, 6.11, 6.13, 6.14, 6.15, 7.1, 7.2, 7.6, 7.9, 7.11, 21.10, 23.1, 23.2, 23.4, 23.5, 23.17
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_MEDIUM_PATHS } from "../../../src/pipeline/common/constants";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import { readFsEntries } from "../../../src/pipeline/intake/shell/fsEntries";
import type { IntakeEntry } from "../../../src/pipeline/intake/core/types";
import { parseLedger } from "../../../src/pipeline/local/core/ledger";
import {
  CERTIFICATE_ENV_VAR,
  CERTIFICATE_FILE,
  LEDGER_REMINDER,
  runResurrect,
  STUB_NO_CREDIT_TEXT,
  type ResurrectDeps,
  type ResurrectFs,
} from "../../../src/pipeline/local/shell/resurrect";
import type { StubCopyItem, StubListEntry } from "../../../src/pipeline/local/core/stubPlan";
import type { KiroOutcome } from "../../../src/pipeline/medium/shell/kiroRunner";
import type { PushInput } from "../../../src/pipeline/local/shell/push";
import { IP_CERT, LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const FIXTURE_REL = "tests/pipeline/fixtures/stub/lodash.set";
const FIXTURE_ABS = path.resolve(__dirname, "../fixtures/stub/lodash.set");
const IP_MEASUREMENT = readFileSync(path.resolve(__dirname, "../../../docs/measurements/ip-2.0.1.json"), "utf8");
const NOW = new Date("2026-11-16T10:00:00.000Z");
const GOOD_LISTING: StubListEntry[] = [
  { path: "resurrection", type: "directory" },
  { path: "resurrection/package.json", type: "file" },
  { path: "deltas.json", type: "file" },
  { path: "harness.json", type: "file" },
];

interface Options {
  cert?: typeof LODASH_SET_CERT;
  license?: string;
  files?: Record<string, string>;
  answers?: string[];
  outcome?: KiroOutcome;
  entries?: IntakeEntry[];
  listing?: StubListEntry[];
  pathFns?: typeof path.win32;
  repoRoot?: string;
  pushCode?: number;
  ledgerWriteFails?: boolean;
}

function setup(opts: Options = {}) {
  const log: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const files = new Map<string, string>(Object.entries(opts.files ?? {}));
  const copies: StubCopyItem[][] = [];
  const kiroEnvs: Array<Record<string, string | undefined>> = [];
  const kiroRuns: string[] = [];
  const pushes: PushInput[] = [];
  const answers = [...(opts.answers ?? ["10 credits", "12 credits"])];
  const cert = opts.cert ?? LODASH_SET_CERT;
  const fs: ResurrectFs = {
    exists: async (rel) => files.has(rel) || [...files.keys()].some((k) => k.startsWith(`${rel}/`)),
    readText: async (rel) => files.get(rel) ?? null,
    mkdir: async () => undefined,
    writeText: async (rel, text) => {
      log.push(`write ${rel}`);
      files.set(rel, text);
    },
    writeAtomic: async (rel, text) => {
      if (opts.ledgerWriteFails) throw new Error("disk full");
      log.push(`atomic ${rel}`);
      files.set(rel, text);
    },
    listDir: async () => opts.listing ?? GOOD_LISTING,
    copy: async (items) => {
      log.push("copy");
      copies.push([...items]);
    },
  };
  const deps: ResurrectDeps = {
    repoRoot: opts.repoRoot ?? "/home/u/graveyard-shift",
    path: opts.pathFns ?? path.posix,
    fs,
    coroner: async () => {
      log.push("coroner");
      return { certificates: [cert], errors: [], notes: [] };
    },
    gravedigger: async (c): Promise<GravediggerResult> => {
      log.push("gravedigger");
      return {
        record: buildEligibilityRecord({
          name: c.package.name,
          version: c.package.version,
          cert: c,
          expectedIntegrity: "sha512-AAAA",
          computedIntegrity: "sha512-AAAA",
          pkg: { license: opts.license ?? "MIT" },
          lineCount: 10,
          packumentUrl: "https://registry.npmjs.org/x",
          tarballUrl: "https://registry.npmjs.org/x/-/x.tgz",
          fetchedAt: "2026-11-16T10:00:00Z",
        }),
        tarball: null,
      };
    },
    kiro: (env) => {
      kiroEnvs.push(env);
      return {
        run: async (name) => {
          log.push("kiro");
          kiroRuns.push(name);
          return opts.outcome ?? { kind: "exited", exitCode: 0, usageLimit: false };
        },
      };
    },
    kiroVersion: async () => "kiro-cli 1.2.3",
    prompt: {
      ask: async (q) => {
        asked.push(q);
        return answers.shift() ?? "";
      },
    },
    readEntries: async () => {
      log.push("validate");
      return opts.entries ?? readFsEntries(FIXTURE_ABS, ALLOWED_MEDIUM_PATHS);
    },
    push: async (input) => {
      log.push("push");
      pushes.push(input);
      return opts.pushCode ?? 0;
    },
    clock: { now: () => NOW },
    env: { GITHUB_TOKEN: "secret-token-value", HOME: "/home/u" },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { deps, log, out, err, asked, files, copies, kiroEnvs, kiroRuns, pushes };
}

const ledgerOf = (files: Map<string, string>) => {
  const parsed = parseLedger(files.get("ledger.json") ?? "");
  if (!parsed.ok) throw new Error("ledger not valid");
  return parsed.value;
};

describe("Local_Runner", () => {
  it("exits 64 with usage and starts nothing for bad arguments", async () => {
    const s = setup();
    const r = await runResurrect(["a", "b"], s.deps);
    expect(r.exitCode).toBe(64);
    expect(s.err.join("\n")).toContain("Usage:");
    expect(s.log).toEqual([]);
  });

  it("stops first on a malformed ledger, names the file and leaves it unchanged", async () => {
    const s = setup({ files: { "ledger.json": "{ nope" } });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("ledger.json is malformed");
    expect(s.log).toEqual([]);
    expect(s.files.get("ledger.json")).toBe("{ nope");
  });

  it.each(["resurrection/package.json", "deltas.json", "harness.json"])("refuses when %s already exists at the root", async (f) => {
    const s = setup({ files: { [f]: "x" } });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("Remove");
    expect(s.log).toEqual([]);
  });

  it("stops on an ineligible package: failed rules, no-branch dispatch command, no Medium, no ledger entry", async () => {
    const s = setup({ license: "GPL-3.0" });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    const text = s.err.join("\n");
    expect(text).toContain("failed rule:");
    expect(text).toContain("gh workflow run resurrect.yml");
    expect(text).not.toContain("branch=");
    expect(text).toContain("medium_mode=local");
    expect(text).toContain(`gh workflow run resurrect.yml`);
    expect(text).toContain(`package=lodash.set`);
    // Print only: Runner_Deps has no gh entry point, and nothing but the two analysis steps ran.
    expect(s.log.filter((l) => /dispatch|push|gh/.test(l))).toEqual([]);
    expect(s.kiroRuns).toEqual([]);
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
  });

  it("ip gate: stops without a measurement file", async () => {
    const s = setup({ cert: IP_CERT });
    const r = await runResurrect(["ip"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("docs/measurements/ip-2.0.1.json is missing");
    expect(s.kiroRuns).toEqual([]);
  });

  it("ip gate: stops when the measurement leaves no delta", async () => {
    const measured = JSON.parse(IP_MEASUREMENT) as { results: Array<{ outcome: unknown }> };
    for (const r of measured.results) r.outcome = { kind: "threw", error: "TypeError" };
    const s = setup({ cert: IP_CERT, files: { "docs/measurements/ip-2.0.1.json": JSON.stringify(measured) } });
    const r = await runResurrect(["ip"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("no delta");
    expect(s.kiroRuns).toEqual([]);
  });

  it("ip gate: passes with the committed measurement", async () => {
    const s = setup({ cert: IP_CERT, files: { "docs/measurements/ip-2.0.1.json": IP_MEASUREMENT } });
    const r = await runResurrect(["ip"], s.deps);
    expect(r.exitCode).toBe(0);
    expect(s.kiroRuns).toEqual(["ip"]);
  });

  it("local run: one Medium start, two readings verbatim, ledger before push, one push, reminder", async () => {
    const s = setup();
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(0);
    expect(s.kiroRuns).toEqual(["lodash.set"]);
    expect(s.asked).toHaveLength(2);
    expect(s.out.join("\n")).toContain("documented rule that this command does not enforce");
    expect(s.log).toEqual(["coroner", "gravedigger", "write " + CERTIFICATE_FILE, "kiro", "atomic ledger.json", "validate", "push"]);
    const entry = ledgerOf(s.files).entries[0];
    expect(entry).toMatchObject({
      mode: "local",
      package: "lodash.set",
      version: LODASH_SET_CERT.package.version,
      date: "2026-11-16T10:00:00Z",
      creditBefore: "10 credits",
      creditAfter: "12 credits",
      exitCode: 0,
      kiroCliVersion: "kiro-cli 1.2.3",
    });
    expect(s.pushes).toEqual([{ package: "lodash.set", version: LODASH_SET_CERT.package.version, mode: "local", root: s.deps.repoRoot }]);
    for (const line of LEDGER_REMINDER) expect(s.out).toContain(line);
    expect(s.out.join("\n")).toContain("commit ledger.json yourself");
    expect(s.files.get(CERTIFICATE_FILE)).toContain(LODASH_SET_CERT.package.name);
  });

  it("passes GRAVEYARD_CERTIFICATE_PATH to the Medium and prints no environment value or ledger path", async () => {
    const s = setup();
    await runResurrect(["lodash.set"], s.deps);
    expect(s.kiroEnvs[0]?.[CERTIFICATE_ENV_VAR]).toBe("/home/u/graveyard-shift/.graveyard-work/certificate.json");
    const printed = [...s.out, ...s.err].join("\n");
    expect(printed).not.toContain("secret-token-value");
    expect(s.files.get("ledger.json")).not.toContain("/home/u");
  });

  it("records not provided for an empty reading", async () => {
    const s = setup({ answers: ["", "  "] });
    await runResurrect(["lodash.set"], s.deps);
    expect(ledgerOf(s.files).entries[0]).toMatchObject({ creditBefore: "not provided", creditAfter: "not provided" });
  });

  it("prints a path with a newline escaped (R9.6)", async () => {
    const entry: IntakeEntry = { path: "resurrection/a\n::warning::x", type: "file", size: 1 };
    const s = setup({ entries: [entry] });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    const lines = s.err.join("\n");
    expect(lines).toContain("resurrection/a\\u000a::warning::x: bad-path");
    expect(lines).toContain("U+000A");
    expect(s.err.every((l) => !/[\u0000-\u001f\u007f]/.test(l) && !l.startsWith("::"))).toBe(true);
    expect(s.pushes).toEqual([]);
  });

  it("violation path writes the ledger, lists the violations and does not push", async () => {
    const s = setup({ entries: [] });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(ledgerOf(s.files).entries).toHaveLength(1);
    expect(s.err.join("\n")).toContain("missing-required");
    expect(s.pushes).toEqual([]);
    expect(s.log.indexOf("atomic ledger.json")).toBeLessThan(s.log.indexOf("validate"));
  });

  it("a Medium exit code other than 0 writes the ledger with that code and does not push", async () => {
    const s = setup({ outcome: { kind: "exited", exitCode: 3, usageLimit: false } });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(ledgerOf(s.files).entries[0]).toMatchObject({ exitCode: 3 });
    expect(s.pushes).toEqual([]);
    expect(s.out.join("\n")).toContain("commit ledger.json yourself");
  });

  it("missing kiro-cli names the cause and the setup note, with no ledger entry and no push", async () => {
    const s = setup({ outcome: { kind: "not-found" } });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("kiro-cli was not found");
    expect(s.err.join("\n")).toContain("spikes/kiro-agent/README.md");
    expect(s.files.has("ledger.json")).toBe(false);
    expect(s.pushes).toEqual([]);
  });

  it("a usage-limit outcome names the cause, writes the ledger and does not push", async () => {
    const s = setup({ outcome: { kind: "exited", exitCode: 1, usageLimit: true } });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("usage limit");
    expect(ledgerOf(s.files).entries).toHaveLength(1);
    expect(s.pushes).toEqual([]);
  });

  it("keeps earlier ledger entries and does not push when the ledger cannot be written", async () => {
    const s = setup({ ledgerWriteFails: true });
    const r = await runResurrect(["lodash.set"], s.deps);
    expect(r.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("ledger.json could not be written");
    expect(s.pushes).toEqual([]);
  });

  it("returns the exit code of push", async () => {
    const s = setup({ pushCode: 1 });
    expect((await runResurrect(["lodash.set"], s.deps)).exitCode).toBe(1);
  });
});

describe("Local_Runner stub run", () => {
  it("copies the fixture, asks no reading, prints the no-credit line and writes a stub entry", async () => {
    const s = setup();
    const r = await runResurrect(["lodash.set", "--stub", FIXTURE_REL], s.deps);
    expect(r.exitCode).toBe(0);
    expect(s.kiroRuns).toEqual([]);
    expect(s.asked).toEqual([]);
    expect(s.out).toContain(STUB_NO_CREDIT_TEXT);
    expect(s.copies[0]?.map((i) => i.relative)).toEqual(["deltas.json", "harness.json", "resurrection", "resurrection/package.json"]);
    expect(ledgerOf(s.files).entries[0]).toEqual({
      mode: "stub",
      package: "lodash.set",
      version: LODASH_SET_CERT.package.version,
      date: "2026-11-16T10:00:00Z",
      fixture: FIXTURE_REL,
    });
    expect(s.out.join("\n")).not.toContain("Credit_Ceiling");
    expect(s.pushes[0]?.mode).toBe("stub");
    expect(s.log.indexOf("copy")).toBeLessThan(s.log.indexOf("atomic ledger.json"));
    expect(s.log.indexOf("atomic ledger.json")).toBeLessThan(s.log.indexOf("push"));
  });

  it("refuses a fixture with another entry before anything is copied", async () => {
    const s = setup({ listing: [...GOOD_LISTING, { path: "extra.txt", type: "file" }] });
    const r = await runResurrect(["lodash.set", "--stub", FIXTURE_REL], s.deps);
    expect(r.exitCode).toBe(64);
    expect(s.copies).toEqual([]);
    expect(s.log).toEqual([]);
  });

  it("refuses an absolute --stub path with exit 64", async () => {
    const s = setup();
    expect((await runResurrect(["lodash.set", "--stub", "/etc"], s.deps)).exitCode).toBe(64);
  });
});

describe("Local_Runner path injection (R21.10)", () => {
  it("builds Windows paths with path.win32", async () => {
    const s = setup({ pathFns: path.win32, repoRoot: "C:\\dev\\graveyard-shift" });
    await runResurrect(["lodash.set", "--stub", FIXTURE_REL], s.deps);
    expect(s.copies[0]?.find((i) => i.relative === "deltas.json")).toMatchObject({
      from: "C:\\dev\\graveyard-shift\\tests\\pipeline\\fixtures\\stub\\lodash.set\\deltas.json",
      to: "C:\\dev\\graveyard-shift\\deltas.json",
    });
    expect(s.files.get("ledger.json")).not.toContain("C:");
  });

  it("builds POSIX paths with path.posix and passes the certificate path on a local run", async () => {
    const s = setup({ pathFns: path.posix, repoRoot: "/home/u/graveyard-shift" });
    await runResurrect(["lodash.set"], s.deps);
    expect(s.kiroEnvs[0]?.[CERTIFICATE_ENV_VAR]).toBe("/home/u/graveyard-shift/.graveyard-work/certificate.json");
  });

  it("builds the Windows certificate path with path.win32", async () => {
    const s = setup({ pathFns: path.win32, repoRoot: "C:\\dev\\graveyard-shift" });
    await runResurrect(["lodash.set"], s.deps);
    expect(s.kiroEnvs[0]?.[CERTIFICATE_ENV_VAR]).toBe("C:\\dev\\graveyard-shift\\.graveyard-work\\certificate.json");
  });
});
