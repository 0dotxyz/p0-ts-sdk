---
"@0dotxyz/p0-ts-sdk": patch
---

Support caller-pinned swap routes in `loop`, `swapCollateral`, and `swapDebt`:

- Introduces `resolvePinnedSwapRoute` — a pinned `swapOpts.swapIxs` now carries its quote's `otherAmountThreshold` through the pipeline so the deposit byte-patch is sized like an engine-selected route (no more silent zero-collateral deposits).
- Bridged fallback (`makeBridgedLoopTx`, `makeBridgedSwapCollateralTx`, `makeBridgedSwapDebtTx`) now short-circuits when a pinned route is provided — pinned routes belong to the direct pair and cannot be spliced into SDK-composed legs.
