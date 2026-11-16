// Requirements: 5.6, 5.8, 5.12
// The ip-address preset against the recorded ip@2.0.1 tarball, through the real Sandbox_Executor:
// the preset's covered exports equal the export list read from the tarball (R5.12), every explicit
// case and a sample of generated cases run to a returned or thrown outcome with the setup module
// (R5.8), `toBuffer` runs with `this` equal to the module, and `address` sees fresh interfaces.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { decodeNode } from "../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import { resolveEntry } from "../../../src/proof/shell/entry";
import { createSandboxExecutorFactory } from "../../../src/proof/shell/executor/sandboxExecutor";
import { createRestartBudget } from "../../../src/proof/shell/executor/types";
import type { Executor, SideHandle } from "../../../src/proof/shell/executor/types";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { verifyIntegrity } from "../../../src/proof/shell/integrity";
import { IP_ADDRESS_PRESET, IP_EXPORTS } from "../../../src/pipeline/harness/core/presets/ipAddress";

const FIXTURES = join(__dirname, "..", "..", "proof", "fixtures", "ip");

let root = "";
let executor: Executor;
let handle: SideHandle;
let listed: string[] = [];

async function call(fn: string, args: readonly unknown[]) {
  const nodes = args.map((a) => {
    const r = encodeValue(a, { budget: 1_048_576 });
    if (!r.ok) throw new Error("argument too large");
    return r.node;
  });
  const r = await handle.call({ fn, args: nodes, caseSeed: 1, stubs: { date: true, random: true }, properties: [] });
  if (!r.ok) throw new Error(`call failed: ${r.error.kind}: ${r.error.message}`);
  return r.value.outcome;
}

async function returned(fn: string, args: readonly unknown[]): Promise<unknown> {
  const o = await call(fn, args);
  if (o.kind !== "returned") throw new Error(`${fn}: unexpected outcome ${o.kind}`);
  return decodeNode(o.value);
}

beforeAll(async () => {
  const bytes = readFileSync(join(FIXTURES, "ip-2.0.1.tgz"));
  const meta = JSON.parse(readFileSync(join(FIXTURES, "ip-2.0.1.meta.json"), "utf8")) as { integrity: string };
  const verified = verifyIntegrity(bytes, meta.integrity);
  if (!verified.ok) throw new Error("the recorded ip tarball does not match its integrity");

  root = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-ipx-")));
  const packageDir = join(root, "package");
  mkdirSync(packageDir);
  const extracted = await extractTarball(bytes, packageDir);
  if (!extracted.ok) throw new Error(`extract failed: ${extracted.error.kind}`);
  const realDir = realpathSync.native(packageDir);
  const entry = resolveEntry(realDir);
  if (!entry.ok) throw new Error(entry.error.message);

  executor = createSandboxExecutorFactory().create({ restartBudget: createRestartBudget(10) });
  const opened = await executor.open({
    side: "original",
    packageDir: realDir,
    entryFile: entry.value.entryFile,
    setupModule: IP_ADDRESS_PRESET.setupModule,
    readPaths: [],
    limits: { callTimeoutMs: 5000, heapLimitMb: 256, outputLimitBytes: 1_048_576 },
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}: ${opened.error.message}`);
  handle = opened.value;
  const exp = await handle.listExports();
  if (!exp.ok) throw new Error(`listExports failed: ${exp.error.message}`);
  listed = exp.value.entries.filter((e) => e.type === "function").map((e) => e.name);
}, 60_000);

afterAll(async () => {
  try {
    await executor?.dispose();
  } finally {
    if (root !== "") rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe("ip-address preset against the recorded ip@2.0.1 tarball", () => {
  it("covers exactly the function exports of the tarball (R5.12)", () => {
    expect(listed).toHaveLength(20);
    expect([...IP_ADDRESS_PRESET.functions].sort()).toEqual([...listed].sort());
    expect([...IP_EXPORTS].sort()).toEqual([...listed].sort());
  });

  it("calls toBuffer with this equal to the module (isV4Format and toBuffer resolve through this)", async () => {
    const buf = (await returned("toBuffer", ["127.0.0.1"])) as Uint8Array;
    expect([...buf]).toEqual([127, 0, 0, 1]);
    const v6 = (await returned("toBuffer", ["::1"])) as Uint8Array;
    expect(v6).toHaveLength(16);
    expect(v6[15]).toBe(1);
    const mapped = (await returned("toBuffer", ["::ffff:127.0.0.1"])) as Uint8Array;
    expect([...mapped.subarray(10)]).toEqual([0xff, 0xff, 127, 0, 0, 1]);
  });

  it("writes into a Buffer argument in place and reports it in the post-state", async () => {
    const o = await call("toBuffer", ["1.2.3.4", Buffer.alloc(6), 1]);
    expect(o.kind).toBe("returned");
    if (o.kind !== "returned") return;
    const after = decodeNode(o.args[1] as never) as Uint8Array;
    expect([...after]).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it("address sees the stub interfaces, fresh on every call (R5.8)", async () => {
    expect(await returned("address", ["eth0"])).toBe("192.168.1.10");
    expect(await returned("address", ["eth0", "ipv6"])).toBe("fe80::1c2d:3e4f:5a6b:7c8d");
    const o = await call("address", ["private"]);
    expect(o.kind).toBe("returned");
    const first = await returned("address", []);
    const second = await returned("address", []);
    expect(second).toEqual(first);
    // The unknown interface throws a TypeError, as the Original does.
    expect((await call("address", ["docker0"])).kind).toBe("threw");
  });

  it("runs every explicit case and sampled generated cases to a returned or thrown outcome", async () => {
    for (const name of IP_EXPORTS) {
      const h = IP_ADDRESS_PRESET.build({}, name);
      const sampled = fc.sample(h.args, { numRuns: 5, seed: 20261116 });
      for (const args of [...(h.explicitCases ?? []), ...sampled]) {
        const o = await call(name, args);
        expect(["returned", "threw"], `${name}(${JSON.stringify(args)}) gave ${o.kind}`).toContain(o.kind);
      }
    }
  }, 120_000);
});
