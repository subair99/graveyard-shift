import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeIdentityFinding, findIdentity, identityValuesFromEnv } from "../../../src/proof/core/identity";
import { computeSri, verifyIntegrity } from "../../../src/proof/shell/integrity";
import type { ExtractedFile } from "../../../src/proof/shell/tarball/tarballExtractor";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { computeDirectoryTreeHash } from "../../../src/proof/shell/treeHash";

// Requirements: 14.1, 14.2, 14.3, 14.4, 14.5; resurrection-pipeline 3.9
// Validates: Requirements 14.1, 14.2, 14.3

const ROOT = process.cwd();
const FIXTURES = join(ROOT, "tests", "proof", "fixtures");
const TARBALL_PATH = join(FIXTURES, "lodash.set", "lodash.set-4.3.2.tgz");
const META_PATH = join(FIXTURES, "lodash.set", "lodash.set-4.3.2.meta.json");
const PACKUMENT_PATH = join(ROOT, "tests", "engine", "fixtures", "lodash.set", "npm-449996e32bd2.json");

/** Documented key order of the metadata file (scripts/lib/recordTarball.ts, buildMeta). */
const META_KEYS_REQUIRED_ORDER = ["name", "version", "tarballUrl", "integrity", "sourceUrl", "fetchedAt", "license"];
const META_KEYS_OPTIONAL_ORDER = ["author", "maintainers", "contributors"];
const META_KEYS_LAST = ["packument"];

// Recorded when the test was written, from the committed tarball; changes only if the tarball changes.
// Refresh with: npx tsx scripts/printFixtureHashes.ts
const ORIGINAL_TREE_HASH =
  "sha512-KAfEmKesLDUHNxkUsC1dQ7FM8EeqHYEuDmis+t88FCVCDabvVtQstlzuCLytm/sGYOqI/PV4mzQYLs7blqFjxQ==";

// Recorded when the test was written, from the committed files; update with `npx tsx scripts/printFixtureHashes.ts` whenever a fixture file changes on purpose.
// Keys are paths relative to tests/proof/fixtures.
const PINS: Readonly<Record<string, string>> = {
  "ip/ip-2.0.1.meta.json":
    "sha512-czJ+3YxqX1tmcO7a9Kpd71QCKIUfcP4LUScv5SF345njXT8kyWj0Aw9T9Ezsxd3gUrCCPHL2wb8wkC4KNTQAkg==",
  "ip/ip-2.0.1.tgz":
    "sha512-lJUL9imLTNi1ZfXT+DU6rBBdbiKGBuay9B6xGSPVjUeQwaH1RIGqef8RZkUtHioLmSNpPR5M4HVKJGm1j8FWVQ==",
  "lodash.set-alive/LICENSE":
    "sha512-t/YCqTo2Om0BuHE/C+C/HnDEMbbFc+Iw7HdZ5m3+Ixv6eAFUYHuaWfDgMyL3zt9X0qvXoIPA8u8qq8i8IVvbMg==",
  "lodash.set-alive/README.md":
    "sha512-CbAgdypmCSCBW48Lit2FHq5++8FqlgjlTILOz9JAh0UtuxxM1UzxtcGSNWOn6TR5XmAfAvhFQcSD3D1ekBD63Q==",
  "lodash.set-alive/index.js":
    "sha512-xp3cqsyQ7ifjhc3MMSvMh8eyTpQJ/Ihw6BdWbqcBLKGVSnPDCwGLlcS1hrP6cdfFn2abzQVX+E1L4wmjsCm04A==",
  "lodash.set-alive/package.json":
    "sha512-+ZzXaIotwebH6WV5MM9YMPnKk4pDD1aeHZatzVF3FBmdj1t14+fYL3TVQh9SI0b2U3NqNWxS3wEVTmXuskzcEw==",
  "lodash.set-broken/LICENSE":
    "sha512-t/YCqTo2Om0BuHE/C+C/HnDEMbbFc+Iw7HdZ5m3+Ixv6eAFUYHuaWfDgMyL3zt9X0qvXoIPA8u8qq8i8IVvbMg==",
  "lodash.set-broken/README.md":
    "sha512-k4dsaLFLwzkea/vMqbNH4f/9MxeXuYGz7+7YkG01xHcRZ3KcjNHlecZUxIs7/puX0SnuM0LgxxRKID4fbZgfkQ==",
  "lodash.set-broken/index.js":
    "sha512-1CHA7TA0os1jpWQiAuzTTju+Ua7dHKXDAKQY6xN9NkXW3VkXpolj4VGeWerfZvILMwqOhJSRJP9jFEYRvJxt9A==",
  "lodash.set-broken/package.json":
    "sha512-+ZzXaIotwebH6WV5MM9YMPnKk4pDD1aeHZatzVF3FBmdj1t14+fYL3TVQh9SI0b2U3NqNWxS3wEVTmXuskzcEw==",
  "lodash.set/lodash.set-4.3.2.meta.json":
    "sha512-jwTgVilo3LThoS0CSU6Zz+UNwcHJ2myqWt87GZWNJACYXpC3K/oSea81LqrVcRDJ3LMjpUtpOXRkuGa6dO2iSw==",
  "lodash.set/lodash.set-4.3.2.tgz":
    "sha512-4hNPN5jlm/N/HLMCO43v8BXKq9Z7QdAGc/VGrRD61w8gN9g/6jF9A4L1pbUgBLCffi0w9VsXfTOij5x8iTyFvg==",
};

