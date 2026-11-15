# Proof engine: ordering rules

The proof engine serializes every Proof_Report to canonical JSON. Two reports that hold the same data produce the same bytes (requirements 13.1 to 13.3). This document lists the fixed order of object keys, the sort rule of every list, the canonical order of encoded values, the fallback report and the replay recipe.

**Source of truth.** The code is authoritative:

- `src/proof/serialize/canonicalReport.ts`: `REPORT_KEY_ORDER` (key order of every report object), `DIFFERENCE_PART_ORDER`, `PROTOTYPE_ORDER`, and the sorts of every list.
- `src/proof/core/report.ts`: report assembly. It already puts several lists in order before serialization and builds the fallback report.
- `src/proof/child/codec/nodes.ts` (`NODE_KEY_ORDER`) and `src/proof/child/codec/canonical.ts`: key order and sorting of encoded nodes.
- `src/proof/child/codec/order.ts`: `compareCodePoints`, `sortBy`, `ordered`.

`REPORT_KEY_ORDER` is the single source of truth for key order. If this document and the code differ, the code is correct and this document must be fixed. The "Discrepancies" section at the end lists places where the code and the design or requirements differ.

## Comparison rules

- **Strings** are compared by Unicode code point (`compareCodePoints` in `child/codec/order.ts`), ascending. Comparison does not use UTF-16 code units, `localeCompare` or `Intl.Collator`. It is case-sensitive: `Z` sorts before `a`, and a character outside the Basic Multilingual Plane sorts by its full code point, not by its surrogate pair.
- **Sorts are stable.** `sortBy` applies its comparators in order and uses the original index as the last tie-breaker, so elements that tie on every rule keep their input order.
- **Undefined keys are omitted.** A key whose value is `undefined` is not written. A key that is absent is skipped. Keys not listed for an object kind are not written.
- **No whitespace** is written between tokens.
- **No wall-clock field.** The report holds no timestamp of any kind. Its fields are the package identity, verified hashes, counts, the seed, tool versions and the results. Tool versions are read from the running installation and are data, not time.
- Numbers are written by `JSON.stringify`. Strings are escaped by `JSON.stringify`.

## Key order

Keys are written in the order below. The tables are copied from `REPORT_KEY_ORDER`.

### Top level (`report`)

1. `schemaVersion`
2. `package`
3. `original`
4. `resurrection`
5. `sandbox`
6. `functionsTested`
7. `casesPerFunction`
8. `unencodableValues`
9. `excludedFunctions`
10. `nonDeterministicFunctions`
11. `divergences`
12. `deltas`
13. `harnessErrors`
14. `verdict`
15. `seed`
16. `toolVersions`

`unencodableValues` comes after `casesPerFunction` and before `excludedFunctions`.

### Nested objects

| Object | Key order |
|---|---|
| `package` | `name`, `version` |
| `original` | `integrity`, `verified` |
| `resurrection` | `source`, `treeHash` |
| `sandbox` | `mechanism`, `restartEvents`, `otherRestarts`, `limits` |
| `sandbox.restartEvents`, `sandbox.otherRestarts` (`sideCounts`) | `original`, `resurrection` |
| `sandbox.limits` | `callTimeoutMs`, `heapLimitMb`, `outputLimitBytes`, `maxRestarts`, `casesRequested`, `shrinkBudget` |
| `casesPerFunction` entry | `function`, `cases` |
| `unencodableValues` entry | `function`, `cases`, `casesWithUnencodable`, `total`, `reasons` |
| `unencodableValues[].reasons` | `cycle`, `depth`, `getter`, `proxy` |
| `excludedFunctions` entry | `function`, `reason` |
| `nonDeterministicFunctions` entry | `function`, `args`, `differences` |
| Divergence | `function`, `kind`, `deltaId`, `args`, `replay`, `differences`, `original`, `resurrection`, `shrink`, `apiSurface`, `redactionMaskedDifference` |
| Divergence `replay` | `phase`, `seed`, `path`, `index` |
| Divergence `shrink` | `attempts`, `budgetExhausted` |
| Difference (in `differences`) | `part`, `path` |
| Divergence `apiSurface` | `export`, `original`, `resurrection` |
| Export summary (`apiSurface.original`, `apiSurface.resurrection`; may be `null`) | `type`, `fnName`, `arity`, `primitive` |
| `deltas` entry | `id`, `function`, `status`, `predicateCasesChecked`, `demonstration` |
| `demonstration` (may be `null`) | `args`, `original`, `resurrection` |
| Property result (`demonstration.original`, `demonstration.resurrection`) | `ok`, `detail` |
| `harnessErrors` entry | `kind`, `function`, `message` |
| `toolVersions` | `node`, `fastCheck`, `reportSchema` |
| Outcome (`original`, `resurrection` of a Divergence) | `kind`, `async`, `value`, `args`, `prototypeDelta` |
| Prototype delta entry | `prototype`, `key`, `change`, `before`, `after` |
| Prototype delta `key` | `s`, `sym` |
| Property descriptor (`before`, `after`) | `value`, `get`, `set`, `writable`, `enumerable`, `configurable` |

