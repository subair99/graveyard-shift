// Requirements: 3.1, 3.2, 3.3, 3.4, 3.10, 3.11
import { describe, expect, it } from "vitest";
import {
  formatMeasurementTable,
  measureIp,
  nodeToJson,
} from "../../../scripts/lib/measureIp";
import {
  ADVISORY_ADDRESSES,
  INFORMATIONAL_ADDRESSES,
  deriveIpDeltas,
  parseIpMeasurement,
  printIpMeasurement,
} from "../../../src/pipeline/harness/core/ipMeasurement";
import { decodeNode } from "../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import type {
  CallRequest,
  CallResult,
  Executor,
  ExportEntry,
  SideSpec,
} from "../../../src/proof/shell/executor/types";
import type { EncodedNode, Outcome } from "../../../src/proof/types";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const SPEC: SideSpec = {
  side: "original",
  packageDir: "/p",
  entryFile: "/p/lib/ip.js",
  readPaths: [],
  limits: { callTimeoutMs: 1000, heapLimitMb: 64, outputLimitBytes: 1000 },
};
const clock = { now: () => new Date("2030-01-02T03:04:05.678Z") };

function enc(value: unknown): EncodedNode {
  const r = encodeValue(value, { budget: 1000 });
  if (!r.ok) throw new Error("encode failed");
  return r.node;
}

function returned(value: unknown): Outcome {
  return { kind: "returned", async: false, value: enc(value), args: [], prototypeDelta: [] };
}

function threw(message: string): Outcome {
  return {
    kind: "threw",
    async: false,
    value: { t: "error", cls: "TypeError", message, props: [] },
    args: [],
    prototypeDelta: [],
  };
}

interface Fake {
  executor: Executor;
  calls: string[];
  closed: () => boolean;
}

/** A fake executor: `answer` maps the input string to an outcome. */
function fakeExecutor(answer: (input: string) => Outcome, entries: ExportEntry[] = []): Fake {
  const calls: string[] = [];
  let closed = false;
  const executor: Executor = {
    mechanism: "in-process",
    probe: async () => ({ ok: true, value: undefined }),
    open: async () => ({
      ok: true,
      value: {
        listExports: async () => ({ ok: true, value: { entries } }),
        call: async (request: CallRequest) => {
          const arg = decodeNode(request.args[0] as EncodedNode) as string;
          calls.push(`${request.fn}(${arg})`);
          const result: CallResult = { outcome: answer(arg), properties: [], restoreVerified: true };
          return { ok: true, value: result };
        },
        restart: async () => ({ ok: true, value: undefined }),
        counters: () => ({ restartEvents: 0, otherRestarts: 0 }),
        close: async () => {
          closed = true;
        },
      },
    }),
    dispose: async () => undefined,
  };
  return { executor, calls, closed: () => closed };
}

const run = (fake: Fake, redact: (t: string) => string = (t) => t) =>
  measureIp({ executor: fake.executor, spec: SPEC, clock, integrity: INTEGRITY, node: "v26.0.0", redact });

describe("measureIp", () => {
  it("records returned values for every input, in order, and closes the side", async () => {
    const fake = fakeExecutor(() => returned(false));
    const { measurement } = await run(fake);
    expect(fake.calls).toEqual([...ADVISORY_ADDRESSES, ...INFORMATIONAL_ADDRESSES].map((a) => `isPublic(${a})`));
    expect(measurement.results.map((r) => r.input)).toEqual([...ADVISORY_ADDRESSES]);
    expect(measurement.results.every((r) => r.outcome.kind === "returned")).toBe(true);
    expect(deriveIpDeltas(measurement)).toEqual({ addresses: [], ipInDemo: false });
    expect(fake.closed()).toBe(true);
  });

  it("records a redacted thrown error", async () => {
    const fake = fakeExecutor(() => threw("bad C:\\secret\\x"));
    const { measurement } = await run(fake, (t) => t.replace("C:\\secret\\x", "<redacted-path>"));
    expect(measurement.results[0]?.outcome).toEqual({ kind: "threw", error: "TypeError: bad <redacted-path>" });
    expect(deriveIpDeltas(measurement).ipInDemo).toBe(false);
  });

  it("handles mixed results and keeps the informational inputs out of the deltas", async () => {
    const fake = fakeExecutor((input) =>
      input === "127.1" || input === "0" ? returned(true) : input === "012.1.2.3" ? threw("boom") : returned(false),
    );
    const { measurement } = await run(fake);
    expect(deriveIpDeltas(measurement)).toEqual({ addresses: ["127.1"], ipInDemo: true });
    expect(measurement.informational[0]).toEqual({ input: "0", outcome: { kind: "returned", value: true } });
  });

  it("writes the advisory ids, the two sources and the clock time, and round trips through the printer", async () => {
    const { measurement } = await run(fakeExecutor(() => returned(false)));
    expect(measurement.measuredAt).toBe("2030-01-02T03:04:05Z");
    expect(measurement.integrity).toBe(INTEGRITY);
    expect(measurement.node).toBe("v26.0.0");
    expect(measurement.advisory.id).toBe("GHSA-2p57-rm9w-gvfp");
    expect(measurement.advisory.aliases).toEqual(["CVE-2024-29415"]);
    expect(measurement.advisory.sources.map((s) => [s.url, s.checkedOn])).toEqual([
      ["https://github.com/advisories/GHSA-2p57-rm9w-gvfp", "2026-11-15"],
      ["https://nvd.nist.gov/vuln/detail/CVE-2024-29415", "2026-11-15"],
    ]);
    const parsed = parseIpMeasurement(printIpMeasurement(measurement));
    expect(parsed).toEqual({ ok: true, value: measurement });
  });

  it("returns the exports and prints them in the table", async () => {
    const entries: ExportEntry[] = [{ name: "isPublic", type: "function", arity: 1 }];
    const result = await run(fakeExecutor(() => returned(false), entries));
    expect(result.exports).toEqual(entries);
    const table = formatMeasurementTable(result).join("\n");
    expect(table).toContain("isPublic");
    expect(table).toContain("arity 1");
    expect(table).toContain('"::fFFf:127.0.0.1"');
  });

  it("fails when the side cannot be opened and never writes a guess", async () => {
    const executor: Executor = {
      mechanism: "in-process",
      probe: async () => ({ ok: true, value: undefined }),
      open: async () => ({ ok: false, error: { kind: "unloadable-module", message: "no" } }),
      dispose: async () => undefined,
    };
    await expect(
      measureIp({ executor, spec: SPEC, clock, integrity: INTEGRITY, node: "v26.0.0", redact: (t) => t }),
    ).rejects.toThrow(/open failed/);
  });
});

describe("nodeToJson", () => {
  it("keeps JSON values and marks the others", () => {
    expect(nodeToJson(enc(true))).toBe(true);
    expect(nodeToJson(enc([1, "a", null]))).toEqual([1, "a", null]);
    expect(nodeToJson(enc({ a: 1 }))).toEqual({ a: 1 });
    expect(nodeToJson(enc(undefined))).toEqual({ notJson: "undefined" });
    expect(nodeToJson(enc(NaN))).toEqual({ notJson: "num" });
  });
});
