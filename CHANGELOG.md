# Changelog

## 2.5.5-alpha.4

### Patch Changes

- Consolidate integration refreshes and bulk tx building across account actions. Introduces two new price actions (`oracle-update`, `refresh-integration-banks`) and reworks `borrow`, `withdraw`, `repay`, `loop`, `swap-collateral`, `swap-debt`, `bridge-swap`, `flash-loan`, `bulk`, `transfer-positions`, and `account-lifecycle` to share common refresh/projection logic. Reduces duplication and improves consistency of transaction projections.

## 2.5.5-alpha.3

### Patch Changes

- chore: add bulk tx action builders to sdk

## 2.5.5-alpha.2

### Patch Changes

- fix: stale-price for debt-moving

## 2.5.5-alpha.1

### Patch Changes

- chore: fix kamino obligation refresh

## 2.5.5-alpha.0

### Patch Changes

- Add `transferPositions` account action: move deposit and/or borrow positions from one marginfi account to another in a single transaction, with Kamino/JupLend integration support. Includes new transaction-building error types and comprehensive tests.

## 2.5.4

### Patch Changes

- Add new `EmodeTag` variants: `SOL_T2` (502), `HYUSD` (47050), and `PT_HYUSD` (8747), with corresponding `parseEmodeTag` cases in the bank deserializer.

## 2.5.3

### Patch Changes

- Swap engine: Jupiter adapter now requests routes with `forJitoBundle: true`, preventing the router from selecting DEXes whose swap instructions lock vote accounts (which Jito rejects with "bundles cannot lock any vote accounts"). Ensures Jupiter swaps executed inside a Jito bundle land reliably.

## 2.5.2

### Patch Changes

- 59cb37d: chore: rename birdeye fallback to generic naming

## 2.5.2-alpha.0

### Patch Changes

- chore: rename birdeye fallback to generic naming

## 2.5.1

### Patch Changes

- Add eMode support to smart cranking.

## 2.5.0

### Minor Changes

- cbedc5d: Upgrade to marginfi program v0.1.9.
  - **Staked Collateral (SVSP) transition:** new bank flags (`STAKED_ORACLE_DISABLED_FLAG`, `STAKED_ORACLE_USES_ONRAMP_FLAG`) and instructions (`disableStakedOracles`, `enableStakedOracleOnramp`, `lendingPoolBackfillStakedBankValidatorVoteAccount`) for dynamic handling of staked-collateral oracles incl. SPL single-pool on-ramp pricing.
  - **Enhanced admin controls:** `adminCloseAccount` for cleaning inactive user accounts, `superAdminDeposit`/`superAdminWithdraw` for direct liquidity management, and a `pauseDelegateAdmin` role on `FeeState`.
  - **Group-level rate limiting:** USD-denominated net-outflow limits applied across all withdraw and borrow operations, requiring updated oracle account handling in transactions.
  - **Emissions:** removed `lendingAccountClearEmissions` — emissions are now fully off-chain managed.
  - **Integrations:** Kamino and JupLend adjusted for new instruction flags and `Uninitialized` account states.
  - **Indexer support:** new `indexerFlags` on `MarginfiAccount` for off-chain indexing.

  IDL regenerated (`marginfi-types_0.1.9.ts`, `marginfi_0.1.9.json`); the 0.1.8 IDL has been removed.

## 2.5.0-alpha.0

### Minor Changes

- Upgrade to marginfi program v0.1.9.
  - **Staked Collateral (SVSP) transition:** new bank flags (`STAKED_ORACLE_DISABLED_FLAG`, `STAKED_ORACLE_USES_ONRAMP_FLAG`) and instructions (`disableStakedOracles`, `enableStakedOracleOnramp`, `lendingPoolBackfillStakedBankValidatorVoteAccount`) for dynamic handling of staked-collateral oracles incl. SPL single-pool on-ramp pricing.
  - **Enhanced admin controls:** `adminCloseAccount` for cleaning inactive user accounts, `superAdminDeposit`/`superAdminWithdraw` for direct liquidity management, and a `pauseDelegateAdmin` role on `FeeState`.
  - **Group-level rate limiting:** USD-denominated net-outflow limits applied across all withdraw and borrow operations, requiring updated oracle account handling in transactions.
  - **Emissions:** removed `lendingAccountClearEmissions` — emissions are now fully off-chain managed.
  - **Integrations:** Kamino and JupLend adjusted for new instruction flags and `Uninitialized` account states.
  - **Indexer support:** new `indexerFlags` on `MarginfiAccount` for off-chain indexing.

  IDL regenerated (`marginfi-types_0.1.9.ts`, `marginfi_0.1.9.json`); the 0.1.8 IDL has been removed.

## 2.4.2

### Patch Changes

- **Breaking (jup-lend DTO consumers):** trim curated jup-lend types and DTOs to the fields actually consumed, mirroring the klend curation. `JupTokenReserve`/`JupTokenReserveJSON` drop `mint`, `vault`, `lastUpdateTimestamp`, `maxUtilization`, `totalClaimAmount`, `interactingProtocol`, `interactingTimestamp`, `interactingBalance`; `JupRateModel`/`JupRateModelJSON` drop `pubkey`, `mint`; `JupLendingRewardsRateModel`/`JupLendingRewardsRateModelJSON` drop `pubkey`, `mint`, `nextDuration`, `nextRewardAmount` (and optional `bump`). Raw types and decoders are unchanged; raw remains structurally assignable to curated. `JupLendingState` is untouched.

## 2.4.1

### Patch Changes

- Widen curated Kamino types with fields consumed downstream: `KaminoReserveConfig.depositLimit` / `borrowLimit` and `KaminoFarmRewardInfo.rewardsAvailable` (plus their JSON DTO mirrors and converter mappings).
- `dtoToKaminoObligation` now tolerates DTOs with pruned empty `deposits`/`borrows` arrays (hosted integration endpoints omit them), defaulting to `[]`.

## 2.4.0

### Minor Changes

- **Breaking (Kamino/klend raw state consumers):** Refactor Kamino integration — raw klend obligation, reserve, and farm DTO types have been restructured. Consumers accessing `dto-obligation.types`, `dto-reserve.types`, or `dto-farm.types` directly must migrate to the new type shapes. High-level SDK actions (deposit, borrow, loop, etc.) are unaffected.

  Includes klend serializer/deserializer cleanup (-1300 lines), separated raw vs. domain types for obligations/reserves/farms, updated interest-rate and reward utilities, and added klend serialize tests.

## 2.3.3

### Patch Changes

- Add bridge utilities (`bridge.utils.ts`) and swap-collateral / swap-debt example scripts (`10-swap-collateral.ts`, `11-swap-debt.ts`). Includes flashloan-size helpers, bank-metrics updates, and a new `TransactionBuildingError` class.

## 2.3.2

### Patch Changes

