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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { formatTimestamp } from "../../src/engine/sources/http";
import type { Clock } from "../../src/engine/types";
import { verifyIntegrity } from "../../src/proof/shell/integrity";

export const PACKAGE_NAME = "lodash.set";
export const PACKAGE_VERSION = "4.3.2";
export const TARBALL_FILE_NAME = tarballFileName(PACKAGE_NAME, PACKAGE_VERSION);
export const META_FILE_NAME = metaFileName(PACKAGE_NAME, PACKAGE_VERSION);
/** The only host a tarball may be downloaded from. */
export const REGISTRY_HOST = "registry.npmjs.org";
/** Compressed tarball limit (requirement A4: 5 MiB). */
export const MAX_TARBALL_BYTES = 5 * 1024 * 1024;

export function tarballFileName(name: string, version: string): string {
  return `${name}-${version}.tgz`;
}

export function metaFileName(name: string, version: string): string {
  return `${name}-${version}.meta.json`;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface RecordTarballArgs {
  packageName: string;
  packageVersion: string;
  force: boolean;
  dryRun: boolean;
}

/** Parses the CLI arguments (without node and script). Defaults to lodash.set@4.3.2. Unscoped package names only. */
export function parseRecordTarballArgs(args: readonly string[]): RecordTarballArgs {
  let packageName = PACKAGE_NAME;
  let packageVersion = PACKAGE_VERSION;
  let force = false;
  let dryRun = false;
  let sawPackage = false;
  let sawVersion = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--package" || arg === "--version") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new TarballRecordError(`${arg} needs a value.`);
      }
      i += 1;
      if (arg === "--package") {
        packageName = value;
        sawPackage = true;
      } else {
        packageVersion = value;
        sawVersion = true;
      }
    } else {
      throw new TarballRecordError(
        `Unknown argument: ${arg.slice(0, 80)}. Supported: --package <name>, --version <v>, --force, --dry-run.`,
      );
    }
  }
  if (sawPackage !== sawVersion) {
    throw new TarballRecordError("--package and --version must be given together.");
  }
  if (!NAME_PATTERN.test(packageName) || packageName.length > 214) {
    throw new TarballRecordError(`Invalid package name: ${JSON.stringify(packageName.slice(0, 80))} (unscoped names only).`);
  }
  if (!VERSION_PATTERN.test(packageVersion)) {
    throw new TarballRecordError(`Invalid version: ${JSON.stringify(packageVersion.slice(0, 80))}.`);
  }
  return { packageName, packageVersion, force, dryRun };
}

/** Finds the recorded registry packument of `name` in `<fixturesDir>/<name>/` (the file whose sourceUrl is the registry document). */
export function findPackumentPath(fixturesDir: string, name: string): string {
  const dir = join(fixturesDir, name);
  const wanted = `https://${REGISTRY_HOST}/${name}`;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("npm-") && f.endsWith(".json")).sort() : [];
  for (const file of files) {
    try {
      const parsed = FixtureSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      if (parsed.sourceUrl === wanted) return join(dir, file);
    } catch {
      // not a packument fixture; keep looking
    }
  }
  throw new TarballRecordError(`No recorded packument for ${name} in ${dir} (run npm run fixtures:record first).`);
}

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
  /** Package to record; default lodash.set. */
  packageName?: string;
  /** Version to record; default 4.3.2. */
  packageVersion?: string;
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
export function readPackumentInfo(packumentPath: string, version: string = PACKAGE_VERSION): DistInfo {
  let fixture: z.infer<typeof FixtureSchema>;
  let packument: z.infer<typeof PackumentSchema>;
  try {
    fixture = FixtureSchema.parse(JSON.parse(readFileSync(packumentPath, "utf8")));
    packument = PackumentSchema.parse(JSON.parse(fixture.body));
  } catch (error) {
    const why = error instanceof Error ? error.message.slice(0, 200) : "unknown error";
    throw new TarballRecordError(`Cannot read the recorded packument ${packumentPath}: ${why}`);
  }
  const entry = packument.versions[version];
  if (entry === undefined) {
    throw new TarballRecordError(`The recorded packument has no version ${version}.`);
  }
  const tarballUrl = entry.dist?.tarball;
  const integrity = entry.dist?.integrity;
  if (tarballUrl === undefined || integrity === undefined) {
    throw new TarballRecordError(`The recorded packument has no dist.tarball or dist.integrity for ${version}.`);
  }
  if (entry.license === undefined) {
    throw new TarballRecordError(`The recorded packument has no license for ${version}.`);
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
export function buildMeta(
  info: DistInfo,
  packumentFile: string,
  fetchedAt: string,
  name: string = PACKAGE_NAME,
  version: string = PACKAGE_VERSION,
): TarballMeta {
  return {
    name,
    version,
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
  const name = options.packageName ?? PACKAGE_NAME;
  const version = options.packageVersion ?? PACKAGE_VERSION;
  const tarballPath = join(options.outDir, tarballFileName(name, version));
  const metaPath = join(options.outDir, metaFileName(name, version));

  const existing = [tarballPath, metaPath].filter((p) => existsSync(p));
  if (existing.length > 0 && options.force !== true) {
    throw new TarballRecordError(
      `Already exists: ${existing.join(", ")}. Use --force to overwrite.`,
    );
  }

  const info = readPackumentInfo(options.packumentPath, version);

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

  const meta = buildMeta(info, basename(options.packumentPath), fetchedAt, name, version);
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(tarballPath, bytes);
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  log(`Wrote ${tarballPath}`);
  log(`Wrote ${metaPath}`);
  return { dryRun: false, written: [tarballPath, metaPath], meta };
}
