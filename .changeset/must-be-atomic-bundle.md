---
"@0dotxyz/p0-ts-sdk": patch
---

Expose `mustBeAtomicBundle: boolean` on the results of `makeLoopTx`, `makeSwapCollateralTx`, `makeSwapDebtTx`, and their bridged fallbacks (plus the shared `BridgedTxResult`). When `true`, the transactions must be sent as one atomic Jito bundle (integration refreshes go stale within a slot, or the flow is a bridged double-hop that must land together); when `false`, sequential sends are safe (cranked oracles tolerate ≥ ~1 min staleness). Lets callers pick the correct send path without inspecting the instruction set.
