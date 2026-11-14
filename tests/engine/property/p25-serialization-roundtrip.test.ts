import { describe, it, expect } from "vitest";
import {
  CERTIFICATE_KEY_ORDER,
  canonicalize,
  canonicalJson,
} from "../../../src/engine/serialize/canonicalJson";
import { deserialize } from "../../../src/engine/serialize/deserialize";
import type { DeathCertificate } from "../../../src/engine/types";
import { deathCertificateArb } from "../helpers/certificateArb";
import { fc, fcParams } from "../helpers/fc";

// Feature: autopsy-engine, Property 25: Serialization round trip
// **Validates: Requirements 10.6, 12.3**

/** Deterministic PRNG (mulberry32) so shuffles replay from the fast-check seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Rebuilds `v` with shuffled object key order. Lists that the canonical order
 * sorts are shuffled too. Lists whose order carries meaning are kept: the
 * maintainers list (registry order) and the `value` of a fact (free-form).
 */
function reorder(v: unknown, next: () => number, keep: boolean): unknown {
  if (Array.isArray(v)) {
    const items = v.map((x) => reorder(x, next, keep));
    return keep ? items : shuffled(items, next);
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const isFact = Array.isArray(o["provenance"]) && "key" in o;
    const out: Record<string, unknown> = {};
    for (const k of shuffled(Object.keys(o), next)) {
      const childKeep = keep || k === "maintainers" || (isFact && k === "value");
      out[k] = reorder(o[k], next, childKeep);
    }
    return out;
  }
  return v;
}

function collectKeys(v: unknown, found: Set<string>): void {
  if (Array.isArray(v)) v.forEach((x) => collectKeys(x, found));
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      found.add(k);
      collectKeys(x, found);
    }
  }
}

/** Keys the serializer may emit as structure; free-form record and fact value keys are excluded. */
function structuralKeys(cert: unknown): Set<string> {
  type Doc = { facts?: Array<{ value: unknown }>; risk?: { formula?: unknown } };
  const found = new Set<string>();
  const clone = structuredClone(cert) as Doc;
  for (const f of clone.facts ?? []) f.value = null;
  if (clone.risk?.formula) clone.risk.formula = {};
  collectKeys(clone, found);
  return found;
}

const jsonRoundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("Property 25: Serialization round trip", () => {
  it("deserialize(canonicalJson(c)) equals canonicalize(c) and re-serializes byte-identically", () => {
    fc.assert(
      fc.property(deathCertificateArb, (cert) => {
        const json = canonicalJson(cert);
        const result = deserialize(json);
        expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
        if (!result.ok) return;
        // (a) equals the canonical form (compared as JSON data; -0 prints as 0)
        expect(jsonRoundTrip(result.value)).toEqual(jsonRoundTrip(canonicalize(cert)));
        // (b) byte-identical second serialization
        expect(canonicalJson(result.value)).toBe(json);
      }),
      fcParams(),
    );
  });

  it("output does not depend on key order or on the order of sorted lists", () => {
    fc.assert(
      fc.property(deathCertificateArb, fc.integer(), (cert, seed) => {
        const permuted = reorder(cert, rng(seed), false) as DeathCertificate;
        expect(canonicalJson(permuted)).toBe(canonicalJson(cert));
      }),
      fcParams(),
    );
  });

  it("emits only keys listed in CERTIFICATE_KEY_ORDER", () => {
    const allowed = new Set<string>(Object.values(CERTIFICATE_KEY_ORDER).flat());
    fc.assert(
      fc.property(deathCertificateArb, (cert) => {
        const keys = structuralKeys(JSON.parse(canonicalJson(cert)));
        for (const k of keys) expect(allowed.has(k), `unexpected key ${JSON.stringify(k)}`).toBe(true);
      }),
      fcParams(),
    );
  });
});