- Add `fetchMintHolders` client method to query all accounts holding a given mint. Includes bank caps support with updated bank types (raw, DTO, model), deserializer/serializer updates, and an example script (`18-mint-holders.ts`).

## 2.3.1

First stable release of the 2.3 line, consolidating the `2.3.0-alpha.0` → `2.3.0-alpha.9` cycle. (`2.3.0` was burned on npm — published and unpublished before the alpha cycle began — so the stable ships as `2.3.1`.) Highlights:

- **Multi-provider swap engine** — flashloan flows (loop, swap-collateral, swap-debt, repay-with-collateral) now fan out across Titan Swap V3 and the Jupiter Router in parallel and pick the best-output route that fits the flashloan budget.
- **PT roll-up** — roll an existing Exponent PT position into a longer-dated PT in a single transaction, driving the Exponent CLMM directly.
- **Bridge / double-hop swaps** — `composeBridgedSwap` / `mergeBridgeQuotes` for collateral and loop-deposit flows.
- **Reliability** — LUT groups for smaller, more reliable transactions, Titan native-SOL wrap/unwrap handling, `noVoteAccounts` routing control, and removal of jitoDontFront accounts that break Jito bundles.

### Minor Changes

- 3ed4c1c: Add bridge/double-hop swap composer (`composeBridgedSwap`, `mergeBridgeQuotes`) for collateral and loop-deposit flows. Also removes jitoDontFront accounts from Titan swap routes before signing.
- 5b9557b: Add a multi-provider swap engine for flashloan flows (loop, swap-collateral, swap-debt).
  - New `services/account/swap-engine` module: `runSwapEngine` fans out to all configured
    providers in parallel (Titan Swap V3 + Jupiter Router `/swap/v2/build` at a maxAccounts
    ladder), keeps only routes that fit the remaining flashloan budget, and returns the
    highest-output route. Adding a provider = one adapter + one registry entry.
  - Titan upgraded to Swap V3 with a full-footprint `transactionTemplate` for precise route
    sizing (`vendor/titan/gateway.ts`); Jupiter upgraded from Metis to the Router `/build`
    endpoint (`vendor/jupiter`).
  - `makeLoopTx` / `makeSwapCollateralTx` / `makeSwapDebtTx` route their swap through the
    engine. They accept an optional `swapEngineRunner` (default in-process) so the provider
    fan-out can be executed server-side; `serialize*`/`deserialize*` helpers support that seam.
  - `makeLoopTx` `depositOpts`/`borrowOpts` now require `marketPrice` (USD/UI) to seed the
    pre-swap deposit estimate.
  - All four flashloan-swap flows (loop, swap-collateral, swap-debt, repay-with-collateral)
    route through the engine and accept `swapEngineRunner`.
  - **Removed provider ExactOut.** Jupiter Router `/build` is ExactIn-only and provider
    ExactOut quotes are unreliable, so swap-debt now sizes the borrow from a market-price
    calculation (`repayOpts`/`borrowOpts.marketPrice`) and routes ExactIn. The engine's
    ExactOut path + provider ExactOut adapter methods are removed; `getExactOutEstimate` /
    `getTitanExactOutEstimate` are deprecated.

- a8e3d72: Add PT roll-up support: roll an existing Exponent PT position into a longer-dated PT in a single transaction. Includes Exponent `strip` instruction wiring, expanded market/vault/strip type coverage, additional resolve utilities, and example scripts (`15-roll-pt.ts`, `17-roll-pt-strip-simulate.ts`, `create-pt-roll-lut.ts`).

### Patch Changes

- 976b6f8: Add the Exponent vendor IDL and PT rollover scaffolding (foundation for PT roll-up).
- 2468735: Fix `resolveExponentMergeContext` so the PT merge context resolves correctly.
- 0a2748e: Implement LUT groups: deposit, borrow, withdraw, and repay actions now select address-lookup-table entries by group, reducing transaction size and improving account-loading reliability.
- 43b1c0c: PT roll-up now drives the Exponent CLMM directly (vendor IDL + instruction wiring) instead of routing through an intermediate swap, removing an extra round-trip and improving reliability.
- 4ae9a66: PT roll-up now routes through the multi-provider swap engine (Titan + Jupiter) instead of Jupiter-only.
- 1872175: Add `noVoteAccounts` parameter to Titan swap requests to exclude vote accounts from routing.
- ee9e014: Fix Titan swap adapter: add SOL unwrapping and wrapping around Titan swaps so native-SOL input/output is handled correctly.

## 2.3.0-alpha.9

### Patch Changes

- Add `noVoteAccounts` parameter to Titan swap requests to exclude vote accounts from routing.

## 2.3.0-alpha.8

### Minor Changes

- Add bridge/double-hop swap composer (`composeBridgedSwap`, `mergeBridgeQuotes`) for collateral and loop-deposit flows. Also removes jitoDontFront accounts from Titan swap routes before signing.

## 2.3.0-alpha.7

### Patch Changes

- Fix Titan swap adapter: add SOL unwrapping and wrapping around Titan swaps so native-SOL input/output is handled correctly.

## 2.3.0-alpha.6

### Patch Changes

- Implement LUT groups: deposit, borrow, withdraw, and repay actions now select address-lookup-table entries by group, reducing transaction size and improving account-loading reliability.

## 2.3.0-alpha.5

### Patch Changes

- PT roll-up now drives the Exponent CLMM directly (vendor IDL + instruction wiring) instead of routing through an intermediate swap, removing an extra round-trip and improving reliability.

## 2.3.0-alpha.4

### Patch Changes

- PT roll-up now routes through the multi-provider swap engine (Titan + Jupiter) instead of Jupiter-only.

## 2.3.0-alpha.3

### Minor Changes

- Add PT roll-up support: roll an existing Exponent PT position into a longer-dated PT in a single transaction. Includes Exponent `strip` instruction wiring, expanded market/vault/strip type coverage, additional resolve utilities, and example scripts (`15-roll-pt.ts`, `17-roll-pt-strip-simulate.ts`, `create-pt-roll-lut.ts`).

## 2.3.0-alpha.2

### Patch Changes

- fix:resolveExponentMergeContext

## 2.3.0-alpha.1

### Patch Changes

- exponent vendor & pt rollover

## 2.3.0-alpha.0

### Minor Changes

