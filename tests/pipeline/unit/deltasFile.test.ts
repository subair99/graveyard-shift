// Requirements: 4.1, 4.2, 4.8, 4.10
import { describe, expect, it } from "vitest";
import {
  canonicalDeltasJson,
  parseDeltasFile,
  type DeltasFile,
} from "../../../src/pipeline/harness/core/deltas";

const proto = {
  kind: "prototype-unchanged",
  id: "proto-pollution",
  function: "default",
  advisory: "GHSA-p6mc-m468-83gw",
};

const returns = {
  kind: "returns-expected",
  id: "ip-public",
  function: "isPublic",
  advisory: "GHSA-2p57-rm9w-gvfp",
  cases: [
    {
      input: ["127.1"],
      expected: false,
      source: { url: "https://github.com/advisories/GHSA-2p57-rm9w-gvfp", fetchedAt: "2026-11-15T10:00:00Z" },
    },
  ],
};

const file = (deltas: unknown[] = [proto]) =>
  JSON.stringify({ schemaVersion: 1, package: "lodash.set", deltas });

function issues(text: string): string[] {
  const r = parseDeltasFile(text);
  if (r.ok) throw new Error("expected a parse failure");
  return r.error.issues;
}

describe("parseDeltasFile", () => {
  it("accepts both delta kinds", () => {
    expect(parseDeltasFile(file([proto, returns])).ok).toBe(true);
  });

  it("rejects malformed JSON at the root", () => {
    expect(issues("{nope")[0]).toMatch(/^\(root\): malformed JSON/);
  });

  it("names the failing path", () => {
    const bad = { ...proto, advisory: "ghsa-p6mc-m468-83gw" };
    expect(issues(file([bad])).join("\n")).toContain("deltas.0.advisory");
    expect(issues(file([{ ...proto, id: "Bad Id" }])).join("\n")).toContain("deltas.0.id");
  });

  it("rejects an unknown kind", () => {
    expect(parseDeltasFile(file([{ ...proto, kind: "other" }])).ok).toBe(false);
  });

  it("rejects extra fields, code strings and module paths", () => {
    const text = file([{ ...proto, propertyModule: "./x.cjs" }]);
    expect(issues(text).join("\n")).toContain("propertyModule");
    expect(parseDeltasFile(JSON.stringify({ schemaVersion: 1, package: "p", deltas: [proto], extra: 1 })).ok).toBe(false);
  });

  it("requires a source URL and fetch date on every returns-expected case", () => {
    const noSource = { ...returns, cases: [{ input: ["127.1"], expected: false }] };
    expect(issues(file([noSource])).join("\n")).toContain("deltas.0.cases.0.source");
    const badDate = {
      ...returns,
      cases: [{ ...returns.cases[0], source: { url: "https://example.com", fetchedAt: "yesterday" } }],
    };
    expect(parseDeltasFile(file([badDate])).ok).toBe(false);
  });

  it("requires at least one delta and one case", () => {
    expect(parseDeltasFile(file([])).ok).toBe(false);
    expect(parseDeltasFile(file([{ ...returns, cases: [] }])).ok).toBe(false);
  });

  it("bounds JSON values by depth and node count", () => {
    const deep = { ...returns, cases: [{ ...returns.cases[0], expected: [[[[1]]]] }] };
    expect(parseDeltasFile(file([deep])).ok).toBe(false);
    const wide = { ...returns, cases: [{ ...returns.cases[0], expected: Array.from({ length: 1000 }, () => 0) }] };
    expect(parseDeltasFile(file([wide])).ok).toBe(false);
    const fine = { ...returns, cases: [{ ...returns.cases[0], expected: [[[1]]] }] };
    expect(parseDeltasFile(file([fine])).ok).toBe(true);
  });

  it("limits input to 8 arguments", () => {
    const many = { ...returns, cases: [{ ...returns.cases[0], input: Array.from({ length: 9 }, () => 1) }] };
    expect(parseDeltasFile(file([many])).ok).toBe(false);
  });
});

describe("canonicalDeltasJson", () => {
  it("writes the fixed key order without whitespace", () => {
    const shuffled = JSON.stringify({
      deltas: [{ advisory: "GHSA-p6mc-m468-83gw", function: "default", id: "proto-pollution", kind: "prototype-unchanged" }],
      package: "lodash.set",
      schemaVersion: 1,
    });
    const r = parseDeltasFile(shuffled);
    if (!r.ok) throw new Error("parse failed");
    expect(canonicalDeltasJson(r.value)).toBe(
      '{"schemaVersion":1,"package":"lodash.set","deltas":[{"kind":"prototype-unchanged","id":"proto-pollution","function":"default","advisory":"GHSA-p6mc-m468-83gw"}]}',
    );
  });

  it("sorts keys inside expected values and round-trips", () => {
    const c = { ...returns.cases[0], expected: { b: 1, a: { z: 1, y: 2 } } };
    const r = parseDeltasFile(file([{ ...returns, cases: [c] }]));
    if (!r.ok) throw new Error("parse failed");
    const text = canonicalDeltasJson(r.value);
    expect(text).toContain('"expected":{"a":{"y":2,"z":1},"b":1}');
    const again = parseDeltasFile(text);
    expect(again.ok && (again.value as DeltasFile)).toEqual(r.value);
    expect(again.ok && canonicalDeltasJson(again.value)).toBe(text);
  });
});
