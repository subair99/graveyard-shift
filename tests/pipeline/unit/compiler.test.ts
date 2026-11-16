// Requirements: 4.3, 4.5, 4.6, 4.7, 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.11
import { describe, expect, it } from "vitest";
import {
  compileHarness,
  compileHarnessFiles,
  type CompileError,
  type CompileInput,
} from "../../../src/pipeline/harness/core/compiler";
import { POLLUTION_MODULE_PATH } from "../../../src/proof/harnesses/lodash.set/config";
import { LODASH_SET_CERT } from "../helpers/gravediggerCerts";

const proto = (id: string, fn = "default", advisory = "GHSA-p6mc-m468-83gw") => ({
  kind: "prototype-unchanged" as const,
  id,
  function: fn,
  advisory,
});

const deltasFile = (deltas: unknown[] = [proto("proto-pollution")], pkg = "lodash.set") => ({
  schemaVersion: 1 as const,
  package: pkg,
  deltas,
});

const harnessFile = (functions: Record<string, unknown> = { default: { preset: "lodash-set" } }, pkg = "lodash.set") => ({
  schemaVersion: 1 as const,
  package: pkg,
  functions,
});

function input(deltas: unknown = deltasFile(), harness: unknown = harnessFile()): CompileInput {
  return { deltas, harness, certificate: LODASH_SET_CERT } as CompileInput;
}

function errorsOf(i: CompileInput): CompileError[] {
  const r = compileHarness(i);
  if (r.ok) throw new Error("expected a compile failure");
  return r.error;
}

function fileErrors(deltas: unknown, harness: unknown): CompileError[] {
  const r = compileHarnessFiles({
    deltasJson: JSON.stringify(deltas),
    harnessJson: JSON.stringify(harness),
    certificate: LODASH_SET_CERT,
  });
  if (r.ok) throw new Error("expected a compile failure");
  return r.error;
}

