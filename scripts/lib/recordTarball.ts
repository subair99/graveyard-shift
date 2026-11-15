/**
 * Tarball recording logic (task 13.1). Testable: fetch, clock, packument path and
 * output directory are injected. The CLI wrapper is `scripts/recordTarball.ts`.
 *
 * The expected tarball URL and integrity come from the RECORDED packument
 * (`tests/engine/fixtures/lodash.set/npm-449996e32bd2.json`), never from the
 * network. The downloaded bytes are verified against that integrity before
 * anything is written. The npm registry needs no credentials: no token is read,
 * sent, printed or written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { formatTimestamp } from "../../src/engine/sources/http";
import type { Clock } from "../../src/engine/types";
import { verifyIntegrity } from "../../src/proof/shell/integrity";

export const PACKAGE_NAME = "lodash.set";
export const PACKAGE_VERSION = "4.3.2";
export const TARBALL_FILE_NAME = `${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`;
export const META_FILE_NAME = `${PACKAGE_NAME}-${PACKAGE_VERSION}.meta.json`;
/** The only host a tarball may be downloaded from. */
export const REGISTRY_HOST = "registry.npmjs.org";
/** Compressed tarball limit (requirement A4: 5 MiB). */
export const MAX_TARBALL_BYTES = 5 * 1024 * 1024;

export type Person = string | { name?: string; email?: string; url?: string };

/** Metadata committed next to the tarball. Optional credit fields appear only when present in the packument. */
export interface TarballMeta {
  name: string;
  version: string;
  tarballUrl: string;
  integrity: string;
  /** URL the packument was recorded from (the registry document that lists the tarball). */
  sourceUrl: string;
  /** UTC ISO 8601, second precision, from the injected clock. */
  fetchedAt: string;
  license: string;
  author?: Person;
  maintainers?: Person[];
  contributors?: Person[];
  packument: { file: string; integrity: string };
}

export interface RecordTarballOptions {
  fetch: typeof fetch;
  clock: Clock;
  /** Path of the recorded packument fixture file. */
  packumentPath: string;
  /** Directory that receives the tarball and the metadata file. */
  outDir: string;
  force?: boolean;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface RecordTarballSummary {
  dryRun: boolean;
  /** Absolute or relative paths of the files written (empty in a dry run). */
  written: string[];
  meta?: TarballMeta;
}

export class TarballRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarballRecordError";
  }
}

const PersonSchema = z.union([
  z.string(),
  z.object({ name: z.string().optional(), email: z.string().optional(), url: z.string().optional() }).passthrough(),
]);