- 5b9557b: Add a multi-provider swap engine for flashloan flows (loop, swap-collateral, swap-debt).
  - New `services/account/swap-engine` module: `runSwapEngine` fans out to all configured
    providers in parallel (Titan Swap V3 + Jupiter Router `/swap/v2/build` at a maxAccounts
    ladder), keeps only routes that fit the remaining flashloan budget, and returns the
    highest-output route. Adding a provider = one adapter + one registry entry.
  - Titan upgraded to Swap V3 with a full-footprint `transactionTemplate` for precise route
    sizing (`vendor/titan/gateway.ts`); Jupiter upgraded from Metis to the Router `/build`
    endpoint (`vendor/jupiter`).
  - `makeLoopTx` / `makeSwapCollateralTx` / `makeSwapDebtTx` route their swap through the
    engine. They accept an optional `swapEngineRunner` (default in-process) so the provider
    fan-out can be executed server-side; `serialize*`/`deserialize*` helpers support that seam.
  - `makeLoopTx` `depositOpts`/`borrowOpts` now require `marketPrice` (USD/UI) to seed the
    pre-swap deposit estimate.
  - All four flashloan-swap flows (loop, swap-collateral, swap-debt, repay-with-collateral)
    route through the engine and accept `swapEngineRunner`.
  - **Removed provider ExactOut.** Jupiter Router `/build` is ExactIn-only and provider
    ExactOut quotes are unreliable, so swap-debt now sizes the borrow from a market-price
    calculation (`repayOpts`/`borrowOpts.marketPrice`) and routes ExactIn. The engine's
    ExactOut path + provider ExactOut adapter methods are removed; `getExactOutEstimate` /
    `getTitanExactOutEstimate` are deprecated.

## 2.2.7

### Patch Changes

- Update staked bank metadata.

## 2.2.6

### Patch Changes

- Update referral key

## 2.2.5

### Patch Changes

- be817ef: Align the off-chain health calculation with the on-chain program's risk engine.
  - ReduceOnly banks now contribute 0 asset value to the **Initial** requirement (Maintenance/Equity unchanged), matching the program. Fixes inflated available collateral for accounts holding ReduceOnly collateral.
  - Isolated risk-tier banks now contribute 0 asset value for all requirement types.
  - Price type is now derived purely from the requirement type (`isWeightedPrice` returns true for Initial **and** Equity), mirroring the program's `RequirementType::get_oracle_price_type`. Equity health-cache values now use the time-weighted price and the conservative confidence bias (Lowest for assets, Highest for liabilities), matching the program.

  Removed the divergent, unbiased equity aggregate helper:
  - `computeHealthComponentsWithoutBiasFromBalances` (function and the `ComputeHealthComponentsWithoutBiasParams` type)
  - `MarginfiAccount.computeHealthComponentsWithoutBiasFromBalances` (model method)

  Use `computeHealthComponentsFromBalances` for program-faithful (biased) health values, or `computeBalanceUsdValue` for per-balance neutral/mid-price display values.

## 2.2.5-alpha.0

### Patch Changes

- Align the off-chain health calculation with the on-chain program's risk engine.
  - ReduceOnly banks now contribute 0 asset value to the **Initial** requirement (Maintenance/Equity unchanged), matching the program. Fixes inflated available collateral for accounts holding ReduceOnly collateral.
  - Isolated risk-tier banks now contribute 0 asset value for all requirement types.
  - Price type is now derived purely from the requirement type (`isWeightedPrice` returns true for Initial **and** Equity), mirroring the program's `RequirementType::get_oracle_price_type`. Equity health-cache values now use the time-weighted price and the conservative confidence bias (Lowest for assets, Highest for liabilities), matching the program.

  Removed the divergent, unbiased equity aggregate helper:
  - `computeHealthComponentsWithoutBiasFromBalances` (function and the `ComputeHealthComponentsWithoutBiasParams` type)
  - `MarginfiAccount.computeHealthComponentsWithoutBiasFromBalances` (model method)

  Use `computeHealthComponentsFromBalances` for program-faithful (biased) health values, or `computeBalanceUsdValue` for per-balance neutral/mid-price display values.

## 2.2.4

### Patch Changes

- f4d23a1: perf(emode): ~80-100x faster emode impact computation

  Refactored `computeEmodeImpacts` and `computeActiveEmodePairs` to operate on
  base58 string `Set`/`Map` lookups instead of `PublicKey.equals()` / `.toBase58()`
  in hot loops, and hoisted the configured-pair index out of the per-bank/per-action
  simulation loop (previously rebuilt ~800x per call). Output is byte-identical to
  the previous implementation (validated by `scripts/emode-bench.ts`) and all public
  signatures are unchanged, so consumers need no code changes.

- - Isolate unmaintained SDK into a separate `vendor` folder
  - Export Jupiter vendor for app consumers and add Jupiter bundle flag
  - Refactor emode to use string keys for performance
  - Add mrgn SDK → p0 SDK account transfer functionality
  - Remove `emode-bench` script

## 2.2.3

### Patch Changes

- - Configure Crossbar API with new env vars
  - Export Jupiter Lend IDL from `vendor/jup-lend/idl`

## 2.2.2

### Patch Changes

- - Update fee wallet address
  - Add ctoken conversion in transaction projection for Drift and Jupiter
  - Publish `instructions` subpath via package exports and tsup config

## 2.2.1

### Patch Changes

- Remove `isSync` boolean from collateral swap flow.

## 2.2.0

### Minor Changes

- 2947bee: - Add bank metrics calculation utilities (`src/services/bank/utils/bank-metrics.utils.ts`).
  - Expose dummy account creation function from `account-lifecycle`.
- 804738b: Rebase onto latest main. Update GitHub CI workflows to use pnpm and Node 22, remove unused docs and publish workflows.
- 1057a2a: Flashloan actions improvements (merged from feat/fl-actions-improvements):
  - Add Titan swap provider support with WebSocket and HTTP proxy paths, including vendored SDK client
  - Add swap provider fallback system with configurable primary/fallback providers
  - Add provider field to SwapQuoteResult to expose which swap provider was used
  - Add flashloan TX size estimator for computing swap byte/account budgets without serialization
  - Add exact-out estimate routing for swap-debt actions via Titan and Jupiter
  - Remove writable account checks for flashloan transactions
  - Support market pricing instead of oracle for swap quotes

- 3ac61db: Native stake bank support, testing cleanup, CI workflow updates (pnpm + Node 22).
- 01736d8: Add provider field to SwapQuoteResult to expose which swap provider (Jupiter/Titan) was used. Market pricing improvements.

### Patch Changes

- e862f16: SDK cleanup from PR feedback:
  - Remove unused `examples/rnd-flashloan-size.ts`.
  - Tighten Jupiter routing constraints.
  - Minor fixes in `repay`, `swap-collateral`, `swap-debt` actions and Titan client.

- 943ca48: Fix: gate `feeAccount` on a non-zero `platformFeeBps` for both Jupiter and
  Titan swap paths. Previously, callers passing `platformFeeBps: 0` (or
  `undefined`) while a referral ATA existed on-chain would still attach
  `feeAccount` to the swap request, causing Jupiter to reject with
  `platformFee must be greater than 0 when feeAccount is set`. Both
  `getJupiterSwapIxsForFlashloan` and `getTitanSwapIxsForFlashloan` now strip
  `platformFeeBps` and omit `feeAccount` together when either prerequisite is
  missing.
