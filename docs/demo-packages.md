# Demo packages

Verified on npmjs.com, 14 Nov 2026. Re-check figures before recording the demo.

| Package | License | Status (npm, 14 Nov 2026) | Advisory | Planned fate |
|---|---|---|---|---|
| ip@2.0.1 | MIT | Last publish ~3 years ago; 8,475,341 weekly downloads; repo last push Aug 2024; fix PR #144 unmerged | CVE-2024-29415 (SSRF via isPublic), no fixed version | Resurrect (hero). Stays in the demo: the Original returns `true` for all five advisory addresses (measured 2026-11-16). Stub run alive in CI run 43874004948 (see "Pipeline runs") |
| lodash.set@4.3.2 | MIT | Last publish ~10 years ago; 2,048,320 weekly downloads; 0 dependencies; 1,710 dependents; not deprecated | CVE-2020-8203 / GHSA-p6mc-m468-83gw, no fixed version for lodash.set | Resurrect. Stub run alive in CI run 43847482329 (see "Pipeline runs") |
| inflight@1.0.6 | ISC | Deprecated by author ("not supported, and leaks memory… Check out lru-cache"); last publish ~10 years ago; 124,503,079 weekly downloads; 2,510 dependents | Memory leak, no CVE | Rest in Peace (successor: lru-cache). Not-resurrected entry merged as PR #6 (`graveyard/inflight`, 2026-11-16) |

The npm figures above were read on 14 Nov 2026 and were not re-read since. The ip, lodash.set and inflight pipeline facts are from the Journal entries named in "Pipeline runs".

## Declared deltas (the only allowed behavior changes)
- ip: one delta, of the kind `returns-expected-class`, for the function `isPublic` only (decision A9: only `isPublic` and the five advisory addresses are advisory-backed; no delta for `isPrivate` or `isLoopback`). The class is `non-public-address` (the input parses and its canonical form is in a range that `isPrivate` of ip@2.0.1 treats as private or loopback), the expected value is `false`, and the explicit cases are the five Advisory_Addresses: `127.1`, `01200034567`, `012.1.2.3`, `000:0:0000::01`, `::fFFf:127.0.0.1` (advisory: https://github.com/advisories/GHSA-2p57-rm9w-gvfp and https://nvd.nist.gov/vuln/detail/CVE-2024-29415, user-checked 15 Nov 2026 per the Journal). A call that the class selects must return `false`; a call outside the class is compared against the Original (decision A18). Measured on the Original ip@2.0.1 (2026-11-16, `docs/measurements/ip-2.0.1.json`; Journal, "2026-11-16: ip@2.0.1 tarball and isPublic measurement"): `isPublic` returned `true` for all five. The informational inputs `0` and `017700000001` also returned `true` on the Original and are not declared and never become explicit cases. The measurement ran on the local Windows Node v26.13.1, not on the CI pin.
- lodash.set: for a path that contains `__proto__`, `constructor` or `prototype` as a segment, the resurrected `set` must not modify Object.prototype (or other built-in prototypes). It stops at the offending segment and returns the object, so assignments for earlier segments stay (as `baseSet` does in lodash 4.17.20; source: https://raw.githubusercontent.com/lodash/lodash/4.17.20/lodash.js, fetched 2026-11-15). For example, `set({}, 'a.__proto__.x', 1)` returns `{ a: {} }`.

## Pipeline runs
- lodash.set: stub run alive in CI run 43847482329 (Journal, "2026-11-16: Step (c) observations, user-run in the WSL clone", M5 and M6). A stub run uses the committed stub fixture, not Medium output.
- ip: stub run alive in CI run 43874004948, seed 693577894, all 20 exports tested, declared delta `is-public-advisory` demonstrated (Journal, "2026-11-16: task 12.9 (M12), ip stub run, second attempt"). Stub, not Medium output. The first attempt (run 43867172769) was restless on `isPublic(":::")`, was not attested and is recorded in the Journal.
- inflight: not resurrected; the not-resurrected entry was merged in PR #6 (Journal, "2026-11-16: First real Crypt entry, M10 done").
- Both stub pull requests (PR #1, PR #3) were closed unmerged, as recorded in the Journal.

## Alternatives (shown honestly on each Death Certificate)
- ip: community security fork @eggjs/ip. Resurrection targets transitive use via npm overrides.
- lodash.set: the full lodash package (patched since 4.17.19). Resurrection keeps the zero-dependency single-function package.

## Notes
- ip.address() reads network interfaces; stub os.networkInterfaces() in differential tests.

## Sources
- https://www.npmjs.com/package/ip
- https://www.npmjs.com/package/lodash.set
- https://www.npmjs.com/package/inflight
- https://security.snyk.io/vuln/SNYK-JS-IP-7148531
- https://security.snyk.io/vuln/SNYK-JS-LODASHSET-1320032
- https://github.com/advisories/GHSA-p6mc-m468-83gw