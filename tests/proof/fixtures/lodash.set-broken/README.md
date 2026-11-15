# lodash.set (DELIBERATELY BROKEN test fixture)

This package is a deliberately broken copy of `lodash.set@4.3.2`, used only by the Graveyard Shift Proof of Life tests to produce a `restless` verdict. **Never publish it.**

Differences from the original:

- It ignores assignments through `__proto__`, `constructor` and `prototype` (same guard as the alive fixture).
- It creates `{}` instead of `[]` for a missing container when the next path segment is a numeric index, so `set({}, 'a[0]', 1)` returns `{ a: { '0': 1 } }` instead of `{ a: [1] }`.

License and author credits are preserved from the original (MIT, John-David Dalton and contributors, see `LICENSE` and `package.json`).
