---
"@0dotxyz/p0-ts-sdk": patch
---

`computeHealthComponentsFromBalances` (and the free-collateral and simulation-fallback helpers built on it) no longer drop positions it can't value. A debt without an oracle price, or a balance whose bank isn't in `banksMap`, now throws instead of being skipped with a console warning, which made the account look healthier than it is. A deposit without a price still counts as 0, as the program values it. `Project0Client` prices every bank, so its own calls are unaffected; callers that build their own price map from a subset of banks may now see the error.
