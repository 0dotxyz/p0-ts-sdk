# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
