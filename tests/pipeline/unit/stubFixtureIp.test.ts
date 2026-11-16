// Requirements: 23.25, 23.26, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 9.10
// The ip Stub_Fixture. The recorded ip@2.0.1 tarball has no license file (only "license": "MIT" in
// package.json), so the license-file check has nothing to compare on either side.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileHarnessFiles } from "../../../src/pipeline/harness/core/compiler";
import { canonicalDeltasJson, parseDeltasFile } from "../../../src/pipeline/harness/core/deltas";
import { canonicalHarnessJson, parseHarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import { parseIpMeasurement } from "../../../src/pipeline/harness/core/ipMeasurement";
import type { IntakeEntry } from "../../../src/pipeline/intake/core/types";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import { checkNecromancy, isLicenseFileName } from "../../../src/pipeline/necromancy/core/gate";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { IP_CERT } from "../helpers/gravediggerCerts";

const FIXTURE = resolve(__dirname, "../fixtures/stub/ip");
const EXAMPLES = resolve(__dirname, "../fixtures/ip");
const ALIVE = resolve(__dirname, "../../proof/fixtures/ip-alive");
const TARBALL = resolve(__dirname, "../../proof/fixtures/ip/ip-2.0.1.tgz");

let originalDir = "";

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function walk(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, rel)).sort()) {
    const path = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...walk(root, path));
    else out.push(path);
  }
  return out;
}

beforeAll(async () => {
  originalDir = mkdtempSync(join(tmpdir(), "gs-stub-fixture-ip-"));
  const extracted = await extractTarball(new Uint8Array(readFileSync(TARBALL)), originalDir);
  expect(extracted.ok).toBe(true);
});

afterAll(() => {
  if (originalDir !== "") rmSync(originalDir, { recursive: true, force: true });
});

describe("Stub_Fixture ip", () => {
  it("holds exactly the three entries", () => {
    expect(readdirSync(FIXTURE).sort()).toEqual(["deltas.json", "harness.json", "resurrection"]);
  });

  it("resurrection/package.json passes the necromancy gate against ip@2.0.1 (no license file on either side)", () => {
    const original = readJson(join(originalDir, "package.json"));
    const resurrection = readJson(join(FIXTURE, "resurrection", "package.json"));
    expect(resurrection.name).toBe("@graveyard-shift/ip");
    expect(resurrection.version).toBe("2.0.2");
    expect(original.license).toBe("MIT");
    expect(readdirSync(originalDir).filter(isLicenseFileName)).toEqual([]);
    expect(readdirSync(join(FIXTURE, "resurrection")).filter(isLicenseFileName)).toEqual([]);
    const result = checkNecromancy({
      original,
      resurrection,
      originalLicense: null,
      resurrectionLicense: null,
    });
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.checks.find((c) => c.id === "license-file")?.message).toBe("the original has no license file");
    expect(result.ok).toBe(true);
  });

  it("validateIntake accepts the directory mapped to the Medium_Output paths unchanged", () => {
    const entries: IntakeEntry[] = walk(FIXTURE).map((path) => {
      const bytes = new Uint8Array(readFileSync(join(FIXTURE, path)));
      return { path, type: "file", size: bytes.length, bytes };
    });
    expect(entries.map((e) => e.path)).toContain("resurrection/package.json");
    const result = validateIntake(entries);
    expect(result.ok ? [] : result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("deltas.json and harness.json are byte-equal to the task 12.12 files and compile (class delta, measurement) against the ip certificate", () => {
    const deltasJson = readFileSync(join(FIXTURE, "deltas.json"), "utf8");
    const harnessJson = readFileSync(join(FIXTURE, "harness.json"), "utf8");
    expect(deltasJson).toBe(readFileSync(join(EXAMPLES, "deltas.json"), "utf8"));
    expect(harnessJson).toBe(readFileSync(join(EXAMPLES, "harness.json"), "utf8"));
    for (const text of [deltasJson, harnessJson]) {
      expect(text.startsWith("\uFEFF")).toBe(false);
      expect(text).not.toContain("\r");
    }
    const deltas = parseDeltasFile(deltasJson);
    const harness = parseHarnessFile(harnessJson);
    if (!deltas.ok || !harness.ok) throw new Error("fixture files do not parse");
    expect(canonicalDeltasJson(deltas.value)).toBe(deltasJson);
    expect(canonicalHarnessJson(harness.value)).toBe(harnessJson);

    const measurement = parseIpMeasurement(readFileSync(resolve(__dirname, "../../../docs/measurements/ip-2.0.1.json"), "utf8"));
    if (!measurement.ok) throw new Error(`measurement: ${measurement.error.issues.join("; ")}`);
    const compiled = compileHarnessFiles({
      deltasJson,
      harnessJson,
      certificate: IP_CERT,
      measurement: measurement.value,
      returnsExpected: {
        template: readFileSync(resolve(__dirname, "../../../src/pipeline/harness/sandbox/returnsExpected.cjs"), "utf8"),
        modulesDir: resolve(tmpdir(), "graveyard-test-ip-stub-modules"),
      },
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect(compiled.value.presetsUsed).toEqual(["ip-address"]);
    expect(compiled.value.config.deltas.map((d) => [d.id, d.function])).toEqual([["is-public-advisory", "isPublic"]]);
    expect(compiled.value.modules.map((m) => m.name)).toEqual(["returns-expected-is-public-advisory.cjs"]);
  });

  it("the copy of ip-alive differs from the source only in the package name, and has no README", () => {
    const copyDir = join(FIXTURE, "resurrection");
    expect(walk(copyDir)).toEqual(walk(ALIVE).filter((p) => p !== "README.md"));
    for (const path of walk(copyDir)) {
      const a = readFileSync(join(ALIVE, path));
      const b = readFileSync(join(copyDir, path));
      if (path === "package.json") {
        expect({ ...readJson(join(copyDir, path)), name: "ip" }).toEqual(readJson(join(ALIVE, path)));
      } else {
        expect(b.equals(a)).toBe(true);
      }
    }
  });
});
