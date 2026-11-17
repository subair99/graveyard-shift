// Input class `non-public-address` of the `ip-address` preset (task 12.11, R4.17 to R4.19; decision of
// 2026-11-16, journal entry "ip class non-public-address, redefined").
//
// `isNonPublicAddress(input)` is a reference classifier written by us (not by the Medium). It is pure:
// no I/O, no clock, no randomness; the range tables are built once from constants.
//
// DEFINITION
//   An input is in the class when the parser below can canonicalize it to an address and the canonical
//   address falls in a range that ip@2.0.1's own `isPrivate` treats as private or loopback. The class
//   is therefore the set of addresses that `ip.isPublic` (which is `!ip.isPrivate`) should answer
//   `false` for, when it is given the canonical form. Everything `isPrivate` does not cover is OUT of
//   the class, even when another registry would call it non-public (0.0.0.0/8, 100.64.0.0/10,
//   198.18.0.0/15, 192.0.0.0/24, 192.0.2.0/24, 240.0.0.0/4, ...).
//
// SOURCE OF THE RANGES (read from the file, not from memory)
//   The recorded tarball tests/proof/fixtures/ip/ip-2.0.1.tgz, member package/lib/ip.js (extracted to a
//   temporary directory and read on 2026-11-16). Line numbers below are the lines of that file.
//     lines 308-334  ip.isPrivate: calls ip.isLoopback first (310); for text that is not `isV6Format`
//                    it normalizes with normalizeToLong/fromLong (315-321); then eight regexes (325-333)
//     lines 336-338  ip.isPublic = !ip.isPrivate
//     lines 340-353  ip.isLoopback (the regexes at 346-352)
//   Supporting references for the ranges (they agree with the intent of the regexes; they are not
//   the source of the list): RFC 1918 (10/8, 172.16/12, 192.168/16), RFC 3927 (169.254/16), RFC 4291
//   (::1 loopback, :: unspecified, fe80::/10 link-local) and RFC 4193 (fc00::/7 unique local).
//
// CANONICAL RANGES (what the regexes intend for canonical dotted IPv4 / IPv6 text)
//   Caveat (from reading the code, not from a run): ip@2.0.1 applies its regexes to the string AS
//   GIVEN in two places. isLoopback (310) always sees the raw text, and `isV6Format` (regex at line 86)
//   also matches a plain dotted quad, so for such text the normalization at 315-321 is skipped and the
//   private regexes (325-333) see the raw text (`012.1.2.3`). Where normalization does run (`127.1`),
//   the private regexes have no 127 pattern, and isLoopback had already looked at the raw text. That is
//   the non-canonical-form flaw of the advisory. The ranges below are the ones the regexes select when
//   the text is canonical; they are what the class contains.
//   IPv4 (canonical dotted text a.b.c.d):
//     127.0.0.0/8       isLoopback 346 (`^(::f{4}:)?127\.d.d.d`; 348 `^0177\.` and 349 `^0x7f\.` are the
//                       same 127/8 written as octal or hex text)
//     10.0.0.0/8        isPrivate 325
//     192.168.0.0/16    isPrivate 326
//     172.16.0.0/12     isPrivate 327-328 (`172\.(1[6-9]|2\d|30|31)`: second octet 16 to 31)
//     169.254.0.0/16    isPrivate 329
//   IPv6 (canonical text):
//     ::1/128           isLoopback 351, isPrivate 332
//     ::/128            isLoopback 352, isPrivate 333
//     fc00::/7          isPrivate 330 (`^f[cd][0-9a-f]{2}:`: first group fc00 to fdff)
//     fe80::/16         isPrivate 331 (`^fe80:`: first group exactly fe80) and isLoopback 350 (`fe80::1`,
//                       inside it). ip does NOT cover the rest of fe80::/10 (fe81:: to febf::), so
//                       neither does the class, although RFC 4291 defines the link-local range as /10.
//   IPv4-mapped IPv6 (`::ffff:a.b.c.d` and `::ffff:7f00:1`): classified by the embedded IPv4 address
//     against the IPv4 list. The regexes at 325-329 and 346 carry the optional `(::f{4}:)?` prefix for
//     the dotted form; the hexadecimal tail (`::ffff:7f00:1`) is in the class by decision, because it
//     is the same address.
//   NOT in the class (isPrivate/isLoopback do not cover them): 0.0.0.0/8 including 0.0.0.0 (and the
//     inputs `0` and `0x0` that parse to it), 100.64.0.0/10, 198.18.0.0/15, 192.0.0.0/24, 192.0.2.0/24,
//     198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, ::ffff:0.0.0.0, IPv4-compatible
//     `::a.b.c.d` (other than `::1` and `::`), 2001:db8::/32, 64:ff9b::/96, everything else.
//
// WHAT IS PARSED (the forms the task names and the forms ip@2.0.1 accepts as address strings; anything
// else is unparseable and returns false, so a parse failure never widens the class)
//   IPv4, in the style of inet_aton, 1 to 4 parts separated by dots:
//     each part is decimal (`127`), octal with a leading zero (`012`, `0177`, `0`) or hexadecimal with
//     `0x` or `0X` and at least one digit (`0x7f`). Part values: every part but the last at most 255;
//     the last part fills the remaining bytes (`127.1` = 127.0.0.1, one part = a 32-bit long integer
//     such as `2130706433`, `0x7f000001`, `01200034567`, `017700000001`, `0`). A leading zero means
//     octal, so `010.0.0.1` is 8.0.0.1 and `09.1.1.1` is unparseable.
//   IPv6: 8 groups of 1 to 4 hex digits (any case, zero padded), at most one `::` standing for at
//     least one group, and an optional dotted-decimal IPv4 tail in the last 32 bits (`::ffff:1.2.3.4`;
//     the tail parts are decimal 0 to 255, no octal or hex). No zone id (`%eth0`), no brackets, no
//     prefix length, no whitespace.
//   Not parsed: non-strings, empty strings, surrounding whitespace, signs, exponents, CIDR notation.