The design (design.md, "Serialization and ordering") fixes the key order up to Outcome. The serializer author chose the orders of these objects, where the design is silent: prototype delta entry (`prototype, key, change, before, after`), prototype delta `key` (`s, sym`), property descriptor (`value, get, set, writable, enumerable, configurable`), `apiSurface` (`export, original, resurrection`), export summary (`type, fnName, arity, primitive`) and property result (`ok, detail`). They are listed in `REPORT_KEY_ORDER` as `deltaEntry`, `deltaKey`, `descriptor`, `apiSurface`, `exportSummary` and `propertyResult`.

### Divergence shape and `redactionMaskedDifference`

A Divergence has one of two shapes.

- Kinds `unexplained` and `delta-violation`: `function`, `kind`, `deltaId` (only when present), `args`, `replay`, `differences`, `original`, `resurrection`, `shrink`, `redactionMaskedDifference`.
- Kind `api-surface`: `function`, `kind`, `apiSurface`, `redactionMaskedDifference`.

`redactionMaskedDifference` is always the last key of a Divergence (requirement 13.2) and is a required boolean (13.6). It is `true` exactly when the Original side and the Resurrection side recorded in that Divergence (for `api-surface`, the two export summaries) differ before identity redaction and have the same canonical JSON after it, and `false` otherwise (13.30 d). The comparison, the Verdict and the set of Divergences are decided before identity redaction, so redaction creates no Divergence and hides none (13.30 a). When the flag is `true`, the two sides look equal in the report text, and the reader must not conclude that the Divergence is spurious.

### Record fields written in a fixed shape

- `replay`: a `generated` or `delta:<id>` phase has `phase`, `seed`, `path`. The `explicit` phase has `phase`, `index`.
- `reasons` always has all four keys, with count 0 where none was observed, written in the order `cycle`, `depth`, `getter`, `proxy`. That is also code point order.
- `prototype delta` `key` is `{"s": <string>}` for a string key and `{"sym": <description>}` for a symbol key. The description is a string or `null`.

## List ordering

All string comparisons are by code point. The "Tie-breakers" column lists later comparators in order. The original index is the last tie-breaker of every `sortBy` list.

