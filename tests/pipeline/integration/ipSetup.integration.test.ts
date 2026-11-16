// Requirements: 5.8
// The ip setup module replaces os.networkInterfaces() identically on both sides: the same setup
// module applied to an Original side and to a second (Resurrection) side, both real
// Sandbox_Executor children over the recorded ip@2.0.1 tarball, gives the same address() results.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeNode } from "../../../src/proof/child/codec/decode";
import { encodeValue } from "../../../src/proof/child/codec/encode";
import { resolveEntry } from "../../../src/proof/shell/entry";
import { createSandboxExecutorFactory } from "../../../src/proof/shell/executor/sandboxExecutor";
import { createRestartBudget } from "../../../src/proof/shell/executor/types";
import type { Executor, Side, SideHandle } from "../../../src/proof/shell/executor/types";
import { extractTarball } from "../../../src/proof/shell/tarball/tarballExtractor";
import { verifyIntegrity } from "../../../src/proof/shell/integrity";
import { IP_ADDRESS_PRESET } from "../../../src/pipeline/harness/core/presets/ipAddress";

const FIXTURES = join(__dirname, "..", "..", "proof", "fixtures", "ip");

let root = "";
let executor: Executor;
let original: SideHandle;
let second: SideHandle;

async function openSide(side: Side, packageDir: string, entryFile: string): Promise<SideHandle> {
  const opened = await executor.open({
    side,
    packageDir,
    entryFile,
    setupModule: IP_ADDRESS_PRESET.setupModule,
    readPaths: [],
    limits: { callTimeoutMs: 5000, heapLimitMb: 256, outputLimitBytes: 1_048_576 },
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}: ${opened.error.message}`);
  return opened.value;
}

async function address(handle: SideHandle, args: readonly unknown[]): Promise<unknown> {
  const nodes = args.map((a) => {
    const r = encodeValue(a, { budget: 1_048_576 });
    if (!r.ok) throw new Error("argument too large");
    return r.node;
  });
  const r = await handle.call({ fn: "address", args: nodes, caseSeed: 1, stubs: { date: true, random: true }, properties: [] });
  if (!r.ok) throw new Error(`call failed: ${r.error.kind}: ${r.error.message}`);
  if (r.value.outcome.kind !== "returned") throw new Error(`unexpected outcome ${r.value.outcome.kind}`);
  return decodeNode(r.value.outcome.value);
}

beforeAll(async () => {
  const bytes = readFileSync(join(FIXTURES, "ip-2.0.1.tgz"));
  const meta = JSON.parse(readFileSync(join(FIXTURES, "ip-2.0.1.meta.json"), "utf8")) as { integrity: string };
  if (!verifyIntegrity(bytes, meta.integrity).ok) throw new Error("the recorded ip tarball does not match its integrity");

  root = realpathSync.native(mkdtempSync(join(tmpdir(), "gs-ips-")));
  const dirs: string[] = [];
  for (const name of ["original", "second"]) {
    const dir = join(root, name);
    mkdirSync(dir);
    const extracted = await extractTarball(bytes, dir);
    if (!extracted.ok) throw new Error(`extract failed: ${extracted.error.kind}`);
    dirs.push(realpathSync.native(dir));
  }
  const entries = dirs.map((d) => {
    const e = resolveEntry(d);
    if (!e.ok) throw new Error(e.error.message);
    return e.value.entryFile;
  });

  executor = createSandboxExecutorFactory().create({ restartBudget: createRestartBudget(10) });
  original = await openSide("original", dirs[0]!, entries[0]!);
  second = await openSide("resurrection", dirs[1]!, entries[1]!);
}, 60_000);

afterAll(async () => {
  try {
    await executor?.dispose();
  } finally {
    if (root !== "") rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe("ip setup module on both sides (R5.8)", () => {
  it("gives the same address() results on the Original and on a second side, from the stub interfaces", async () => {
    const argLists: unknown[][] = [["eth0"], ["eth0", "ipv6"], ["wlan0"], ["lo"], ["public"], ["private", "ipv6"]];
    for (const args of argLists) {
      const a = await address(original, args);
      const b = await address(second, args);
      expect(b, JSON.stringify(args)).toEqual(a);
    }
    // The values come from the stub, not from the machine's real interfaces.
    expect(await address(original, ["eth0"])).toBe("192.168.1.10");
    expect(await address(second, ["eth0"])).toBe("192.168.1.10");
  });
});
