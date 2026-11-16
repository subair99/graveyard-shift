// Harness compiler (Requirements 4.3 to 4.7, 5.1 to 5.6, 5.11; design "Harness: Deltas_File,
// Harness_File, presets and compiler"). Pure: the same inputs give equal results (R5.5), and
// `compileHarness` never throws (R5.11).
//
// V14 (engine read at task 6.4, journal entry 2026-11-16): a sandbox-side property module is called
// with `{ functionName, kind, prototypeDelta, result }` only, so there is no channel for per-delta
// data. A `prototype-unchanged` delta needs none (it reuses pollution.cjs). A `returns-expected`
// delta will get one generated property module per delta from a template (task 12.2), written to
// the work directory by CI as data; this compiler does not lower that kind yet.

import type { DeathCertificate } from "../../../engine/types";
import type { Result } from "../../common/result";
import { compareCodePoints } from "../../../proof/child/codec/order";
import type { DeclaredDelta, FunctionHarness, HarnessConfig } from "../../../proof/types";
import type { Delta, DeltasFile } from "./deltas";
import { parseDeltasFile } from "./deltas";
import type { HarnessFile } from "./harnessFile";
import { parseHarnessFile } from "./harnessFile";
import { deriveIpDeltas } from "./ipMeasurement";
import type { IpMeasurement } from "./ipMeasurement";
import { findPreset, PRESET_NAMES } from "./presets";

export type CompileErrorCode =
  | "parse-error"
  | "forbidden-key"
  | "forbidden-value"
  | "package-mismatch"
  | "unknown-preset"
  | "invalid-option"
  | "preset-package-mismatch"
  | "unknown-function"
  | "duplicate-delta-id"
  | "unknown-advisory"
  | "delta-function-not-selected"
  | "delta-kind-unsupported"
  | "missing-source"
  | "measurement-required"
  | "input-not-measured"
  | "returns-expected-not-implemented"
  | "internal-error";

export interface CompileError {
  code: CompileErrorCode;
  /** Where the problem is, e.g. `harness.json functions.default` or `deltas.json deltas[0]`. */
  where: string;
  message: string;
  /** The offending key or preset name, when there is one. */
  key?: string;
  deltaId?: string;
}

export interface CompiledHarness {
  config: HarnessConfig;
  /** Names of the presets the Harness_File selected, sorted. */
  presetsUsed: string[];
}

export interface CompileInput {
  deltas: DeltasFile;
  harness: HarnessFile;
  certificate: DeathCertificate;
  /** Required when the package is `ip` and a `returns-expected` delta exists. */
  measurement?: IpMeasurement;
}

/**
 * Settings the compiled config carries so it satisfies `HarnessConfig`. They are placeholders the
 * CI caller (`prove.ts`) overrides through `--seed`, `--cases` and `--timeout`; no file the Medium
 * writes can change them (A11). Values are those of the lodash.set harness.
 */
export const CI_RUN_DEFAULTS = {
  seed: 20260101,
  caseCount: 100,
  perCallTimeoutMs: 1000,
  heapLimitMb: 256,
  outputLimitBytes: 1_048_576,
  maxRestarts: 20,
  shrinkBudget: 500,
} as const;

/** Keys that belong to CI (A11): the Medium may not set them. */
export const CI_OWNED_KEYS: readonly string[] = ["excluded", "radius", "caseCount", "seed", "perCallTimeoutMs"];

/** Keys that are engine settings or code: never accepted from a Medium file. */
export const CODE_KEYS: readonly string[] = [
  "stubs",
  "accept",
  "args",
  "setupModule",
  "propertyModule",
  "generator",
  "predicate",
];

export const FORBIDDEN_KEYS: readonly string[] = [...CI_OWNED_KEYS, ...CODE_KEYS];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function keyError(file: string, where: string, key: string): CompileError {
  const reason = CI_OWNED_KEYS.includes(key)
    ? "this setting belongs to CI and is not accepted from the Medium"
    : "code and engine settings are not accepted from the Medium";
  return {
    code: "forbidden-key",
    where: `${file} ${where}`,
    key,
    message: `${file} ${where}: key "${key}" is not allowed: ${reason}`,
  };
}

/** Checks the keys of one level of structure; function values are rejected wherever they appear. */
function scanLevel(file: string, where: string, o: Obj, out: CompileError[]): void {
  for (const key of Object.keys(o).sort(compareCodePoints)) {
    if (FORBIDDEN_KEYS.includes(key)) out.push(keyError(file, where, key));
    if (typeof o[key] === "function") {
      out.push({
        code: "forbidden-value",
        where: `${file} ${where}`,
        key,
        message: `${file} ${where}: the value of "${key}" is a function; code is not accepted from the Medium`,
      });
    }
  }
}

/**
 * Looks for forbidden keys and function values in the structural levels of a Deltas_File
 * (root, each delta, each case) or Harness_File (root, each function entry, each options object).
 * Case `input`, `expected` and `source` values are data and are not searched.
 */
