// Identity safety through buildReport (task 8.9; Requirements 13.25 to 13.30, decisions D10 and D11,
// limitation L14). Fake identity values only, except the one real-machine test at the end, which
// never prints the values it reads: every assertion there is a boolean with a fixed message.
import { afterEach, describe, expect, it, vi } from "vitest";
import { findIdentity, identityValuesFromEnv, type Platform } from "../../../src/proof/core/identity";
import { buildReport, type RawDivergence, type ReportInput } from "../../../src/proof/core/report";
import type { Outcome, ProofReport } from "../../../src/proof/types";

const zero = { cycle: 0, depth: 0, getter: 0, proxy: 0 };

function returned(text: string): Outcome {
  return { kind: "returned", async: false, value: { t: "str", v: text }, args: [], prototypeDelta: [] };
}

function divergence(a: string, b: string, arg = "x"): RawDivergence {
  return {
    function: "pad",
    kind: "unexplained",
    args: [{ t: "str", v: arg }],
    replay: { phase: "generated", seed: 42, path: "3:0" },
    differences: [{ part: "value", path: "" }],
    original: returned(a),
    resurrection: returned(b),
    shrink: { attempts: 5, budgetExhausted: false },
  };
}

function base(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    package: { name: "left-pad", version: "1.3.0" },
    original: { integrity: "sha512-AAAA", verified: true },
    resurrection: { source: "directory", treeHash: "sha512-BBBB" },
    sandbox: {
      mechanism: "in-process",
      restartEvents: { original: 0, resurrection: 0 },
      otherRestarts: { original: 0, resurrection: 0 },
      limits: {
        callTimeoutMs: 1000,
        heapLimitMb: 256,
        outputLimitBytes: 1048576,
        maxRestarts: 20,
        casesRequested: 100,
        shrinkBudget: 500,
      },
    },
    functionsTested: ["pad"],
    casesPerFunction: [{ function: "pad", cases: 100 }],
    unencodableValues: [{ function: "pad", cases: 100, casesWithUnencodable: 0, total: 0, reasons: zero }],
    excludedFunctions: [],
    nonDeterministicFunctions: [],
    divergences: [],
    deltas: [],
    harnessErrors: [],
    seed: 42,
    toolVersions: { node: "v22.0.0", fastCheck: "4.10.2" },
    roots: { original: { created: "C:\\gs\\a" }, resurrection: { created: "C:\\gs\\b" } },
    otherTempRoots: [],
    identity: identityValuesFromEnv({}, "win32"),
    platform: "win32",
    serialize: (r: ProofReport) => JSON.stringify(r),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("comparison before redaction (13.29 e/f, 13.30)", () => {
  it("keeps a divergence when only one of two different users is an Identity_Value", () => {
    const identity = identityValuesFromEnv({ USERNAME: "alice" }, "win32");
    const report = buildReport(base({ identity, divergences: [divergence("C:\\Users\\alice\\x", "C:\\Users\\bob\\x")] }));
    const d = report.divergences[0];
    expect(report.verdict).toBe("restless");
    expect(report.divergences).toHaveLength(1);
    expect(d).toMatchObject({
      original: { value: { v: "C:\\Users\\<user>\\x" } },
      resurrection: { value: { v: "C:\\Users\\bob\\x" } },
      redactionMaskedDifference: false,
    });
    expect(JSON.stringify(report).toLowerCase().includes("alice")).toBe(false);
  });

  it("flags redactionMaskedDifference when two different Identity_Values redact to the same text", () => {
    const identity = identityValuesFromEnv({ USERPROFILE: "C:\\Users\\alice", HOMEPATH: "\\Users\\bob" }, "win32");
    // Two different Identity_Values: both become <user-home>.
    const report = buildReport(
      base({ identity, divergences: [divergence("C:\\Users\\alice", "\\Users\\bob")] }),
    );
    const d = report.divergences[0];
    expect(report.divergences).toHaveLength(1);
    expect(report.verdict).toBe("restless");
    expect(d?.redactionMaskedDifference).toBe(true);
  });

  it("does not flag equal strings and does not create a divergence from them", () => {
    const identity = identityValuesFromEnv({ USERNAME: "alice" }, "win32");
    const report = buildReport(base({ identity }));
    expect(report.verdict).toBe("alive");
    expect(report.divergences).toEqual([]);
  });
});

describe("Identity_Scanner backstop (13.26)", () => {
  const identity = identityValuesFromEnv({ USERNAME: "zelda_fake", USERPROFILE: "C:\\Users\\zelda_fake" }, "win32");
  const residue = "C:\\Users\\zelda_fake\\leftover";

  it("returns identity-leak, inconclusive, with a fallback report free of identity values", () => {
    const report = buildReport(
      base({
        identity,
        divergences: [divergence("a", "b")],
        // A residue form the redactor never saw: the serializer adds it to a full report only.
        serialize: (r) => (r.divergences.length > 0 ? `${JSON.stringify(r)}${residue}` : JSON.stringify(r)),
      }),
    );
    expect(report.verdict).toBe("inconclusive");
    expect(report.harnessErrors.map((e) => e.kind)).toEqual(["identity-leak"]);
    expect(report.divergences).toEqual([]);
    expect(report.deltas).toEqual([]);
    const text = JSON.stringify(report);
    expect(findIdentity(text, identity, "win32").found, "fallback contains an Identity_Value").toBe(false);
    expect(text.toLowerCase().includes("zelda_fake"), "fallback contains the fake name").toBe(false);
  });

  it("withholds an identity-bearing field of the fallback instead of printing it", () => {
    const report = buildReport(
      base({
        identity,
        harnessErrors: [{ kind: "unloadable-module", message: "cannot open C:\\Users\\zelda_fake\\x" }],
        serialize: (r) => (r.harnessErrors.length === 1 ? `${JSON.stringify(r)}${residue}` : JSON.stringify(r)),
      }),
    );
    expect(report.verdict).toBe("inconclusive");
    expect(findIdentity(JSON.stringify(report), identity, "win32").found, "fallback contains an Identity_Value").toBe(false);
  });

  it("keeps an Identity_Value out of the fallback when it sits in a field the report does not redact", () => {
    const report = buildReport(
      base({ identity, toolVersions: { node: "v22.0.0 C:\\Users\\zelda_fake\\node", fastCheck: "4.10.2" } }),
    );
    expect(report.verdict).toBe("inconclusive");
    expect(report.harnessErrors.map((e) => e.kind)).toEqual(["identity-leak"]);
    expect(findIdentity(JSON.stringify(report), identity, "win32").found, "fallback contains an Identity_Value").toBe(false);
  });
});

describe("fake identity values never reach report, logs or error messages", () => {
  const env = {
    USERNAME: "zelda_fake",
    USERPROFILE: "C:\\Users\\zelda_fake",
    HOMEPATH: "\\Users\\zelda_fake",
  };
  const identity = identityValuesFromEnv(env, "win32");
  const forms = [
    "zelda_fake",
    "C:\\Users\\zelda_fake",
    "C:\\\\Users\\\\zelda_fake",
    "C:/Users/zelda_fake",
    "\\Users\\zelda_fake",
  ];

  it("serialized report, console output and error messages contain none of them", () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
    ];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const collisionDivergence: RawDivergence = {
      ...divergence("a", "b"),
      original: {
        kind: "returned",
        async: false,
        value: {
          t: "object",
          ctor: "Object",
          props: [
            ["C:\\Users\\zelda_fake\\k", { t: "num", v: 1 }],
            ["<user-home>\\k", { t: "num", v: 2 }],
          ],
        },
        args: [],
        prototypeDelta: [],
      },
    } as RawDivergence;
    const reports: ProofReport[] = [
      buildReport(
        base({
          identity,
          divergences: [
            divergence("C:\\Users\\zelda_fake\\a", "zelda_fake wrote C:/Users/zelda_fake/b", "\\Users\\zelda_fake\\in"),
          ],
          harnessErrors: [{ kind: "unloadable-module", message: "failed in C:\\Users\\zelda_fake\\pkg" }],
        }),
      ),
      buildReport(base({ identity, divergences: [collisionDivergence] })),
      buildReport(base({ identity, serialize: (r) => `${JSON.stringify(r)} C:\\Users\\zelda_fake` })),
    ];

    const captured = [
      ...spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))),
      ...stdout.mock.calls.map((c) => String(c[0])),
      ...stderr.mock.calls.map((c) => String(c[0])),
    ];
    stdout.mockRestore();
    stderr.mockRestore();

    const lowered = (t: string): string => t.toLowerCase();
    for (const report of reports) {
      const text = lowered(JSON.stringify(report));
      const messages = lowered(report.harnessErrors.map((e) => e.message).join("\n"));
      for (const form of forms) {
        expect(text.includes(form.toLowerCase()), "serialized report contains a fake identity form").toBe(false);
        expect(messages.includes(form.toLowerCase()), "an error message contains a fake identity form").toBe(false);
      }
      expect(findIdentity(JSON.stringify(report), identity, "win32").found, "scanner finds a value in a report").toBe(false);
    }
    expect(captured.some((line) => forms.some((f) => line.toLowerCase().includes(f.toLowerCase()))), "a log line contains a fake identity form").toBe(false);
    expect(reports.map((r) => r.verdict)).toEqual(["inconclusive", "inconclusive", "inconclusive"]);
    expect(reports.map((r) => r.harnessErrors.some((e) => e.kind === "normalization-collision"))).toEqual([false, true, false]);
    expect(reports[2]?.harnessErrors.map((e) => e.kind)).toEqual(["identity-leak"]);
  });

  // The emit path (every line written through shell/emit during an engine run) is tested in
  // tests/proof/unit/endToEndIdentity.test.ts (task 11.12), with these fake values and with the
  // machine's real values; the todo that stood here was moved there and deleted.
});