import type { InputClassDoc, InputClassPredicate } from "./types";

const V4_BITS = 32;
const V6_BITS = 128;

// The ranges of the class, as [network, prefix length]; see CANONICAL RANGES above.
const V4_RANGES: readonly (readonly [string, number])[] = [
  ["127.0.0.0", 8], // ip.js 346 (348, 349 are text forms of the same range)
  ["10.0.0.0", 8], // ip.js 325, RFC 1918
  ["192.168.0.0", 16], // ip.js 326, RFC 1918
  ["172.16.0.0", 12], // ip.js 327-328, RFC 1918
  ["169.254.0.0", 16], // ip.js 329, RFC 3927
];

const V6_RANGES: readonly (readonly [string, number])[] = [
  ["::1", 128], // ip.js 332, 351, RFC 4291
  ["::", 128], // ip.js 333, 352, RFC 4291
  ["fc00::", 7], // ip.js 330, RFC 4193
  ["fe80::", 16], // ip.js 331, 350 (ip covers fe80::/16 only; RFC 4291 link-local is fe80::/10)
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const DEC = /^[1-9][0-9]*$/;
const OCT = /^0[0-7]*$/;
const HEX = /^0[xX][0-9a-fA-F]+$/;
const GROUP = /^[0-9a-fA-F]{1,4}$/;
const QUAD_PART = /^(?:0|[1-9][0-9]{0,2})$/;

function parseV4Part(part: string): bigint | null {
  if (part.length > 12) return null;
  if (HEX.test(part)) return BigInt(part);
  if (OCT.test(part)) return BigInt(`0o${part}`);
  if (DEC.test(part)) return BigInt(part);
  return null;
}

/** inet_aton style: 1 to 4 parts, the last one fills the remaining bytes. */
function parseV4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  let value = 0n;
  for (let i = 0; i < parts.length; i++) {
    const n = parseV4Part(parts[i] ?? "");
    if (n === null) return null;
    if (i < parts.length - 1) {
      if (n > 255n) return null;
      value = (value << 8n) | n;
    } else {
      const bytesLeft = 4 - i;
      if (n >= 1n << BigInt(8 * bytesLeft)) return null;
      value = (value << BigInt(8 * bytesLeft)) | n;
    }
  }
  return value;
}

