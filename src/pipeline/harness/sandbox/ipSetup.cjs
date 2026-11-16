"use strict";
// Setup module of the ip-address preset (design "ip coverage", R5.8). It runs in the sandbox child
// before the package loads, on both sides, and replaces os.networkInterfaces() with a fixed stub.
//
// ip.address() writes `details.family` into the interface objects it reads, so the stub returns
// fresh objects on every call: a call on one side can never change what a later call sees, and
// both sides see byte-identical data. Nothing here reads the real network, the clock or the
// environment. The addresses are documentation ranges (RFC 5737, RFC 3849), loopback and link-local.

const os = require("os");

function networkInterfaces() {
  return {
    // Private IPv4 and a link-local IPv6 address.
    eth0: [
      { address: "192.168.1.10", netmask: "255.255.255.0", family: "IPv4", mac: "02:00:00:00:00:01", internal: false, cidr: "192.168.1.10/24" },
      { address: "fe80::1c2d:3e4f:5a6b:7c8d", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "02:00:00:00:00:01", internal: false, cidr: "fe80::1c2d:3e4f:5a6b:7c8d/64", scopeid: 2 },
    ],
    // Public-looking IPv4 and IPv6 (TEST-NET-3 and the IPv6 documentation range). The IPv4 entry
    // has a numeric family, as Node 18.0 to 18.3 reported it, to exercise the family normalization.
    wlan0: [
      { address: "203.0.113.7", netmask: "255.255.255.0", family: 4, mac: "02:00:00:00:00:02", internal: false, cidr: "203.0.113.7/24" },
      { address: "2001:db8::7", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "02:00:00:00:00:02", internal: false, cidr: "2001:db8::7/64", scopeid: 0 },
    ],
    // Loopback.
    lo: [
      { address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" },
      { address: "::1", netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", family: "IPv6", mac: "00:00:00:00:00:00", internal: true, cidr: "::1/128", scopeid: 0 },
    ],
    // An interface with no addresses.
    empty0: [],
  };
}

os.networkInterfaces = networkInterfaces;
