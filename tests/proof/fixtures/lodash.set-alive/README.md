# lodash.set (hand-written test fixture, not published)

This directory is a test fixture for Graveyard Shift. It is a hand-written minimal
resurrection of `lodash.set@4.3.2`, used to check the Proof of Life engine. It is not
published to npm.

- Base: `lodash.set@4.3.2` (MIT). The `LICENSE` text, `author`, `contributors` and
  `repository` are copied unchanged from the original package. Version is `4.3.3`.
- Only change: in `baseSet`, a path segment equal to `__proto__`, `constructor` or `prototype`
  makes `set` return the object unchanged at that point. Assignments for earlier segments stay.
- Guard source checked against lodash 4.17.20 `baseSet`:
  https://raw.githubusercontent.com/lodash/lodash/4.17.20/lodash.js (fetched 2026-11-15).
  The guard is the same check, placed right after the key conversion inside the loop.
- Exports are unchanged: `module.exports = set`, name `set`, length 3.
