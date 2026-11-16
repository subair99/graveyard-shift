// Preset `ip-address` (design "ip coverage"): one generator for each of the 20 function exports of
// ip@2.0.1, read from the recorded tarball (Journal, 2026-11-16). No option is accepted.
//
// Every arbitrary is built by construction: no `.filter`, rejection chain or retry loop
// (R8.14 of the proof-of-life-engine spec). No generator yields a function value (A7). Strings
// stay short (at most about 40 characters) and Buffers at most 64 bytes, inside the codec budget.
//
// `ipSetup.cjs` replaces `os.networkInterfaces()` on both sides (R5.8). The compiler must set it
// as `HarnessConfig.setupModule` for this preset (`IP_SETUP_MODULE_PATH`).

import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { z } from "zod";
import type { FunctionHarness } from "../../../../proof/types";
import { nonPublicAddressPredicate } from "./ipNonPublicAddress";
import type { Preset, PresetOptions } from "./types";

/** Absolute path of the sandbox-side setup module. */
export const IP_SETUP_MODULE_PATH: string = fileURLToPath(new URL("../../sandbox/ipSetup.cjs", import.meta.url));

/** The 20 function exports of ip@2.0.1, sorted. */
export const IP_EXPORTS = [
  "address",
  "cidr",
  "cidrSubnet",
  "fromLong",
  "fromPrefixLen",
  "isEqual",
  "isLoopback",
  "isPrivate",
  "isPublic",
  "isV4Format",
  "isV6Format",
  "loopback",
  "mask",
  "normalizeToLong",
  "not",
  "or",
  "subnet",
  "toBuffer",
  "toLong",
  "toString",
] as const;

export type IpExport = (typeof IP_EXPORTS)[number];

// ---------------------------------------------------------------------------
// ipString
// ---------------------------------------------------------------------------

/** The five Advisory_Addresses, then the two informational inputs, then a few reference forms. */
export const ADVISORY_AND_INFORMATIONAL: readonly string[] = [
  "127.1",
  "01200034567",
  "012.1.2.3",
  "000:0:0000::01",
  "::fFFf:127.0.0.1",
  "0",
  "017700000001",
];

const FIXED_ADDRESSES: readonly string[] = [
  ...ADVISORY_AND_INFORMATIONAL,
  "192.168.1.10",
  "10.1",
  "0177.0.0.1",
  "010.0.0.1",
  "0x7f.0.0.1",
  "0x7f000001",
  "2130706433",
  "::",
  "::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "8.8.8.8",
  "172.16.0.1",
  "169.254.1.1",
  "fd00::1",
];

const MALFORMED: readonly string[] = [
  "",
  " ",
  "abc",
  "1.2.3",
  "1.2.3.4.5",
  "256.1.1.1",
  "1.2.3.",
  ".1.2.3",
  "0x",
  "-1",
  "1e3",
  "::g",
  ":::",
  "1:2:3:4:5:6:7:8:9",
  "09.1.1.1",
];

const octet = fc.integer({ min: 0, max: 255 });
const dotted = fc.tuple(octet, octet, octet, octet).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
/** Fewer than four parts: `127.1`, `10.1.2`, `5`. */
const shortForm = fc
  .array(octet, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("."));
const octalInt = fc.integer({ min: 0, max: 0o37777777777 }).map((n) => `0${n.toString(8)}`);
const octalDotted = fc
  .tuple(fc.integer({ min: 0, max: 0o377 }), octet, octet, octet)
  .map(([a, b, c, d]) => `0${a.toString(8)}.${b}.${c}.${d}`);
const hexDotted = fc
  .tuple(octet, octet, octet, octet)
  .map(([a, b, c, d]) => `0x${a.toString(16)}.${b}.${c}.0x${d.toString(16)}`);
const hexInt = fc.integer({ min: 0, max: 0xffffffff }).map((n) => `0x${n.toString(16)}`);
const decimalInt = fc.integer({ min: 0, max: 0xffffffff }).map(String);

const hexGroup = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 0xffff }))
  .map(([width, n]) => n.toString(16).padStart(width, "0").slice(-width));
const groups = (max: number) => fc.array(hexGroup, { minLength: 0, maxLength: max });
const v6Full = fc.array(hexGroup, { minLength: 1, maxLength: 8 }).map((g) => g.join(":"));
const v6Compressed = fc
  .tuple(groups(3), groups(3))
  .map(([head, tail]) => `${head.join(":")}::${tail.join(":")}`);
const v4Mapped = fc
  .tuple(fc.constantFrom("::ffff:", "::fFFf:", "::FFFF:", "0:0:0:0:0:ffff:"), dotted)
  .map(([prefix, v4]) => `${prefix}${v4}`);

