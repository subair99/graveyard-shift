// Requirements: 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 23.4
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendEntry,
  buildLocalEntry,
  buildStubEntry,
  canonicalLedgerJson,
  describeLedgerFailure,
  emptyLedger,
  parseLedger,
  printLedger,
} from "../../../src/pipeline/local/core/ledger";
import { writeFileAtomic, nodeAtomicFs } from "../../../src/pipeline/local/shell/atomicWrite";

const DATE = "2026-11-16T01:02:03Z";
const local = buildLocalEntry({
  package: "ip",
  version: "2.0.1",
  date: DATE,
  creditBefore: "  12.5 ",
  creditAfter: "",
  exitCode: 0,
  kiroCliVersion: "1.2.3",
});

describe("ledger entries", () => {
  it("copies readings verbatim and uses `not provided` when empty", () => {
    expect(local.creditBefore).toBe("  12.5 ");
    expect(local.creditAfter).toBe("not provided");
    expect(local.cliUsage).toBeUndefined();
  });

  it("stub entry has no reading, exit code or CLI version", () => {
    const s = buildStubEntry({
      package: "lodash.set",
      version: "4.3.3",
      date: DATE,
      fixture: "tests/pipeline/fixtures/stub/lodash.set",
    });
    expect(Object.keys(s)).toEqual(["mode", "package", "version", "date", "fixture"]);
  });

  it("append keeps earlier entries unchanged", () => {
    const l1 = appendEntry(emptyLedger(), local);
    const snapshot = JSON.stringify(l1);
    const l2 = appendEntry(l1, buildLocalEntry({ ...local, creditAfter: "9", cliUsage: "u" }));
    expect(JSON.stringify(l1)).toBe(snapshot);
    expect(l2.entries[0]).toEqual(l1.entries[0]);
    expect(l2.entries).toHaveLength(2);
  });

  it("round trips through the printed and canonical forms with fixed key order", () => {
    const l = appendEntry(
      appendEntry(emptyLedger(), local),
      buildStubEntry({ package: "p", version: "1.0.0", date: DATE, fixture: "tests/proof/fixtures/x" }),
    );
    for (const text of [printLedger(l), canonicalLedgerJson(l)]) {
      const r = parseLedger(text);
      expect(r.ok && r.value).toEqual(l);
    }
    expect(canonicalLedgerJson(l).startsWith('{"schemaVersion":1,"entries":[{"mode":"local","package":"ip"')).toBe(true);
  });
});

describe("parseLedger", () => {
  it("names the file and the failing path for a malformed ledger", () => {
    const bad = JSON.stringify({ schemaVersion: 1, entries: [{ mode: "local", package: "ip" }] });
    const r = parseLedger(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = describeLedgerFailure(r.error);
    expect(msg).toContain("ledger.json");
    expect(msg).toContain("entries.0");
  });

  it("reports malformed JSON", () => {
    const r = parseLedger("{nope");
    expect(r.ok).toBe(false);
  });

  it.each(["/home/u/x", "C:\\x", "C:/x", "\\\\srv\\share", "a/../b", ""])(
    "rejects fixture path %j (no absolute path, R7.10)",
    (fixture) => {
      const text = JSON.stringify({
        schemaVersion: 1,
        entries: [{ mode: "stub", package: "p", version: "1.0.0", date: DATE, fixture }],
      });
      expect(parseLedger(text).ok).toBe(false);
    },
  );

  it("rejects unknown keys", () => {
    const text = JSON.stringify({ schemaVersion: 1, entries: [], extra: 1 });
    expect(parseLedger(text).ok).toBe(false);
  });
});

describe("writeFileAtomic", () => {
  it("writes the file and leaves no temp file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    try {
      const p = join(dir, "ledger.json");
      await writeFileAtomic(p, "new");
      expect(readFileSync(p, "utf8")).toBe("new");
      expect(readdirSync(dir)).toEqual(["ledger.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the old file when the rename fails and removes the temp file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    try {
      const p = join(dir, "ledger.json");
      writeFileSync(p, "old");
      await expect(
        writeFileAtomic(p, "new", "t", {
          ...nodeAtomicFs,
          rename: () => Promise.reject(new Error("boom")),
        }),
      ).rejects.toThrow("boom");
      expect(readFileSync(p, "utf8")).toBe("old");
      expect(readdirSync(dir)).toEqual(["ledger.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
