// Requirements: 4.11, 23.18, 23.19, 23.20, 23.21
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileHarnessFiles } from "../../../src/pipeline/harness/core/compiler";
import { canonicalDeltasJson, parseDeltasFile } from "../../../src/pipeline/harness/core/deltas";
import { canonicalHarnessJson, parseHarnessFile } from "../../../src/pipeline/harness/core/harnessFile";
import type { IntakeEntry } from "../../../src/pipeline/intake/core/types";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import { checkNecromancy } from "../../../src/pipeline/necromancy/core/gate";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const FIXTURE = resolve(__dirname, "../fixtures/stub/lodash.set");
const TARBALL = resolve(__dirname, "../../proof/fixtures/lodash.set/lodash.set-4.3.2.tgz");

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
  originalDir = mkdtempSync(join(tmpdir(), "gs-stub-fixture-"));
  const extracted = await extractTarball(new Uint8Array(readFileSync(TARBALL)), originalDir);
  expect(extracted.ok).toBe(true);
});

afterAll(() => {
  if (originalDir !== "") rmSync(originalDir, { recursive: true, force: true });
});

describe("Stub_Fixture lodash.set", () => {
  it("holds exactly the three entries", () => {
    expect(readdirSync(FIXTURE).sort()).toEqual(["deltas.json", "harness.json", "resurrection"]);
  });

  it("resurrection/package.json and its license pass the necromancy gate against lodash.set@4.3.2", () => {
    const original = readJson(join(originalDir, "package.json"));
    const resurrection = readJson(join(FIXTURE, "resurrection", "package.json"));
    expect(resurrection.name).toBe("@graveyard-shift/lodash.set");
    expect(resurrection.version).toBe("4.3.3");
    const result = checkNecromancy({
      original,
      resurrection,
      originalLicense: { path: "LICENSE", bytes: new Uint8Array(readFileSync(join(originalDir, "LICENSE"))) },
      resurrectionLicense: {
        path: "resurrection/LICENSE",
        bytes: new Uint8Array(readFileSync(join(FIXTURE, "resurrection", "LICENSE"))),
      },
    });
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
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

  it("deltas.json and harness.json are canonical, contain no BOM or CR, and compile against the certificate", () => {
    const deltasJson = readFileSync(join(FIXTURE, "deltas.json"), "utf8");
    const harnessJson = readFileSync(join(FIXTURE, "harness.json"), "utf8");
    for (const text of [deltasJson, harnessJson]) {
      expect(text.startsWith("\uFEFF")).toBe(false);
      expect(text).not.toContain("\r");
    }
    const deltas = parseDeltasFile(deltasJson);
    const harness = parseHarnessFile(harnessJson);
    if (!deltas.ok || !harness.ok) throw new Error("fixture files do not parse");
    expect(canonicalDeltasJson(deltas.value)).toBe(deltasJson);
    expect(canonicalHarnessJson(harness.value)).toBe(harnessJson);
    expect(deltas.value.deltas).toEqual([
      { kind: "prototype-unchanged", id: "proto-pollution", function: "default", advisory: "GHSA-p6mc-m468-83gw" },
    ]);

    const compiled = compileHarnessFiles({ deltasJson, harnessJson, certificate: LODASH_SET_CERT });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect(compiled.value.presetsUsed).toEqual(["lodash-set"]);
  });

  it("the copy of lodash.set-alive differs from the source only in the package name", () => {
    const aliveDir = resolve(__dirname, "../../proof/fixtures/lodash.set-alive");
    const copyDir = join(FIXTURE, "resurrection");
    expect(walk(copyDir)).toEqual(walk(aliveDir));
    for (const path of walk(aliveDir)) {
      const a = readFileSync(join(aliveDir, path));
      const b = readFileSync(join(copyDir, path));
      if (path === "package.json") {
        expect({ ...readJson(join(copyDir, path)), name: "lodash.set" }).toEqual(readJson(join(aliveDir, path)));
      } else {
        expect(b.equals(a)).toBe(true);
      }
    }
  });
});
