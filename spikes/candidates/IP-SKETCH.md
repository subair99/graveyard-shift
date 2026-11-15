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
- The summary names `isPublic`. It does not name `isPrivate`.
- An earlier journal entry records the OSV fixture for this advisory with `last_affected: 2.0.1` and no fixed version (`docs/kiro-journal.md`, fixture checks).

### Advisory text (checked by the user 15 Nov 2026; not fetched by the agent)

Sources: https://github.com/advisories/GHSA-2p57-rm9w-gvfp and https://nvd.nist.gov/vuln/detail/CVE-2024-29415. The user read both and pasted the text; the agent did not fetch either page.

- The advisory says the `ip` package through 2.0.1 "might allow SSRF" because some addresses are "improperly categorized as globally routable via isPublic".
- It lists these example addresses: `127.1`, `01200034567`, `012.1.2.3`, `000:0:0000::01`, `::fFFf:127.0.0.1`.
- It adds a note that the issue exists because of an "incomplete fix for CVE-2023-42282".
- The advisory names only `isPublic`. It does not name `isPrivate` or `isLoopback`.
- The GitLab advisory database says no fixed version exists. This is user-stated; the agent has not verified it.

## Harness preset sketch

The harness config is compiled deterministically. An LLM never writes executable harness code. A preset is a named, reviewed generator that the config refers to by name, and the compiler expands it into the same generator code every time.

An `ipString` generator would cover these forms. The "advisory mentions" column comes from the advisory text above.

| Form | Example string | Advisory mentions |
|---|---|---|
| Dotted decimal | `192.168.1.10` | no example in the advisory text |
| Short (fewer than four parts) | `127.1`, `10.1` | yes: `127.1` |
| Octal integer | `01200034567` | yes: `01200034567` |
| Octal dotted | `012.1.2.3`, `0177.0.0.1`, `010.0.0.1` | yes: `012.1.2.3` |
| Hex parts | `0x7f.0.0.1`, `0x7f000001` | no; to verify (the advisory text does not mention hex) |
| Single decimal integer | `2130706433` | no example in the advisory text |
| IPv6 with zero compression | `000:0:0000::01`, `::1`, `fe80::1` | yes: `000:0:0000::01` |
| IPv4-mapped IPv6 | `::fFFf:127.0.0.1`, `::ffff:127.0.0.1` | yes: `::fFFf:127.0.0.1` |

Illustrative config shape (not real code, field names are not decided):

```jsonc
// illustrative only
{
  "package": "ip",
  "functions": ["isPublic"],
  "inputs": { "preset": "ipString" }
}
```

## Returns-expected deltas sketch

Differential testing compares the resurrected package with the original. Only inputs where the advisory says behavior should change are declared deltas. Everywhere else, the resurrected output must equal the original output.

| Delta | Advisory | Function and input | Expected value | Status |
|---|---|---|---|---|
| D-ip-1 | GHSA-2p57-rm9w-gvfp | `isPublic("127.1")` | `false` | from advisory text (user-checked) |
| D-ip-2 | GHSA-2p57-rm9w-gvfp | `isPublic("01200034567")` | `false` | from advisory text (user-checked) |
| D-ip-3 | GHSA-2p57-rm9w-gvfp | `isPublic("012.1.2.3")` | `false` | from advisory text (user-checked) |
| D-ip-4 | GHSA-2p57-rm9w-gvfp | `isPublic("000:0:0000::01")` | `false` | from advisory text (user-checked) |
| D-ip-5 | GHSA-2p57-rm9w-gvfp | `isPublic("::fFFf:127.0.0.1")` | `false` | from advisory text (user-checked) |

The table is illustrative, not code to build. The expected value `false` comes from the advisory's wording: these addresses are "improperly categorized as globally routable via isPublic", so `isPublic` should not report them as public. Source URLs: https://github.com/advisories/GHSA-2p57-rm9w-gvfp and https://nvd.nist.gov/vuln/detail/CVE-2024-29415, checked by the user 15 Nov 2026.

Only these five inputs are deltas. For every other input, and for every other function, the resurrection must match the original, including the original's wrong results for inputs the advisory does not mention.

Rules for adding more deltas:
- Each delta cites an advisory ID from the certificate.
- The expected value comes from the advisory text or from a documented rule (for example, a reserved range definition), with its source URL and fetch date.
- Input classes outside the deltas keep the original behavior, including the original's wrong results for inputs the advisory does not mention.

## To verify (secondary sources only)

- `isPrivate`: the advisory text does not name it. Whether it has the same problem is not established.
- `isLoopback`: same; not named by the advisory text.

These two come from secondary sources only. Nothing here claims the advisory covers them. Until confirmed, they have no deltas and must match the original.

## To verify (advisory follow-ups)

- (a) What the Original actually returns for `isPublic` on each of the five addresses. Run it in the spike later; do not assume it returns `true`.
- (b) Whether CVE-2023-42282 is fixed in `ip@2.0.1`.
- (c) The GitLab "no fixed version" claim is user-stated and unverified by the agent.

## Open questions

1. Which `ip` versions does the advisory cover? The advisory text says "through 2.0.1" and the OSV fixture says `last_affected: 2.0.1` with no fixed version.
2. Which input forms beyond the five examples (for example hex) are affected? The advisory text mentions only the five examples; hex stays to verify.
3. Does the fix change a return value for any input outside the advisory? If yes, that is a behavior change and must be declared or avoided.
4. The public API must not change: same export names, signatures and return shapes. Check the exports shape of `lib/ip` (names and which are functions) before and after.
5. The proof engine runs CommonJS packages only. `ip` is CommonJS per the packument; confirm by reading the tarball.
6. The proof engine requires no runtime dependencies. The packument shows none; confirm in the tarball's `package.json`.
7. Does the 5,000-line limit hold? Only `unpackedSize` (15497 bytes, 3 files) is known; measure the lines of the tarball.
8. Does `isPublic` depend on other functions in `ip` (for example parsing helpers), so that a fix touches more than one function? To verify by reading the source.
9. Do the other advisories from the ecosystem (not on this certificate) apply to `ip`? The certificate lists only one.