| List | Order | Tie-breakers, in order | Notes |
|---|---|---|---|
| `functionsTested` | Function name | None (equal strings are identical) | Sorted as strings. |
| `casesPerFunction` | `function` | Original index | |
| `unencodableValues` | `function` | Original index | The `reasons` keys use the fixed order above. |
| `excludedFunctions` | `function` | Original index | |
| `nonDeterministicFunctions` | `function` | Original index | Its `args` keep their order. `differences` follow the Differences rule. |
| `divergences` | `function` | 1. `kind`. 2. The rendered counterexample (below). 3. Original index. | See "Divergence sort". |
| `deltas` | `id` | Original index | `buildReport` first sorts by `id`, then `function`; the serializer sorts by `id` and keeps that order for equal ids. |
| `harnessErrors` | `kind` | 1. `message`. 2. Original index. | `buildReport` first sorts by `kind`, then `function` (a missing function counts as the empty string), then `message`. |
| `differences` (in a Divergence and in a non-deterministic entry) | `part`, in the fixed order `kind`, `async`, `value`, `args`, `prototypeDelta` | 1. `path`. 2. Original index. | A `part` not in the fixed list sorts after all known parts. |
| `prototypeDelta` (in an Outcome) | `prototype`, in the fixed order `Object.prototype`, `Array.prototype`, `Function.prototype`, `String.prototype`, `Number.prototype`, `Boolean.prototype` | 1. Kind of key: string keys (`s`) before symbol keys (`sym`). 2. Key text: the string, or the symbol description. 3. Original index. | See "Prototype delta entries". |
| `args` of a Divergence, of a non-deterministic entry and of a demonstration | Not sorted | None | Argument order is semantic. |
| `unencodable` reasons | Not a list. Fixed key order `cycle`, `depth`, `getter`, `proxy` | None | |

A `prototype` not in the fixed list sorts after all known prototypes.

### Divergence sort

Divergences are sorted by `function`, then `kind`, then the canonical JSON of the shrunk counterexample **as rendered in the report**, which is the text after the Identity_Redactor and the Root_Normalizer. Two Divergences whose real arguments differ but whose redacted arguments are equal therefore tie on this key and keep their input order. Sorting on the real, unredacted arguments would make the order depend on a value that the report does not show, so it is not done (requirement 13.3).

- For kinds `unexplained` and `delta-violation`, the key is `[` plus the canonical node JSON of each argument, joined by `,`, plus `]` (`argsJson` in the serializer).
- For kind `api-surface`, there are no arguments. The key is `JSON.stringify` of `{export, original, resurrection}` taken from `apiSurface`, where each side is `null` or its summary object with `primitive` replaced by its canonical node JSON text.

`buildReport` sorts with the same three comparators and then the original index. The serializer repeats the sort, so a report built in any order serializes the same way (subject to the open tie item in "Discrepancies").

### Prototype delta entries

Entries are ordered by prototype (fixed order), then string keys before symbol keys, then by key text in code point order. Symbol keys are compared by description. A symbol with a `null` description counts as the empty string, so it sorts before every symbol with a non-empty description and ties with a symbol whose description is the empty string. Ties keep input order.

A string key `s` and a symbol key `sym` never tie, even when the text is equal, because kind of key is compared first.

### Unencodable reasons

`unencodableValues` entries sort by `function`. Inside an entry, `reasons` is an object with exactly `cycle`, `depth`, `getter`, `proxy`, in that order. The schema requires `total` to equal the sum of `reasons` and `casesWithUnencodable` not to exceed `cases`.

## Encoded nodes

Every encoded value (arguments, outcome `value`, Property result `detail`, export summary `primitive`, descriptor `value`, `get` and `set`) is written in the codec's canonical form (`canonicalizeNode`, `nodeJson`). Keys are written per tag, with `t` always first, in the order of `NODE_KEY_ORDER`:

| Tag `t` | Key order |
|---|---|
| `undefined`, `null` | `t` |
| `bool`, `str`, `num`, `bigint`, `symbol`, `date` | `t`, `v` |
| `regexp` | `t`, `source`, `flags` |
| `map` | `t`, `entries` |
| `set` | `t`, `items` |
| `arraybuffer` | `t`, `b64` |
| `typed` | `t`, `kind`, `b64` |
| `error` | `t`, `cls`, `message`, `props` |
| `array` | `t`, `length`, `items`, `props` |
| `object` | `t`, `ctor`, `props` |
| `function` | `t`, `name`, `arity` |
| `unencodable` | `t`, `reason` |

Every key of a tag is written. Nodes are not subject to the "omit undefined" rule, because their fields are never `undefined`. A `props` entry is a two-element array `[key, node]`. An array item is the object `{"i": <index>, "n": <node>}`, written with `i` first.

Sorting inside a node:

| Part | Order | Tie-breakers |
|---|---|---|
| `props` of `object`, `error` and `array` | Key, by code point | Input order (stable sort) |
| `items` of `array` | Index `i`, ascending | Input order |
| `entries` of `map` | Canonical JSON of the pair `[<key node>,<value node>]`, by code point | Original index |
| `items` of `set` | Canonical JSON of the item node, by code point | Original index |

Map entries and Set items are canonicalized (recursively) before their JSON is compared. The compared text is canonical JSON, so the order does not depend on construction order. The codec compares that text with `compareRendered`, which orders UTF-16 text by code point without allocation. It gives the same result as `compareCodePoints` for well-formed text. `JSON.stringify` escapes lone surrogates, so the compared text has only paired surrogates.

`canonicalizeNode` is idempotent and returns a new node. A node that is already canonical is not changed by a second pass.

## Fallback report

`fallbackReport` in `core/report.ts` replaces the normal report when the builder cannot render it safely. It is used when:

- two keys of one encoded object become identical after root normalization or identity redaction (harness error `normalization-collision`);
- the serialized report still contains a temporary root (harness error `temp-root-leak`);
- the serialized report still contains an Identity_Value after redaction (harness error `identity-leak`).

The fallback report has the same shape and key order as a normal report, and goes through the same serializer. It differs in content:

- `divergences` is `[]`.
- `deltas` is `[]`, so no Declared_Delta result or demonstration is listed.
- Each `nonDeterministicFunctions` entry keeps its `function` and has `args: []` and `differences: []`.
- `harnessErrors` holds the existing errors plus one added error of the kind above, sorted by `kind`, then `function`, then `message`. The added error has no path. A `normalization-collision` error includes `function` when known.
- Free text (function names, reasons, package name, version, integrity, tree hash, error messages) is identity-redacted, and replaced by the text `<withheld>` when it still holds a temporary root or an Identity_Value.
- Counts, `sandbox`, `seed`, `verified` and the `source` of `resurrection` are copied as measured.
- The Verdict is computed by the normal verdict rule from these parts. A harness error, which the fallback always has, makes it `inconclusive` unless another rule applies first.

The fallback report lists no Divergence even when the run found some. That is stated in the added error message, so the omission is visible.

## Replay recipe

A Divergence is replayed through its `replay` object, not through the text of `args`.

- For a `generated` or `delta:<id>` phase, run the same function with the recorded `seed` and `path` and the same number of runs and harness. `seed` and `path` are not changed by redaction.
- For the `explicit` phase, run the explicit Case at `index` of the harness.

The `args` in the report are the redacted rendering. When identity redaction or root normalization changed a string, `args` differ from the real arguments and cannot be pasted back as an explicit Case. Replay through Seed and path stays exact (limitation L14). `redactionMaskedDifference` tells the reader that redaction made the two recorded sides look equal.

## Discrepancies

None open as of 2026-11-15 for items 2 to 6 of the earlier list: design.md ("Serialization and ordering") documents the rules above and adopts the code's behavior (harness error and delta pre-sort in `buildReport`, the `api-surface` sort key, stable sorts for node lists, string keys before symbol keys with a `null` description counted as the empty string).

Open, reported as a code gap (code not changed):

1. **Permutation tie on Divergences and harness errors.** Requirement 13.3 and Property 23 describe canonical JSON that is identical for any permutation of the sortable lists, and R13.3 breaks ties by original index. Divergences are sorted by `function`, `kind` and the rendered counterexample only. Two Divergences with the same function, kind and rendered arguments but different `deltaId`, `replay`, outcomes or `shrink` (for example two `delta-violation` entries from different deltas that found the same counterexample) tie on every comparator while differing in content, so their output order depends on input order. The same applies to `harnessErrors` with the same `kind` and `message` and different `function`. `buildReport` hides this with its own earlier sort (`function` is added for harness errors and deltas), but `canonicalReport` on a hand-permuted report is not permutation-invariant in these cases. A fix needs extra tie-breakers (for example `deltaId`, `function`, then the canonical JSON of the entry), which goes beyond the sort rule written in R13.3.
The code table (`REPORT_KEY_ORDER`) stays the single source of truth for key order. If it changes, update this document in the same change.