/** One address-shaped string: the forms of spikes/candidates/IP-SKETCH.md plus malformed values. */
export const ipString: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...FIXED_ADDRESSES),
  dotted,
  shortForm,
  octalInt,
  octalDotted,
  hexDotted,
  hexInt,
  decimalInt,
  v6Full,
  v6Compressed,
  v4Mapped,
  fc.constantFrom(...MALFORMED),
);

/** Two addresses, IPv4 and IPv6 mixed; one in four is the same address twice. */
export const ipPair: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  fc.tuple(ipString, ipString),
  ipString.map((a) => [a, a]),
);

// ---------------------------------------------------------------------------
// ipMaskPair, cidrString
// ---------------------------------------------------------------------------

function v4MaskOf(prefix: number): string {
  const parts: number[] = [];
  let left = prefix;
  for (let i = 0; i < 4; i++) {
    const bits = Math.max(0, Math.min(8, left));
    left -= bits;
    parts.push((0xff << (8 - bits)) & 0xff);
  }
  return parts.join(".");
}

function v6MaskOf(prefix: number): string {
  const words: string[] = [];
  let left = prefix;
  for (let i = 0; i < 8; i++) {
    const bits = Math.max(0, Math.min(16, left));
    left -= bits;
    words.push(((0xffff << (16 - bits)) & 0xffff).toString(16));
  }
  return words.join(":");
}

const maskString: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 32 }).map(v4MaskOf), weight: 4 },
  { arbitrary: fc.integer({ min: 0, max: 128 }).map(v6MaskOf), weight: 2 },
  { arbitrary: ipString, weight: 1 },
);

/** `(addr, mask)` for `mask` and `subnet`: masks built from prefix lengths, plus non-mask strings. */
export const ipMaskPair: fc.Arbitrary<readonly unknown[]> = fc.tuple(ipString, maskString);

const cidrPrefix: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 32 }).map(String), weight: 6 },
  { arbitrary: fc.integer({ min: 33, max: 129 }).map(String), weight: 1 },
  { arbitrary: fc.constantFrom("-1", "", "x", "8x", "08", "1.5"), weight: 1 },
);

/** One `a.b.c.d/n` string, plus out-of-range prefixes and malformed values (no or several `/`). */
export const cidrString: fc.Arbitrary<readonly unknown[]> = fc
  .oneof(
    { arbitrary: fc.tuple(dotted, cidrPrefix).map(([a, p]) => `${a}/${p}`), weight: 6 },
    { arbitrary: fc.tuple(ipString, cidrPrefix).map(([a, p]) => `${a}/${p}`), weight: 3 },
    { arbitrary: ipString, weight: 1 },
    { arbitrary: fc.tuple(dotted, cidrPrefix, cidrPrefix).map(([a, p, q]) => `${a}/${p}/${q}`), weight: 1 },
  )
  .map((text) => [text]);

// ---------------------------------------------------------------------------
// familyArg, prefixLen, longInt
// ---------------------------------------------------------------------------

const familyValue: fc.Arbitrary<unknown> = fc.constantFrom<unknown[]>(
  4,
  6,
  "ipv4",
  "ipv6",
  "IPv4",
  "IPv6",
  "IPV4",
  "",
  "foo",
  0,
  5,
  true,
  null,
);

/** `(family?)` for `loopback`: absent, 4, 6, `ipv4`, `ipv6`, case variants, other values. */
export const familyArg: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  fc.constant<readonly unknown[]>([]),
  familyValue.map((f) => [f]),
);

const interfaceName: fc.Arbitrary<unknown> = fc.constantFrom<unknown[]>(
  undefined,
  "public",
  "private",
  "eth0",
  "wlan0",
  "lo",
  "empty0",
  "docker0",
  "ETH0",
  "",
);

/** `(name?, family?)` for `address`: names present and absent in the stub of ipSetup.cjs. */
export const addressArgs: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  fc.constant<readonly unknown[]>([]),
  interfaceName.map((n) => [n]),
  fc.tuple(interfaceName, familyValue),
);

const prefixValue: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 32 }), weight: 5 },
  { arbitrary: fc.integer({ min: 33, max: 128 }), weight: 3 },
  { arbitrary: fc.constantFrom(-1, 129, 1.5, Number.NaN), weight: 1 },
);

/** `(prefixlen, family?)` for `fromPrefixLen`: a prefix above 32 forces ipv6 inside the function. */
export const prefixLen: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  prefixValue.map((p) => [p]),
  fc.tuple(prefixValue, familyValue),
);

/** `(n)` for `fromLong`: 0 to 2^32, plus out-of-range, negative, fractional and numeric strings. */
export const longInt: fc.Arbitrary<readonly unknown[]> = fc
  .oneof(
    { arbitrary: fc.integer({ min: 0, max: 0xffffffff }), weight: 6 },
    { arbitrary: fc.integer({ min: -0x200000000, max: 0x200000000 }), weight: 2 },
    {
      arbitrary: fc.constantFrom<unknown[]>(0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 0x100000000, -1, 1.5, "2130706433", ""),
      weight: 2,
    },
  )
  .map((n) => [n]);