describe("real machine identity (L14)", () => {
  const platform: Platform = process.platform === "win32" ? "win32" : "posix";
  const real = identityValuesFromEnv(process.env, platform);
  const hasHome = real.pathValues.length > 0;
  const hasName = real.userName !== undefined && real.userName !== "";
  const runnable = hasHome || hasName;

  // Skipped only when the environment has no home-path variable and no USERNAME at all.
  it.skipIf(!runnable)(
    "a report built from strings holding the real home path and user name contains neither",
    () => {
      const home = real.pathValues[0];
      const name = real.userName;
      const sep = platform === "win32" ? "\\" : "/";
      const a: string[] = [];
      const b: string[] = [];
      if (home !== undefined) {
        a.push(`${home}${sep}project${sep}a.js`);
        b.push(`${home}${sep}project${sep}b.js`);
      }
      if (name !== undefined) {
        a.push(`${sep}Users${sep}${name}${sep}x`);
        b.push(`/home/${name}/y`);
      }
      const input = base({
        identity: real,
        platform,
        roots:
          platform === "win32"
            ? { original: { created: "C:\\gs-proof\\a" }, resurrection: { created: "C:\\gs-proof\\b" } }
            : { original: { created: "/gs-proof/a" }, resurrection: { created: "/gs-proof/b" } },
        divergences: [divergence(a.join(" | "), b.join(" | "), a.join(" | "))],
      });
      const report = buildReport(input);
      const text = JSON.stringify(report);

      expect(report.verdict, "verdict is not restless").toBe("restless");
      expect(report.divergences.length, "divergence missing").toBe(1);
      expect(findIdentity(text, real, platform).found, "scanner finds an Identity_Value in the report").toBe(false);
      for (const p of real.pathValues) {
        expect(text.includes(p), "report contains a raw home path value").toBe(false);
        expect(text.includes(JSON.stringify(p).slice(1, -1)), "report contains an escaped home path value").toBe(false);
      }
      if (name !== undefined && (name.length >= 4 || name.length > 0)) {
        // The name appears only as a path segment here, which the requirements promise to remove.
        const segment = new RegExp(`[\\\\/]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._~-])`, platform === "win32" ? "i" : "");
        expect(segment.test(text), "report contains the user name as a path segment").toBe(false);
      }
    },
  );

  it.runIf(!runnable)("is skipped because neither a home path variable nor USERNAME is set", () => {
    expect(runnable).toBe(false);
  });
});
