---
"@0dotxyz/p0-ts-sdk": minor
---

marginfi 0.1.12 audit fixes:

- **PT roll:** `makeRollPtTx` now refreshes every Kamino/Drift/JupLend bank the account holds before the flashloan and returns `mustBeAtomicBundle`. With premium-bearing debt, 0.1.12's `end_flashloan` reverts (6615) when any collateral can't be priced, so rolls for accounts holding integration collateral failed before.
- **Kamino emergency:** new `BankType.kaminoEmergency` (bank flags bit 14, exported as `KAMINO_MARKET_EMERGENCY_FLAG`, OR'd with the reserve's new `KaminoReserveConfig.emergencyMode` where the bank is joined with its reserve; `Project0Client` does this). `getAssetWeight` gives such banks zero initial weight, as the program does, so initial health, max borrow and max withdraw no longer overstate borrowing power during an emergency. **Breaking (BankType/KaminoReserve constructors):** both fields are required; DTOs default them to `false` / `0`.
- **Costly position limit:** deposit builders (`makeDepositTx`, `makeKaminoDepositTx`, `makeDriftDepositTx`, `makeJuplendDepositTx`), `makeLoopTx` and `makeSwapCollateralTx` throw `COSTLY_POSITION_LIMIT_EXCEEDED` when the deposit would open a 5th integration or staked position (0.1.12 limit; on-chain error 6073). `makeTransferPositionsTx` rejects a selection that leaves the destination over the limit with `TRANSFER_POSITIONS_INVALID_SELECTION`. New `exceedsCostlyPositionLimit` / `isCostlyBank` helpers and `MAX_COSTLY_POSITIONS` constant.
- **Venue refresh:** the Kamino/Drift/JupLend refresh helpers throw `KAMINO_RESERVE_NOT_FOUND` / `DRIFT_STATE_NOT_FOUND` / `JUPLEND_STATE_NOT_FOUND` when a bank's state is missing from `bankMetadataMap`, instead of silently skipping the refresh (which left the premium refresh a no-op and made borrows revert with 6615).
- **Transfer:** `makeAccountTransferToNewAccountTx` throws `ACCOUNT_DISABLED` for disabled accounts.
- **Breaking (admin builders):** match the 0.1.12 governance split.
  - `makePoolConfigureBankIx` (instructions, group service, `MarginfiGroup`) takes `BankConfigFastRaw`; it previously took `BankConfigOptRaw` and silently dropped every governance field. New `makePoolConfigureBankGovIx` takes `BankConfigGovRaw` (weights, risk tier, asset tag, oracle limits, tokenless repayments, freeze), signed by the governance admin.
  - `freezeBankConfigIx(program, bank)` sends `configure_bank_gov`; it was a no-op and drops its unused `bankConfigOpt` param.
  - The `admin` override on add-bank, configure-oracle, configure-oracle-scope and set-oracle-price is renamed `governanceAdmin` (`adminAddress` → `governanceAdminAddress` in the bank service); the old name was ignored by Anchor.
  - `configureScopeOracleIx` / `makeLendingPoolConfigureBankOracleScopeIx` take `integrationAccount` (Kamino reserve or JupLend lending) for ScopeKamino/ScopeJuplend banks; `addOracleToBanksIx` rejects those setups like `Scope`.
  - Removes the simulation-only sync admin builders (`makeGroupInitIx`, `makePoolConfigureBankIx`, `makeLendingPoolConfigureBankOracleIx`, `makeLendingPoolConfigureBankOracleScopeIx`, `makePoolAddBankIx` in `sync-instructions`), which were invalid against 0.1.12 and unused.
