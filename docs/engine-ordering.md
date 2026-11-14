# Autopsy engine: ordering rules

The engine serializes every Death_Certificate to canonical JSON. The same certificate always produces the same bytes (requirements 10.3, 10.4, 10.5). This document lists the ordering of every list, the fixed order of object keys, and the timestamp format.

**Source of truth.** The code is authoritative:

- `src/engine/serialize/canonicalJson.ts`: `CERTIFICATE_KEY_ORDER` (key order), list sorting, timestamp truncation.
- `src/engine/core/certificate.ts`: assembly of the certificate. It already puts several lists in order before serialization.

If this document and the code differ, the code is correct and this document must be fixed.

## Comparison rules

- **Strings** are compared by Unicode code point (`compareCodePoints` in `canonicalJson.ts`), ascending. Locale-aware comparison (`localeCompare`, `Intl.Collator`) and UTF-16 code unit comparison are not used. Comparison is case-sensitive, so `Z` sorts before `a`, and a character outside the Basic Multilingual Plane sorts by its full code point, not by its surrogate pair.
- **Stable and total.** Sorting keeps the original index as the last tie-breaker, so equal elements keep their input order. Lists that compare equal on every listed rule and also serialize to the same JSON are identical, so shuffling them does not change the output.
- **Timestamps** are second precision, `YYYY-MM-DDTHH:mm:ssZ`. Milliseconds are truncated (cut off, not rounded). See "Timestamps".

## List ordering

The serializer sorts the lists below, except where the Notes column says the order comes from certificate assembly.

| List | Order | Tie-breakers, in order | Notes |
|---|---|---|---|
| `causes` | Fixed: `maintainer-gone`, `repo-archived`, `unpatched-cve`, `runtime-rot` | Code point of the cause string | A value not in the fixed list sorts before all known causes (its index in the fixed list is -1). Duplicates are not removed. |
| `openVulnerabilityIds` | Code point | None | Not in the design table. Duplicates are not removed by the serializer. |
| Open vulnerabilities (`vitalSigns.openVulnerabilities.value`, when available) | `id`, code point | 1. First alias of the vulnerability (after aliases are sorted), code point. A vulnerability with no aliases counts as the empty string. 2. JSON text of the whole canonicalized vulnerability, code point (applies to equal items). 3. Original index. | Certificate assembly also sorts by `summary` and keeps one entry per `id`. The serializer does not deduplicate. |
| Vulnerability `aliases` | Code point | None | Certificate assembly removes duplicates. The serializer does not. |
| Maintainers (`vitalSigns.maintainers.value`) | Registry order, not sorted | None | The serializer does not touch this list. Registry order is itself a reported fact (requirement 7.2). |
| `facts` | `key`, code point | 1. `sourceUrl` of the first provenance entry (after provenance is sorted), code point. A fact with no provenance counts as the empty string. 2. JSON text of the whole canonicalized fact, code point (applies to equal items). 3. Original index. | |
| `provenance` entries in a Fact | `sourceUrl`, code point | 1. `fetchedAt`, code point (after truncation to seconds; UTC ISO 8601 strings compare correctly as text). 2. Original index. | Certificate assembly also removes duplicate entries and keeps at most 20. |
| Risk `contributions` | Fixed component order (below) | 1. Code point of `component`. 2. Original index. | A component not in the fixed list sorts after all known components, then by code point. |
| `risk.unavailable` | Code point | None | Entries are sorted as strings. |
| `notes.omittedFacts` | `key`, code point | 1. `reason`, code point. 2. Original index. | Not in the design table. Certificate assembly produces one entry per key. |

Fixed component order for risk contributions:

1. `cause:maintainer-gone`
2. `cause:repo-archived`
3. `cause:unpatched-cve`
4. `cause:runtime-rot`
5. `vitalSign:maintainers`
6. `vitalSign:openVulnerabilities`
7. `vitalSign:scorecard`
8. `vitalSign:dependents`
9. `vitalSign:weeklyDownloads`

The cause components follow the cause order. The vital sign components follow the key order of `vitalSigns`.

### Certificates in a run

