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
ts-node 01-deposit.ts

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
ts-node examples/02-borrow.ts
```

**What you'll learn:**

- Calculate maximum borrow capacity
- Create borrow instructions
- Check health factor before borrowing

#### 3. Withdraw (`03-withdraw.ts`)

Withdraw your deposited collateral.

```bash
ts-node examples/03-withdraw.ts
```

**What you'll learn:**

- Calculate maximum withdraw amount
- Withdraw partial or full positions
- Maintain account health

#### 4. Repay (`04-repay.ts`)

Repay borrowed tokens to reduce liabilities.

```bash
ts-node examples/04-repay.ts
```

**What you'll learn:**

- Check current liabilities
- Repay partial or full debt
- Improve account health

### Oracle & Pricing

#### 5. Oracle Prices (`05-oracle-prices.ts`)

Fetch and update oracle prices for all banks.

```bash
ts-node examples/05-oracle-prices.ts
```

**What you'll learn:**

- Access real-time oracle prices
- Manually refresh price data
- Work with Pyth and Switchboard oracles
- Understand price confidence intervals

### Account Health

#### 6. Account Health (`06-account-health.ts`)

Monitor your account's health and risk metrics.

```bash
ts-node examples/06-account-health.ts
```

**What you'll learn:**

- Compute health components (assets vs liabilities)
- Calculate health factor
- Monitor free collateral
- Track net APY
- Access health cache

#### 7. Remaining Collateral (`07-remaining-collateral.ts`)

Calculate borrowing capacity and available collateral.

```bash
ts-node examples/07-remaining-collateral.ts
```

**What you'll learn:**

- Calculate free collateral in USD
- Determine max borrow per bank
- Check max withdraw per position
- Monitor account utilization

### Bank Management

#### 10. Bank Filtering (`10-bank-filtering.ts`)

Filter banks by mint address and asset tag.

```bash
ts-node 10-bank-filtering.ts
```

**What you'll learn:**

- Use `getBanksByMint()` to get all banks matching a mint
- Filter by AssetTag (DEFAULT, KAMINO, STAKED)
- Distinguish between main protocol and Kamino banks
- Handle cases where multiple banks exist for the same mint
- Select specific banks from the returned array

### Advanced Operations

#### 8. Repay with Collateral (`08-repay-with-collateral.ts`)

Repay debt by swapping collateral assets.

```bash
ts-node examples/08-repay-with-collateral.ts
```

**What you'll learn:**

- Withdraw collateral
- Swap via Jupiter
- Repay debt in one transaction
- Handle complex multi-step operations

#### 9. Loop/Leverage (`09-loop-leverage.ts`)

Create leveraged positions by looping deposits and borrows.

```bash
ts-node examples/09-loop-leverage.ts
```

**What you'll learn:**

- Build leveraged positions
- Use Jupiter swaps for leverage
- Deposit → Borrow → Swap → Deposit loops
- Maximize capital efficiency

### Native Stake Operations

#### 12. Mint Staked LST (`12-mint-staked-lst.ts`)

Convert a native stake account into LST tokens via the single-validator pool.

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

## 🏗️ Architecture

### Project0Client

The central client that manages all marginfi interactions:

```typescript
const client = await Project0Client.initialize(connection, {
  environment: "production",
  groupPk: new PublicKey("YOUR_GROUP_ADDRESS"),
  programId: new PublicKey("YOUR_PROGRAM_ID"),
});

// Access preloaded data
client.bankMap              // Map of all banks
client.oraclePriceByBank   // Current oracle prices
client.mintDataByBank      // Token program data (keyed by bank address)
client.addressLookupTables // For transaction optimization

// Get banks
client.getBank(address)             // Get bank by address
client.getBanksByMint(mint, tag?)   // Get all banks by mint (+ optional tag filter)
```

### MarginfiAccountWrapper

Clean API wrapper around MarginfiAccount:

```typescript
// Create wrapper
const wrappedAccount = new MarginfiAccountWrapper(account, client);

// Clean method calls - no need to pass banks, oracles, etc.
await wrappedAccount.makeDepositIx(bankAddress, amount);
const health = wrappedAccount.computeFreeCollateral();
const maxBorrow = wrappedAccount.computeMaxBorrowForBank(bankAddress);
```

## 🎯 Best Practices

### 1. Always Check Health

Before any operation, check your account health:

```typescript
const freeCollateral = wrappedAccount.computeFreeCollateral();
const healthComponents = wrappedAccount.computeHealthComponents(
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
  pythOpts: { mode: "on-chain", connection },
  swbOpts: { mode: "on-chain", connection },
});
```

## 🔧 Common Patterns

### Initialize Once, Use Everywhere

```typescript
// Initialize at app startup
const client = await Project0Client.initialize(connection, config);

// Reuse throughout your app
function depositHandler() {
  const account = await MarginfiAccount.fetch(userAddress, client.program);
  const wrapped = new MarginfiAccountWrapper(account, client);
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
import BigNumber from "bignumber.js";

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
} from "p0-ts-sdk";
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
const freeCollateral = wrappedAccount.computeFreeCollateral();
console.log("Free collateral:", freeCollateral.toString());
```

### Transaction Size Issues

For complex transactions (loop, repay with collat), you may need to use versioned transactions with lookup tables:

```typescript
// Lookup tables are automatically loaded in client.addressLookupTables
const tx = new VersionedTransaction(message);
```

## 📚 Additional Resources

- [Marginfi Documentation](https://docs.marginfi.com)
- [TypeScript SDK Reference](../README.md)
- [Solana Web3.js Docs](https://solana-labs.github.io/solana-web3.js/)

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
