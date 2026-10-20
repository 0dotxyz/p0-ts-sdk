# Project 0 SDK Examples

This directory contains practical examples demonstrating how to use the Project 0 SDK.

## 📚 Overview

The examples are organized by functionality, from basic operations to advanced use cases. Each example is a standalone TypeScript file with detailed comments.

## 🚀 Getting Started

### Prerequisites

```bash
# Install dependencies (from monorepo root)
pnpm install

# Or install dotenv if running standalone
pnpm add dotenv
```

### Configuration

**Step 1:** Copy the example environment file:

```bash
cd examples
cp .env.example .env
```

**Step 2:** Edit `.env` and fill in your values:

```bash
# Required
MARGINFI_GROUP_ADDRESS=4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8
MARGINFI_PROGRAM_ID=MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA
MARGINFI_ACCOUNT_ADDRESS=<your_account_address>

# Optional - defaults are provided
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
MARGINFI_ENVIRONMENT=production
```

**Note:** The `.env` file is gitignored for security. Never commit private keys!

## 📖 Examples

### Basic Operations

#### 1. Deposit (`01-deposit.ts`)

Deposit tokens into a bank to earn interest and use as collateral.

```bash
# From the examples directory
npx tsx examples/01-deposit.ts

# Or with tsx (recommended)
pnpm exec tsx 01-deposit.ts
```

**What you'll learn:**

- Initialize the Project0Client
- Fetch a marginfi account
- Create a wrapper for clean API
- Deposit tokens into a bank

#### 2. Borrow (`02-borrow.ts`)

Borrow tokens against your collateral.

```bash
npx tsx examples/02-borrow.ts
```

**What you'll learn:**

- Calculate maximum borrow capacity
- Create borrow instructions
- Check health factor before borrowing

#### 3. Withdraw (`03-withdraw.ts`)

Withdraw your deposited collateral.

```bash
npx tsx examples/03-withdraw.ts
```

**What you'll learn:**

- Calculate maximum withdraw amount
- Withdraw partial or full positions
- Maintain account health

#### 4. Repay (`04-repay.ts`)

Repay borrowed tokens to reduce liabilities.

```bash
npx tsx examples/04-repay.ts
```

**What you'll learn:**

- Check current liabilities
- Repay partial or full debt
- Improve account health

### Oracle & Pricing

#### 5. Oracle Prices (`05-oracle-prices.ts`)

Fetch and refresh oracle prices for all banks.

```bash
npx tsx examples/05-oracle-prices.ts
```

**What you'll learn:**

- Access real-time oracle prices
- Refresh price data with `fetchOracleData` (Pyth, Scope, share multipliers)
- Understand price confidence intervals

### Account Health

#### 6a. Simulated Health (`06a-account-health-simulated.ts`)

Refresh the account's health cache by simulation and read its metrics.

```bash
npx tsx examples/06a-account-health-simulated.ts
```

**What you'll learn:**

- Simulate the on-chain health cache (needs an RPC with `simulateBundle`)
- Compute health components, free collateral, account value and net APY

#### 6b. Calculated Health (`06b-account-health-calculated.ts`)

Calculate health from balances and oracle prices, and compare it with the on-chain cache.

```bash
npx tsx examples/06b-account-health-calculated.ts
```

### Flash-Loan Flows

These build atomic flash-loan transactions around a swap (Titan/Jupiter swap engine, see
`getSwapConfig` in `config.ts`) and simulate them as a Jito bundle.

- **`10-swap-collateral.ts`** - swap one collateral position into another (`makeBridgedSwapCollateralTx`)
- **`11-swap-debt.ts`** - swap one debt position into another (`makeBridgedSwapDebtTx`)
- **`15-roll-pt.ts`** - roll a matured Exponent PT position into its successor PT (`makeRollPtTx`);
  `create-pt-roll-lut.ts` creates the lookup table for a roll (sends transactions, needs `LUT_KEYPAIR`)
- **`16a-loop.ts`** - leverage loop with a direct swap (`makeLoopTx`)
- **`16b-loop-bridged.ts`** - leverage loop with a bridged double-hop fallback (`makeBridgedLoopTx`)
- **`16c-loop-pinned-route.ts`** - inspect or pin the swap route (`swapEngineRunner`, `swapOpts.swapIxs`)
- **`99-bridged-loop-forced.ts`** - forces the bridged fallback to test it
- **`swap-engine.ts`** - runs the swap engine alone for a token pair

### Native Stake Operations

#### 12. Mint Staked LST (`12-mint-staked-lst.ts`)

Convert a native stake account into LST tokens via the single-validator pool. Needs
`WALLET_ADDRESS` (the stake authority) and the stake/vote accounts set in the file.

```bash
pnpm exec tsx 12-mint-staked-lst.ts
```

**What you'll learn:**

- Convert native stake to LST tokens
- Handle partial vs full stake account conversion
- Authorize pool as staker/withdrawer
- Deposit stake into a single-validator pool

#### 13. Redeem Staked LST (`13-redeem-staked-lst.ts`)

Convert LST tokens back into a native stake account.

```bash
pnpm exec tsx 13-redeem-staked-lst.ts
```

**What you'll learn:**

- Redeem LST tokens to a new stake account
- Approve mint authority to burn LST
- Withdraw stake from the pool

#### 14. Merge Stake Accounts (`14-merge-stake-accounts.ts`)

Merge two native stake accounts into one.

```bash
pnpm exec tsx 14-merge-stake-accounts.ts
```

**What you'll learn:**

- Merge a source stake account into a destination
- Requirements: same authority, same validator, both active

### Accounts

