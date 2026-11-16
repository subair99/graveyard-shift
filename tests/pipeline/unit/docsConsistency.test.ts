// Requirements: 14.12
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTRY_FILES, type EntryKind } from "../../../src/pipeline/undertaker/core/layout";

const ROOT = resolve(__dirname, "../../..");
const DOCS = ["README.md", ".kiro/steering/structure.md"] as const;
const KINDS: readonly EntryKind[] = ["resurrection", "not-resurrected"];

describe("entry layout names appear in the docs (R14.12)", () => {
  for (const doc of DOCS) {
    const text = readFileSync(resolve(ROOT, doc), "utf8");

    it(`${doc} names every ENTRY_FILES file`, () => {
      const missing = Object.values(ENTRY_FILES).filter((name) => !text.includes(name));
      expect(missing).toEqual([]);
    });

    it(`${doc} names both entry kinds`, () => {
      const missing = KINDS.filter((kind) => !text.includes(`\`${kind}\``));
      expect(missing).toEqual([]);
    });
  }
});
