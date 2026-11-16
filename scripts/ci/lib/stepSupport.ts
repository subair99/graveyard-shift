// Shared wiring of the `checks`, `attest` and `publish` step entries (task 8.17): file operations, sha256,
// the redacting step output, and the production adapters. Logic lives in checksSteps/attestSteps/publishSteps.

import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { identityValuesFromEnv } from "../../../src/proof/core/identity";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import type { ExtractedFile } from "../../../src/proof/shell/tarball/tarballExtractor";
import type { Result } from "../../../src/engine/types";
import type { PublishFs } from "../../../src/pipeline/undertaker/shell/publish";
import { createRedactingIo } from "./intakeSteps";
import type { Env, StepIo } from "./intakeSteps";

export type { Env, StepIo };

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Plain file operations on paths relative to the working directory. */
export interface FileOps {
  readFile(file: string): Promise<Uint8Array>;
  writeFile(file: string, bytes: Uint8Array): Promise<void>;
  makeDir(dir: string): Promise<void>;
}

export const nodeFileOps: FileOps = {
  readFile: async (file) => new Uint8Array(await readFile(file)),
  writeFile: async (file, bytes) => {
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await writeFile(file, bytes);
  },
  makeDir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
};

export const nodePublishFs: PublishFs = {
  readFile: nodeFileOps.readFile,
  writeFile: nodeFileOps.writeFile,
  makeDir: nodeFileOps.makeDir,
  removeDir: async (dir) => {
    await rm(dir, { recursive: true, force: true });
  },
  listFiles: async (dir) => (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name),
};

export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Extracts a tarball into a temporary directory that is removed again; only the file list is kept. */
export async function extractInMemory(bytes: Uint8Array): Promise<Result<ExtractedFile[], string>> {
  const dir = await mkdtemp(path.join(tmpdir(), "gs-ci-"));
  try {
    const extracted = await extractTarball(bytes, dir);
    return extracted.ok ? { ok: true, value: extracted.value } : { ok: false, error: extracted.error.kind };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The step output of the real job: stdout, stderr, `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`, all redacted. */
export function createProductionIo(env: Env): StepIo {
  const platform = process.platform === "win32" ? "win32" : "posix";
  const outputFile = env["GITHUB_OUTPUT"];
  const summaryFile = env["GITHUB_STEP_SUMMARY"];
  return createRedactingIo(
    {
      stdout: (text) => void process.stdout.write(text),
      stderr: (text) => void process.stderr.write(text),
      appendOutput: (text) => {
        if (outputFile !== undefined && outputFile !== "") appendFileSync(outputFile, text);
      },
      appendSummary: (text) => {
        if (summaryFile !== undefined && summaryFile !== "") appendFileSync(summaryFile, text);
      },
    },
    identityValuesFromEnv(env, platform),
    platform,
  );
}

/** Runs a step; an unexpected throw becomes exit code 1 with a generic message. */
export async function guarded(name: string, io: StepIo, run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch {
    io.error(`${name} stopped on an unexpected error`);
    return 1;
  }
}