describe("compileHarness", () => {
  it("compiles the lodash-set preset with a prototype-unchanged delta", () => {
    const r = compileHarness(input());
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const { config, presetsUsed } = r.value;
    expect(presetsUsed).toEqual(["lodash-set"]);
    expect(config.package).toBe("lodash.set");
    expect(Object.keys(config.functions)).toEqual(["default"]);
    expect(config.deltas.map((d) => [d.id, d.function, d.propertyModule])).toEqual([
      ["proto-pollution", "default", POLLUTION_MODULE_PATH],
    ]);
    expect(config.readPaths).toEqual([POLLUTION_MODULE_PATH]);
    expect(config.seed).toBe(20260101);
    expect(config.caseCount).toBe(100);
    expect("radius" in config).toBe(false);
  });

  it("orders deltas by id and gives equal results for equal inputs", () => {
    const deltas = deltasFile([proto("b-second"), proto("a-first")]);
    const a = compileHarness(input(deltas));
    const b = compileHarness(input(deltas));
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(a.value.config.deltas.map((d) => d.id)).toEqual(["a-first", "b-second"]);
    expect(b.value).toEqual(a.value);
  });

  it("rejects a duplicate delta id", () => {
    const errors = errorsOf(input(deltasFile([proto("same"), proto("same")])));
    expect(errors.map((e) => e.code)).toEqual(["duplicate-delta-id"]);
  });

  it("rejects an unknown preset and names it", () => {
    const errors = errorsOf(input(deltasFile(), harnessFile({ default: { preset: "ip-address" } })));
    expect(errors[0]).toMatchObject({ code: "unknown-preset", key: "ip-address" });
    expect(errors[0]?.message).toContain("lodash-set");
  });

  it("rejects an option the preset does not declare", () => {
    const errors = errorsOf(input(deltasFile(), harnessFile({ default: { preset: "lodash-set", options: { depth: 3 } } })));
    expect(errors[0]?.code).toBe("invalid-option");
    expect(errors[0]?.where).toContain("functions.default");
  });

  it("rejects a function the preset does not cover", () => {
    const errors = errorsOf(input(deltasFile([]), harnessFile({ other: { preset: "lodash-set" } })));
    expect(errors[0]).toMatchObject({ code: "unknown-function", key: "other" });
  });

  it("rejects an advisory that is not on the certificate", () => {
    const errors = errorsOf(input(deltasFile([proto("x", "default", "GHSA-aaaa-bbbb-cccc")])));
    expect(errors[0]).toMatchObject({ code: "unknown-advisory", key: "GHSA-aaaa-bbbb-cccc", deltaId: "x" });
  });

  it("accepts an advisory that is an alias in the certificate vital signs", () => {
    const cert = {
      ...LODASH_SET_CERT,
      openVulnerabilityIds: [],
      vitalSigns: {
        ...LODASH_SET_CERT.vitalSigns,
        openVulnerabilities: {
          available: true as const,
          value: [{ id: "OSV-1", aliases: ["CVE-2020-8203"], summary: "s" }],
        },
      },
    };
    const r = compileHarness({
      ...input(deltasFile([proto("x", "default", "CVE-2020-8203")])),
      certificate: cert,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a delta whose function no preset selection covers", () => {
    const errors = errorsOf(input(deltasFile([proto("x", "isPublic")])));
    expect(errors[0]).toMatchObject({ code: "delta-function-not-selected", key: "isPublic" });
  });

  it("rejects a package that differs from the certificate", () => {
    const errors = errorsOf(input(deltasFile(undefined, "ip"), harnessFile(undefined, "ip")));
    expect(errors.map((e) => e.code)).toEqual(["package-mismatch", "package-mismatch"]);
  });

  it("returns returns-expected-not-implemented for a valid returns-expected delta", () => {
    const delta = {
      kind: "returns-expected",
      id: "re",
      function: "default",
      advisory: "GHSA-p6mc-m468-83gw",
      cases: [
        {
          input: ["a"],
          expected: 1,
          source: { url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", fetchedAt: "2026-11-15T10:00:00Z" },
        },
      ],
    };
    expect(errorsOf(input(deltasFile([delta]))).map((e) => e.code)).toEqual(["returns-expected-not-implemented"]);
  });

  it("never throws on malformed input", () => {
    const r = compileHarness({ deltas: undefined, harness: null, certificate: LODASH_SET_CERT } as unknown as CompileInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("internal-error");
  });
});

describe("compileHarnessFiles: forbidden content", () => {
  it.each(["radius", "seed", "caseCount", "perCallTimeoutMs", "excluded"])(
    "names the CI-owned key %s with 'belongs to CI'",
    (key) => {
      const errors = fileErrors(deltasFile(), harnessFile({ default: { preset: "lodash-set", [key]: true } }));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "forbidden-key", key });
      expect(errors[0]?.message).toContain("belongs to CI");
    },
  );

  it.each(["stubs", "accept", "args", "setupModule", "propertyModule", "generator", "predicate"])(
    "names the code key %s without claiming it belongs to CI",
    (key) => {
      const errors = fileErrors(
        deltasFile([{ ...proto("x"), [key]: "x" }]),
        harnessFile(),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "forbidden-key", key });
      expect(errors[0]?.message).not.toContain("belongs to CI");
    },
  );

  it("finds a forbidden key given as a preset option", () => {
    const errors = fileErrors(deltasFile(), harnessFile({ default: { preset: "lodash-set", options: { seed: 1 } } }));
    expect(errors[0]).toMatchObject({ code: "forbidden-key", key: "seed" });
    expect(errors[0]?.where).toContain("options");
  });

  it("does not search the data of a case", () => {
    const delta = {
      kind: "returns-expected",
      id: "re",
      function: "default",
      advisory: "GHSA-p6mc-m468-83gw",
      cases: [
        {
          input: [{ seed: 1 }],
          expected: { radius: 2 },
          source: { url: "https://github.com/advisories/GHSA-p6mc-m468-83gw", fetchedAt: "2026-11-15T10:00:00Z" },
        },
      ],
    };
    const errors = fileErrors(deltasFile([delta]), harnessFile());
    expect(errors.map((e) => e.code)).toEqual(["returns-expected-not-implemented"]);
  });

  it("reports malformed JSON and schema failures with the file name", () => {
    const bad = compileHarnessFiles({
      deltasJson: "{",
      harnessJson: JSON.stringify({ schemaVersion: 2 }),
      certificate: LODASH_SET_CERT,
    });
    if (bad.ok) throw new Error("expected failure");
    expect(bad.error[0]).toMatchObject({ code: "parse-error", where: "deltas.json (root)" });

    const schema = fileErrors(deltasFile([{ kind: "nope" }]), harnessFile());
    expect(schema[0]?.code).toBe("parse-error");
    expect(schema[0]?.message).toContain("deltas.json");
  });

  it("compiles valid file text", () => {
    const r = compileHarnessFiles({
      deltasJson: JSON.stringify(deltasFile()),
      harnessJson: JSON.stringify(harnessFile()),
      certificate: LODASH_SET_CERT,
    });
    expect(r.ok).toBe(true);
  });
});
