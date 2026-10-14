---
"@0dotxyz/p0-ts-sdk": patch
---

`makeSwapCollateralTx` and `makeSwapDebtTx` swap through a pinned route (`swapOpts.swapIxs`) instead of ignoring it and re-quoting through the swap engine. A collateral swap's pinned route must be quoted for the withdrawal amount; a debt swap borrows what the route takes in and repays its minimum output. `resolvePinnedSwapRoute` takes the expected input as optional, and its result's `lookupTables` is renamed `swapLuts` to match the swap engine's result.
