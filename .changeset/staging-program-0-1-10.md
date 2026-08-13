---
"@0dotxyz/p0-ts-sdk": minor
---

Support marginfi program 0.1.10 (staging: `stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct`, group `FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo`).

- Bundle the 0.1.10 IDL (built from `marginfi-v2@mrgn-0.1.10-rc1`) and regenerated types; `MARGINFI_IDL` / `MarginfiIdlType` now point at 0.1.10.
- `lending_account_end_flashloan` and `lending_account_pulse_health` now require the `group` account; `transfer_to_new_account` (+ PDA variant) and `end_liquidation` now require the `fee_state` PDA. The Anchor-based builders resolve these automatically; the sync (simulation) builders take them as new required params, threaded through `makeEndFlashLoanIx` and friends.
- New `OperationalState.CircuitBroken` bank state (per-bank oracle circuit breaker) — parsed instead of throwing.
- `BankConfigOptRaw` gains the 0.1.10 liquidation-fee and circuit-breaker fields (serialized as `null` until surfaced in `BankConfigOpt`).

Breaking for callers of the sync `makeEndFlashLoanIx` / `makePulseHealthIx` / `makeAccountTransferToNewAccountIx` builders (new required accounts). Not compatible with the 0.1.9 mainnet program — keep 2.6.x for production until the mainnet upgrade lands.