#### 18. Mint Holders (`18-mint-holders.ts`)

List every account holding a mint and its balances (`getAccountAddressesHoldingBank`,
`getAuthorityBalancesForMint`).

```bash
pnpm exec tsx 18-mint-holders.ts [MINT]
```

## 🏗️ Architecture

### Project0Client

The central client that manages all marginfi interactions:

```typescript
const rpcEndpoint = "YOUR_RPC_URL";
const client = await Project0Client.initialize(
  { rpc: createSolanaRpc(rpcEndpoint), rpcEndpoint },
  {
    environment: "production",
    groupPk: address("YOUR_GROUP_ADDRESS"),
    programId: address("YOUR_PROGRAM_ID"),
  }
);

// Access preloaded data
client.bankMap              // Map of all banks
client.oraclePriceByBank   // Current oracle prices
client.mintDataByBank      // Token program data (keyed by bank address)
client.addressLookupTables // For transaction optimization

// Get banks
client.getBank(address)             // Get bank by address
client.getBanksByMint(mint, tag?)   // Get all banks by mint (+ optional tag filter)
client.fetchAccount(address)        // Fetch an account, simulate its health cache, wrap it
```

### MarginfiAccountWrapper

Clean API wrapper around MarginfiAccount:

```typescript
// Create wrapper; transactions are built for `signer` (default: a noop signer for the authority)
const wrappedAccount = new MarginfiAccountWrapper(account, client, signer);

// Clean method calls - no need to pass banks, oracles, etc.
await wrappedAccount.makeDepositIx(bankAddress, amount);
const health = wrappedAccount.computeFreeCollateralFromCache();
const maxBorrow = wrappedAccount.computeMaxBorrowForBank(bankAddress);
```

## 🎯 Best Practices

### 1. Always Check Health

Before any operation, check your account health:

```typescript
const freeCollateral = wrappedAccount.computeFreeCollateralFromCache();
const healthComponents = wrappedAccount.computeHealthComponentsFromCache(
  MarginRequirementType.Maintenance
);
```

### 2. Use Max Amount Calculations

Never hardcode amounts - always check limits:

```typescript
const maxBorrow = wrappedAccount.computeMaxBorrowForBank(bankAddress);
const maxWithdraw = wrappedAccount.computeMaxWithdrawForBank(bankAddress);
```

### 3. Handle Errors Gracefully

```typescript
try {
  const ix = await wrappedAccount.makeBorrowIx(bankAddress, amount);
  // Process instruction
} catch (error) {
  console.error("Failed to create borrow instruction:", error);
  // Handle error appropriately
}
```

### 4. Refresh Oracle Prices

For critical operations, refresh prices first:

```typescript
const { bankOraclePriceMap } = await fetchOracleData(client.banks, {
  pythOpts: { mode: "on-chain", rpc },
  scopeOpts: { mode: "on-chain", rpc },
});
```

## 🔧 Common Patterns

### Initialize Once, Use Everywhere

```typescript
// Initialize at app startup
const client = await Project0Client.initialize({ rpc, rpcEndpoint }, config);

// Reuse throughout your app
async function depositHandler() {
  const wrapped = await client.fetchAccount(userAddress, false, walletSigner);
  // ... perform operations
}
```

### Batch Health Checks

```typescript
// Check multiple banks at once
const activePairs = wrappedAccount.computeActiveEmodePairs(emodePairs);
const impacts = wrappedAccount.computeEmodeImpacts(emodePairs, bankAddresses);
```

### Safe Amount Handling

```typescript
import { BigNumber } from "bignumber.js";

// Always use BigNumber for precision
const amount = new BigNumber(userInput);
const maxAmount = wrappedAccount.computeMaxBorrowForBank(bank.address);

if (amount.gt(maxAmount)) {
  throw new Error(`Amount exceeds maximum: ${maxAmount.toString()}`);
}
```

## 📝 TypeScript Support

All examples include full type safety:

```typescript
import {
  Project0Client,
  MarginfiAccount,
  MarginfiAccountWrapper,
  MarginRequirementType,
  Bank,
  OraclePrice,
} from "@0dotxyz/p0-ts-sdk";
```

## 🐛 Troubleshooting

### "Bank not found"

Ensure you're using the correct mint address and the bank exists in the client's bankMap:

```typescript
const banks = client.getBanksByMint(mintAddress);
if (banks.length === 0) {
  console.log("Available banks:", Array.from(client.bankMap.keys()));
}
const bank = banks[0]; // Use first matching bank
```

### "Insufficient free collateral"

Check your account health before borrowing:

```typescript
const freeCollateral = wrappedAccount.computeFreeCollateralFromCache();
console.log("Free collateral:", freeCollateral.toString());
```

### Transaction Size Issues

Transactions are v0 messages compressed with the group's lookup tables
(`client.addressLookupTables`, passed automatically by the wrapper). Flash-loan flows size the swap
to what fits and fall back to bridged bundles (`makeBridged*Tx`) when a route doesn't fit.

## 📚 Additional Resources

- [Marginfi Documentation](https://docs.marginfi.com)
- [TypeScript SDK Reference](../README.md)
- [Solana Kit](https://github.com/anza-xyz/kit)

## 🤝 Contributing

Found an issue or want to add an example? Contributions are welcome!

1. Add your example to this directory
2. Follow the existing naming convention (`##-feature-name.ts`)
3. Include detailed comments and error handling
4. Update this README with your example

## ⚠️ Disclaimer

These examples are for educational purposes. Always:

- Test on devnet first
- Use small amounts initially
- Understand the risks of leveraged positions
- Monitor your account health regularly
- Never share your private keys
