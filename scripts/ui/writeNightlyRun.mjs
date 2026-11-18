// Writes `.crypt-nightly/run.json` from the nightly workflow_run event values (crypt-ui Requirements 9.10, 12.2).
// Dependency-free: `node:` imports only. The only file of the Crypt UI that reads process.env (Requirement 1.5).
// The shape checks equal NightlyRunRecordSchema (src/ui/core/nightlyRun.ts); tests compare the two.
// On a bad value it prints `::warning::` with the variable name only (never the value), writes nothing and exits 0.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const VARIABLES = ["GS_RUN_ID", "GS_RUN_STARTED_AT", "GS_CONCLUSION", "GS_HEAD_SHA", "GS_BUILD_SHA"];

const SECOND_PRECISION_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function isSecondPrecisionUtc(value) {
  if (!SECOND_PRECISION_UTC.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value.replace("Z", ".000Z");
}

/**
 * Checks the five values. Returns `{ ok: true, record }` or `{ ok: false, variables, message }`,
 * where `variables` names the bad variables and `message` never contains a value.
 */
export function checkNightlyRun(env) {
  const get = (name) => (typeof env[name] === "string" ? env[name] : "");
  const runIdText = get("GS_RUN_ID");
  const runId = /^[0-9]{1,16}$/.test(runIdText) ? Number(runIdText) : Number.NaN;
  const bad = [];
  if (!(Number.isSafeInteger(runId) && runId > 0)) bad.push("GS_RUN_ID");
  if (!isSecondPrecisionUtc(get("GS_RUN_STARTED_AT"))) bad.push("GS_RUN_STARTED_AT");
  if (!/^[a-z_]{1,32}$/.test(get("GS_CONCLUSION"))) bad.push("GS_CONCLUSION");
  if (!/^[0-9a-f]{40}$/.test(get("GS_HEAD_SHA"))) bad.push("GS_HEAD_SHA");
  if (!/^[0-9a-f]{40}$/.test(get("GS_BUILD_SHA"))) bad.push("GS_BUILD_SHA");
  if (bad.length > 0) {
    return { ok: false, variables: bad, message: `invalid value for ${bad.join(", ")}` };
  }
  return {
    ok: true,
    record: {
      schemaVersion: 1,
      runId,
      runStartedAt: get("GS_RUN_STARTED_AT"),
      conclusion: get("GS_CONCLUSION"),
      headSha: get("GS_HEAD_SHA"),
      buildSha: get("GS_BUILD_SHA"),
    },
  };
}

/** Runs the writer in `cwd`; returns the lines to print and the exit code (always 0). */
export function writeNightlyRun(env, cwd) {
  const checked = checkNightlyRun(env);
  if (!checked.ok) {
    return { exitCode: 0, written: false, lines: checked.variables.map((v) => `::warning::nightly run record not written: invalid ${v}`) };
  }
  const dir = join(cwd, ".crypt-nightly");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), `${JSON.stringify(checked.record, null, 2)}\n`, "utf8");
  return { exitCode: 0, written: true, lines: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = writeNightlyRun(process.env, process.cwd());
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  process.exitCode = result.exitCode;
}
