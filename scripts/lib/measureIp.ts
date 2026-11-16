/**
 * ip measurement logic (resurrection-pipeline requirement 3). Testable: the executor, the clock and
 * the redaction function are injected. The CLI wrapper is `scripts/measureIp.ts`.
 *
 * Runs the Original ip@2.0.1 through the proof engine's Executor interface (open side, call), with
 * no network, calls `isPublic` for the five Advisory_Addresses and the informational inputs, and
 * records the exact returned value or the redacted thrown error. Nothing here states a result: the
 * values written to the measurement file come only from the calls.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { encodeValue } from "../../src/proof/child/codec/encode";
import { identityValuesFromEnv, redactIdentity } from "../../src/proof/core/identity";
import type { Platform } from "../../src/proof/core/identity";
import { redactErrorText } from "../../src/proof/core/redact";
import type { PathContext } from "../../src/proof/core/redact";
import { resolveEntry } from "../../src/proof/shell/entry";
import type { Executor, ExportEntry, SideSpec } from "../../src/proof/shell/executor/types";
import { createRestartBudget } from "../../src/proof/shell/executor/types";
import { createSandboxExecutorFactory } from "../../src/proof/shell/executor/sandboxExecutor";
import { verifyIntegrity } from "../../src/proof/shell/integrity";
import { extractTarball } from "../../src/proof/shell/tarball/tarballExtractor";
import { formatTimestamp } from "../../src/engine/sources/http";
import { safeParseResult } from "../../src/engine/types";
import type { Clock } from "../../src/engine/types";
import type { EncodedNode, Outcome } from "../../src/proof/types";
import {
  ADVISORY_ADDRESSES,
  INFORMATIONAL_ADDRESSES,
  IpMeasurementSchema,
  printIpMeasurement,
} from "../../src/pipeline/harness/core/ipMeasurement";
import type { IpMeasurement, JsonValue, MeasuredInput } from "../../src/pipeline/harness/core/ipMeasurement";

export const IP_PACKAGE = "ip";
export const IP_VERSION = "2.0.1";
export const IP_FUNCTION = "isPublic";
export const IP_TARBALL_PATH = "tests/proof/fixtures/ip/ip-2.0.1.tgz";
export const IP_META_PATH = "tests/proof/fixtures/ip/ip-2.0.1.meta.json";
export const IP_OUTPUT_PATH = "docs/measurements/ip-2.0.1.json";

/** Advisory ids and sources from spikes/candidates/IP-SKETCH.md; checkedOn is the user's check date. */
export const ADVISORY = {
  id: "GHSA-2p57-rm9w-gvfp",
  aliases: ["CVE-2024-29415"],
  sources: [
    { url: "https://github.com/advisories/GHSA-2p57-rm9w-gvfp", checkedOn: "2026-11-15" },
    { url: "https://nvd.nist.gov/vuln/detail/CVE-2024-29415", checkedOn: "2026-11-15" },
  ],
} as const;

const SIDE_LIMITS = { callTimeoutMs: 5000, heapLimitMb: 256, outputLimitBytes: 100000 } as const;

export class MeasureIpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasureIpError";
  }
}

// ---------------------------------------------------------------------------
// Outcome conversion
// ---------------------------------------------------------------------------

function notJson(tag: string): JsonValue {
  return { notJson: tag };
}

/** Converts an encoded value to JSON. A value JSON cannot carry is recorded as `{ notJson: <tag> }`. */
export function nodeToJson(node: EncodedNode): JsonValue {
  switch (node.t) {
    case "null":
      return null;
    case "bool":
    case "str":
      return node.v;
    case "num":
      return typeof node.v === "number" && !Object.is(node.v, -0) ? node.v : notJson("num");
    case "array": {
      if (node.props.length > 0 || node.items.length !== node.length) return notJson("array");
      const sorted = [...node.items].sort((a, b) => a.i - b.i);
      if (sorted.some((item, i) => item.i !== i)) return notJson("array");
      return sorted.map((item) => nodeToJson(item.n));
    }
    case "object": {
      if (node.ctor !== "Object" && node.ctor !== null) return notJson("object");
      return Object.fromEntries(node.props.map(([k, v]) => [k, nodeToJson(v)]));
    }
    default:
      return notJson(node.t);
  }
}

