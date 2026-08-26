---
"@0dotxyz/p0-ts-sdk": minor
---

Remove the temporary 0.1.9/0.1.10 dialect shim now that the mainnet program upgrade is final. The SDK unconditionally emits the 0.1.10 wire format.

- Deleted `src/dialect.ts` — `isMarginfiV0110Live` and `MARGINFI_V0_1_10_ACTIVATION` are no longer exported (they were internal to the upgrade window; no behaviour depends on them post-upgrade).
- Removed the six pre-flip account-splice checks in `instructions.ts` and `sync-instructions.ts` (`lending_account_end_flashloan`, `lending_account_pulse_health`, `transfer_to_new_account`), so `group` / `feeState` are always included.
- Deleted `UPGRADE-0.1.10.md`.
