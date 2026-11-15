/**
 * Spike 6: run the real autopsy engine over the shortlisted resurrection candidates and
 * two controls, and check each against the registry packument.
 *
 * Run MANUALLY by a human (needs network):
 *
 *   npx tsx --env-file=.env scripts/spike/coroner-candidates.ts [--dry-run]
 *
 * Reads GITHUB_TOKEN from process.env. Works without it (unauthenticated, with a warning).
 * The token is never printed and never written. Only JSON is fetched; no package code
 * (and no tarball) is downloaded or executed.
 *
 * Writes:
 *   spikes/candidates/certificates/<name>.json   canonical Death Certificate (engine output)
 *   spikes/candidates/RESULTS.md                 summary, eligibility, sources
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalJson, createMemoryCache, runAutopsy, systemClock } from "../../src/engine/index";
import type { DeathCertificate, EngineInput } from "../../src/engine/index";

// ---------------------------------------------------------------------------
// Targets. Pinned name@version as read from the registry (dist-tags.latest) on
// 2026-11-15; see spikes/candidates/SHORTLIST.md. Ordered by recommendation.
// ---------------------------------------------------------------------------

interface Target {
  name: string;
  version: string;
}

const CANDIDATES: readonly Target[] = [
  { name: "lodash.setwith", version: "4.3.2" },
  { name: "lodash.update", version: "4.10.2" },
  { name: "merge-recursive", version: "0.0.3" },
  { name: "ansi2html", version: "0.0.1" },
  { name: "lodash.updatewith", version: "4.10.2" },
  { name: "utils-extend", version: "1.0.8" },
  { name: "lodash.pick", version: "4.4.0" },
  { name: "safe-eval", version: "0.4.1" },
  { name: "node-serialize", version: "0.0.4" },
];

/** Controls: eligibility is expected to be "no" for both (see CONTROL_EXPECTATION). */
const CONTROLS: readonly Target[] = [
  { name: "ip", version: "2.0.1" },
  { name: "inflight", version: "1.0.6" },
];

const CONTROL_EXPECTATION: Record<string, string> = {
  ip: "blocked (task expectation: runtime dependencies)",
  inflight: "no resurrection (task expectation: retired-with-successor)",
};

const PERMITTED_LICENSES: readonly string[] = ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"];

const OUT_DIR = resolve(process.cwd(), "spikes", "candidates");
const CERT_DIR = join(OUT_DIR, "certificates");
const RESULTS_FILE = join(OUT_DIR, "RESULTS.md");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type UnavailableLike = { available: false; source: string; reason: string };
type MaybeLike<T> = { available: true; value: T } | UnavailableLike;

