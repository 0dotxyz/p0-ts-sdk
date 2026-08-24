---
"@0dotxyz/p0-ts-sdk": patch
---

Fix "The given account did not sign" on flashloans built via the sync instruction path (repay-with-collateral, swap-debt) while mainnet still runs program 0.1.9.

The 0.1.9/0.1.10 dialect gate (`isMarginfiV0110Live`) was applied to the Anchor builders in `instructions.ts` but not to their duplicates in `sync-instructions.ts`, which since 2.7.0 unconditionally emitted the 0.1.10 wire format. For `lending_account_end_flashloan` this placed `group` in the slot where 0.1.9 expects the `authority` signer. The sync builders for end-flashloan, pulse-health, and transfer-to-new-account now strip the 0.1.10-inserted account until the per-program activation timestamp, matching the async builders.
