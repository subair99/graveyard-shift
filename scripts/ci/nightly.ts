/**
 * CI entry of the `verify` job of nightly.yml: `tsx scripts/ci/nightly.ts`. Logic is in
 * src/pipeline/undertaker/shell/nightly.ts; this file only wires the real side effects.
 * Reads graveyard/, writes nightly-report.json and the job summary. It commits nothing and deploys nothing.
 * Environment: GH_TOKEN (or GITHUB_TOKEN) for `gh` and the GitHub REST API, GITHUB_STEP_SUMMARY (optional).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runAutopsy } from "../../src/engine";
import { createMemoryCache } from "../../src/engine/cache/cache";
import { systemClock } from "../../src/engine/clock";
import { identityValuesFromEnv } from "../../src/proof/core/identity";
import {
  GRAVEYARD_DIR,
  NIGHTLY_REPORT_FILE,
  runNightly,
  runningToolVersions,
  type GhRunner,
  type NightlyDeps,
  type NightlyFs,
} from "../../src/pipeline/undertaker/shell/nightly";
import { productionDeps, runProve } from "./prove";
import { createProductionIo, sha256Hex } from "./lib/stepSupport";

const REGISTRY = "https://registry.npmjs.org";
const FETCH_TIMEOUT_MS = 30_000;

const nodeFs: NightlyFs = {
  listDirs: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return null;
    }
  },
  exists: (file) => existsSync(file),
  listFiles: (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name),
  readBytes: (file) => {
    try {
      return new Uint8Array(readFileSync(file));
    } catch {
      return null;
    }
  },
  writeText: (file, text) => {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    writeFileSync(file, text, "utf8");
  },
};

/** `gh` without a shell, in `cwd`, with the process environment (GH_TOKEN comes from the workflow). */
const runGh: GhRunner = (argv, options) =>
  new Promise((resolve) => {
    const child = spawn("gh", [...argv], {
      shell: false,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const errs: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => errs.push(b));
    child.on("error", () => resolve({ code: 127, stdout: "", stderr: "could not start gh" }));
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(errs).toString("utf8") }),
    );
  });

/** The Original's tarball from the registry: the packument names the tarball URL of the version. */
async function fetchOriginal(name: string, version: string): Promise<Uint8Array> {
  const packument = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!packument.ok) throw new Error(`the registry answered ${packument.status} for ${name}`);
  const body = (await packument.json()) as { versions?: Record<string, { dist?: { tarball?: unknown } }> };
  const url = body.versions?.[version]?.dist?.tarball;
  if (typeof url !== "string" || !url.startsWith(`${REGISTRY}/`)) throw new Error(`no registry tarball URL for ${name}@${version}`);
  const tarball = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!tarball.ok) throw new Error(`the registry answered ${tarball.status} for the tarball of ${name}@${version}`);
  return new Uint8Array(await tarball.arrayBuffer());
}

export function productionNightlyDeps(env: Readonly<Record<string, string | undefined>>): NightlyDeps {
  const platform = process.platform === "win32" ? "win32" : "posix";
  const prove = { ...productionDeps(), setOutput: () => undefined };
  const token = env["GH_TOKEN"] ?? env["GITHUB_TOKEN"];
  return {
    root: GRAVEYARD_DIR,
    reportFile: NIGHTLY_REPORT_FILE,
    fs: nodeFs,
    runGh,
    sha256: sha256Hex,
    io: createProductionIo(env),
    runningTools: runningToolVersions(prove.toolVersions.node, prove.toolVersions.fastCheck),
    coroner: (name, version) =>
      runAutopsy(
        { kind: "name", name, version },
        { requestTimeoutMs: 10_000, concurrency: 8, ...(token !== undefined && token !== "" ? { githubToken: token } : {}) },
        { fetch, clock: systemClock, cache: createMemoryCache() },
      ),
    replay: {
      prove,
      runProve,
      readBytes: nodeFs.readBytes,
      writeBytes: (file, bytes) => {
        mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        writeFileSync(file, bytes);
      },
      fetchOriginal,
    },
    makeWorkDir: () => mkdtempSync(path.join(tmpdir(), "gs-nightly-")),
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
    identity: identityValuesFromEnv(env, platform),
    platform,
  };
}

async function main(): Promise<number> {
  const outcome = await runNightly(productionNightlyDeps({ ...process.env }));
  return outcome.exitCode;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("nightly stopped on an unexpected error\n");
      process.exitCode = 1;
    },
  );
}
