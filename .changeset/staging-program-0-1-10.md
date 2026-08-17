---
"@0dotxyz/p0-ts-sdk": minor
---

Support marginfi program 0.1.10 (staging `stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct` / group `FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo`) with dual-program (0.1.9/0.1.10) operation. Full details in UPGRADE-0.1.10.md.

- Bundle the 0.1.10 IDL (built from `marginfi-v2@mrgn-0.1.10-rc1`) and regenerated types.
- 0.1.10 inserts required accounts into six instructions — a positional wire break in both directions. For the three the SDK executes or simulates (`makeEndFlashLoanIx`, `makeAccountTransferToNewAccountIx`, `makePulseHealthIx`), the builders inline-remove the inserted account while the target program still runs 0.1.9. The switch is the announced per-program upgrade timestamp (`MARGINFI_V0_1_10_ACTIVATION` in `src/dialect.ts`). No RPC, no caching.
- Sync (simulation-only) builders are not version-switched — they are used solely for size estimation and always emit the 0.1.10 layout (≤34-byte conservative overestimate against 0.1.9). Their changed builders gained required `group` / `feeState` account params (breaking for direct callers).
- New `OperationalState.CircuitBroken` bank state parsed instead of throwing; `BankConfigOptRaw` gains the 0.1.10 liquidation-fee and circuit-breaker fields (serialized as `null` until surfaced); appended `Option` args on admin instructions verified tolerated by the deployed 0.1.9 program.

**Action required before the mainnet upgrade:** the mainnet activation timestamp ships as a not-yet-scheduled sentinel; when the protocol announces the flip time, set it in `MARGINFI_V0_1_10_ACTIVATION` and publish a release — integrators must be on it before the flip.