// ---------------------------------------------------------------------------
// bufferArgs
// ---------------------------------------------------------------------------

/** A Buffer of 0 to 64 bytes; lengths 4 and 16 are over-represented. */
const smallBuffer: fc.Arbitrary<Buffer> = fc
  .oneof(
    { arbitrary: fc.uint8Array({ minLength: 0, maxLength: 64 }), weight: 3 },
    { arbitrary: fc.uint8Array({ minLength: 4, maxLength: 4 }), weight: 2 },
    { arbitrary: fc.uint8Array({ minLength: 16, maxLength: 16 }), weight: 2 },
  )
  .map((bytes) => Buffer.from(bytes));

const bufferOffset: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.constantFrom<unknown[]>(undefined, 0, 1, 3, 4, 12, 15, 16, 17, 63, 64, 65, -1, -2, 1.5), weight: 3 },
  { arbitrary: fc.integer({ min: 0, max: 70 }), weight: 2 },
);

/** `(ip, buff?, offset?)` for `toBuffer`: absent or present Buffer, offsets around its bounds. */
export const toBufferArgs: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  ipString.map((a) => [a]),
  fc.tuple(ipString, fc.constant(undefined), bufferOffset),
  fc.tuple(ipString, smallBuffer),
  fc.tuple(ipString, smallBuffer, bufferOffset),
);

const readLength: fc.Arbitrary<unknown> = fc.constantFrom<unknown[]>(undefined, 0, 3, 4, 5, 8, 15, 16, 17, 32);

/** `(buff, offset?, length?)` for `toString`: lengths 0, 4, 16 and others, offsets around the bounds. */
export const toStringArgs: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  smallBuffer.map((b) => [b]),
  fc.tuple(smallBuffer, bufferOffset),
  fc.tuple(smallBuffer, bufferOffset, readLength),
);

// ---------------------------------------------------------------------------
// One generator per export
// ---------------------------------------------------------------------------

const single = ipString.map((a) => [a] as readonly unknown[]);
const singleCases: readonly (readonly unknown[])[] = FIXED_ADDRESSES.map((a) => [a]);

// isPublic only (task 12.9, decision A of 2026-11-17): malformed IPv6 text and non-canonical IPv4 forms,
// inside and outside the non-public-address class. They are preset cases, not delta cases; the delta
// cases stay the five Advisory_Addresses.
const IS_PUBLIC_EXTRA_INPUTS: readonly string[] = [
  // malformed IPv6: empty groups, extra colons, runs of colons
  ":::",
  "::",
  "::::",
  ":",
  "::0",
  "0::",
  ":::1",
  // non-canonical IPv4 inside the class (short, hex, octal, long forms)
  "0x7f.1",
  "0xa.0.0.1",
  "192.168.1",
  "172.16.0.0x1",
  "0300.0250.0.1",
  "0xc0a80001",
  "0251.0376.1.1",
  // the same forms outside the class
  "172.32.0.0x1",
  "0xb.0.0.1",
  "11.1",
  "0x08080808",
  "0300.0251.0.1",
  "4294967295",
];
const isPublicCases: readonly (readonly unknown[])[] = [
  ...singleCases,
  ...IS_PUBLIC_EXTRA_INPUTS.filter((a) => !FIXED_ADDRESSES.includes(a)).map((a) => [a]),
];

/** Malformed IPv6 text by construction: empty groups, extra colons, ':::' runs, stray edge colons. */
const emptyGroupV6: fc.Arbitrary<string> = fc
  .array(fc.oneof({ arbitrary: hexGroup, weight: 2 }, { arbitrary: fc.constant(""), weight: 1 }), {
    minLength: 1,
    maxLength: 9,
  })
  .map((parts) => parts.join(":"));
const colonRunV6: fc.Arbitrary<string> = fc
  .tuple(groups(3), fc.constantFrom(":", "::", ":::", "::::", ":::::"), groups(3))
  .map(([head, run, tail]) => `${head.join(":")}${run}${tail.join(":")}`);
const edgeColonV6: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom("", ":", "::", ":::"), v6Full, fc.constantFrom("", ":", "::", ":::"))
  .map(([lead, body, trail]) => `${lead}${body}${trail}`);
const twoGapsV6: fc.Arbitrary<string> = fc
  .tuple(groups(2), groups(2), groups(2))
  .map(([a, b, c]) => `${a.join(":")}::${b.join(":")}::${c.join(":")}`);

/** More malformed IPv6 text for isPublic. Exported for the ip-alive equivalence test. */
export const malformedV6String: fc.Arbitrary<string> = fc.oneof(emptyGroupV6, colonRunV6, edgeColonV6, twoGapsV6);