- 2969f70: Remove writable account checks for flashloans.
- Declare `ws` and `@types/ws` as runtime dependencies. The Titan WebSocket
  client (`src/vendor/titan/client.ts`) imports `ws` but the dependency was
  missing from `package.json`, breaking type-checking and runtime resolution
  in environments that install from the published tarball (including CI with
  `--frozen-lockfile`).

## 2.2.0-alpha.8

### Patch Changes

- Fix: gate `feeAccount` on a non-zero `platformFeeBps` for both Jupiter and
  Titan swap paths. Previously, callers passing `platformFeeBps: 0` (or
  `undefined`) while a referral ATA existed on-chain would still attach
  `feeAccount` to the swap request, causing Jupiter to reject with
  `platformFee must be greater than 0 when feeAccount is set`. Both
  `getJupiterSwapIxsForFlashloan` and `getTitanSwapIxsForFlashloan` now strip
  `platformFeeBps` and omit `feeAccount` together when either prerequisite is
  missing.

## 2.2.0-alpha.7

### Minor Changes

- - Add bank metrics calculation utilities (`src/services/bank/utils/bank-metrics.utils.ts`).
  - Expose dummy account creation function from `account-lifecycle`.

## 2.2.0-alpha.6

### Patch Changes

- SDK cleanup from PR feedback:
  - Remove unused `examples/rnd-flashloan-size.ts`.
  - Tighten Jupiter routing constraints.
  - Minor fixes in `repay`, `swap-collateral`, `swap-debt` actions and Titan client.

## 2.2.0-alpha.5

### Minor Changes

- 804738b: Rebase onto latest main. Update GitHub CI workflows to use pnpm and Node 22, remove unused docs and publish workflows.
- Flashloan actions improvements (merged from feat/fl-actions-improvements):
  - Add Titan swap provider support with WebSocket and HTTP proxy paths, including vendored SDK client
  - Add swap provider fallback system with configurable primary/fallback providers
  - Add provider field to SwapQuoteResult to expose which swap provider was used
  - Add flashloan TX size estimator for computing swap byte/account budgets without serialization
  - Add exact-out estimate routing for swap-debt actions via Titan and Jupiter
  - Remove writable account checks for flashloan transactions
  - Support market pricing instead of oracle for swap quotes

- 01736d8: Add provider field to SwapQuoteResult to expose which swap provider (Jupiter/Titan) was used. Market pricing improvements.

### Patch Changes

- 2969f70: Remove writable account checks for flashloans.

## 2.2.0-beta.3

### Patch Changes

- Remove writable account checks for flashloans.

## 2.2.0-beta.2

### Minor Changes

- Add provider field to SwapQuoteResult to expose which swap provider (Jupiter/Titan) was used. Market pricing improvements.

## 2.2.0-beta.1

### Minor Changes

- Rebase onto latest main. Update GitHub CI workflows to use pnpm and Node 22, remove unused docs and publish workflows.

## 2.2.0-beta.0

### Minor Changes

- feat: Titan swap provider support, transaction size optimization, and enhanced error handling

  ## New Features
  - **Titan Swap Provider**: Added full support for Titan as a swap provider alongside Jupiter
    - Vendored minimal Titan WebSocket client (`@repo/marginfi-client-v2/vendor/titan`)
    - HTTP proxy route for serverless environments (`/api/titan/[...path]`)
    - Fee account validation with automatic fallback when ATA doesn't exist
    - Consistent `quoteParams` structure matching Jupiter's API

  ## Transaction Size Optimization
  - Added `getTotalAccountKeys()` helper to count static + LUT-resolved accounts
  - Implemented account lock limit validation (64 max) across all flashloan actions
  - Added early throwing of `TransactionBuildingError.swapSizeExceeded*` before simulation
  - Updated `loop.ts`, `repay.ts`, `swap-collateral.ts`, `swap-debt.ts` with total account checks
  - Improved `computeFlashloanSwapConstraints` to calculate available swap budget accurately

  ## Error Handling Improvements
  - Fixed `TransactionBuildingError` passthrough in swap provider fallback loops
  - Added simulation error parsing for "Transaction locked too many accounts" message
  - Moved account lock overflow errors from precheck to transaction build step
  - Improved typed error propagation across Jupiter and Titan swap providers
  - Enhanced error messages for swap size exceeded scenarios

## 2.2.0-alpha.4

### Minor Changes

- Native stake bank support, testing cleanup, CI workflow updates (pnpm + Node 22).

## 2.2.0-alpha.3

### Patch Changes

- chore: support deposit & borrow in one transaction

## 2.2.0-alpha.2

### Patch Changes

- rebase jup-lend

## 2.2.0-alpha.1

### Patch Changes

- remove mint apy and mint price from bank type

## 2.2.0-alpha.0

### Minor Changes

- Add native stake bank support: mint LST from stake accounts, redeem LST back to stake accounts, merge stake accounts, asset share multiplier for staked banks, oracle simplification for staked collateral, and hardcoded staked bank metadata.

## 2.1.4

### Patch Changes

- Remove `mintPrice` from `BankType` and related utilities. Clean up testing framework (remove vitest configs and TESTING.md). Update CI workflows to use pnpm and Node 22.

## 2.1.3

### Patch Changes

- JupLend token program support for vault ATA derivation, removed unused swap/titan utils

## 2.1.2

### Patch Changes

- Bumped IDL version and improved support for 1.8

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] - 2026-03-16

### Changed

- **Switchboard Package Update** - Updated switchboard package to improve compatibility with latest oracles

## [2.1.0] - 2026-03-09

### 🎉 Stable Release

Graduates the 2.1.0 alpha series to stable.

### Added

- **Marginfi v1.8 Support** - Added support for the Marginfi v1.8 program
- **Jupiter Lend Integration** - Added support for Jupiter Lend as a new lending protocol
- **JupLend extended actions** - Jupiter Lend support for swap collateral and looping flows

### Changed

- **Staging LUTs** - Updated lookup tables for staging group

## [2.0.2] - 2026-02-23

### Added

- **Lookup Table Address** - Added new lookup table address `qmH8NYYdHkbLYwAdAwnrqiPdBvayjn3DQwRUi9MoXX4` to main pool

## [2.0.1] - 2026-02-20

### Fixed

- **Account inference overrides** - Ensured `authority`/`group` are propagated via `overrideInferAccounts` in account transaction builders to avoid empty Anchor provider inference issues
- **Drift metadata naming mismatch** - Fixed drift integration metadata naming alignment in service/types usage
- **Oracle update noise** - Removed verbose debug `console.log` statements from Switchboard oracle update actions
- **Dependency imports** - Corrected BN/BigNumber import usage in drift utilities

## [2.0.0] - 2026-02-20

### 🎉 Stable Release

Graduates the 2.0.0 alpha series to stable, including emode lifecycle support and action/accounting fixes.

### Added

