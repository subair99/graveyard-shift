// Requirements: 4.17, 4.18, 4.19, 4.20, 5.6
// The ip class `non-public-address` (task 12.11): inputs the reference parser canonicalizes whose
// canonical form is in a range that ip@2.0.1's isPrivate covers (package/lib/ip.js lines 308-334 and
// 340-353 of the recorded tarball): 127/8, 10/8, 192.168/16, 172.16/12, 169.254/16, ::1, ::, fc00::/7,
// fe80::/16, and the IPv4-mapped forms of the IPv4 ranges.
import { describe, expect, it } from "vitest";
import { isNonPublicAddress } from "../../../src/pipeline/harness/core/presets/ipNonPublicAddress";
import { IP_ADDRESS_PRESET } from "../../../src/pipeline/harness/core/presets/ipAddress";

describe("non-public-address class", () => {
  it("contains the five Advisory_Addresses", () => {
    for (const a of ["127.1", "01200034567", "012.1.2.3", "000:0:0000::01", "::fFFf:127.0.0.1"]) {
      expect(isNonPublicAddress(a), a).toBe(true);
    }
  });

  it("contains 017700000001 and ::ffff:7f00:1", () => {
    for (const a of ["017700000001", "::ffff:7f00:1"]) expect(isNonPublicAddress(a), a).toBe(true);
  });

  it("does not contain 0, 0x0 and 0.0.0.0 (0.0.0.0/8 is not covered by isPrivate)", () => {
    for (const a of ["0", "0x0", "0.0.0.0", "0.1.2.3", "::ffff:0.0.0.0", "::ffff:0:0"]) {
      expect(isNonPublicAddress(a), a).toBe(false);
    }
  });

  it("contains canonical examples inside each covered range, at both edges", () => {
    for (const a of [
      "127.0.0.1", "127.255.255.255", "127.0.0.0",
      "10.0.0.1", "10.255.255.255",
      "192.168.0.0", "192.168.1.1", "192.168.255.255",
      "172.16.0.1", "172.31.255.255",
      "169.254.0.0", "169.254.1.1", "169.254.255.255",
      "::1", "::",
      "fc00::1", "fd12:3456:789a::1", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::1", "fe80::abcd:1234",
    ]) {
      expect(isNonPublicAddress(a), a).toBe(true);
    }
  });

  it("does not contain addresses just outside the covered ranges", () => {
    for (const a of [
      "126.255.255.255", "128.0.0.0",
      "9.255.255.255", "11.0.0.0",
      "192.167.255.255", "192.169.0.0",
      "172.15.255.255", "172.32.0.0",
      "169.253.255.255", "169.255.0.0",
      "::2", "fbff::1", "fe00::1", "fe7f::1", "fe81::1", "febf::1", "ff02::1",
    ]) {
      expect(isNonPublicAddress(a), a).toBe(false);
    }
  });

  it("does not contain the canonical public examples", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isNonPublicAddress(a), a).toBe(false);
  });

  it("does not contain ranges that isPrivate does not cover (100.64/10, 198.18/15, ...)", () => {
    for (const a of ["100.64.0.1", "100.127.255.255", "198.18.0.1", "198.19.255.255", "192.0.0.1", "192.0.2.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "2001:db8::1", "64:ff9b::808:808"]) {
      expect(isNonPublicAddress(a), a).toBe(false);
    }
  });

  it("parses short, octal, hex and long-integer forms", () => {
    expect(isNonPublicAddress("0x7f.0.0.1")).toBe(true);
    expect(isNonPublicAddress("0x7f000001")).toBe(true);
    expect(isNonPublicAddress("2130706433")).toBe(true);
    expect(isNonPublicAddress("0177.0.0.1")).toBe(true);
    expect(isNonPublicAddress("10.1")).toBe(true);
    expect(isNonPublicAddress("0xc0a80001")).toBe(true); // 192.168.0.1
    // a leading zero is octal: 010.0.0.1 is 8.0.0.1 (public), 0x08080808 is 8.8.8.8
    expect(isNonPublicAddress("010.0.0.1")).toBe(false);
    expect(isNonPublicAddress("0x08080808")).toBe(false);
    expect(isNonPublicAddress("134744072")).toBe(false);
  });

  it("classifies IPv4-mapped IPv6 by the embedded IPv4 address", () => {
    expect(isNonPublicAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isNonPublicAddress("::ffff:0a00:1")).toBe(true);
    expect(isNonPublicAddress("0:0:0:0:0:ffff:192.168.0.1")).toBe(true);
    expect(isNonPublicAddress("::ffff:172.31.0.1")).toBe(true);
    expect(isNonPublicAddress("::ffff:169.254.1.1")).toBe(true);
    expect(isNonPublicAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isNonPublicAddress("::ffff:808:808")).toBe(false);
    expect(isNonPublicAddress("::ffff:100.64.0.1")).toBe(false);
  });

  it("returns false for unparseable and non-string inputs", () => {
    for (const a of [
      "", " ", "abc", "1.2.3.4.5", "256.1.1.1", "1.2.3.", ".1.2.3", "0x", "-1", "1e3", "09.1.1.1", "4294967296",
      "256.0.0", "1.2.65536", " 127.0.0.1", "127.0.0.1 ", "::g", ":::", "1::2::3", "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7::8", "fe80::1%eth0", "::ffff:256.0.0.1", "::ffff:1.2.3", "10.0.0.0/8", ":1::",
    ]) {
      expect(isNonPublicAddress(a), JSON.stringify(a)).toBe(false);
    }
    for (const v of [undefined, null, 0, 2130706433, true, {}, [], ["127.0.0.1"], Buffer.from("127.0.0.1")]) {
      expect(isNonPublicAddress(v)).toBe(false);
    }
  });

  it("is pure: same input, same output", () => {
    for (const a of ["127.1", "8.8.8.8", "::1", "0", "junk", 5]) {
      expect(isNonPublicAddress(a)).toBe(isNonPublicAddress(a));
    }
  });
});

describe("ip-address preset exposes the class", () => {
  it("has the class with an exactly-one-string predicate and the isPublic allowlist", () => {
    const predicate = IP_ADDRESS_PRESET.inputClasses["non-public-address"];
    expect(Object.keys(IP_ADDRESS_PRESET.inputClasses)).toEqual(["non-public-address"]);
    expect(IP_ADDRESS_PRESET.deltaFunctions).toEqual(["isPublic"]);
    expect(predicate?.(["127.1"])).toBe(true);
    expect(predicate?.(["8.8.8.8"])).toBe(false);
    expect(predicate?.(["0"])).toBe(false);
    expect(predicate?.([])).toBe(false);
    expect(predicate?.(["127.1", "x"])).toBe(false);
    expect(predicate?.([2130706433])).toBe(false);
  });
});
