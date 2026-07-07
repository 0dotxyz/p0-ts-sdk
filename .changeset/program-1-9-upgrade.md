---
"@0dotxyz/p0-ts-sdk": minor
---

Upgrade to marginfi program v0.1.9.

- **Staked Collateral (SVSP) transition:** new bank flags (`STAKED_ORACLE_DISABLED_FLAG`, `STAKED_ORACLE_USES_ONRAMP_FLAG`) and instructions (`disableStakedOracles`, `enableStakedOracleOnramp`, `lendingPoolBackfillStakedBankValidatorVoteAccount`) for dynamic handling of staked-collateral oracles incl. SPL single-pool on-ramp pricing.
- **Enhanced admin controls:** `adminCloseAccount` for cleaning inactive user accounts, `superAdminDeposit`/`superAdminWithdraw` for direct liquidity management, and a `pauseDelegateAdmin` role on `FeeState`.
- **Group-level rate limiting:** USD-denominated net-outflow limits applied across all withdraw and borrow operations, requiring updated oracle account handling in transactions.
- **Emissions:** removed `lendingAccountClearEmissions` — emissions are now fully off-chain managed.
- **Integrations:** Kamino and JupLend adjusted for new instruction flags and `Uninitialized` account states.
- **Indexer support:** new `indexerFlags` on `MarginfiAccount` for off-chain indexing.

IDL regenerated (`marginfi-types_0.1.9.ts`, `marginfi_0.1.9.json`); the 0.1.8 IDL has been removed.