- **E-mode Lifecycle Support** - Full emode state support across client and account wrapper flows
  - Added emode pair generation, active pair/weight resolution, and per-bank impact analysis
- **Typed Amount Handling** - Added `TypedAmount` and `resolveAmount()` for explicit UI token vs cToken amount inputs
- **LST_PT E-mode Tag Support** - Added support for the `LST_PT` emode tag (`15787`) in SDK emode parsing

### Fixed

- **Kamino Account Derivation** - Uses reserve accounts directly from on-chain state instead of derived addresses
- **cToken Amount Conversion** - Improved cToken conversion accuracy across withdraw, repay, and swap-collateral flows
- **E-mode Health Inputs** - Replaced placeholder emode values with active-pair derived values in health and max-amount computations

## [2.0.0-alpha.4] - 2026-02-20

### Added

- **LST_PT E-mode Tag Support** - Added support for the `LST_PT` emode tag (`15787`) in SDK emode parsing
  - Updated `parseEmodeTag` to correctly classify and expose the new tag

⚠️ **Alpha Release** - This is an unstable pre-release version. Not recommended for production use.

## [2.0.0-alpha.3] - 2026-02-18

### Fixed

- **Kamino Account Derivation** - Use on-chain reserve account addresses instead of PDA derivation for Kamino deposit and withdraw instructions
  - `reserveLiquiditySupply`, `reserveCollateralMint`, and `reserveDestinationDepositCollateral` now read directly from the reserve state (`reserve.liquidity.supplyVault`, `reserve.collateral.mintPubkey`, `reserve.collateral.supplyVault`)
  - Removed unused derived accounts from `getAllDerivedKaminoAccounts` calls (only `lendingMarketAuthority` is still derived)

⚠️ **Alpha Release** - This is an unstable pre-release version. Not recommended for production use.

## [2.0.0-alpha.2] - 2026-02-16

### Added

- **TypedAmount Support** - New `TypedAmount` type and `resolveAmount()` utility to distinguish between UI token amounts and cToken amounts
  - `AmountType` union type: `"uiToken" | "cToken"`
  - `TypedAmount` interface with `value` and `type` fields
  - `resolveAmount()` helper that accepts both `Amount` and `TypedAmount`, defaulting to `"uiToken"`

### Fixed

- **cToken Amount Calculation** - Improved cToken conversion accuracy across withdraw, repay, and swap-collateral actions
  - `makeKaminoWithdrawIx` now accepts explicit `cTokenAmount` parameter instead of ambiguous `amount`
  - `makeKaminoWithdrawTx` uses `assetShareValueMultiplierByBank` and `resolveAmount()` for correct cToken/UI token handling
  - Repay and swap-collateral flashloan builders now use `assetShareValueMultiplierByBank` for accurate cToken conversion instead of `bank.assetShareValue`
  - `computeMaxBorrowForBank` now passes `assetShareValueMultiplier` to `computeQuantityUi` for correct asset calculations

⚠️ **Alpha Release** - This is an unstable pre-release version. Not recommended for production use.

## [2.0.0-alpha.1] - 2026-02-12

### Added

- **E-mode State in SDK** - Full emode lifecycle support in the SDK class structure
  - `getEmodePairs(banks)` — generates `EmodePair[]` from bank emode configurations
  - `computeLowestEmodeWeights(emodePairs)` — computes lowest weight per collateral bank across active pairs
  - `Project0Client` now stores `emodePairs` and generates them during `initialize()`
  - `MarginfiAccountWrapper` new emode state getters:
    - `getActiveEmodePairs()` — active pairs derived from account balances + client emode pairs
    - `getActiveEmodeWeightsByBank()` — lowest emode weights Map for active pairs
    - `getEmodeImpacts()` — per-bank action impact analysis using client emode pairs

### Fixed

- **Emode TODOs resolved** — All placeholder emode values in `MarginfiAccountWrapper` now use real data:
  - `simulateHealthCache()` and `computeNetApy()` pass active emode weights instead of empty Map
  - `computeMaxBorrowForBank()` passes real `emodeImpactStatus` and `activePair` from impact analysis
  - `computeMaxWithdrawForBank()` passes real `activePair` from active emode pairs
  - `fetchAccount()` computes and passes emode weights + asset share multipliers to health cache simulation

⚠️ **Alpha Release** - This is an unstable pre-release version. Not recommended for production use.

## [2.0.0-alpha.0] - 2026-02-10

### Changed

- **Emode & Asset Weight Multiplier Refactor** - Refactored emode and asset weight multiplier logic
- **Unified Health Functions** - Reworked health functions to have a more unified structure

⚠️ **Alpha Release** - This is an unstable pre-release version. Not recommended for production use.

## [1.2.7] - 2026-02-16

### Changed

- **Disable Switchboard Feed Data Override** - Commented out `pullFeed.data` assignment restored in v1.2.6, relying entirely on on-chain feed data for oracle updates

### Added

- **Oracle Update Logging** - Debug logging across Switchboard oracle update flow for easier troubleshooting

## [1.2.6] - 2026-02-13

### Changed

- **Switchboard Revert to v2 Pattern** - Reverted oracle update logic back to pre-v3 Switchboard SDK pattern
  - Restored `pullFeed.data` with `PullFeedAccountData` instead of `pullFeed.configs`
  - Restored manual gateway resolution via `CrossbarClient.fetchGateways`
  - Restored dummy wallet passthrough to `AnchorUtils.loadProgramFromConnection`
  - Downgraded `@switchboard-xyz/on-demand` back to `2.14.4` and `@switchboard-xyz/common` back to `4.1.0`

## [1.2.5] - 2026-02-12

### Changed

- **Switchboard Feed Config** - Commented out `pullFeed.configs` assignment to use on-chain feed data instead of local overrides

## [1.2.4] - 2026-02-11

### Fixed

- **Payer in Oracle Update** - Adds payer to the `makeUpdateSwbFeedIx` function

## [1.2.3] - 2026-02-11

### Fixed

- **Switchboard SDK v3 Upgrade** - Updated Switchboard integration for `@switchboard-xyz/on-demand` v3 and `@switchboard-xyz/common` v5
  - Fixed ConstraintMut error by passing dummy wallet with feePayer to `AnchorUtils.loadProgramFromConnection`
  - Removed manual gateway resolution (now handled internally by SDK)
  - Use `PullFeed.configs` instead of `PullFeed.data` for feed configuration

## [1.2.2] - 2026-02-11

### Added

- **Oracle Update Logging** - Added debug logging to Switchboard oracle update functions for easier troubleshooting

## [1.2.1] - 2026-02-06

### Added

- **Partial Collateral Swap Support** - Enhanced collateral swap functionality to support partial swaps
  - Ability to swap a portion of collateral instead of full amount
  - Better control over position management
  - More flexible rebalancing strategies

