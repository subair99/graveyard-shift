# Sketch: resurrecting `ip`

Status: sketch only. Nothing is built. Sources are `certificates/ip.json` (analysis date 2026-11-15T19:03:19Z) and `RESULTS.md`. Anything not stated by those files is marked "to verify".

## Package facts (from RESULTS.md)

- `ip@2.0.1`, MIT, no runtime dependencies in the registry packument, `type` absent (CommonJS), `main` is `lib/ip`.
- `dist.unpackedSize` 15497 bytes, 3 files (a proxy for size, not a line count).
- Spike 6 marks it eligible.

## Advisories on the certificate

| Advisory ID | Open per certificate | Functions named | Source URL | Fetched |
|---|---|---|---|---|
| GHSA-2p57-rm9w-gvfp (alias CVE-2024-29415, severity HIGH) | yes (listed in `openVulnerabilityIds`) | `isPublic`, from the summary "ip SSRF improper categorization in isPublic" | https://api.osv.dev/v1/query | 2026-11-15T19:03:19Z |

- The certificate holds only the id, aliases, severity and a one-line summary. It has no advisory body text and no list of affected inputs.
- The summary names `isPublic`. It does not name `isPrivate`. The user states the advisory concerns `isPublic` and `isPrivate`; treat `isPrivate` as user-stated until the advisory text confirms it.
- An earlier journal entry records the OSV fixture for this advisory with `last_affected: 2.0.1` and no fixed version (`docs/kiro-journal.md`, fixture checks).
- Which input forms the advisory mentions: to verify (read the advisory text at the OSV or GitHub advisory page and record its URL and fetch date here).

## Harness preset sketch

The harness config is compiled deterministically. An LLM never writes executable harness code. A preset is a named, reviewed generator that the config refers to by name, and the compiler expands it into the same generator code every time.

An `ipString` generator would cover these forms. The "advisory mentions" column is "to verify" everywhere, because the certificate does not carry the advisory text.

| Form | Example string | Advisory mentions |
|---|---|---|
| Dotted decimal | `192.168.1.10` | to verify |
| Short (fewer than four parts) | `127.1`, `10.1` | to verify |
| Octal parts | `0177.0.0.1`, `010.0.0.1` | to verify |
| Hex parts | `0x7f.0.0.1`, `0x7f000001` | to verify |
| Single decimal integer | `2130706433` | to verify |
| IPv6 | `::1`, `fe80::1` | to verify |
| IPv4-mapped IPv6 | `::ffff:127.0.0.1` | to verify |

Illustrative config shape (not real code, field names are not decided):

```jsonc
// illustrative only
{
  "package": "ip",
  "functions": ["isPublic", "isPrivate"],
  "inputs": { "preset": "ipString" }
}
```

## Returns-expected deltas sketch

Differential testing compares the resurrected package with the original. Only inputs where the advisory says behavior should change are declared deltas. Everywhere else, the resurrected output must equal the original output.

| Delta | Advisory | Input class | Expected value | Status |
|---|---|---|---|---|
| D-ip-1 | GHSA-2p57-rm9w-gvfp | Inputs the advisory says `isPublic` categorizes wrongly (which forms: to verify) | What `isPublic` should return for that class: to verify | to verify |
| D-ip-2 | GHSA-2p57-rm9w-gvfp (user-stated) | Same class for `isPrivate` | to verify | to verify; not confirmed by the certificate |

Rules for filling this in:
- Each delta cites an advisory ID from the certificate.
- The expected value comes from the advisory text or from a documented rule (for example, a reserved range definition), with its source URL and fetch date.
- Input classes outside the deltas keep the original behavior, including the original's wrong results for inputs the advisory does not mention.

## Open questions

1. Which `ip` versions does the advisory cover? The OSV fixture says `last_affected: 2.0.1` and no fixed version (to verify against the advisory page).
2. Which input forms does the advisory text mention? This decides the generator and the deltas.
3. Does the fix change a return value for any input outside the advisory? If yes, that is a behavior change and must be declared or avoided.
4. The public API must not change: same export names, signatures and return shapes. Check the exports shape of `lib/ip` (names and which are functions) before and after.
5. The proof engine runs CommonJS packages only. `ip` is CommonJS per the packument; confirm by reading the tarball.
6. The proof engine requires no runtime dependencies. The packument shows none; confirm in the tarball's `package.json`.
7. Does the 5,000-line limit hold? Only `unpackedSize` (15497 bytes, 3 files) is known; measure the lines of the tarball.
8. Does `isPublic`/`isPrivate` depend on other functions in `ip` (for example parsing helpers), so that a fix touches more than two functions? To verify by reading the source.
9. Do the other advisories from the ecosystem (not on this certificate) apply to `ip`? The certificate lists only one.
