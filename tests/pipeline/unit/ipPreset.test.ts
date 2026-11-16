// Requirements: 5.6, 5.8, 5.12
// The ip-address preset: one generator per export, every generated and explicit value encodes with
// the Value_Codec, and the setup module returns fresh, identical interface objects on every call.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { encodeValue } from "../../../src/proof/child/codec/encode";
import type { EncodedNode } from "../../../src/proof/child/codec/nodes";
import { DEFAULT_ENCODE_BUDGET } from "../../../src/proof/shell/driver";
import {
  ADVISORY_AND_INFORMATIONAL,
  IP_ADDRESS_PRESET,
  IP_EXPORTS,
  IP_SETUP_MODULE_PATH,
  addressArgs,
  cidrString,
  familyArg,
  ipMaskPair,
  ipPair,
  ipString,
  longInt,
  prefixLen,
  toBufferArgs,
  toStringArgs,
} from "../../../src/pipeline/harness/core/presets/ipAddress";
import { PRESET_NAMES, findPreset } from "../../../src/pipeline/harness/core/presets";
import { ADVISORY_ADDRESSES, INFORMATIONAL_ADDRESSES } from "../../../src/pipeline/harness/core/ipMeasurement";

function hasUnencodable(node: EncodedNode): boolean {
  return JSON.stringify(node).includes('"t":"unencodable"');
}

function expectEncodes(args: readonly unknown[]): void {
  for (const arg of args) {
    const r = encodeValue(arg, { budget: DEFAULT_ENCODE_BUDGET });
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasUnencodable(r.node)).toBe(false);
  }
}

const GENERATORS: Readonly<Record<string, fc.Arbitrary<readonly unknown[]>>> = {
  ipString: ipString.map((s) => [s]),
  ipPair,
  ipMaskPair,
  cidrString,
  prefixLen,
  longInt,
  toBufferArgs,
  toStringArgs,
  familyArg,
  addressArgs,
};

describe("ip-address preset", () => {
  it("is registered and covers the 20 exports of ip@2.0.1", () => {
    expect(PRESET_NAMES).toContain("ip-address");
    expect(findPreset("ip-address")).toBe(IP_ADDRESS_PRESET);
    expect(IP_ADDRESS_PRESET.package).toBe("ip");
    expect(IP_ADDRESS_PRESET.functions).toHaveLength(20);
    expect(new Set(IP_ADDRESS_PRESET.functions).size).toBe(20);
    expect([...IP_EXPORTS]).toEqual([...IP_EXPORTS].sort());
  });

  it("accepts no option", () => {
    expect(IP_ADDRESS_PRESET.optionsSchema.safeParse({}).success).toBe(true);
    expect(IP_ADDRESS_PRESET.optionsSchema.safeParse({ depth: 1 }).success).toBe(false);
  });

  it("builds a harness with generator and explicit cases for each export", () => {
    for (const name of IP_EXPORTS) {
      const h = IP_ADDRESS_PRESET.build({}, name);
      expect(h.args).toBeDefined();
      expect(h.explicitCases?.length ?? 0).toBeGreaterThan(0);
      expect(h.caseCount).toBe(100);
    }
  });

  it("refuses to build without a known function name", () => {
    expect(() => IP_ADDRESS_PRESET.build({})).toThrow(/no generator/);
    expect(() => IP_ADDRESS_PRESET.build({}, "nope")).toThrow(/"nope"/);
  });

  it("lists the Advisory_Addresses and the informational inputs as explicit ipString cases", () => {
    for (const a of [...ADVISORY_ADDRESSES, ...INFORMATIONAL_ADDRESSES]) {
      expect(ADVISORY_AND_INFORMATIONAL).toContain(a);
      expect(IP_ADDRESS_PRESET.build({}, "isPublic").explicitCases).toContainEqual([a]);
    }
  });

  it.each(Object.keys(GENERATORS))("generator %s produces values the codec encodes", (name) => {
    const arb = GENERATORS[name];
    if (arb === undefined) throw new Error("missing generator");
    for (const args of fc.sample(arb, { numRuns: 200, seed: 20261116 })) expectEncodes(args);
  });

  it("every explicit case of every export encodes", () => {
    for (const name of IP_EXPORTS) {
      for (const args of IP_ADDRESS_PRESET.build({}, name).explicitCases ?? []) expectEncodes(args);
    }
  });

  it("every export's generated values encode", () => {
    for (const name of IP_EXPORTS) {
      const h = IP_ADDRESS_PRESET.build({}, name);
      for (const args of fc.sample(h.args, { numRuns: 50, seed: 7 })) expectEncodes(args);
    }
  });

  it("keeps Buffers at 64 bytes or fewer and shapes to the documented argument lists", () => {
    for (const args of fc.sample(toStringArgs, { numRuns: 200, seed: 3 })) {
      const buf = args[0];
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect((buf as Buffer).length).toBeLessThanOrEqual(64);
      expect(args.length).toBeLessThanOrEqual(3);
    }
    for (const args of fc.sample(toBufferArgs, { numRuns: 200, seed: 4 })) {
      expect(typeof args[0]).toBe("string");
      if (Buffer.isBuffer(args[1])) expect(args[1].length).toBeLessThanOrEqual(64);
    }
  });
});

describe("ipSetup.cjs", () => {
  it("lives next to the other sandbox modules and contains no network call", () => {
    expect(existsSync(IP_SETUP_MODULE_PATH)).toBe(true);
    expect(IP_SETUP_MODULE_PATH.replace(/\\/g, "/")).toMatch(/src\/pipeline\/harness\/sandbox\/ipSetup\.cjs$/);
    const text = readFileSync(IP_SETUP_MODULE_PATH, "utf8");
    expect(text).not.toMatch(/Math\.random|Date\.now|process\.env/);
  });

  it("replaces os.networkInterfaces with fresh, identical objects per call", () => {
    const original = os.networkInterfaces;
    try {
      createRequire(import.meta.url)(IP_SETUP_MODULE_PATH);
      const first = os.networkInterfaces();
      const second = os.networkInterfaces();
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(second["eth0"]).not.toBe(first["eth0"]);
      expect(Object.keys(first)).toEqual(["eth0", "wlan0", "lo", "empty0"]);
      // ip.address() writes details.family into these objects; a write must not leak to the next call.
      const entry = first["eth0"]?.[0];
      if (entry === undefined) throw new Error("eth0 has no entry");
      (entry as { family: unknown }).family = "ipv4";
      expect(os.networkInterfaces()["eth0"]?.[0]?.family).toBe("IPv4");
    } finally {
      os.networkInterfaces = original;
    }
  });
});