- **Partial Debt Swap Support** - Enhanced debt swap functionality to support partial swaps
  - Ability to swap a portion of debt instead of full amount
  - Improved position management flexibility
  - Support for gradual debt migration

### Changed

- **Debt Swap Mode** - Switched debt swap to use `ExactIn` mode instead of `ExactOut`
  - More predictable input amounts for better UX
  - Improved slippage handling
  - Better alignment with Jupiter routing optimization

## [1.2.0] - 2026-02-05

### 🎉 Stable Release: Swap Collateral Feature

This release graduates from alpha and adds swap collateral functionality for seamless position management.

### Added

- **Swap Collateral Transactions** - Flash loan-based collateral swapping without affecting account health
  - Withdraw existing collateral via flash loan
  - Swap to new asset using Jupiter integration
  - Deposit swapped assets as new collateral
  - Support for Kamino and Drift integrated banks
  - Automatic ATA creation and oracle price updates

- **Enhanced Transaction Building** - Better Jupiter integration for swap operations
  - Multiple route evaluation for optimal execution
  - Transaction size validation and optimization
  - Dynamic slippage support
  - Platform fee support

### Fixed

- **Swap Collateral Synchronization** - Disabled `isSync` flag to prevent synchronization issues during complex multi-instruction transactions
- **Transaction Size Handling** - Improved handling of large swap transactions with lookup tables

### Changed

- **Loop Action Updates** - Enhanced loop transaction builders to support new swap infrastructure
- **Flash Loan Improvements** - Better handling of flash loan transactions with swap operations

## [1.2.0-alpha.2] - 2026-02-04

### Fixed

- **Swap Collateral isSync** - Disabled `isSync` flag in swap collateral transactions to prevent synchronization issues

⚠️ **Alpha Release** - This is a pre-release version for testing. Not recommended for production use.

## [1.2.0-alpha.1] - 2026-01-30

### Added

- **Enhanced Swap Actions** - New swap functionality for testing
  - Improved swap collateral transaction building
  - Enhanced swap debt flashloan transactions
  - Updated loop action transaction builders
  - Better Jupiter integration for swap operations

⚠️ **Alpha Release** - This is a pre-release version for testing new swap features. Not recommended for production use.

## [1.1.1] - 2026-01-29

### Improved

- **Oracle Key Serialization** - Enhanced oracle key handling and serialization for better reliability and performance
  - Improved PublicKey serialization in oracle-related operations
  - Better handling of oracle account data structures

- **Jupiter API Key Support** - Added support for Jupiter API keys in swap operations
  - Optional `jupiterApiKey` parameter in Jupiter swap utilities
  - Allows for rate limit increases and priority access to Jupiter API
  - Backward compatible - API key is optional

## [1.1.0] - 2026-01-27

### 🎉 Major Release: Drift Protocol Integration

This stable release graduates from alpha and includes comprehensive Drift Protocol integration support.

### Added

- **Drift Protocol Integration** - Complete support for Drift lending and borrowing
  - Drift deposit and withdraw instructions with all required accounts
  - Drift market synchronization and updates
  - Drift reward harvesting functionality
  - Drift oracle support (Pyth Pull, Switchboard Pull)
  - New IDL: `marginfi-types_0.1.7.ts` with Drift integration fields
  - Drift spot market state management
  - Drift user account and stats tracking
  - Pool ID support for market categorization

- **Drift Interest Rate Curve Calculations** - Utilities for generating and visualizing Drift interest rate curves
  - `DriftInterestRateCurvePoint` interface for curve data points (utilization, borrowAPY, supplyAPY)
  - `generateDriftReserveCurve()` - Generates complete interest rate curve with 101 data points (0% to 100% utilization)
  - Discrete compounding formula with `SLOTS_PER_YEAR` (63,072,000) for APY calculations
  - Proper handling of Drift's `SPOT_MARKET_UTILIZATION_PRECISION` (1e6) and `SPOT_MARKET_RATE_PRECISION` (1e6)

- **Staging Environment Support** - New program constants and LUTs for staging
  - `MARGINFI_PROGRAM_STAGING`: `stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct`
  - `MARGINFI_PROGRAM_STAGING_ALT`: `5UDghkpgW1HfYSrmEj2iAApHShqU44H6PKTAar9LL9bY`
  - Updated staging LUT address: `9p1CwvXMYNEY9CqSwuWySVXsG37NGb36nua94ea5KsiQ`
  - Staging group ID: `FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo`

### Changed

- **Unified Bank Integration Structure** - Replaced individual integration fields with generic structure
  - Changed from specific integration fields to `integrationAcc1`, `integrationAcc2`, `integrationAcc3`
  - Exposed as optional `driftData` and `kaminoData` objects in `BankType`
  - More flexible and maintainable integration architecture

- **Drift Function Naming** - Improved naming consistency with `Drift` prefix
  - `getTokenAmount` → `getDriftTokenAmount`
  - `calculateUtilization` → `calculateDriftUtilization`
  - `calculateInterestRate` → `calculateDriftInterestRate`
  - `calculateBorrowRate` → `calculateDriftBorrowRate`
  - `calculateDepositRate` → `calculateDriftDepositRate`
  - `calculateLendingAPR` → `calculateDriftLendingAPR`
  - `calculateLendingAPY` → `calculateDriftLendingAPY`
  - `calculateBorrowAPR` → `calculateDriftBorrowAPR`
  - `calculateBorrowAPY` → `calculateDriftBorrowAPY`

- **Klend Function Naming** - Improved naming consistency with `Kamino`/`Klend` prefix
  - `InterestRateCurvePoint` → `KlendInterestRateCurvePoint`
  - `getBorrowRate` → `getKaminoBorrowRate`
  - `getTotalSupply` → `getKaminoTotalSupply`
  - `calculateEstimatedBorrowRate` → `calculateKaminoEstimatedBorrowRate`
  - `calculateEstimatedSupplyRate` → `calculateKaminoEstimatedSupplyRate`
  - `calculateSupplyAPY` → `calculateKaminoSupplyAPY`

### Fixed

- **Instruction Builder Bugs** - Fixed critical issues in integration instructions
  - Fixed `makeKaminoDepositIx` missing Kamino lending program in accounts
  - Fixed `makelendingAccountWithdrawEmissionIx` incorrect account ordering
  - Fixed `DRIFT_WITHDRAW` discriminator (was using deposit discriminator)
  - Corrected to `[86, 59, 186, 123, 183, 181, 234, 137]`

- **Sync Instructions** - Fixed `isWritable` flag misconfiguration
  - Set `group` account to `isWritable: true` in Drift withdraw sync instruction

- **Repay Actions** - Changed to use async instructions for better transaction reliability
  - Updated `buildRepayWithCollatFlashloanTx` withdraw instructions to use `isSync: false`
  - Updated `buildRepayTxn` borrow and repay instructions to use `isSync: false`