/** Strict dotted decimal, exactly four parts 0 to 255 (the IPv6 tail and the table rows). */
function parseDottedQuad(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!QUAD_PART.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseGroups(text: string): bigint[] | null {
  if (text === "") return [];
  const groups: bigint[] = [];
  for (const g of text.split(":")) {
    if (!GROUP.test(g)) return null;
    groups.push(BigInt(`0x${g}`));
  }
  return groups;
}

function parseV6(input: string): bigint | null {
  let text = input;
  const lastColon = text.lastIndexOf(":");
  if (lastColon < 0) return null;
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const quad = parseDottedQuad(tail);
    if (quad === null) return null;
    const hi = (quad >> 16n).toString(16);
    const lo = (quad & 0xffffn).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  let groups: bigint[];
  if (halves.length === 2) {
    const left = parseGroups(halves[0] ?? "");
    const right = parseGroups(halves[1] ?? "");
    if (left === null || right === null) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<bigint>(missing).fill(0n), ...right];
  } else {
    const all = parseGroups(text);
    if (all === null || all.length !== 8) return null;
    groups = all;
  }
  let value = 0n;
  for (const g of groups) value = (value << 16n) | g;
  return value;
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

interface Range {
  readonly network: bigint;
  readonly length: number;
}

function buildRanges(
  rows: readonly (readonly [string, number])[],
  bits: number,
  parse: (text: string) => bigint | null,
): readonly Range[] {
  return rows.map(([text, length]) => {
    const network = parse(text);
    if (network === null || !Number.isInteger(length) || length < 0 || length > bits) {
      throw new Error(`ipNonPublicAddress: bad range "${text}/${length}"`);
    }
    return { network, length };
  });
}

const V4_TABLE = buildRanges(V4_RANGES, V4_BITS, parseDottedQuad);
const V6_TABLE = buildRanges(V6_RANGES, V6_BITS, parseV6);

function inRanges(address: bigint, bits: number, table: readonly Range[]): boolean {
  return table.some((range) => {
    const shift = BigInt(bits - range.length);
    return address >> shift === range.network >> shift;
  });
}

/**
 * True when `input` is a string that parses as an IPv4 or IPv6 address (forms in the header comment)
 * whose canonical form is in a range that ip@2.0.1's isPrivate covers. Unparseable input and
 * non-strings give false.
 */
export function isNonPublicAddress(input: unknown): boolean {
  if (typeof input !== "string") return false;
  if (input.includes(":")) {
    const v6 = parseV6(input);
    if (v6 === null) return false;
    if (v6 >> 32n === 0xffffn) return inRanges(v6 & 0xffffffffn, V4_BITS, V4_TABLE);
    return inRanges(v6, V6_BITS, V6_TABLE);
  }
  const v4 = parseV4(input);
  return v4 === null ? false : inRanges(v4, V4_BITS, V4_TABLE);
}

/**
 * Reviewed definition shown to the Medium by the preset menu. Kept next to the predicate and the
 * range tables above: change them together. Written from the parser and the tables of this file.
 */
export const NON_PUBLIC_ADDRESS_DOC: InputClassDoc = {
  definition:
    "A call is in the class when it has exactly one argument, that argument is a string, and the string parses as an IPv4 or IPv6 address inside one of the ranges listed below. " +
    "A string that contains a colon is parsed as IPv6; any other string is parsed as IPv4. " +
    "A parse failure means not in the class, and so do a non-string, an empty string, surrounding whitespace, a sign, an exponent, CIDR notation, a prefix length, brackets and a zone id. " +
    "IPv4 grammar: 1 to 4 parts separated by dots. Each part is decimal without a leading zero (127), octal with a leading zero (010 is 8; 09 does not parse; 0 is zero) or hexadecimal with 0x or 0X and at least one digit (0x7f); a part is at most 12 characters. " +
    "Every part but the last is at most 255. The last part fills the remaining bytes, so 127.1 is 127.0.0.1 and a single part is a 32-bit integer such as 2130706433 or 0x7f000001; a last part too large for its bytes does not parse. " +
    "IPv6 grammar: 8 groups of 1 to 4 hexadecimal digits in any case, with at most one :: standing for at least one group, and an optional dotted-decimal IPv4 tail in the last 32 bits (exactly four decimal parts 0 to 255 without leading zeros, no octal or hex). " +
    "IPv4 ranges: 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12 and 169.254.0.0/16. " +
    "IPv6 ranges: ::1 (/128), :: (/128), fc00::/7 and fe80::/16 (not the rest of fe80::/10). " +
    "An IPv6 address whose first 96 bits are 0:0:0:0:0:ffff (IPv4-mapped, written ::ffff:a.b.c.d or ::ffff:7f00:1) is judged by its embedded IPv4 address against the IPv4 ranges only. " +
    "Every other address is not in the class, for example 0.0.0.0/8, 100.64.0.0/10, 224.0.0.0/4 and 2001:db8::/32.",
  appliesTo: ["isPublic"],
};

/** Class predicate over the argument array of one call: exactly one string argument. */
export const nonPublicAddressPredicate: InputClassPredicate = (args) =>
  args.length === 1 && typeof args[0] === "string" && isNonPublicAddress(args[0]);
