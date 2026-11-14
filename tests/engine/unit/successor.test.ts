import { describe, expect, it } from "vitest";
import {
  extractCandidates,
  findSuccessor,
  type LookupResult,
} from "../../../src/engine/core/successor";

const INFLIGHT =
  "This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.";

const exists = (name: string): LookupResult => ({
  status: "ok",
  value: null,
  provenance: [
    { sourceUrl: `https://registry.npmjs.org/${name}`, fetchedAt: "2026-01-01T00:00:00Z" },
  ],
});
const notFound = (name: string): LookupResult => ({
  status: "not-found",
  source: "npm",
  url: `https://registry.npmjs.org/${name}`,
});
const unavailable = (name: string, reason: string): LookupResult => ({
  status: "unavailable",
  source: "npm",
  attemptedUrl: `https://registry.npmjs.org/${name}`,
  attemptedAt: "2026-01-01T00:00:00Z",
  reason,
});

describe("extractCandidates", () => {
  it("finds `it` then `lru-cache` in the inflight message", () => {
    const names = extractCandidates(INFLIGHT).map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(["it", "lru-cache"]);
  });

  it("extracts backtick tokens", () => {
    expect(extractCandidates("Moved to `got` now")).toEqual([
      { name: "got", position: 9, rule: "backticks" },
    ]);
  });

  it("takes the word BEFORE instead", () => {
    const c = extractCandidates("Please undici instead.");
    expect(c.map((x) => [x.name, x.rule])).toEqual([["undici", "before-instead"]]);
  });

  it("matches phrases case-insensitively and strips trailing punctuation", () => {
    const names = extractCandidates("SWITCH TO foo-bar, or Replaced By baz.").map((c) => c.name);
    expect(names).toEqual(["foo-bar", "baz"]);
  });

  it("orders by position, then rule order", () => {
    const c = extractCandidates("use `foo` or bar instead");
    expect(c.map((x) => x.name)).toEqual(["foo", "bar"]);
    expect(c[0]?.rule).toBe("backticks");
  });

  it("returns nothing when no rule matches", () => {
    expect(extractCandidates("This package is no longer maintained.")).toEqual([]);
  });
});

describe("findSuccessor", () => {
  it("skips stoplisted `it` without lookup and selects lru-cache", async () => {
    const looked: string[] = [];
    const r = await findSuccessor(extractCandidates(INFLIGHT), async (n) => {
      looked.push(n);
      return exists(n);
    });
    expect(r.successor).toBe("lru-cache");
    expect(looked).toEqual(["lru-cache"]);
    expect(r.lookups).toHaveLength(1);
  });

  it("skips stoplisted words case-insensitively and invalid names without lookup", async () => {
    const looked: string[] = [];
    const r = await findSuccessor(
      [
        { name: "IT", position: 0, rule: "after-phrase" },
        { name: "Another", position: 1, rule: "after-phrase" },
        { name: "not valid!", position: 2, rule: "backticks" },
      ],
      async (n) => {
        looked.push(n);
        return exists(n);
      },
    );
    expect(looked).toEqual([]);
    expect(r).toEqual({ lookups: [] });
  });

  it("records failures and moves on to the next candidate", async () => {
    const results: Record<string, LookupResult> = {
      gone: notFound("gone"),
      slow: unavailable("slow", "timeout"),
      limited: unavailable("limited", "rate limit"),
      good: exists("good"),
    };
    const cands = ["gone", "slow", "limited", "good", "later"].map((name, i) => ({
      name,
      position: i,
      rule: "backticks" as const,
    }));
    const r = await findSuccessor(cands, async (n) => {
      if (n === "limited") throw new Error("boom");
      return results[n] ?? exists(n);
    });
    expect(r.successor).toBe("good");
    expect(r.lookups.map((l) => [l.name, l.outcome])).toEqual([
      ["gone", "result"],
      ["slow", "result"],
      ["limited", "threw"],
      ["good", "result"],
    ]);
  });

  it("returns no successor when no candidate exists", async () => {
    const r = await findSuccessor(extractCandidates("use `nope` instead"), async (n) =>
      notFound(n),
    );
    expect(r.successor).toBeUndefined();
    expect(r.lookups).toHaveLength(1);
  });

  it("returns no successor for a message without candidates", async () => {
    const r = await findSuccessor(extractCandidates("deprecated"), async (n) => exists(n));
    expect(r).toEqual({ lookups: [] });
  });
});