- **CPI Decoding** - Added Drift instructions to CPI decoding in compute utilities
  - Added support for decoding Drift deposit instructions in `computeProjectedActiveBalancesNoCpi`
  - Added support for decoding Drift withdraw instructions in `computeProjectedActiveBalancesNoCpi`
  - Ensures Drift CPI transactions are properly accounted for in balance projections

- **Drift Oracle Configuration** - Ensured explicit `driftOracle` parameter requirement in `makeDriftDepositIx`

### Removed

- **Dependency Cleanup** - Removed unused `@mrgnlabs/mrgn-common` dependency and updated package-lock

---

## [1.1.0-alpha.12] - 2026-01-27

### Fixed

- **CPI Decoding** - Added Drift instructions to CPI decoding in compute utilities
  - Added support for decoding Drift deposit instructions in `computeProjectedActiveBalancesNoCpi`
  - Added support for decoding Drift withdraw instructions in `computeProjectedActiveBalancesNoCpi`
  - Ensures Drift CPI transactions are properly accounted for in balance projections

## [1.1.0-alpha.11] - 2026-01-26

### Added

- **Drift Interest Rate Curve Calculations** - Added utilities for generating and visualizing Drift interest rate curves
  - Added `DriftInterestRateCurvePoint` interface for curve data points (utilization, borrowAPY, supplyAPY)
  - Added `generateDriftReserveCurve()` - Generates complete interest rate curve with 101 data points (0% to 100% utilization)
  - Uses discrete compounding formula with `SLOTS_PER_YEAR` (63,072,000) for APY calculations
  - Properly handles Drift's `SPOT_MARKET_UTILIZATION_PRECISION` (1e6) and `SPOT_MARKET_RATE_PRECISION` (1e6)

### Changed

- **Drift Function Naming** - Improved naming consistency with `Drift` prefix
  - Renamed `getTokenAmount` → `getDriftTokenAmount`
  - Renamed `calculateUtilization` → `calculateDriftUtilization`
  - Renamed `calculateInterestRate` → `calculateDriftInterestRate`
  - Renamed `calculateBorrowRate` → `calculateDriftBorrowRate`
  - Renamed `calculateDepositRate` → `calculateDriftDepositRate`
  - Renamed `calculateLendingAPR` → `calculateDriftLendingAPR`
  - Renamed `calculateLendingAPY` → `calculateDriftLendingAPY`
  - Renamed `calculateBorrowAPR` → `calculateDriftBorrowAPR`
  - Renamed `calculateBorrowAPY` → `calculateDriftBorrowAPY`
- **Klend Function Naming** - Improved naming consistency with `Kamino` or `Klend` prefix
  - Renamed `InterestRateCurvePoint` → `KlendInterestRateCurvePoint`
  - Renamed `getBorrowRate` → `getKaminoBorrowRate`
  - Renamed `getTotalSupply` → `getKaminoTotalSupply`
  - Renamed `calculateEstimatedBorrowRate` → `calculateKaminoEstimatedBorrowRate`
  - Renamed `calculateEstimatedSupplyRate` → `calculateKaminoEstimatedSupplyRate`
  - Renamed `calculateSupplyAPY` → `calculateKaminoSupplyAPY`

## [1.1.0-alpha.10] - 2026-01-23

### Fixed

- **Sync Instructions** - Fixed `isWritable` flag misconfiguration
  - Set `group` account to `isWritable: true` in Drift withdraw sync instruction (was incorrectly set to `false`)
- **Repay Actions** - Changed to use async instructions for better transaction reliability
  - Updated `buildRepayWithCollatFlashloanTx`: Changed withdraw instructions from `isSync: true` to `isSync: false` (3 instances)
  - Updated `buildRepayTxn`: Changed borrow and repay instructions from `isSync: true` to `isSync: false` (2 instances)
  - Flashloan transactions still use `isSync: true` as required

## [1.1.0-alpha.9] - 2026-01-23

### Added

- **Staging Program Constants** - Added staging environment program IDs
  - Added `MARGINFI_PROGRAM_STAGING` constant (`stag8sTKds2h4KzjUw3zKTsxbqvT4XKHdaR9X9E6Rct`)
  - Added `MARGINFI_PROGRAM_STAGING_ALT` constant (`5UDghkpgW1HfYSrmEj2iAApHShqU44H6PKTAar9LL9bY`)

### Fixed

- **Sync Instructions** - Fixed multiple instruction builder bugs
  - Fixed Drift withdraw instruction discriminator (was `[178, 238, 229, 72, 126, 212, 78, 103]`, now `[86, 59, 186, 123, 183, 181, 234, 137]`)
  - Removed duplicate `reserveLiquidityMint` account from Kamino deposit instruction (bank mint already provides this)
  - Fixed `lendingAccountWithdrawEmissionIx` account ordering: moved `destinationAccount` to correct position
  - Removed redundant `emissionsTokenAccount` from `lendingAccountWithdrawEmissionIx`

## [1.1.0-alpha.8] - 2026-01-23

### Added

- **Drift Pool ID** - Added `poolId` field to Drift spot market types
  - Added `poolId: number` to `DriftSpotMarket` interface for market labeling (Main Market, JLP Market, LST Market, etc.)
  - Added `poolId` to `DriftSpotMarketJSON` DTO type
  - Updated serialization utilities: `driftSpotMarketRawToDto` now includes `poolId`
  - Updated deserialization utilities: `dtoToDriftSpotMarketRaw` now includes `poolId`

## [1.1.0-alpha.7] - 2026-01-22

### Changed

- **Staging Lookup Tables** - Updated staging environment LUT address
  - Updated staging group (`FCPfpHA69EbS8f9KKSreTRkXbzFpunsKuYf5qNmnJjpo`) LUT from `HxPy7b58KLKSU7w4LUW9xwYQ1NPyRNQkYYk2f7SmYAip` to `9p1CwvXMYNEY9CqSwuWySVXsG37NGb36nua94ea5KsiQ`

## [1.1.0-alpha.6] - 2026-01-22

### Fixed

- **Drift Integration Metadata** - Fixed DTO conversion for drift states in bank integration metadata
  - Added `driftStates` serialization/deserialization in `dtoToBankMetadata` and `bankMetadataToDto`
  - Added `userRewards: DriftRewardsJSON[]` field to drift states
  - Made `userStatsState` optional in drift states
  - Imported drift conversion utilities: `driftRewardsRawToDto`, `driftSpotMarketRawToDto`, `driftUserRawToDto`, `driftUserStatsRawToDto`, `dtoToDriftRewardsRaw`, `dtoToDriftSpotMarketRaw`, `dtoToDriftUserRaw`, `dtoToDriftUserStatsRaw`

## [1.1.0-alpha.5] - 2026-01-22

### Fixed

- **Drift Oracle** - Fixed `makeDriftDepositIx` to require explicit `driftOracle` parameter (not optional with default)
  - Changed from `driftOracle?: PublicKey | null` with default `null` to required `driftOracle: PublicKey | null`
  - Ensures drift oracle is properly defined when set

