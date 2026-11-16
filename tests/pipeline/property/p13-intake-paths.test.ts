// Requirements: 9.5, 9.6, 9.11, 8.1
// Feature: resurrection-pipeline, Property 13: Intake accepts only allowlisted paths
import fc from "fast-check";
import { describe, it } from "vitest";
import { validateIntake } from "../../../src/pipeline/intake/core/validator";
import type { EntryType, IntakeEntry } from "../../../src/pipeline/intake/core/types";

type Label = "good" | "bad-path" | "outside" | "link";

interface Item {
  readonly label: Label;
  readonly entry: IntakeEntry;
}

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function regular(path: string): IntakeEntry {
  const bytes = enc("{}");
  return { path, type: "file", size: bytes.length, bytes };
}

const base = (): IntakeEntry[] => [
  regular("resurrection/package.json"),
  regular("deltas.json"),
  regular("harness.json"),
];

// Names differ only in the case of the stem, so a case variant keeps an allowed extension.
const nameArb = fc.constantFrom("a.js", "A.js", "b.json", "B.json", "c.md", "C.md");
const dirArb = fc.array(fc.constantFrom("lib", "Lib", "src", "SRC", "x"), { maxLength: 2 });

const goodPathArb = fc
  .tuple(dirArb, nameArb)
  .map(([dirs, name]) => ["resurrection", ...dirs, name].join("/"));

const forbiddenArb = fc.constantFrom(".git", ".github", ".kiro", ".GIT", ".Github", ".KIRO");

const controlArb = fc.oneof(fc.integer({ min: 0, max: 0x1f }), fc.constant(0x7f)).map((code) => String.fromCharCode(code));

const badPathArb: fc.Arbitrary<string> = fc.oneof(
  goodPathArb.map((p) => p.replace("resurrection/", "resurrection/../")),
  goodPathArb.map((p) => `../${p}`),
  fc.constant("resurrection/.."),
  goodPathArb.map((p) => p.replaceAll("/", "\\")),
  goodPathArb.map((p) => p.replace("resurrection/", "resurrection\\")),
  fc.tuple(fc.constantFrom("C", "d", "Z"), goodPathArb).map(([drive, p]) => `${drive}:/${p}`),
  fc.tuple(fc.constantFrom("C", "d"), nameArb).map(([drive, n]) => `${drive}:${n}`),
  goodPathArb.map((p) => `/${p}`),
  goodPathArb.map((p) => p.replace("resurrection/", "resurrection//")),
  goodPathArb.map((p) => `${p.slice(0, -1)}\0${p.slice(-1)}`),
  // Any C0 control character or DEL (R9.6 amended).
  fc
    .tuple(goodPathArb, controlArb)
    .map(([p, c]) => `${p.slice(0, -1)}${c}${p.slice(-1)}`),
  fc.tuple(goodPathArb, forbiddenArb).map(([p, seg]) => p.replace("resurrection/", `resurrection/${seg}/`)),
  forbiddenArb.map((seg) => `${seg}/config.json`),
  fc.constant(""),
);

const outsidePathArb = fc.oneof(
  fc.constantFrom(
    "package.json",
    "README.md",
    "src/a.js",
    "Resurrection/a.js",
    "resurrection",
    "resurrection.js",
    "Deltas.json",
    "HARNESS.json",
    "deltas.json.bak",
    "tests/deltas.json",
    "lib/harness.json",
  ),
  nameArb.map((n) => `other/${n}`),
);

const linkTypeArb = fc.constantFrom<EntryType>("symlink", "hardlink", "submodule", "device", "other");

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  { weight: 5, arbitrary: goodPathArb.map((p): Item => ({ label: "good", entry: regular(p) })) },
  { weight: 2, arbitrary: badPathArb.map((p): Item => ({ label: "bad-path", entry: regular(p) })) },
  { weight: 2, arbitrary: outsidePathArb.map((p): Item => ({ label: "outside", entry: regular(p) })) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.oneof(goodPathArb, outsidePathArb, fc.constantFrom("deltas.json", "harness.json")), linkTypeArb)
      .map(([p, type]): Item => ({ label: "link", entry: { path: p, type, size: 0 } })),
  },
);

// Mostly clean lists, so the accept branch is exercised as often as the reject branch.
const itemsArb = fc.oneof(
  { weight: 1, arbitrary: fc.array(itemArb, { maxLength: 12 }) },
  {
    weight: 2,
    arbitrary: fc.array(
      goodPathArb.map((p): Item => ({ label: "good", entry: regular(p) })),
      { maxLength: 8 },
    ),
  },
);

describe("Property 13: Intake accepts only allowlisted paths", () => {
  it("accepts iff every path is allowlisted and clean, no entry is a link and no two paths differ only by case", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const entries = [...base(), ...items.map((i) => i.entry)];
        const result = validateIntake(entries);

        // Expected rejection, computed from the labels (not from the validator's rules).
        const rejected = new Set<string>();
        for (const item of items) if (item.label !== "good") rejected.add(item.entry.path);

        // Case collisions take part among entries whose path is not a bad path.
        const badPaths = new Set(items.filter((i) => i.label === "bad-path").map((i) => i.entry.path));
        const groups = new Map<string, string[]>();
        for (const entry of entries) {
          if (badPaths.has(entry.path)) continue;
          const key = entry.path.toLowerCase();
          groups.set(key, [...(groups.get(key) ?? []), entry.path]);
        }
        for (const paths of groups.values()) {
          if (paths.length > 1) for (const p of paths) rejected.add(p);
        }

        if (rejected.size === 0) {
          if (!result.ok) {
            throw new Error(`expected accept, got ${JSON.stringify(result.violations)}`);
          }
          if (result.files.length !== entries.length) throw new Error("accepted file list is incomplete");
          return;
        }

        if (result.ok) throw new Error(`expected reject, accepted; rejected paths ${JSON.stringify([...rejected])}`);
        const reported = new Set(result.violations.map((v) => v.path));
        for (const path of rejected) {
          if (!reported.has(path)) {
            throw new Error(`rejected path ${JSON.stringify(path)} missing from violations`);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
