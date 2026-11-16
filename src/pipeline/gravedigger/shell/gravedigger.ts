// Gravedigger shell (R2.1, R2.2, R2.7, R2.8, R2.11): fetches the packument and the tarball from the
// npm registry, checks the sha512 digest, reads the package through the proof tarball extractor and
// builds the Eligibility_Record. All I/O is injected (fetch, clock) except a temp directory for extraction.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { formatTimestamp } from "../../../engine/sources/http";
import type { Clock, DeathCertificate } from "../../../engine/types";
import { computeSri } from "../../../proof/shell/integrity";
import { DEFAULT_EXTRACT_LIMITS, extractTarball } from "../../../proof/shell/tarball/tarballExtractor";
import type { EligibilityRecord } from "../core/eligibility";
import { buildEligibilityRecord } from "../core/record";
import { countLines } from "../core/rules";
import type { PackageJsonLike } from "../core/rules";

/** The only host a packument or tarball may be fetched from. */
export const REGISTRY_HOST = "registry.npmjs.org";

export interface GravediggerDeps {
  fetch: typeof fetch;
  clock: Clock;
}

export interface GravediggerResult {
  record: EligibilityRecord;
  /** The verified tarball bytes; null when the digest did not match (nothing is kept). */
  tarball: Uint8Array | null;
}

export class GravediggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GravediggerError";
  }
}

const PackumentSchema = z
  .object({
    versions: z.record(
      z.string(),
      z
        .object({
          dist: z
            .object({ tarball: z.string().optional(), integrity: z.string().optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Throws unless `url` is an https URL on registry.npmjs.org without credentials or a custom port. */
function assertRegistryUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GravediggerError(`Not a valid URL: ${JSON.stringify(url.slice(0, 200))}`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== REGISTRY_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new GravediggerError(`Refusing to fetch from ${parsed.origin}: only https://${REGISTRY_HOST}/ is allowed.`);
  }
}

async function getBytes(fetchFn: typeof fetch, url: string, maxBytes: number): Promise<Uint8Array> {
  assertRegistryUrl(url);
  const response = await fetchFn(url, { method: "GET", redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new GravediggerError(`Request to ${url} was redirected (HTTP ${response.status}); redirects are not followed.`);
  }
  if (response.status !== 200) {
    throw new GravediggerError(`Request to ${url} failed with HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new GravediggerError(`Response from ${url} is larger than ${maxBytes} bytes.`);
  }
  return bytes;
}

const MAX_PACKUMENT_BYTES = 50 * 1024 * 1024;

function packumentUrlOf(name: string): string {
  return `https://${REGISTRY_HOST}/${name.startsWith("@") ? name.replace("/", "%2F") : name}`;
}

function parsePackageJson(bytes: Uint8Array): PackageJsonLike | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PackageJsonLike) : null;
  } catch {
    return null;
  }
}

/** Extracts the verified tarball into a temp directory and reads `package.json` and the line count. */
async function readPackage(tarball: Uint8Array): Promise<{ pkg: PackageJsonLike | null; lineCount: number | null }> {
  const dir = await mkdtemp(path.join(tmpdir(), "gs-gravedigger-"));
  try {
    const extracted = await extractTarball(tarball, dir);
    if (!extracted.ok) return { pkg: null, lineCount: null };
    const manifest = extracted.value.find((f) => f.path === "package.json");
    return {
      pkg: manifest === undefined ? null : parsePackageJson(manifest.bytes),
      lineCount: countLines(extracted.value),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs the Gravedigger for the package of `cert`. Throws GravediggerError when the registry
 * data cannot be used at all (host, redirect, HTTP status, missing version or dist fields).
 * A digest mismatch is a record (`integrity-mismatch`) and returns no tarball.
 */
export async function runGravedigger(cert: DeathCertificate, deps: GravediggerDeps): Promise<GravediggerResult> {
  const { name, version } = cert.package;
  const packumentUrl = packumentUrlOf(name);
  const packumentBytes = await getBytes(deps.fetch, packumentUrl, MAX_PACKUMENT_BYTES);
  let packument: z.infer<typeof PackumentSchema>;
  try {
    packument = PackumentSchema.parse(JSON.parse(new TextDecoder().decode(packumentBytes)));
  } catch {
    throw new GravediggerError(`The packument of ${name} is not valid.`);
  }
  const dist = packument.versions[version]?.dist;
  if (dist?.tarball === undefined || dist.integrity === undefined) {
    throw new GravediggerError(`The packument of ${name} has no dist.tarball or dist.integrity for ${version}.`);
  }
  const tarballUrl = dist.tarball;
  const tarball = await getBytes(deps.fetch, tarballUrl, DEFAULT_EXTRACT_LIMITS.maxCompressedBytes);
  const fetchedAt = formatTimestamp(deps.clock.now());

  const computedIntegrity = computeSri(tarball);
  const matches = computedIntegrity === dist.integrity;
  const content = matches ? await readPackage(tarball) : { pkg: null, lineCount: null };

  const record = buildEligibilityRecord({
    name,
    version,
    cert,
    expectedIntegrity: dist.integrity,
    computedIntegrity,
    pkg: content.pkg,
    lineCount: content.lineCount,
    packumentUrl,
    tarballUrl,
    fetchedAt,
  });
  return { record, tarball: matches ? tarball : null };
}