## [1.1.0-alpha.4] - 2026-01-21

### Changed

- **Program Support** - Updated for Marginfi program v1.7rc2
- **Bank Structure** - Unified integration accounts structure
  - Replaced individual integration fields (`kaminoReserve`, `kaminoObligation`, `driftSpotMarket`, etc.) with unified `integrationAcc1`, `integrationAcc2`, `integrationAcc3` slots
  - Bank type now exposes optional integration account objects: `kaminoIntegrationAccounts`, `driftIntegrationAccounts`, `solendIntegrationAccounts`
  - Updated serialization/deserialization logic for the new structure
- **IDL** - Updated marginfi-types_0.1.7.ts and marginfi_0.1.7.json for v1.7rc2

## [1.1.0-alpha.3] - 2026-01-19

### Changed

- **Dependencies** - Removed `@mrgnlabs/mrgn-common` dependency
- **Package Lock** - Updated package-lock.json

## [1.1.0-alpha.2] - 2026-01-19

### Changed

- **Oracle Logic** - Added Drift oracle setup handling to Pyth and Switchboard oracle services
  - Support for `DriftPythPull` and `DriftSwitchboardPull` oracle setups
  - Support for `SolendPythPull` and `SolendSwitchboardPull` oracle setups
  - Categorize and process Drift/Solend banks in oracle price fetching

## [1.1.0-alpha.1] - 2026-01-19

### Added

- **Drift Protocol Integration** - Full support for Drift spot markets
  - `makeDriftDepositIx` / `makeDriftDepositTx` - Deposit into Drift spot markets
  - `makeDriftWithdrawIx` / `makeDriftWithdrawTx` - Withdraw from Drift spot markets
  - `makeUpdateDriftMarketIxs` - Update Drift spot market cumulative interest
  - Drift reward harvesting support (up to 2 reward tokens)
  - Account wrapper methods: `makeDriftDepositTx()` and `makeDriftWithdrawTx()`
- **New IDL** - Added `marginfi-types_0.1.7.ts` with Drift-related instructions
- **Asset Tag** - Added `AssetTag.DRIFT = 4` for Drift-integrated banks
- **Bank Fields** - Added `driftSpotMarket`, `driftUser`, `driftUserStats` to bank state
- **Loop/Repay Support** - Integrated Drift withdrawals into loop and repay-with-collateral flows

### Changed

- Updated compute budget utilities to handle Drift spot market accounts
- Enhanced loop and repay logic to support Drift banks via switch statements
- Improved bank serialization to include Drift account fields

## [1.0.1] - 2026-01-19

### Changed

- **Locked Anchor version** - Fixed `@coral-xyz/anchor` package version for stability
- **Updated BN imports** - Improved BigNumber import consistency across codebase
- **Moved jup-ag dependency** - Relocated `@jup-ag/core` from devDependencies to main dependencies

### Fixed

- Dependency management improvements for production use

## [1.0.0] - 2026-01-15

### 🎉 Initial Stable Release

Official v1.0.0 release of the **@0dotxyz/p0-ts-sdk** - A production-ready TypeScript SDK for the P0 Protocol on Solana.

### Features

#### Core SDK

- ✅ **Type-safe client** - `Project0Client` with full TypeScript support
- ✅ **Account management** - `MarginfiAccountWrapper` for clean account operations
- ✅ **Modern build tooling** - tsup with optimized ESM + CJS bundles
- ✅ **Tree-shakeable exports** - Separate vendor entry point for oracle integrations

#### Protocol Operations

- ✅ **Deposits & Withdrawals** - Full support for lending operations
- ✅ **Borrows & Repayments** - Leverage and debt management
- ✅ **Multi-bank support** - Handle main + Kamino banks seamlessly
- ✅ **Health monitoring** - Real-time account health calculations
- ✅ **Max amount calculations** - Safe borrow/withdraw limits

#### Developer Experience

- ✅ **7+ runnable examples** - Covering all core features
- ✅ **Comprehensive tests** - Unit + integration test suites with Vitest
- ✅ **Full documentation** - Complete SDK docs and migration guides
- ✅ **Oracle integrations** - Pyth, Switchboard support via vendor exports
- ✅ **Zero mrgn-common dependency** - Standalone package with internal utilities

### Technical Details

- **Package**: `@0dotxyz/p0-ts-sdk@1.0.0`
- **License**: MIT
- **TypeScript**: 5.5+
- **Node**: >=18.0.0
- **Bundle size**: <1MB (gzipped)

### Migration from Alpha

If migrating from previous alpha versions or `p0-ts-sdk`:

- Update package name to `@0dotxyz/p0-ts-sdk`
- Update all imports to use the scoped package name
- No API breaking changes from alpha.3

---

## Old Changelog (Pre-Alpha)

### Patch Changes

- Initial alpha release of Project 0 TypeScript SDK
  - Complete TypeScript SDK for marginfi protocol on Solana
  - Full type safety with comprehensive TypeScript definitions
  - Modern build tooling with tsup (ESM + CJS)
  - Unit and integration test suites with Vitest
  - 7+ runnable examples covering all core features
  - Production-ready architecture with `Project0Client` and `MarginfiAccountWrapper`
  - Support for deposits, borrows, withdrawals, repayments
  - Health monitoring and risk calculations
  - Oracle price integration (Pyth, Switchboard)
  - Kamino integration support

## 2.0.0-alpha.0

### Major Changes

- Initial alpha release of Project 0 TypeScript SDK
  - Complete TypeScript SDK for marginfi protocol on Solana
  - Full type safety with comprehensive TypeScript definitions
  - Modern build tooling with tsup (ESM + CJS)
  - Unit and integration test suites with Vitest
  - 7+ runnable examples covering all core features
  - Production-ready architecture with `Project0Client` and `MarginfiAccountWrapper`
  - Support for deposits, borrows, withdrawals, repayments
  - Health monitoring and risk calculations
  - Oracle price integration (Pyth, Switchboard)
  - Kamino integration support

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-07

### Added

- Initial release of P0 TypeScript SDK
- Complete migration from marginfi-client-v2
- Industry-standard build tooling with tsup
- Comprehensive TypeScript configuration
- ESM and CJS dual-package support
- Path alias support for cleaner imports
- ESLint and Prettier configuration
- Vitest for testing with coverage support
- TypeDoc for documentation generation
- Full type safety and type definitions
- Tree-shakeable exports
- Vendor exports for optional dependencies

### Changed

- Package name from `p0-ts-sdk` to `p0-ts-sdk`
- Migrated from turborepo monorepo to standalone repository
- Updated all configuration files to industry standards

### Infrastructure

- Modern build system with tsup
- GitHub workflows for CI/CD
- Automated testing and linting
- Documentation generation pipeline
