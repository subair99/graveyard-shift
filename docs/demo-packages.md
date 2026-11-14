# Demo packages

Verified on npmjs.com, 14 Nov 2026. Re-check figures before recording the demo.

| Package | License | Status (npm, 14 Nov 2026) | Advisory | Planned fate |
|---|---|---|---|---|
| ip@2.0.1 | MIT | Last publish ~3 years ago; 8,475,341 weekly downloads; repo last push Aug 2024; fix PR #144 unmerged | CVE-2024-29415 (SSRF via isPublic), no fixed version | Resurrect (hero) |
| lodash.set@4.3.2 | MIT | Last publish ~10 years ago; 2,048,320 weekly downloads; 0 dependencies; 1,710 dependents; not deprecated | CVE-2020-8203 / GHSA-p6mc-m468-83gw, no fixed version for lodash.set | Resurrect |
| inflight@1.0.6 | ISC | Deprecated by author ("not supported, and leaks memory… Check out lru-cache"); last publish ~10 years ago; 124,503,079 weekly downloads; 2,510 dependents | Memory leak, no CVE | Rest in Peace (successor: lru-cache) |

## Declared deltas (the only allowed behavior changes)
- ip: isPublic / isPrivate / isLoopback classify the CVE-2024-29415 forms correctly
  (127.1, 01200034567, 012.1.2.3, 000:0:0000::01, ::fFFf:127.0.0.1, 0, 017700000001).
- lodash.set: path segments __proto__, constructor and prototype are ignored.

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