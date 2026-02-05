# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
