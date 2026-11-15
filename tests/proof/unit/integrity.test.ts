import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeSri, parseSri, verifyIntegrity } from "../../../src/proof/shell/integrity";

const bytes = new TextEncoder().encode("graveyard shift tarball bytes");
const good = "sha512-" + createHash("sha512").update(bytes).digest("base64");
const other = computeSri(new TextEncoder().encode("something else"));

describe("integrity", () => {
  it("computes the known-answer SRI for empty input", () => {
    // sha512("") from node:crypto, base64
    expect(computeSri(new Uint8Array())).toBe(
      "sha512-" + createHash("sha512").update("").digest("base64"),
    );
    expect(computeSri(new Uint8Array())).toBe(
      "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==",
    );
  });

  it("accepts matching bytes and returns the SRI", () => {
    expect(verifyIntegrity(bytes, good)).toEqual({ ok: true, value: good });
  });

  it("reports a mismatch with both strings", () => {
    const r = verifyIntegrity(bytes, other);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "integrity-mismatch") {
      expect(r.error.expected).toBe(other);
      expect(r.error.actual).toBe(good);
      expect(r.error.message).toContain(other);
      expect(r.error.message).toContain(good);
    } else {
      throw new Error("expected integrity-mismatch");
    }
  });

  it("detects a single changed byte", () => {
    const changed = bytes.slice();
    changed[0] = (changed[0] ?? 0) ^ 1;
    const r = verifyIntegrity(changed, good);
    expect(!r.ok && r.error.kind).toBe("integrity-mismatch");
  });

  it("rejects malformed SRI strings as invalid-integrity", () => {
    for (const s of ["", "   ", "sha512-", "sha512-!!!!", "sha512-AAAA", good.slice(0, -4), good + "A", "garbage"]) {
      const r = verifyIntegrity(bytes, s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("invalid-integrity");
    }
  });

  it("rejects other algorithms, alone or mixed with sha512", () => {
    const sha1 = "sha1-" + createHash("sha1").update(bytes).digest("base64");
    const md5 = "md5-" + createHash("md5").update(bytes).digest("base64");
    const sha256 = "sha256-" + createHash("sha256").update(bytes).digest("base64");
    for (const s of [sha1, md5, sha256, `${sha1} ${good}`]) {
      const r = verifyIntegrity(bytes, s);
      expect(!r.ok && r.error.kind).toBe("invalid-integrity");
    }
  });

  it("accepts multiple sha512 hashes when one matches", () => {
    expect(verifyIntegrity(bytes, `${other} ${good}`).ok).toBe(true);
    const r = verifyIntegrity(bytes, `${other}  ${other}`);
    expect(!r.ok && r.error.kind).toBe("integrity-mismatch");
  });

  it("handles empty tarball bytes", () => {
    const empty = new Uint8Array();
    expect(verifyIntegrity(empty, computeSri(empty)).ok).toBe(true);
    expect(verifyIntegrity(empty, good).ok).toBe(false);
  });

  it("parseSri returns 64-byte digests", () => {
    const r = parseSri(good);
    expect(r.ok && r.value.map((d) => d.length)).toEqual([64]);
  });
});