For a list of certificates (or package references) in one run, the design order is package name by code point, then version by semver precedence, then version string by code point. `canonicalJson` serializes one certificate and does not order a list of certificates. The only implemented ordering of this kind is `finalize` in `src/engine/parse/inputParser.ts`, which sorts parsed package references by name (code point), then by version spec. A spec of `null` (latest) sorts first. Two exact semver versions compare by precedence, with ties broken by the spec string by code point. Finished certificates are ordered by `compareCertificates` in `src/engine/autopsy.ts`, which `runAutopsy` applies to `AutopsyRun.certificates`: name by code point, then version by semver precedence (`semver.compare`), then the version string by code point. A version that is not valid semver sorts after valid ones. The order depends only on the certificates, not on the order in which upstream requests finish (requirement 11.5). Two references that resolve to the same name and version produce one certificate.

## Key order

Keys are written in the order below at every level. A key whose value is `undefined` is omitted. Keys not listed for an object kind are not emitted. All order tables live in `CERTIFICATE_KEY_ORDER`.

### Top level (`DeathCertificate`)

1. `schemaVersion`
2. `package`
3. `analysisDate`
4. `status`
5. `statusError`
6. `causes`
7. `openVulnerabilityIds`
8. `timeOfDeath`
9. `daysSinceDeath`
10. `vitalSigns`
11. `successor`
12. `riskScore`
13. `risk`
14. `facts`
15. `notes`

### Nested objects

| Object | Key order |
|---|---|
| `package` | `name`, `version` |
| `vitalSigns` | `maintainers`, `openVulnerabilities`, `scorecard`, `dependents`, `weeklyDownloads` |
| `Maybe` (both variants; used by `timeOfDeath` and each vital sign) | `available`, `value`, `source`, `attemptedUrl`, `attemptedAt`, `reason`, `rateLimitResetAt` |
| Vulnerability | `id`, `aliases`, `summary`, `severity` |
| `risk` | `contributions`, `rawScore`, `formula`, `unavailable`, `note` |
| Risk contribution | `component`, `points` |
| `risk.formula` | `weights`, `thresholds` |
| Fact | `key`, `value`, `provenance`, `stale` |
| Provenance entry | `sourceUrl`, `fetchedAt` |
| `notes` | `githubTokenUsed`, `githubSkippedReason`, `omittedFacts` |
| Omitted fact | `key`, `reason` |

The `Maybe` order is one list shared by both variants. An available `Maybe` has `available` and `value`, so it emits `available`, `value`. An unavailable `Maybe` has no `value`, so it emits `available`, `source`, `attemptedUrl`, `attemptedAt`, `reason`, then `rateLimitResetAt` when present.

### Record keys that are sorted

Only these objects have their keys sorted by code point (list order inside them is kept, and `undefined` values are dropped), applied recursively:

- `risk.formula.weights`
- `risk.formula.thresholds`
- the `value` of a Fact (any shape)

The `value` of a `Maybe` (maintainers, scorecard, dependents, weekly downloads) is emitted as given, with no key sorting, apart from the vulnerability list and timestamp handling described here.

## Timestamps

Timestamps are truncated to whole seconds by removing fractional digits from a string of the form `YYYY-MM-DDTHH:mm:ss.fffZ`. A string that does not match that pattern (no fraction, or a non-`Z` offset) and any non-string value is left unchanged. Truncation applies to these fields only:

- `analysisDate`
- `timeOfDeath.value` (when available)
- `attemptedAt` of every `Maybe`
- `fetchedAt` of every provenance entry

It is not applied to `rateLimitResetAt` or to strings inside a Fact `value`. Provenance is truncated before it is sorted, so `fetchedAt` ties are decided on the truncated text.

## Deserialization

`deserialize(json)` in `src/engine/serialize/deserialize.ts` parses the JSON and validates it with the zod certificate schema. It returns the parsed value and does not sort lists or re-impose key order. For a certificate `c`, `deserialize(canonicalJson(c))` therefore equals the canonicalized form of `c` (same lists in the same order, timestamps already truncated). Calling `canonicalJson` on that value gives the same bytes as the first call. Malformed JSON or a missing or invalid field returns an error naming the field, and no partial certificate.