function errorText(node: EncodedNode): string {
  if (node.t === "error") return `${node.cls}: ${node.message}`;
  if (node.t === "str") return node.v;
  return `thrown ${node.t}`;
}

/** Maps an engine Outcome to the measurement outcome. `redact` is applied to every error text. */
export function toMeasuredOutcome(outcome: Outcome, redact: (text: string) => string): MeasuredInput["outcome"] {
  switch (outcome.kind) {
    case "returned":
      return { kind: "returned", value: nodeToJson(outcome.value) };
    case "threw":
      return { kind: "threw", error: redact(errorText(outcome.value)) };
    case "rejected":
      return { kind: "threw", error: redact(`rejected: ${errorText(outcome.value)}`) };
    default:
      return { kind: "threw", error: outcome.kind };
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export interface MeasureIpDeps {
  executor: Executor;
  spec: SideSpec;
  clock: Clock;
  integrity: string;
  /** Node version string of the parent process (`process.version`). */
  node: string;
  redact: (text: string) => string;
}

export interface MeasureIpResult {
  measurement: IpMeasurement;
  exports: readonly ExportEntry[];
}

/** Opens the Original through the Executor, reads its exports and calls `isPublic` for every input. */
export async function measureIp(deps: MeasureIpDeps): Promise<MeasureIpResult> {
  const opened = await deps.executor.open(deps.spec);
  if (!opened.ok) throw new MeasureIpError(`open failed: ${opened.error.kind}: ${deps.redact(opened.error.message)}`);
  const handle = opened.value;
  try {
    const listed = await handle.listExports();
    if (!listed.ok) throw new MeasureIpError(`listing exports failed: ${listed.error.kind}: ${deps.redact(listed.error.message)}`);

    const measure = async (input: string): Promise<MeasuredInput> => {
      const arg = encodeValue(input, { budget: 100000 });
      if (!arg.ok) throw new MeasureIpError("an input could not be encoded");
      const called = await handle.call({
        fn: IP_FUNCTION,
        args: [arg.node],
        caseSeed: 1,
        stubs: { date: true, random: true },
        properties: [],
      });
      if (!called.ok) throw new MeasureIpError(`call failed for ${JSON.stringify(input)}: ${called.error.kind}: ${deps.redact(called.error.message)}`);
      return { input, outcome: toMeasuredOutcome(called.value.outcome, deps.redact) };
    };

    const results: MeasuredInput[] = [];
    for (const input of ADVISORY_ADDRESSES) results.push(await measure(input));
    const informational: MeasuredInput[] = [];
    for (const input of INFORMATIONAL_ADDRESSES) informational.push(await measure(input));

    const candidate = {
      schemaVersion: 1,
      package: IP_PACKAGE,
      version: IP_VERSION,
      integrity: deps.integrity,
      node: deps.node,
      measuredAt: formatTimestamp(deps.clock.now()),
      advisory: {
        id: ADVISORY.id,
        aliases: [...ADVISORY.aliases],
        sources: ADVISORY.sources.map((s) => ({ ...s })),
      },
      results,
      informational,
    };
    const parsed = safeParseResult(IpMeasurementSchema, candidate);
    if (!parsed.ok) throw new MeasureIpError(`the measurement is invalid: ${parsed.error.issues.join("; ")}`);
    return { measurement: parsed.value, exports: listed.value.entries };
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Plain table
// ---------------------------------------------------------------------------

function showOutcome(outcome: MeasuredInput["outcome"]): string {
  return outcome.kind === "returned" ? `returned ${JSON.stringify(outcome.value)}` : `threw ${outcome.error}`;
}

/** Plain-text table for stderr: the results, the informational inputs and the exports. */
export function formatMeasurementTable(result: MeasureIpResult): string[] {
  const m = result.measurement;
  const lines = [
    `ip ${m.version}  integrity ${m.integrity}`,
    `node ${m.node}  measured at ${m.measuredAt}`,
    "",
    `${IP_FUNCTION}(input) for the Advisory_Addresses:`,
    ...m.results.map((r) => `  ${JSON.stringify(r.input).padEnd(22)} ${showOutcome(r.outcome)}`),
    "informational inputs (never used to derive a delta):",
    ...m.informational.map((r) => `  ${JSON.stringify(r.input).padEnd(22)} ${showOutcome(r.outcome)}`),
    "",
    "exports of the recorded tarball:",
    ...result.exports.map(
      (e) => `  ${e.name.padEnd(22)} ${e.type}${e.arity === undefined ? "" : `  arity ${e.arity}`}`,
    ),
  ];
  return lines;
}

// ---------------------------------------------------------------------------
// Real run (not unit tested: needs the recorded tarball and a real sandbox)
// ---------------------------------------------------------------------------

export interface RunMeasureIpOptions {
  repoRoot: string;
  clock: Clock;
  env: Readonly<Record<string, string | undefined>>;
  platform: Platform;
  node: string;
  log: (line: string) => void;
}

export async function runMeasureIp(options: RunMeasureIpOptions): Promise<MeasureIpResult> {
  const tarballPath = join(options.repoRoot, IP_TARBALL_PATH);
  const metaPath = join(options.repoRoot, IP_META_PATH);
  let bytes: Buffer;
  let metaText: string;
  try {
    bytes = readFileSync(tarballPath);
    metaText = readFileSync(metaPath, "utf8");
  } catch {
    throw new MeasureIpError(
      `The recorded tarball or its metadata is missing (${IP_TARBALL_PATH}). Run: npm run fixtures:record-tarball -- --package ip --version 2.0.1`,
    );
  }
  const meta = JSON.parse(metaText) as { name?: unknown; version?: unknown; integrity?: unknown };
  if (meta.name !== IP_PACKAGE || meta.version !== IP_VERSION || typeof meta.integrity !== "string") {
    throw new MeasureIpError(`${IP_META_PATH} is not the metadata of ${IP_PACKAGE}@${IP_VERSION}.`);
  }
  const verified = verifyIntegrity(bytes, meta.integrity);
  if (!verified.ok) throw new MeasureIpError(`The tarball does not match its recorded integrity: ${verified.error.message}`);

  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-ip-")));
  const executor = createSandboxExecutorFactory().create({ restartBudget: createRestartBudget(3) });
  try {
    const packageDir = join(root, "package");
    mkdirSync(packageDir);
    const extracted = await extractTarball(bytes, packageDir);
    if (!extracted.ok) throw new MeasureIpError(`The tarball could not be extracted: ${extracted.error.kind}`);
    const entry = resolveEntry(realpathSync.native(packageDir));
    if (!entry.ok) throw new MeasureIpError(entry.error.message);

    const identity = identityValuesFromEnv(options.env, options.platform);
    const context: PathContext = {
      caseInsensitive: options.platform === "win32",
      knownPaths: { work: root, nodeDir: dirname(process.execPath), tmpDir: tmpdir(), tempNames: [basename(root)] },
      identityPaths: identity.pathValues,
    };
    const redact = (text: string): string => redactIdentity(redactErrorText(text, context), identity, options.platform);

    const result = await measureIp({
      executor,
      spec: {
        side: "original",
        packageDir: realpathSync.native(packageDir),
        entryFile: entry.value.entryFile,
        readPaths: [],
        limits: { ...SIDE_LIMITS },
      },
      clock: options.clock,
      integrity: verified.value,
      node: options.node,
      redact,
    });

    const outPath = join(options.repoRoot, IP_OUTPUT_PATH);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, printIpMeasurement(result.measurement), "utf8");
    for (const line of formatMeasurementTable(result)) options.log(line);
    options.log("");
    options.log(`wrote ${IP_OUTPUT_PATH}`);
    return result;
  } finally {
    await executor.dispose();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
