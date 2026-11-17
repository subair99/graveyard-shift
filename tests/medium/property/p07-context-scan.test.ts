// Requirements: 5.5
// Feature: medium-agent, Property 7: The context scan stops the run on generated-file findings and on identity values only
// Local_Runner with a fake spawn, fake git, fake file system, fake prompt and fake clock. No kiro-cli, no network.
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { buildEligibilityRecord } from "../../../src/pipeline/gravedigger/core/record";
import type { GravediggerResult } from "../../../src/pipeline/gravedigger/shell/gravedigger";
import {
  runResurrect,
  type ResurrectDeps,
  type ResurrectFs,
} from "../../../src/pipeline/local/shell/resurrect";
import { createKiroRunner, type SpawnedProcess, type SpawnFn } from "../../../src/pipeline/medium/shell/kiroRunner";
import { LODASH_SET_CERT } from "../../pipeline/helpers/gravediggerCerts";

// The preset menu is built from the fixed PRESETS inside runResurrect and no dependency reaches it, so
// the test replaces only its printer, to let the menu text carry the planted value.
const menu = vi.hoisted(() => ({ extra: "" }));
vi.mock("../../../src/pipeline/medium/core/presetMenu", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/pipeline/medium/core/presetMenu")>();
  return { ...original, printPresetMenu: (...a: Parameters<typeof original.printPresetMenu>) => original.printPresetMenu(...a) + menu.extra };
});

const ROOT = "/home/u/graveyard-shift";
const NOW = new Date("2026-11-16T10:00:00.000Z");
const GUARD_LOG = ".graveyard-work/guard.log";
const MEASUREMENT_REL = `docs/measurements/lodash.set-${LODASH_SET_CERT.package.version}.json`;
const ALLOW_LINE = "2026-11-16T10:00:00Z ALLOW fs_write resurrection/package.json";

type Extract = Awaited<ReturnType<ResurrectDeps["extract"]>>;

