// Shared path generators for the intake property tests (resurrection-pipeline Property 13)
// and the medium-agent path-rules tests.
import fc from "fast-check";

// Names differ only in the case of the stem, so a case variant keeps an allowed extension.
export const nameArb = fc.constantFrom("a.js", "A.js", "b.json", "B.json", "c.md", "C.md");
export const dirArb = fc.array(fc.constantFrom("lib", "Lib", "src", "SRC", "x"), { maxLength: 2 });

export const goodPathArb = fc
  .tuple(dirArb, nameArb)
  .map(([dirs, name]) => ["resurrection", ...dirs, name].join("/"));

export const forbiddenArb = fc.constantFrom(".git", ".github", ".kiro", ".GIT", ".Github", ".KIRO");

export const controlArb = fc
  .oneof(fc.integer({ min: 0, max: 0x1f }), fc.constant(0x7f))
  .map((code) => String.fromCharCode(code));

export const badPathArb: fc.Arbitrary<string> = fc.oneof(
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

export const outsidePathArb = fc.oneof(
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