function maybeText<T>(m: MaybeLike<T>, format: (value: T) => string): string {
  return m.available ? format(m.value) : `unavailable (${m.source}: ${m.reason})`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function utcSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function fileSafe(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "__");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** Secret handling: the token is only ever passed to the engine. */
function makeGuards(token: string | undefined): {
  redact: (text: string) => string;
  assertClean: (label: string, text: string) => void;
} {
  const secret = token !== undefined && token !== "" ? token : undefined;
  return {
    redact: (text) => (secret !== undefined ? text.split(secret).join("[redacted]") : text),
    assertClean: (label, text) => {
      if (secret !== undefined && text.includes(secret)) {
        throw new Error(`Refusing to write ${label}: it contains the token.`);
      }
      if (text.includes("Authorization") || text.includes("Bearer")) {
        throw new Error(`Refusing to write ${label}: it contains an authorization marker.`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Registry packument (fetched directly, outside the engine)
// ---------------------------------------------------------------------------

interface RegistryRecord {
  sourceUrl: string;
  fetchedAt: string;
  requestedVersion: string;
  versionPresent: boolean;
  latest: string | undefined;
  license: string | undefined;
  legacyLicenses: string | undefined;
  dependencyNames: string[];
  dependenciesField: "absent" | "empty" | "present";
  type: string | undefined;
  main: string | undefined;
  hasExports: boolean;
  deprecated: string | undefined;
  unpackedSize: number | undefined;
  fileCount: number | undefined;
  published: string | undefined;
  maintainerCount: number | undefined;
  repositoryUrl: string | undefined;
}

function registryUrl(name: string): string {
  return `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
}

function licenseText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return record === undefined ? undefined : asString(record["type"]);
}

function legacyLicensesText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((v) => licenseText(v)).filter((v): v is string => v !== undefined);
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  return undefined;
}

async function fetchRegistry(target: Target): Promise<RegistryRecord> {
  const sourceUrl = registryUrl(target.name);
  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const fetchedAt = utcSeconds(systemClock.now());
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status} for ${sourceUrl}`);
  const packument = asRecord(await response.json());
  if (packument === undefined) throw new Error("registry response is not a JSON object");

  const latest = asString(asRecord(packument["dist-tags"])?.["latest"]);
  const versions = asRecord(packument["versions"]);
  const version = asRecord(versions?.[target.version]);
  const time = asRecord(packument["time"]);
  const maintainers = packument["maintainers"];

  const dependencies = asRecord(version?.["dependencies"]);
  const dependencyNames = dependencies === undefined ? [] : Object.keys(dependencies);
  const dist = asRecord(version?.["dist"]);
  const repository = version?.["repository"];
  const repositoryUrl = typeof repository === "string" ? repository : asString(asRecord(repository)?.["url"]);

  return {
    sourceUrl,
    fetchedAt,
    requestedVersion: target.version,
    versionPresent: version !== undefined,
    latest,
    license: licenseText(version?.["license"]),
    legacyLicenses: legacyLicensesText(version?.["licenses"]),
    dependencyNames,
    dependenciesField:
      dependencies === undefined ? "absent" : dependencyNames.length === 0 ? "empty" : "present",
    type: asString(version?.["type"]),
    main: asString(version?.["main"]),
    hasExports: version?.["exports"] !== undefined,
    deprecated: asString(version?.["deprecated"]),
    unpackedSize: asNumber(dist?.["unpackedSize"]),
    fileCount: asNumber(dist?.["fileCount"]),
    published: asString(time?.[target.version]),
    maintainerCount: Array.isArray(maintainers) ? maintainers.length : undefined,
    repositoryUrl,
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

interface Verdict {
  eligible: boolean;
  reasons: string[];
  notes: string[];
}

function evaluate(
  reg: RegistryRecord | undefined,
  regError: string | undefined,
  cert: DeathCertificate | undefined,
  engineError: string | undefined,
): Verdict {
  const reasons: string[] = [];
  const notes: string[] = [];

  if (reg === undefined) {
    reasons.push(`unverified: registry packument unavailable (${regError ?? "no detail"})`);
  } else if (!reg.versionPresent) {
    reasons.push(`pinned version ${reg.requestedVersion} not found in the packument`);
  } else {
    if (reg.license === undefined) {
      reasons.push(
        reg.legacyLicenses === undefined
          ? "license field absent (unverified)"
          : `license field absent; legacy "licenses" field says ${reg.legacyLicenses} (unverified)`,
      );
    } else if (!PERMITTED_LICENSES.includes(reg.license)) {
      reasons.push(`license not permitted or not a plain SPDX id: ${reg.license}`);
    }
    if (reg.dependencyNames.length > 0) {
      reasons.push(`${reg.dependencyNames.length} runtime dependencies (${reg.dependencyNames.join(", ")})`);
    }
    if (reg.type === "module") reasons.push('package.json "type" is "module"');
    if (reg.main === undefined) notes.push('"main" absent (Node falls back to index.js; unverified)');
    if (reg.hasExports) notes.push('"exports" field present (check CommonJS entry)');
    if (reg.unpackedSize === undefined) notes.push("unpackedSize not reported by the registry for this version");
    if (reg.latest !== undefined && reg.latest !== reg.requestedVersion) {
      notes.push(`pinned version is not dist-tags.latest (${reg.latest})`);
    }
    if (reg.deprecated !== undefined) notes.push("deprecated on npm");
    if (reg.repositoryUrl === undefined || reg.repositoryUrl === "") notes.push("no repository URL in package.json");
  }

  if (cert === undefined) {
    reasons.push(`unverified: no certificate (${engineError ?? "no detail"})`);
  } else {
    if (cert.status === "retired-with-successor") {
      reasons.push(`status retired-with-successor${cert.successor !== undefined ? ` (${cert.successor})` : ""}`);
    } else if (cert.status === "alive") {
      reasons.push("status alive (not abandoned)");
    } else if (cert.status === undefined) {
      reasons.push(`unverified: status absent (${cert.statusError ?? "no detail"})`);
    }
    const vulnerabilities = cert.vitalSigns.openVulnerabilities;
    if (!vulnerabilities.available) {
      reasons.push(`unverified: open vulnerabilities unavailable (${vulnerabilities.reason})`);
    } else if (cert.openVulnerabilityIds.length === 0) {
      reasons.push("no open vulnerability per the engine (OSV)");
    }
    if (cert.causes.length === 0) reasons.push("no cause of death detected");
  }

  return { eligible: reasons.length === 0, reasons, notes };
}

function verdictText(v: Verdict): string {
  return v.eligible ? "yes" : `no (${v.reasons.join("; ")})`;
}

// ---------------------------------------------------------------------------
// Per-target work
// ---------------------------------------------------------------------------

interface Outcome {
  target: Target;
  role: "candidate" | "control";
  cert?: DeathCertificate;
  certFile?: string;
  engineError?: string;
  engineNotes: string[];
  reg?: RegistryRecord;
  regError?: string;
  verdict: Verdict;
}

async function processTarget(
  target: Target,
  role: "candidate" | "control",
  token: string | undefined,
  guards: ReturnType<typeof makeGuards>,
): Promise<Outcome> {
  let cert: DeathCertificate | undefined;
  let certFile: string | undefined;
  let engineError: string | undefined;
  let engineNotes: string[] = [];

  try {
    const input: EngineInput = { kind: "name", name: target.name, version: target.version };
    const run = await runAutopsy(
      input,
      {
        requestTimeoutMs: 10_000,
        concurrency: 8,
        ...(token !== undefined ? { githubToken: token } : {}),
      },
      { fetch: globalThis.fetch, clock: systemClock, cache: createMemoryCache() },
    );
    engineNotes = run.notes.map((n) => guards.redact(n));
    cert = run.certificates.find((c) => c.package.name === target.name) ?? run.certificates[0];
    if (cert === undefined) {
      engineError = guards.redact(run.errors.map((e) => e.message).join("; ") || "no certificate produced");
    } else {
      if (run.errors.length > 0) engineNotes.push(...run.errors.map((e) => guards.redact(e.message)));
      const text = `${canonicalJson(cert)}\n`;
      guards.assertClean(`certificate ${target.name}`, text);
      certFile = join("certificates", `${fileSafe(target.name)}.json`);
      mkdirSync(CERT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, certFile), text, "utf8");
    }
  } catch (error) {
    cert = undefined;
    certFile = undefined;
    engineError = guards.redact(errorText(error));
  }

  let reg: RegistryRecord | undefined;
  let regError: string | undefined;
  try {
    reg = await fetchRegistry(target);
  } catch (error) {
    regError = guards.redact(errorText(error));
  }

  const verdict = evaluate(reg, regError, cert, engineError);
  return {
    target,
    role,
    ...(cert !== undefined ? { cert } : {}),
    ...(certFile !== undefined ? { certFile } : {}),
    ...(engineError !== undefined ? { engineError } : {}),
    engineNotes,
    ...(reg !== undefined ? { reg } : {}),
    ...(regError !== undefined ? { regError } : {}),
    verdict,
  };
}

// ---------------------------------------------------------------------------
// RESULTS.md
// ---------------------------------------------------------------------------

function summaryRow(o: Outcome): string {
  const id = `${o.target.name}@${o.target.version}`;
  const c = o.cert;
  if (c === undefined) {
    return `| ${cell(id)} | engine failed: ${cell(o.engineError ?? "unknown")} | | | | | | | ${cell(verdictText(o.verdict))} |`;
  }
  const vs = c.vitalSigns;
  return [
    id,
    c.status ?? `unverified (${c.statusError ?? "no detail"})`,
    c.causes.length > 0 ? c.causes.join(", ") : "none",
    c.openVulnerabilityIds.length > 0
      ? c.openVulnerabilityIds.join(", ")
      : vs.openVulnerabilities.available
        ? "none"
        : maybeText(vs.openVulnerabilities, () => ""),
    maybeText(c.timeOfDeath, (v) => v),
    maybeText(vs.maintainers, (v) => String(v.length)),
    maybeText(vs.weeklyDownloads, (v) => String(v)),
    maybeText(vs.dependents, (v) => String(v)),
    verdictText(o.verdict),
  ]
    .map(cell)
    .reduce((acc, text) => `${acc} ${text} |`, "|");
}

function eligibilityRow(o: Outcome): string {
  const id = `${o.target.name}@${o.target.version}`;
  const r = o.reg;
  if (r === undefined) {
    return `| ${cell(id)} | registry unavailable: ${cell(o.regError ?? "unknown")} | | | | | | | |`;
  }
  const licenseCell =
    r.license !== undefined
      ? `${r.license} (${PERMITTED_LICENSES.includes(r.license) ? "permitted" : "not permitted"})`
      : `absent${r.legacyLicenses !== undefined ? `; legacy licenses: ${r.legacyLicenses}` : ""} (unverified)`;
  const depsCell =
    r.dependencyNames.length === 0
      ? `0 (${r.dependenciesField})`
      : `${r.dependencyNames.length}: ${r.dependencyNames.join(", ")}`;
  return [
    id,
    licenseCell,
    depsCell,
    r.type ?? "absent (CommonJS)",
    r.main ?? "absent",
    r.unpackedSize === undefined ? "unavailable" : String(r.unpackedSize),
    r.fileCount === undefined ? "unavailable" : String(r.fileCount),
    r.published ?? "unavailable",
    o.verdict.notes.length > 0 ? o.verdict.notes.join("; ") : "-",
  ]
    .map(cell)
    .reduce((acc, text) => `${acc} ${text} |`, "|");
}

function sourcesSection(o: Outcome): string[] {
  const lines: string[] = [`### ${o.target.name}@${o.target.version}`, ""];
  if (o.reg !== undefined) {
    lines.push(`- registry packument (eligibility): ${o.reg.sourceUrl} (fetched ${o.reg.fetchedAt})`);
  }
  if (o.certFile !== undefined) lines.push(`- certificate: \`${o.certFile}\``);
  if (o.cert !== undefined) {
    lines.push(`- analysis date: ${o.cert.analysisDate}`);
    if (o.cert.daysSinceDeath !== undefined) lines.push(`- days since time of death (engine): ${o.cert.daysSinceDeath}`);
    lines.push(`- risk score (engine): ${o.cert.riskScore}`);
    lines.push(`- GitHub token used by the engine: ${o.cert.notes.githubTokenUsed ? "yes" : "no"}`);
    if (o.cert.notes.githubSkippedReason !== undefined) {
      lines.push(`- GitHub skipped: ${o.cert.notes.githubSkippedReason}`);
    }
    const seen = new Set<string>();
    for (const fact of o.cert.facts) {
      for (const p of fact.provenance) {
        const line = `- fact \`${fact.key}\`: ${p.sourceUrl} (fetched ${p.fetchedAt}${fact.stale === true ? ", stale" : ""})`;
        if (!seen.has(line)) {
          seen.add(line);
          lines.push(line);
        }
      }
    }
    for (const missing of o.cert.notes.omittedFacts) lines.push(`- omitted fact \`${missing.key}\`: ${missing.reason}`);
  }
  for (const note of o.engineNotes) lines.push(`- engine note: ${note}`);
  if (o.engineError !== undefined) lines.push(`- engine error: ${o.engineError}`);
  if (o.regError !== undefined) lines.push(`- registry error: ${o.regError}`);
  lines.push("");
  return lines;
}

function renderResults(outcomes: readonly Outcome[], generatedAt: string, authenticated: boolean): string {
  const candidates = outcomes.filter((o) => o.role === "candidate");
  const controls = outcomes.filter((o) => o.role === "control");
  const summaryHead = [
    "| Package | Status | Causes | Vulnerability ids | Time of death | Maintainers | Weekly downloads | Dependents | Eligible |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const eligibilityHead = [
    "| Package | License | Runtime dependencies | type | main | unpackedSize (bytes, proxy) | fileCount | Published (pinned version) | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  const lines: string[] = [
    "# Coroner candidates: autopsy results",
    "",
    `Generated ${generatedAt} by \`scripts/spike/coroner-candidates.ts\`. GitHub token: ${authenticated ? "set (authenticated requests)" : "not set (unauthenticated requests)"}.`,
    "Status, causes, vulnerabilities, time of death, maintainers, weekly downloads and dependents come from the autopsy engine (npm registry, OSV, deps.dev, GitHub REST API). Eligibility columns come from a direct registry packument fetch. Every number is listed with its source URL and fetch date in the Sources section; full facts are in `certificates/<name>.json`.",
    "",
    "Eligible means: permitted license (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 as a plain SPDX id), no runtime dependencies, `type` is not `module`, status is not `alive` or `retired-with-successor`, at least one open vulnerability per OSV, and at least one cause of death. Anything that could not be read counts as `no (unverified: ...)`. Size is `dist.unpackedSize` only (a proxy; lines are not measured).",
    "",
    "## Candidates",
    "",
    ...summaryHead,
    ...candidates.map(summaryRow),
    "",
    "### Eligibility detail (registry packument)",
    "",
    ...eligibilityHead,
    ...candidates.map(eligibilityRow),
    "",
    "## Controls",
    "",
    ...summaryHead,
    ...controls.map(summaryRow),
    "",
    ...eligibilityHead,
    ...controls.map(eligibilityRow),
    "",
    "| Control | Expectation | Observed eligible | Matches |",
    "|---|---|---|---|",
    ...controls.map((o) => {
      const expectation = CONTROL_EXPECTATION[o.target.name] ?? "unspecified";
      const observed = verdictText(o.verdict);
      return `| ${cell(o.target.name)} | ${cell(expectation)} | ${cell(observed)} | ${o.verdict.eligible ? "no (control passed the gate)" : "yes (blocked as expected)"} |`;
    }),
    "",
    "## Sources",
    "",
    ...outcomes.flatMap(sourcesSection),
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printPlan(log: (line: string) => void, tokenSet: boolean): void {
  log("Candidates:");
  for (const t of CANDIDATES) log(`  ${t.name}@${t.version}`);
  log("Controls:");
  for (const t of CONTROLS) log(`  ${t.name}@${t.version}`);
  log("Planned outputs:");
  for (const t of [...CANDIDATES, ...CONTROLS]) {
    log(`  ${join("spikes", "candidates", "certificates", `${fileSafe(t.name)}.json`)}`);
  }
  log(`  ${join("spikes", "candidates", "RESULTS.md")}`);
  log(`GITHUB_TOKEN: ${tokenSet ? "set" : "not set (a real run would be unauthenticated)"}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(", ")}. Supported: --dry-run.`);

  const rawToken = process.env["GITHUB_TOKEN"];
  const token = rawToken !== undefined && rawToken.trim() !== "" ? rawToken.trim() : undefined;
  const log = (line: string): void => console.log(line);

  if (args.includes("--dry-run")) {
    log("[dry run] no network requests, nothing written.");
    printPlan(log, token !== undefined);
    return;
  }

  if (token === undefined) {
    log("WARNING: GITHUB_TOKEN is not set. GitHub requests run unauthenticated (low rate limit).");
  } else {
    log("GITHUB_TOKEN is set: GitHub requests are authenticated.");
  }

  const guards = makeGuards(token);
  const work: { target: Target; role: "candidate" | "control" }[] = [
    ...CANDIDATES.map((target) => ({ target, role: "candidate" as const })),
    ...CONTROLS.map((target) => ({ target, role: "control" as const })),
  ];

  const outcomes: Outcome[] = [];
  for (const item of work) {
    log(`Autopsy ${item.target.name}@${item.target.version} (${item.role}) ...`);
    try {
      outcomes.push(await processTarget(item.target, item.role, token, guards));
    } catch (error) {
      const message = guards.redact(errorText(error));
      outcomes.push({
        target: item.target,
        role: item.role,
        engineError: message,
        engineNotes: [],
        verdict: evaluate(undefined, message, undefined, message),
      });
    }
    const last = outcomes[outcomes.length - 1];
    if (last !== undefined) log(`  eligible: ${verdictText(last.verdict)}`);
  }

  const results = renderResults(outcomes, utcSeconds(systemClock.now()), token !== undefined);
  guards.assertClean("RESULTS.md", results);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(RESULTS_FILE, results, "utf8");

  const failed = outcomes.filter((o) => o.cert === undefined || o.reg === undefined).length;
  log(`Done: ${outcomes.length} package(s), ${failed} with a failed engine run or registry fetch.`);
  log(`Wrote ${join("spikes", "candidates", "RESULTS.md")} and certificates under ${join("spikes", "candidates", "certificates")}.`);
  if (failed > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Spike failed.");
  process.exitCode = 1;
});