function setup(opts: { certText?: string; eligibilityText?: string; measurement?: string; original: Array<{ path: string; text: string }>; identityPath: string }) {
  const err: string[] = [];
  const out: string[] = [];
  const asked: string[] = [];
  const spawns: string[] = [];
  const written: string[] = [];
  const removed: string[] = [];
  const files = new Map<string, string>();
  if (opts.measurement !== undefined) files.set(MEASUREMENT_REL, opts.measurement);
  const enc = new TextEncoder();

  const fakeSpawn: SpawnFn = (command) => {
    spawns.push(command);
    files.set(GUARD_LOG, `${ALLOW_LINE}\n`);
    const handlers: Record<string, Array<(...a: never[]) => void>> = {};
    const stream = { on: () => undefined };
    const child = {
      stdout: stream,
      stderr: stream,
      on: (event: string, listener: (...a: never[]) => void) => {
        (handlers[event] ??= []).push(listener);
      },
    };
    setTimeout(() => {
      for (const h of handlers["close"] ?? []) (h as (c: number | null, s: string | null) => void)(0, null);
    }, 0);
    return child as unknown as SpawnedProcess;
  };

  const fs: ResurrectFs = {
    exists: async (rel) => files.has(rel),
    readText: async (rel) => files.get(rel) ?? null,
    mkdir: async () => undefined,
    writeText: async (rel, text) => {
      files.set(rel, text);
    },
    writeAtomic: async (rel, text) => {
      files.set(rel, text);
    },
    listDir: async () => [
      { path: "resurrection", type: "directory" },
      { path: "resurrection/package.json", type: "file" },
      { path: "deltas.json", type: "file" },
      { path: "harness.json", type: "file" },
    ],
    copy: async () => undefined,
    readOptional: async (rel) => {
      const text = files.get(rel);
      return text === undefined ? null : enc.encode(text);
    },
    removeTree: async (rel) => {
      removed.push(rel);
    },
    writeBytes: async (rel) => {
      written.push(rel);
    },
    truncate: async (rel) => {
      files.set(rel, "");
    },
  };

  const extract: Extract = {
    ok: true,
    value: opts.original.map((f) => ({ path: f.path, bytes: enc.encode(f.text) })),
  };

  const deps: ResurrectDeps = {
    repoRoot: ROOT,
    path: path.posix,
    fs,
    coroner: async () => ({
      certificates: [
        opts.certText === undefined
          ? LODASH_SET_CERT
          : { ...LODASH_SET_CERT, openVulnerabilityIds: [opts.certText] },
      ],
      errors: [],
      notes: [],
    }),
    gravedigger: async (c): Promise<GravediggerResult> => ({
      record: {
        ...buildEligibilityRecord({
        name: c.package.name,
        version: c.package.version,
        cert: c,
        expectedIntegrity: "sha512-AAAA",
        computedIntegrity: "sha512-AAAA",
        pkg: { license: "MIT" },
        lineCount: 10,
        packumentUrl: "https://registry.npmjs.org/x",
        tarballUrl: "https://registry.npmjs.org/x/-/x.tgz",
        fetchedAt: "2026-11-16T10:00:00Z",
        }),
        ...(opts.eligibilityText === undefined ? {} : { successor: opts.eligibilityText }),
      },
      tarball: new Uint8Array([1]),
    }),
    gitStatus: async () => ({ ok: true, value: "" }),
    extract: async () => extract,
    identity: { pathValues: [opts.identityPath], userName: undefined },
    platform: "posix",
    kiro: (env) =>
      createKiroRunner({
        spawn: fakeSpawn,
        env,
        cwd: ROOT,
        added: {
          GRAVEYARD_CERTIFICATE_PATH: env["GRAVEYARD_CERTIFICATE_PATH"] ?? "",
          GUARD_LOG_FILE: env["GUARD_LOG_FILE"] ?? "",
        },
        out: () => undefined,
        err: () => undefined,
      }),
    kiroVersion: async () => "kiro-cli 1.2.3",
    prompt: {
      ask: async (q) => {
        asked.push(q);
        return "1 credit";
      },
    },
    readEntries: async (): ReturnType<ResurrectDeps["readEntries"]> => [],
    push: async () => 0,
    clock: { now: () => NOW },
    env: { PATH: "/usr/bin" },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { deps, err, out, asked, spawns, written, removed, files };
}

const token = fc.stringMatching(/^[a-z]{8,12}$/);
const planted = fc.record({
  tok: token,
  kind: fc.constantFrom("identity", "credential", "path"),
  target: fc.constantFrom(
    "measurement",
    "certificate",
    "eligibility",
    "menu",
    "original-a",
    "original-b",
  ),
});

function plantedText(kind: string, tok: string, identityPath: string): string {
  if (kind === "identity") return `${identityPath}/${tok}`;
  if (kind === "credential") return `ghp_${tok}`;
  return `/home/${tok}/src`;
}

describe("Property 7: the context scan stops on generated-file findings and on identity values only", () => {
  it("stops exactly when the file is generated or the planted text is an Identity_Value", async () => {
    await fc.assert(
      fc.asyncProperty(planted, async ({ tok, kind, target }) => {
        const identityPath = `/srv/people/${tok}id`;
        const text = plantedText(kind, tok, identityPath);
        const body = `{"note":"${text}"}`;
        const original = [
          { path: "package.json", text: target === "original-a" ? body : "{}" },
          { path: "lib/index.js", text: target === "original-b" ? body : "module.exports = 1;\n" },
        ];
        menu.extra = target === "menu" ? `\n${text}` : "";
        const s = setup({
          certText: target === "certificate" ? text : undefined,
          eligibilityText: target === "eligibility" ? text : undefined,
          measurement: target === "measurement" ? body : undefined,
          original,
          identityPath,
        });
        const relByTarget: Record<string, string> = {
          measurement: "measurement.json",
          certificate: "certificate.json",
          eligibility: "eligibility.json",
          menu: "preset-menu.json",
          "original-a": "original/package.json",
          "original-b": "original/lib/index.js",
        };
        const rel = relByTarget[target]!;
        const generated = !target.startsWith("original");
        const shouldStop = generated || kind === "identity";

        const r = await runResurrect(["lodash.set"], s.deps);

        if (shouldStop) {
          expect(r.exitCode).not.toBe(0);
          expect(s.spawns).toHaveLength(0);
          expect(s.asked).toEqual([]);
          expect(s.files.has("ledger.json")).toBe(false);
          expect(s.written).toEqual([]);
          expect(s.removed).toEqual([]);
          const all = [...s.err, ...s.out].join("\n");
          expect(all).toContain(rel);
          expect(all).not.toContain(text);
          expect(all).not.toContain(tok);
        } else {
          expect(s.spawns).toHaveLength(1);
          expect(s.written).toContain(`.graveyard-work/medium-context/${rel}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});
