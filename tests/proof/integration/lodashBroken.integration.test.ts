// lodash.set broken test (task 18.9; Requirements 8, 11, 12, 14.8). The REAL engine runs end to end
// with the REAL Sandbox_Executor: Original = the committed lodash.set@4.3.2 tarball (integrity from
// its meta file), Resurrection = tests/proof/fixtures/lodash.set-broken (a directory whose only
// difference outside the declared delta is that numeric path segments create `{}` instead of `[]`).
// Expected: verdict `restless` with an unexplained Divergence for `set`, a shrunk counterexample
// with a numeric index path, and Replay_Parameters (seed and path) that reproduce it.
//
// Harness: lodashSetHarness with small overrides (shrinkBudget, delta caseCount) and with the
// ordinary explicit cases reduced to those without a numeric path segment. The default explicit
// list has `[{}, "a[0].b", 2]`, which would find the divergence in the explicit phase (Replay has
// an `index` only). Keeping numeric paths out of the explicit list makes the GENERATED phase
// (seed and path) the one under test. The generators and the case count (100) are the defaults.
// No assertion message prints an Identity_Value or a temp root: all checks are booleans.
// Requirements: 3.6, 8.7, 8.8, 11.4, 11.8, 12.2, 13.4, 14.8
import { mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import * as tar from "tar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeNode } from "../../../src/proof/child/codec/decode";
import { canonicalizeNode } from "../../../src/proof/child/codec/canonical";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import { deepEqualNodes } from "../../../src/proof/core/equal";
import { findIdentity, identityValuesFromEnv } from "../../../src/proof/core/identity";
import { lodashSetHarness, ordinaryExplicitCases } from "../../../src/proof/harnesses/lodash.set/config";
import { replayPhase, type DriverOptions } from "../../../src/proof/shell/driver";
import { defaultProofDeps, runProofOfLife } from "../../../src/proof/shell/orchestrator";
import type { FunctionHarness, HarnessConfig, ProofRequest, ProofRun, Replay } from "../../../src/proof/types";
import { createHarness, type PackageSource } from "./helpers/sandboxHarness";

const FIXTURES = join(__dirname, "..", "fixtures");
const TARBALL = join(FIXTURES, "lodash.set", "lodash.set-4.3.2.tgz");
const META = join(FIXTURES, "lodash.set", "lodash.set-4.3.2.meta.json");
const BROKEN_DIR = join(FIXTURES, "lodash.set-broken");
const tarballPresent = existsSync(TARBALL) && existsSync(META);
const snapshot = defaultProofDeps();
const identity = identityValuesFromEnv(snapshot.env, snapshot.platform);

const hasNumericSegment = (args: readonly unknown[]): boolean => {
  const p = args[1];
  if (Array.isArray(p)) return p.some((s) => typeof s === "number" || (typeof s === "string" && /^\d+$/.test(s)));
  return typeof p === "string" && /\[\s*\d+\s*\]|(^|\.)\d+(\.|$)/.test(p);
};

// The shipped harness keys the function and the delta as `default` (lodash.set's module.exports).
const FN = "default";
const smallHarness: HarnessConfig = {
  ...lodashSetHarness,
  shrinkBudget: 100,
  functions: {
    [FN]: {
      ...(lodashSetHarness.functions[FN] as FunctionHarness),
      explicitCases: ordinaryExplicitCases.filter((c) => !hasNumericSegment(c)),
    },
  },
  deltas: lodashSetHarness.deltas.map((d) => ({ ...d, caseCount: 20 })),
};

let root = "";
const lines: string[] = [];
let tempRoot = "";
let first: ProofRun | undefined;
let second: ProofRun | undefined;

function request(): ProofRequest {
  const meta = JSON.parse(readFileSync(META, "utf8")) as { name: string; version: string; integrity: string };
  return {
    original: { name: meta.name, version: meta.version, tarballPath: TARBALL, integrity: meta.integrity },
    resurrection: { kind: "directory", path: BROKEN_DIR },
    harness: smallHarness,
  };
}

async function runOnce(): Promise<ProofRun> {
  return runProofOfLife(request(), { ...snapshot, tempRoot, sink: (line) => void lines.push(line) });
}

function everything(run: ProofRun): string {
  return [run.json, ...lines, ...run.report.harnessErrors.map((e) => e.message)].join("\n");
}

function readTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).replace(/\\/g, "/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return files;
}