const isPublicArgs: fc.Arbitrary<readonly unknown[]> = fc.oneof(
  { arbitrary: single, weight: 3 },
  { arbitrary: malformedV6String.map((a) => [a] as readonly unknown[]), weight: 2 },
);

interface Entry {
  args: fc.Arbitrary<readonly unknown[]>;
  explicitCases: readonly (readonly unknown[])[];
}

const ENTRIES: Readonly<Record<IpExport, Entry>> = {
  address: {
    args: addressArgs,
    explicitCases: [[], ["public"], ["private"], ["eth0"], ["eth0", "ipv6"], ["wlan0", 4], ["lo", "IPv6"], ["empty0"]],
  },
  cidr: { args: cidrString, explicitCases: [["192.168.1.130/25"], ["10.0.0.1/8"], ["127.1/8"], ["1.2.3.4"]] },
  cidrSubnet: { args: cidrString, explicitCases: [["192.168.1.134/26"], ["10.0.0.1/32"], ["10.0.0.1/31"], ["1.2.3.4"]] },
  fromLong: { args: longInt, explicitCases: [[0], [2130706433], [0xffffffff], [-1]] },
  fromPrefixLen: { args: prefixLen, explicitCases: [[24], [0], [32], [33], [64, "ipv6"], [24, "ipv4"], [8, 6]] },
  isEqual: {
    args: ipPair,
    explicitCases: [
      ["127.0.0.1", "::ffff:127.0.0.1"],
      ["127.0.0.1", "127.0.0.1"],
      ["::1", "::1"],
      ["127.1", "127.0.0.1"],
    ],
  },
  isLoopback: { args: single, explicitCases: singleCases },
  isPrivate: { args: single, explicitCases: singleCases },
  isPublic: { args: isPublicArgs, explicitCases: isPublicCases },
  isV4Format: { args: single, explicitCases: singleCases },
  isV6Format: { args: single, explicitCases: singleCases },
  loopback: { args: familyArg, explicitCases: [[], [4], [6], ["ipv4"], ["IPv6"], ["foo"]] },
  mask: {
    args: ipMaskPair,
    explicitCases: [
      ["192.168.1.134", "255.255.255.192"],
      ["192.168.1.134", "::ffff:ff00"],
      ["::1", "255.0.0.0"],
    ],
  },
  normalizeToLong: { args: single, explicitCases: singleCases },
  not: { args: single, explicitCases: singleCases },
  or: {
    args: ipPair,
    explicitCases: [
      ["1.2.3.4", "0.0.0.255"],
      ["::1", "0.0.0.255"],
      ["0.0.0.255", "::1"],
    ],
  },
  subnet: {
    args: ipMaskPair,
    explicitCases: [
      ["192.168.1.134", "255.255.255.192"],
      ["10.0.0.1", "255.255.255.254"],
      ["10.0.0.1", "255.255.255.255"],
    ],
  },
  toBuffer: {
    args: toBufferArgs,
    explicitCases: [
      ...singleCases,
      ["127.0.0.1", Buffer.alloc(6), 1],
      ["::1", Buffer.alloc(20), 2],
      ["1.2.3.4", undefined, 2],
    ],
  },
  toLong: { args: single, explicitCases: singleCases },
  toString: {
    args: toStringArgs,
    explicitCases: [
      [Buffer.from([127, 0, 0, 1])],
      [Buffer.alloc(16)],
      [Buffer.from([0, 0, 127, 0, 0, 1]), 2],
      [Buffer.alloc(6), 0, 3],
      [Buffer.alloc(2), 0, 4],
    ],
  },
};

export interface IpAddressPreset extends Preset {
  /** Absolute path of `ipSetup.cjs`; the compiler sets it as `HarnessConfig.setupModule`. */
  readonly setupModule: string;
  /** `fn` is the export the entry is for. Every ip export needs its own generator. */
  build(options: PresetOptions, fn?: string): FunctionHarness;
}

export const IP_ADDRESS_PRESET: IpAddressPreset = {
  name: "ip-address",
  package: "ip",
  functions: IP_EXPORTS,
  deltaFunctions: ["isPublic"],
  inputClasses: { "non-public-address": nonPublicAddressPredicate },
  optionsSchema: z.strictObject({}),
  setupModule: IP_SETUP_MODULE_PATH,
  build: (_options, fn) => {
    if (fn === undefined || !Object.hasOwn(ENTRIES, fn)) {
      throw new Error(`ip-address preset: no generator for ${fn === undefined ? "an unnamed function" : `"${fn}"`}`);
    }
    const entry = ENTRIES[fn as IpExport];
    return { args: entry.args, explicitCases: entry.explicitCases, caseCount: 100 };
  },
};