const KEYWORDS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "Authorization", pattern: /authorization/i },
  { label: "Bearer", pattern: /bearer/i },
  { label: "ghp_ token shape", pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { label: "github_pat_ token shape", pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: "gh[osur]_ token shape", pattern: /gh[osur]_[A-Za-z0-9]{20,}/ },
];

async function listFiles(dir: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

function readFixture(rel: string): Buffer {
  return readFileSync(join(FIXTURES, ...rel.split("/")));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

/** dist info of 4.3.2 from the recorded packument fixture (its body is a JSON string). */
function readRecordedDist(): { tarball: unknown; integrity: unknown } {
  const fixture = readJson(PACKUMENT_PATH);
  const body: unknown = JSON.parse(String(fixture["body"]));
  if (!isRecord(body) || !isRecord(body["versions"])) throw new Error("packument has no versions");
  const entry = body["versions"]["4.3.2"];
  if (!isRecord(entry) || !isRecord(entry["dist"])) throw new Error("packument has no 4.3.2 dist");
  return { tarball: entry["dist"]["tarball"], integrity: entry["dist"]["integrity"] };
}

const meta = readJson(META_PATH);
const tarballBytes = readFileSync(TARBALL_PATH);

describe("fixture integrity: lodash.set@4.3.2 tarball and metadata", () => {
  it("verifies the committed tarball bytes against the metadata integrity (sha512 SRI)", () => {
    const integrity = meta["integrity"];
    expect(typeof integrity).toBe("string");
    const verified = verifyIntegrity(tarballBytes, String(integrity));
    expect(verified.ok, "tarball digest equals the metadata integrity").toBe(true);
  });

  it("matches the recorded packument: integrity, tarball URL, name, version, license", () => {
    const dist = readRecordedDist();
    expect(meta["integrity"], "meta integrity equals packument dist.integrity").toBe(dist.integrity);
    expect(meta["tarballUrl"], "meta tarballUrl equals packument dist.tarball").toBe(dist.tarball);
    expect(meta["name"]).toBe("lodash.set");
    expect(meta["version"]).toBe("4.3.2");
    expect(meta["license"]).toBe("MIT");
    const packument = meta["packument"];
    expect(isRecord(packument) ? packument["integrity"] : undefined, "meta packument.integrity").toBe(dist.integrity);
    expect(isRecord(packument) ? packument["file"] : undefined).toBe("npm-449996e32bd2.json");
  });

  it("has exactly the documented keys in the documented order", () => {
    const keys = Object.keys(meta);
    const required = keys.slice(0, META_KEYS_REQUIRED_ORDER.length);
    const last = keys.slice(-META_KEYS_LAST.length);
    const optional = keys.slice(META_KEYS_REQUIRED_ORDER.length, keys.length - META_KEYS_LAST.length);
    expect(required).toEqual(META_KEYS_REQUIRED_ORDER);
    expect(last).toEqual(META_KEYS_LAST);
    const expectedOptional = META_KEYS_OPTIONAL_ORDER.filter((k) => optional.includes(k));
    expect(optional, "optional credit keys, in order, without extras").toEqual(expectedOptional);
    const packument = meta["packument"];
    expect(isRecord(packument) ? Object.keys(packument) : []).toEqual(["file", "integrity"]);
    expect(meta["fetchedAt"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("contains no credentials and no identity values of this machine", () => {
    const text = readFileSync(META_PATH, "utf8");
    for (const { label, pattern } of KEYWORDS) {
      expect(pattern.test(text), `meta file matches the credential check "${label}"`).toBe(false);
    }
    const platform = process.platform === "win32" ? "win32" : "posix";
    const identity = identityValuesFromEnv(process.env, platform);
    const finding = findIdentity(text, identity, platform);
    expect(finding.found, finding.found ? describeIdentityFinding(finding) : "no identity value").toBe(false);
  });
});

describe("fixture integrity: ip@2.0.1 tarball and metadata", () => {
  const ipMeta = readJson(join(FIXTURES, "ip", "ip-2.0.1.meta.json"));
  const ipBytes = readFixture("ip/ip-2.0.1.tgz");
  const ipPackumentFile = String(isRecord(ipMeta["packument"]) ? ipMeta["packument"]["file"] : "");

  it("verifies the committed tarball bytes against the metadata integrity (sha512 SRI)", () => {
    expect(typeof ipMeta["integrity"]).toBe("string");
    expect(verifyIntegrity(ipBytes, String(ipMeta["integrity"])).ok).toBe(true);
  });

  it("matches the recorded packument: integrity, tarball URL, name, version, license", () => {
    const fixture = readJson(join(ROOT, "tests", "engine", "fixtures", "ip", ipPackumentFile));
    const body: unknown = JSON.parse(String(fixture["body"]));
    if (!isRecord(body) || !isRecord(body["versions"])) throw new Error("packument has no versions");
    const entry = body["versions"]["2.0.1"];
    if (!isRecord(entry) || !isRecord(entry["dist"])) throw new Error("packument has no 2.0.1 dist");
    expect(ipMeta["integrity"]).toBe(entry["dist"]["integrity"]);
    expect(ipMeta["tarballUrl"]).toBe(entry["dist"]["tarball"]);
    expect(ipMeta["name"]).toBe("ip");
    expect(ipMeta["version"]).toBe("2.0.1");
    expect(ipMeta["license"]).toBe("MIT");
    const packument = ipMeta["packument"];
    expect(isRecord(packument) ? packument["integrity"] : undefined).toBe(entry["dist"]["integrity"]);
  });
});

describe("fixture integrity: extracted original", () => {
  let dir = "";
  let files: ExtractedFile[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fixture-integrity-"));
    const extracted = await extractTarball(tarballBytes, dir);
    if (!extracted.ok) throw new Error(`extraction failed: ${extracted.error.kind}`);
    files = extracted.value;
  });

  afterAll(async () => {
    if (dir !== "") await rm(dir, { recursive: true, force: true });
  });

  it("has package.json name lodash.set, version 4.3.2, license MIT", async () => {
    const pkg: unknown = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(isRecord(pkg) ? pkg["name"] : undefined).toBe("lodash.set");
    expect(isRecord(pkg) ? pkg["version"] : undefined).toBe("4.3.2");
    expect(isRecord(pkg) ? pkg["license"] : undefined).toBe("MIT");
  });

  it("keeps the pinned Tree_Hash, so any byte change in the extraction fails", async () => {
    const tree = await computeDirectoryTreeHash(dir);
    expect(tree.ok).toBe(true);
    expect(tree.ok ? tree.value : "").toBe(ORIGINAL_TREE_HASH);
  });

  it("has LICENSE copies in alive and broken that are byte-identical to the original", () => {
    const original = files.find((f) => f.path === "LICENSE");
    expect(original, "original LICENSE exists").toBeDefined();
    const expected = Buffer.from(original?.bytes ?? new Uint8Array());
    for (const copy of ["lodash.set-alive/LICENSE", "lodash.set-broken/LICENSE"]) {
      expect(readFixture(copy).equals(expected), `${copy} is byte-identical to the original LICENSE`).toBe(true);
    }
  });
});

describe("fixture integrity: fixture bytes and line endings", () => {
  it("pins the sha512 of every fixture file (tarball, metadata, alive and broken packages)", () => {
    for (const [rel, sri] of Object.entries(PINS)) {
      expect(computeSri(readFixture(rel)), `bytes of ${rel} (update pins with scripts/printFixtureHashes.ts)`).toBe(sri);
    }
  });
  it("has no fixture file that is missing from the pin table", async () => {
    const onDisk = (await listFiles(FIXTURES, "")).sort();
    const known = Object.keys(PINS).sort();
    expect(onDisk).toEqual(known);
  });

  it("has no CRLF in any text fixture file", async () => {
    const onDisk = await listFiles(FIXTURES, "");
    const crlf = Buffer.from("\r\n");
    const offenders = onDisk.filter((rel) => !rel.endsWith(".tgz") && readFixture(rel).includes(crlf));
    expect(offenders, "fixture files containing CRLF (Git must not change fixture bytes)").toEqual([]);
  });

  it("marks fixtures as binary-safe in .gitattributes", () => {
    const lines = readFileSync(join(ROOT, ".gitattributes"), "utf8").split(/\r?\n/);
    expect(lines).toContain("tests/**/fixtures/** -text");
  });
});