describe.skipIf(!tarballPresent)("lodash.set original against lodash.set-broken (real engine, real sandbox)", () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "gs-lodash-broken-"));
    tempRoot = join(root, "tmp");
    mkdirSync(tempRoot);
    first = await runOnce();
    second = await runOnce();
  });
  afterAll(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const divergence = () => {
    const found = first!.report.divergences.find((d) => d.function === FN && d.kind === "unexplained");
    return found !== undefined && found.kind !== "api-surface" ? found : undefined;
  };

  it("gives verdict restless with no harness error", () => {
    expect(first!.report.harnessErrors.map((e) => `${e.kind}: ${e.message}`)).toEqual([]);
    expect(first!.report.verdict).toBe("restless");
    expect(first!.report.original.verified).toBe(true);
    expect(first!.report.sandbox.mechanism).toBe("node-permission");
  });

  it("lists an unexplained divergence for set, not a delta violation", () => {
    expect(divergence(), "no unexplained divergence for set").toBeDefined();
    expect(first!.report.divergences.some((d) => d.kind === "delta-violation"), "a delta-violation is listed").toBe(false);
  });

  it("the shrunk counterexample has a numeric index path and differs first in the returned value", () => {
    const d = divergence()!;
    const args = d.args.map((n) => decodeNode(n));
    expect(hasNumericSegment(args), "the counterexample path has no numeric segment").toBe(true);
    expect(d.differences.length).toBeGreaterThan(0);
    expect(d.differences[0]!.part).toBe("value");
    expect(d.original.kind).toBe("returned");
    expect(d.resurrection.kind).toBe("returned");
    // Array on the Original, plain object on the Resurrection, somewhere in the returned value.
    const text = (o: unknown): string => JSON.stringify(o);
    expect(text(d.original).includes('"t":"array"'), "the Original value has no array").toBe(true);
    expect(text(d.resurrection).includes('"t":"array"') && !text(d.original).includes('"t":"object"'),
      "the sides do not differ as array versus object").toBe(false);
  });

  it("for the explicit case [{}, 'a[0]', 1] the Original returns exactly { a: [1] } and the Resurrection exactly { a: { '0': 1 } }", async () => {
    const base = request();
    const explicitHarness: HarnessConfig = {
      ...smallHarness,
      functions: {
        [FN]: {
          ...(smallHarness.functions[FN] as FunctionHarness),
          explicitCases: [[{}, "a[0]", 1]],
        },
      },
    };
    const run = await runProofOfLife(
      { ...base, harness: explicitHarness },
      { ...snapshot, tempRoot, sink: (line) => void lines.push(line) },
    );
    expect(run.report.harnessErrors.map((e) => `${e.kind}: ${e.message}`)).toEqual([]);
    const d = run.report.divergences.find(
      (x) => x.function === FN && x.kind === "unexplained" && x.replay.phase === "explicit" && x.replay.index === 0,
    );
    expect(d, "no unexplained divergence for set at explicit index 0").toBeDefined();
    if (d === undefined || d.kind === "api-surface") throw new Error("expected an unexplained divergence");
    expect(d.replay.phase, "the explicit case was not the one that diverged").toBe("explicit");
    expect(d.original.kind).toBe("returned");
    expect(d.resurrection.kind).toBe("returned");
    if (d.original.kind !== "returned" || d.resurrection.kind !== "returned") return;
    const expected = (v: unknown) => {
      const r = encodeValue(v, { budget: 1_000_000 });
      if (!r.ok) throw new Error("could not encode the expected value");
      return canonicalizeNode(r.node);
    };
    const wantOriginal = expected({ a: [1] });
    const wantResurrection = expected({ a: { "0": 1 } });
    expect(deepEqualNodes(canonicalizeNode(d.original.value), wantOriginal), "the Original value is not exactly { a: [1] }").toBe(true);
    expect(deepEqualNodes(canonicalizeNode(d.resurrection.value), wantResurrection), "the Resurrection value is not exactly { a: { '0': 1 } }").toBe(true);
    expect(JSON.stringify(canonicalizeNode(d.original.value)) === JSON.stringify(wantOriginal)).toBe(true);
    expect(JSON.stringify(canonicalizeNode(d.resurrection.value)) === JSON.stringify(wantResurrection)).toBe(true);
  }, 120_000);

  it("has Replay_Parameters with a seed and a path", () => {
    const r = divergence()!.replay;
    expect(r.phase).toBe("generated");
    if (r.phase === "explicit") throw new Error("expected a generated replay");
    // The recorded seed is the per-phase seed derived from the run seed, an int32.
    expect(Number.isInteger(r.seed) && Math.abs(r.seed) <= 2 ** 31).toBe(true);
    expect(r.path.length).toBeGreaterThan(0);
  });

  it("replays the same counterexample from the recorded seed and path", async () => {
    const d = divergence()!;
    const replay: Replay = d.replay;
    const h = createHarness({
      limits: { callTimeoutMs: 1000, heapLimitMb: 256, outputLimitBytes: 1_048_576 },
      readPaths: smallHarness.readPaths ?? [],
    });
    try {
      const extracted = join(h.root, "extracted");
      mkdirSync(extracted);
      await tar.x({ file: TARBALL, cwd: extracted, strip: 1 });
      const original = await h.open(readTree(extracted) as PackageSource, "original");
      const resurrection = await h.open(readTree(BROKEN_DIR) as PackageSource, "resurrection");
      const options: DriverOptions = {
        seed: smallHarness.seed,
        caseCount: smallHarness.caseCount,
        shrinkBudget: smallHarness.shrinkBudget,
        deltas: smallHarness.deltas,
      };
      const replayed = await replayPhase(
        FN,
        smallHarness.functions[FN] as FunctionHarness,
        { original: original.handle, resurrection: resurrection.handle },
        options,
        replay,
      );
      expect(replayed.harnessErrors.length, "the replay had a harness error").toBe(0);
      expect(replayed.diverged, "the replay did not diverge").toBe(true);
      const encoded = (replayed.counterexample ?? []).map((v) => {
        const r = encodeValue(v, { budget: 1_000_000 });
        if (!r.ok) throw new Error("the replayed counterexample could not be encoded");
        return r.node;
      });
      expect(JSON.stringify(encoded) === JSON.stringify(d.args), "the replayed counterexample differs from the report").toBe(true);
    } finally {
      await h.cleanup();
    }
  });

  it("reports the declared delta as demonstrated (the broken fixture keeps the pollution guard)", () => {
    const delta = first!.report.deltas.find((x) => x.function === FN);
    expect(delta, "no delta report for set").toBeDefined();
    expect(delta!.status).toBe("demonstrated");
    expect(delta!.demonstration, "no demonstration").not.toBeNull();
  });

  it("is deterministic: two real runs with the same seed give the same report", () => {
    expect(second!.json === first!.json, "the two reports differ").toBe(true);
  });

  it("has no temp root and no Identity_Value in the report, log lines or error messages", () => {
    for (const run of [first!, second!]) {
      const text = everything(run);
      expect(findIdentity(text, identity, snapshot.platform).found, "an Identity_Value was found").toBe(false);
      const forms = [tempRoot, tempRoot.replace(/\\/g, "/"), JSON.stringify(tempRoot).slice(1, -1)];
      expect(forms.some((f) => text.toLowerCase().includes(f.toLowerCase())), "the temp root was found").toBe(false);
    }
  });

  it("removes the work directory", () => {
    expect(readdirSync(tempRoot).length, "the work directory was not removed").toBe(0);
  });
});