export function findForbiddenContent(
  file: "deltas.json" | "harness.json",
  raw: unknown,
): CompileError[] {
  const out: CompileError[] = [];
  if (!isObj(raw)) return out;
  scanLevel(file, "(root)", raw, out);
  if (file === "deltas.json") {
    const deltas = raw["deltas"];
    if (Array.isArray(deltas)) {
      deltas.forEach((d: unknown, i: number) => {
        if (!isObj(d)) return;
        scanLevel(file, `deltas[${i}]`, d, out);
        const cases = d["cases"];
        if (Array.isArray(cases)) {
          cases.forEach((c: unknown, j: number) => {
            if (isObj(c)) scanLevel(file, `deltas[${i}].cases[${j}]`, c, out);
          });
        }
      });
    }
  } else {
    const fns = raw["functions"];
    if (isObj(fns)) {
      for (const name of Object.keys(fns).sort(compareCodePoints)) {
        const entry = fns[name];
        if (!isObj(entry)) continue;
        scanLevel(file, `functions.${name}`, entry, out);
        const options = entry["options"];
        if (isObj(options)) scanLevel(file, `functions.${name}.options`, options, out);
      }
    }
  }
  return out;
}

function certificateHasAdvisory(cert: DeathCertificate, advisory: string): boolean {
  if (cert.openVulnerabilityIds.includes(advisory)) return true;
  const open = cert.vitalSigns.openVulnerabilities;
  if (!open.available) return false;
  return open.value.some((v) => v.id === advisory || v.aliases.includes(advisory));
}

function compileInner(input: CompileInput): Result<CompiledHarness, CompileError[]> {
  const { deltas, harness, certificate, measurement } = input;
  const errors: CompileError[] = [];
  const add = (e: CompileError): void => {
    errors.push(e);
  };

  errors.push(...findForbiddenContent("deltas.json", deltas), ...findForbiddenContent("harness.json", harness));

  const pkg = certificate.package.name;
  if (deltas.package !== pkg) {
    add({
      code: "package-mismatch",
      where: "deltas.json (root)",
      key: "package",
      message: `deltas.json: package "${deltas.package}" is not the certificate's package "${pkg}"`,
    });
  }
  if (harness.package !== pkg) {
    add({
      code: "package-mismatch",
      where: "harness.json (root)",
      key: "package",
      message: `harness.json: package "${harness.package}" is not the certificate's package "${pkg}"`,
    });
  }

  // Functions: every entry names a preset from the menu, a function the preset covers, and options
  // the preset declares.
  const functions: Record<string, FunctionHarness> = {};
  const presetOfFunction = new Map<string, string>();
  const presetsUsed = new Set<string>();
  for (const name of Object.keys(harness.functions).sort(compareCodePoints)) {
    const entry = harness.functions[name];
    if (entry === undefined) continue;
    const where = `harness.json functions.${name}`;
    const preset = findPreset(entry.preset);
    if (preset === undefined) {
      add({
        code: "unknown-preset",
        where,
        key: entry.preset,
        message: `${where}: unknown preset "${entry.preset}" (known: ${PRESET_NAMES.join(", ")})`,
      });
      continue;
    }
    if (preset.package !== pkg) {
      add({
        code: "preset-package-mismatch",
        where,
        key: entry.preset,
        message: `${where}: preset "${preset.name}" is for package "${preset.package}", not "${pkg}"`,
      });
      continue;
    }
    if (!preset.functions.includes(name)) {
      add({
        code: "unknown-function",
        where,
        key: name,
        message: `${where}: preset "${preset.name}" does not cover function "${name}" (covers: ${preset.functions.join(", ")})`,
      });
      continue;
    }
    const parsed = preset.optionsSchema.safeParse(entry.options ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const at = issue.path.length === 0 ? "options" : `options.${issue.path.map(String).join(".")}`;
        add({
          code: "invalid-option",
          where: `${where}.${at}`,
          message: `${where}.${at}: ${issue.message}`,
        });
      }
      continue;
    }
    functions[name] = preset.build(parsed.data);
    presetOfFunction.set(name, preset.name);
    presetsUsed.add(preset.name);
  }

  // Deltas, ordered by id (R5.5). A duplicate id is an error.
  const sorted = [...deltas.deltas].sort((a, b) => compareCodePoints(a.id, b.id));
  const seen = new Set<string>();
  const declared: DeclaredDelta[] = [];
  sorted.forEach((d: Delta) => {
    const where = `deltas.json delta "${d.id}"`;
    const base = { where, deltaId: d.id };
    if (seen.has(d.id)) {
      add({ ...base, code: "duplicate-delta-id", key: d.id, message: `${where}: the id is used more than once` });
      return;
    }
    seen.add(d.id);
    if (!certificateHasAdvisory(certificate, d.advisory)) {
      add({
        ...base,
        code: "unknown-advisory",
        key: d.advisory,
        message: `${where}: advisory ${d.advisory} is not on the certificate (open vulnerability ids or their aliases)`,
      });
    }
    const presetName = presetOfFunction.get(d.function);
    if (presetName === undefined) {
      add({
        ...base,
        code: "delta-function-not-selected",
        key: d.function,
        message: `${where}: function "${d.function}" is not selected by a valid preset in harness.json`,
      });
      return;
    }
    const preset = findPreset(presetName);
    if (d.kind === "prototype-unchanged") {
      if (preset?.prototypeUnchangedDelta === undefined) {
        add({
          ...base,
          code: "delta-kind-unsupported",
          key: d.kind,
          message: `${where}: preset "${presetName}" does not support deltas of kind "${d.kind}"`,
        });
        return;
      }
      declared.push(preset.prototypeUnchangedDelta(d.id, d.function));
      return;
    }
    // returns-expected: validate everything, then report that the lowering is not built yet.
    let valid = true;
    d.cases.forEach((c, j) => {
      if (c.source === undefined) {
        valid = false;
        add({ ...base, code: "missing-source", message: `${where} cases[${j}]: a source url and fetchedAt are required` });
      }
    });
    if (pkg === "ip") {
      if (measurement === undefined) {
        valid = false;
        add({
          ...base,
          code: "measurement-required",
          message: `${where}: package ip needs docs/measurements/ip-2.0.1.json to check returns-expected inputs`,
        });
      } else {
        const measured = new Set(deriveIpDeltas(measurement).addresses);
        d.cases.forEach((c, j) => {
          const first: unknown = c.input[0];
          if (c.input.length !== 1 || typeof first !== "string" || !measured.has(first)) {
            valid = false;
            add({
              ...base,
              code: "input-not-measured",
              message: `${where} cases[${j}]: the input is not an address the Original measured as true`,
            });
          }
        });
      }
    }
    if (valid) {
      add({
        ...base,
        code: "returns-expected-not-implemented",
        key: d.kind,
        message: `${where}: deltas of kind "returns-expected" cannot be compiled yet`,
      });
    }
  });

  if (errors.length > 0) return { ok: false, error: errors };

  const readPaths = [...new Set(declared.map((d) => d.propertyModule))].sort(compareCodePoints);
  const config: HarnessConfig = {
    package: pkg,
    ...CI_RUN_DEFAULTS,
    functions,
    deltas: declared,
    ...(readPaths.length > 0 ? { readPaths } : {}),
  };
  return { ok: true, value: { config, presetsUsed: [...presetsUsed].sort(compareCodePoints) } };
}