const PackumentSchema = z
  .object({
    versions: z.record(
      z.string(),
      z
        .object({
          license: z.string().optional(),
          author: PersonSchema.optional(),
          maintainers: z.array(PersonSchema).optional(),
          contributors: z.array(PersonSchema).optional(),
          dist: z
            .object({ tarball: z.string().optional(), integrity: z.string().optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const FixtureSchema = z.object({ sourceUrl: z.string(), body: z.string() }).passthrough();

/** Throws unless `url` is an https URL on registry.npmjs.org without credentials or a custom port. */
export function assertRegistryUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TarballRecordError(`Tarball URL is not a valid URL: ${JSON.stringify(url.slice(0, 200))}`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== REGISTRY_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new TarballRecordError(`Refusing to download from ${parsed.origin}: only https://${REGISTRY_HOST}/ is allowed.`);
  }
  return parsed;
}

interface DistInfo {
  tarballUrl: string;
  integrity: string;
  sourceUrl: string;
  license: string;
  author?: Person;
  maintainers?: Person[];
  contributors?: Person[];
}

/** Reads the dist info, license and credits of the pinned version from the recorded packument fixture. */
export function readPackumentInfo(packumentPath: string): DistInfo {
  let fixture: z.infer<typeof FixtureSchema>;
  let packument: z.infer<typeof PackumentSchema>;
  try {
    fixture = FixtureSchema.parse(JSON.parse(readFileSync(packumentPath, "utf8")));
    packument = PackumentSchema.parse(JSON.parse(fixture.body));
  } catch (error) {
    const why = error instanceof Error ? error.message.slice(0, 200) : "unknown error";
    throw new TarballRecordError(`Cannot read the recorded packument ${packumentPath}: ${why}`);
  }
  const entry = packument.versions[PACKAGE_VERSION];
  if (entry === undefined) {
    throw new TarballRecordError(`The recorded packument has no version ${PACKAGE_VERSION}.`);
  }
  const tarballUrl = entry.dist?.tarball;
  const integrity = entry.dist?.integrity;
  if (tarballUrl === undefined || integrity === undefined) {
    throw new TarballRecordError(`The recorded packument has no dist.tarball or dist.integrity for ${PACKAGE_VERSION}.`);
  }
  if (entry.license === undefined) {
    throw new TarballRecordError(`The recorded packument has no license for ${PACKAGE_VERSION}.`);
  }
  assertRegistryUrl(tarballUrl);
  return {
    tarballUrl,
    integrity,
    sourceUrl: fixture.sourceUrl,
    license: entry.license,
    ...(entry.author !== undefined ? { author: entry.author } : {}),
    ...(entry.maintainers !== undefined ? { maintainers: entry.maintainers } : {}),
    ...(entry.contributors !== undefined ? { contributors: entry.contributors } : {}),
  };
}

/** Builds the metadata object; key order is the order written to the file. */
export function buildMeta(info: DistInfo, packumentFile: string, fetchedAt: string): TarballMeta {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    tarballUrl: info.tarballUrl,
    integrity: info.integrity,
    sourceUrl: info.sourceUrl,
    fetchedAt,
    license: info.license,
    ...(info.author !== undefined ? { author: info.author } : {}),
    ...(info.maintainers !== undefined ? { maintainers: info.maintainers } : {}),
    ...(info.contributors !== undefined ? { contributors: info.contributors } : {}),
    packument: { file: packumentFile, integrity: info.integrity },
  };
}

async function download(fetchFn: typeof fetch, url: string): Promise<Uint8Array> {
  assertRegistryUrl(url);
  const response = await fetchFn(url, { method: "GET", redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new TarballRecordError(`Download was redirected (HTTP ${response.status}); redirects are not followed.`);
  }
  if (response.status !== 200) {
    throw new TarballRecordError(`Download failed with HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_TARBALL_BYTES) {
    throw new TarballRecordError(`Downloaded tarball is larger than ${MAX_TARBALL_BYTES} bytes; nothing was written.`);
  }
  return bytes;
}

/**
 * Downloads the pinned tarball, verifies it against the recorded integrity and
 * writes the tarball and its metadata file. Nothing is written unless the digest matches.
 */
export async function recordTarball(options: RecordTarballOptions): Promise<RecordTarballSummary> {
  const log = options.log ?? ((): void => undefined);
  const tarballPath = join(options.outDir, TARBALL_FILE_NAME);
  const metaPath = join(options.outDir, META_FILE_NAME);

  const existing = [tarballPath, metaPath].filter((p) => existsSync(p));
  if (existing.length > 0 && options.force !== true) {
    throw new TarballRecordError(
      `Already exists: ${existing.join(", ")}. Use --force to overwrite.`,
    );
  }

  const info = readPackumentInfo(options.packumentPath);

  if (options.dryRun === true) {
    log(`[dry run] would download ${info.tarballUrl}`);
    log(`[dry run] would verify it against the recorded integrity ${info.integrity}`);
    log(`[dry run] would write ${tarballPath} and ${metaPath}`);
    log("[dry run] no network requests made, nothing written.");
    return { dryRun: true, written: [] };
  }

  log(`Downloading ${info.tarballUrl} ...`);
  const bytes = await download(options.fetch, info.tarballUrl);
  const fetchedAt = formatTimestamp(options.clock.now());

  const verified = verifyIntegrity(bytes, info.integrity);
  if (!verified.ok) {
    throw new TarballRecordError(`${verified.error.message} (${bytes.length} bytes downloaded). Nothing was written.`);
  }
  log(`Integrity verified (${bytes.length} bytes).`);

  const meta = buildMeta(info, basename(options.packumentPath), fetchedAt);
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(tarballPath, bytes);
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  log(`Wrote ${tarballPath}`);
  log(`Wrote ${metaPath}`);
  return { dryRun: false, written: [tarballPath, metaPath], meta };
}
