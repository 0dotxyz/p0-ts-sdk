# P0 TypeScript SDK

[![npm version](https://img.shields.io/npm/v/p0-ts-sdk.svg)](https://www.npmjs.com/package/p0-ts-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)

A modern, type-safe TypeScript SDK for interacting with the P0 Protocol on Solana. Lend, borrow, and manage leveraged DeFi positions with a clean, developer-friendly API.

## Features

- 🔒 **Type-safe**: Full TypeScript support with comprehensive type definitions
- 📦 **Tree-shakeable**: Optimized ESM and CJS builds (<1MB)
- 🧪 **Well-tested**: Unit and integration tests with Vitest
- 📚 **Rich examples**: 7+ runnable examples covering all core features
- 🔄 **Modern tooling**: Built with tsup, ESLint, Prettier
- 🎯 **Solana-native**: Built on Anchor with full on-chain integration
- ⚡ **Production-ready**: Used in production applications

## Installation

```bash
npm install p0-ts-sdk
# or
yarn add p0-ts-sdk
# or
pnpm add p0-ts-sdk
```

## Quick Start

### 1. Initialize the Client

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { Project0Client, getConfig } from "p0-ts-sdk";

// Connect to Solana
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// Get configuration (mainnet-beta)
const config = getConfig("production");

// Initialize the client (loads all banks and oracle prices)
const client = await Project0Client.initialize(connection, config);

console.log(`Loaded ${client.banks.length} banks`);
```

### 2. Load Your Account

```typescript
import { MarginfiAccount, MarginfiAccountWrapper } from "p0-ts-sdk";

const accountAddress = new PublicKey("YOUR_MARGINFI_ACCOUNT_ADDRESS");

// Fetch your account
const account = await MarginfiAccount.fetch(accountAddress, client.program);

// Wrap it for cleaner API
const wrappedAccount = new MarginfiAccountWrapper(account, client);
```

### 3. Find a Bank

```typescript
import { AssetTag } from "p0-ts-sdk";

// Option 1: Get bank by address
const bank = client.getBank(new PublicKey("BANK_ADDRESS"));

// Option 2: Get all banks for a mint (e.g., USDC)
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const usdcBanks = client.getBanksByMint(USDC_MINT);
```

### 4. Deposit Tokens

```typescript
// Build deposit transaction
const depositTx = await wrappedAccount.makeDepositTx(
  usdcBank.address,
  "100" // Amount in UI units (100 USDC)
);

// Simulate (optional, but recommended)
const simulation = await connection.simulateTransaction(depositTx);
console.log(`Compute units: ${simulation.value.unitsConsumed}`);

// Sign and send
// depositTx.sign([wallet]);
// await connection.sendTransaction(depositTx);
```

### 5. Borrow Against Collateral

```typescript
// Check how much you can borrow
const maxBorrow = wrappedAccount.computeMaxBorrowForBank(usdcBank.address);
console.log(`Max borrow: $${maxBorrow.toString()}`);

// Build borrow transaction
const borrowTx = await wrappedAccount.makeBorrowTx(
  usdcBank.address,
  "100" // Borrow 100 USDC
);

// Send transaction...
```

### 6. Monitor Account Health

```typescript
import { MarginRequirementType } from "p0-ts-sdk";

// Get free collateral in USD
const freeCollateral = wrappedAccount.computeFreeCollateral();
console.log(`Free collateral: $${freeCollateral.toString()}`);

// Get health components
const health = wrappedAccount.computeHealthComponents(MarginRequirementType.Initial);

const healthFactor = health.assets.div(health.liabilities);
console.log(`Health factor: ${healthFactor.toString()}`);
```

## 📚 Examples

Check out the [`examples/`](./examples) directory for complete, runnable examples:

- **[01-deposit.ts](./examples/01-deposit.ts)** - Deposit tokens and earn interest
- **[02-borrow.ts](./examples/02-borrow.ts)** - Borrow against your collateral
- **[03-withdraw.ts](./examples/03-withdraw.ts)** - Withdraw your deposits
- **[04-repay.ts](./examples/04-repay.ts)** - Repay borrowed amounts
- **[05-oracle-prices.ts](./examples/05-oracle-prices.ts)** - Work with oracle price feeds
- **[06a-account-health-simulated.ts](./examples/06a-account-health-simulated.ts)** - Monitor account health
- **[06b-account-health-calculated.ts](./examples/06b-account-health-calculated.ts)** - Calculate health metrics

Each example includes:

- ✅ Full setup instructions
- ✅ Detailed comments
- ✅ Error handling
- ✅ Transaction simulation

### Running Examples

```bash
cd examples
cp .env.example .env
# Edit .env with your values
tsx 01-deposit.ts
```

## 🏗️ Core Concepts

### Project0Client

The main SDK client that manages protocol interactions.

```typescript
const client = await Project0Client.initialize(connection, config);

// Pre-loaded data (fetched once at initialization)
client.banks                // All available banks
client.bankMap              // Banks indexed by address
client.oraclePriceByBank   // Latest oracle prices
client.mintDataByBank      // Token mint metadata
client.addressLookupTables // For transaction optimization

// Methods
client.getBank(address)             // Get bank by address
client.getBanksByMint(mint, tag?)   // Get all banks for a mint
```

**Benefits:**

- Single initialization loads all chain data
- Reuse throughout your application
- Automatic oracle price caching
- Built-in lookup table support

### MarginfiAccount & Wrapper

Your lending account on the protocol.

```typescript
// Fetch raw account
const account = await MarginfiAccount.fetch(address, client.program);

// Wrap for clean API (recommended)
const wrapped = new MarginfiAccountWrapper(account, client);

// All methods have access to banks, oracles, etc.
wrapped.computeMaxBorrowForBank(bankAddress);
wrapped.makeDepositTx(bankAddress, amount);
wrapped.computeFreeCollateral();
```

### Bank

A lending pool for a specific token.

```typescript
const bank = client.getBank(bankAddress);

bank.mint; // Token mint address
bank.config; // Interest rates, weights, limits
bank.config.assetWeightInit; // Collateral factor (LTV)
bank.config.liabilityWeightInit; // Borrow weight
```

### Balance

Your position in a specific bank.

```typescript
const balance = account.balances[0];

balance.bankPk; // Bank address
balance.assetShares; // Deposit shares
balance.liabilityShares; // Borrow shares
balance.active; // Is position active?
```

## 📦 Package Structure

The SDK provides optimized entry points:

```typescript
// Main SDK (core functionality)
import { Project0Client, MarginfiAccount, getConfig } from "p0-ts-sdk";

// Vendor utilities (oracle integrations, Jupiter, etc.)
import { fetchOracleData, OraclePrice } from "p0-ts-sdk/vendor";
```

**Why separate vendor exports?**

- Reduces bundle size for simple use cases
- Oracle libraries (Pyth, Switchboard) are large
- Tree-shake what you don't need

## 🎯 Key Features

### Type Safety

Full TypeScript support with exported types:

```typescript
import type {
  MarginfiAccountType,
  BankType,
  BalanceType,
  OraclePrice,
  MarginRequirementType,
  Project0Config,
} from "p0-ts-sdk";
```

### Multiple Bank Support

Handle cases where multiple banks exist for the same mint:

```typescript
// Get ALL SOL banks (main + Kamino)
const solBanks = client.getBanksByMint(WSOL_MINT);

// Filter by tag
const mainSolBanks = client.getBanksByMint(WSOL_MINT, AssetTag.SOL);
const kaminoBanks = client.getBanksByMint(WSOL_MINT, AssetTag.KAMINO);
```

### Health Calculations

Built-in account health monitoring:

```typescript
import { MarginRequirementType } from "p0-ts-sdk";

// Free collateral (how much you can still borrow)
const free = wrapped.computeFreeCollateral();

// Health components (assets vs liabilities)
const health = wrapped.computeHealthComponents(
  MarginRequirementType.Initial // or Maintenance
);

// Max amounts
const maxBorrow = wrapped.computeMaxBorrowForBank(bankAddress);
const maxWithdraw = wrapped.computeMaxWithdrawForBank(bankAddress);
```

## 🧪 Testing

The SDK includes comprehensive tests:

```bash
# Unit tests (fast, no RPC needed)
pnpm test:unit

# Integration tests (requires RPC)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com pnpm test:integration

# All tests
pnpm test

# With coverage
pnpm test:coverage
```

**Testing Strategy:**

- **Unit tests**: Pure calculations, conversions, validations
- **Integration tests**: Real chain data, transaction building, simulations

See [TESTING.md](./TESTING.md) for details.

## 🛠️ Development

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended)

### Setup

```bash
# Install dependencies
pnpm install

# Build the SDK
pnpm build

# Watch mode (for development)
pnpm dev

# Type check
pnpm typecheck

# Lint and format
pnpm lint
pnpm format
```

### Project Structure

```
p0-ts-sdk/
├── src/
│   ├── index.ts              # Main SDK exports
│   ├── vendor/               # Vendor entry point (oracles, etc.)
│   ├── config.ts             # Network configurations
│   ├── models/               # Core models
│   │   ├── client.ts         # Project0Client
│   │   ├── account.ts        # MarginfiAccount
│   │   ├── account-wrapper.ts # MarginfiAccountWrapper
│   │   ├── bank.ts           # Bank model
│   │   └── ...
│   ├── services/             # Business logic
│   │   ├── account/          # Account operations
│   │   ├── price/            # Oracle price fetching
│   │   └── ...
│   ├── instructions/         # Transaction builders
│   ├── types/                # TypeScript types
│   ├── idl/                  # Anchor IDL
│   └── utils/                # Helpers
├── tests/
│   ├── unit/                 # Unit tests (mocked)
│   ├── integration/          # Integration tests (real RPC)
│   └── fixtures/             # Test data
├── examples/                 # 7+ runnable examples
└── dist/                     # Build output
    ├── index.js              # ESM bundle
    ├── index.cjs             # CJS bundle
    ├── index.d.ts            # Type definitions
    └── vendor.*              # Vendor bundles
```

### Available Scripts

| Script                  | Description                |
| ----------------------- | -------------------------- |
| `pnpm build`            | Build ESM + CJS bundles    |
| `pnpm dev`              | Watch mode for development |
| `pnpm test`             | Run all tests              |
| `pnpm test:unit`        | Run unit tests only        |
| `pnpm test:integration` | Run integration tests      |
| `pnpm test:coverage`    | Generate coverage report   |
| `pnpm lint`             | Lint with ESLint           |
| `pnpm format`           | Format with Prettier       |
| `pnpm typecheck`        | TypeScript type checking   |
| `pnpm clean`            | Remove build artifacts     |

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Run `pnpm test` and `pnpm lint`
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Workflow

```bash
# 1. Make changes
vim src/models/client.ts

# 2. Add tests
vim tests/unit/models/client.test.ts

# 3. Run tests
pnpm test:unit

# 4. Build
pnpm build

# 5. Test with examples
cd examples && tsx 01-deposit.ts
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

This SDK is built on top of the [marginfi protocol](https://github.com/mrgnlabs/marginfi-v2), leveraging its on-chain programs and infrastructure.

Additional thanks to:

- [Solana Web3.js](https://github.com/solana-labs/solana-web3.js) - Solana JavaScript API
- [Anchor](https://github.com/coral-xyz/anchor) - Solana development framework

## ⚠️ Disclaimer

This SDK is provided as-is. Always:

- Understand the risks of DeFi protocols
- Monitor your account health
- Use appropriate risk management
- Audit your integration code

---

**Built for builders** 🛠️ by the P0 team