/** Compiles parsed files into a HarnessConfig. Never throws; every problem is listed. */
export function compileHarness(input: CompileInput): Result<CompiledHarness, CompileError[]> {
  try {
    return compileInner(input);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: [{ code: "internal-error", where: "compiler", message: `the compiler failed unexpectedly: ${detail}` }],
    };
  }
}

function parseRaw(file: string, text: string): Result<unknown, CompileError> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: { code: "parse-error", where: `${file} (root)`, message: `${file} (root): malformed JSON: ${detail}` },
    };
  }
}

/**
 * Compiles from file text: forbidden keys are reported by name first (a strict-schema parse would
 * only say "unrecognized key"), then both files are parsed and compiled. Never throws.
 */
export function compileHarnessFiles(input: {
  deltasJson: string;
  harnessJson: string;
  certificate: DeathCertificate;
  measurement?: IpMeasurement;
}): Result<CompiledHarness, CompileError[]> {
  try {
    const errors: CompileError[] = [];
    const rawDeltas = parseRaw("deltas.json", input.deltasJson);
    const rawHarness = parseRaw("harness.json", input.harnessJson);
    if (!rawDeltas.ok) errors.push(rawDeltas.error);
    if (!rawHarness.ok) errors.push(rawHarness.error);
    if (rawDeltas.ok) errors.push(...findForbiddenContent("deltas.json", rawDeltas.value));
    if (rawHarness.ok) errors.push(...findForbiddenContent("harness.json", rawHarness.value));
    if (errors.length > 0) return { ok: false, error: errors };

    const deltas = parseDeltasFile(input.deltasJson);
    const harness = parseHarnessFile(input.harnessJson);
    if (!deltas.ok) {
      for (const issue of deltas.error.issues) {
        errors.push({ code: "parse-error", where: "deltas.json", message: `deltas.json ${issue}` });
      }
    }
    if (!harness.ok) {
      for (const issue of harness.error.issues) {
        errors.push({ code: "parse-error", where: "harness.json", message: `harness.json ${issue}` });
      }
    }
    if (!deltas.ok || !harness.ok) return { ok: false, error: errors };
    return compileHarness({
      deltas: deltas.value,
      harness: harness.value,
      certificate: input.certificate,
      ...(input.measurement === undefined ? {} : { measurement: input.measurement }),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: [{ code: "internal-error", where: "compiler", message: `the compiler failed unexpectedly: ${detail}` }],
    };
  }
}
