# Integration Tests

Integration tests run against **real Solana RPC endpoints**. The tests are designed to work in **read-only mode** by default (safe for mainnet).

## 🚀 Quick Start

```bash
# Mainnet (read-only, safe)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com pnpm test:integration

# With your own RPC
SOLANA_RPC_URL=https://your-helius-rpc.com pnpm test:integration

# With specific test account (optional)
TEST_MARGINFI_ACCOUNT=YourAccountAddress pnpm test:integration
```

## ✅ Current Test Coverage

### **deposit.integration.test.ts** (Completed)
- ✅ Client initialization with real chain data
- ✅ Bank fetching and validation
- ✅ Oracle price verification
- ✅ Account fetching
- ✅ Transaction building (read-only)
- ✅ Transaction simulation
- ✅ Interest rate validation
- ✅ Weight configuration checks

### **loop.integration.test.ts** (TODO)
- 🔄 Jupiter integration
- 🔄 Leverage transaction building
- 🔄 Multi-step CPI validation

## 🔧 Setup Options

### Option 1: Mainnet (Recommended) ⭐
**Best for:** Testing with real data, no setup required

```bash
# Free public RPC (rate-limited)
export SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Or paid RPC (recommended)
export SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

pnpm test:integration
```

**Tests run in READ-ONLY mode** - safe to run against mainnet!

### Option 2: Local Validator
**Best for:** Testing write operations

```bash
# Terminal 1: Start validator
solana-test-validator

# Terminal 2: Run tests
SOLANA_RPC_URL=http://localhost:8899 pnpm test:integration
```

**Note:** Requires deploying the marginfi program locally.

### Option 3: Devnet
**Best for:** CI/CD

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
pnpm test:integration
```

## 📝 Environment Variables

Create `.env.test` file (optional):

```bash
# Required
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Optional - use your own test account
TEST_MARGINFI_ACCOUNT=<your_account_address>

# Otherwise, tests use a known public account for read-only tests
```

## 🎯 Running Tests

```bash
# All integration tests
pnpm test:integration

# Specific test file
pnpm test:integration deposit

# Watch mode
pnpm test:integration --watch

# With verbose output
pnpm test:integration --reporter=verbose
```

## 📊 What Gets Tested

### ✅ Read-Only Tests (Safe for Mainnet)
- Client initialization
- Bank data fetching
- Oracle price fetching
- Account state reading
- Transaction **building** (not sending)
- Transaction **simulation** (not sending)
- Data validation

### 🔴 Write Tests (Need Local/Devnet)
- Actual transaction sending
- Account creation
- Token transfers
- Loop/leverage execution

Currently, all tests are **read-only** and safe to run on mainnet!

## 🐛 Troubleshooting

### "RPC rate limit exceeded"
Use a paid RPC provider (Helius, QuickNode, etc.)

### "Account not found"
Set `TEST_MARGINFI_ACCOUNT` to an account that exists on your target network

### "Program not found"
Make sure you're using the correct network (mainnet/devnet)

### Tests taking too long
```bash
# Increase timeout
pnpm test:integration --testTimeout=60000
```

## 📈 Adding New Tests

```typescript
it.skipIf(!process.env.SOLANA_RPC_URL)(
  "your test name",
  async () => {
    // Your test code
  },
  30000 // 30s timeout
);
```

**Always use `skipIf`** - tests auto-skip if RPC not configured!

## 🎓 Best Practices

1. ✅ **Read-only by default** - Don't send transactions unless necessary
2. ✅ **Use real addresses** - Test against actual mainnet banks/accounts
3. ✅ **Simulate transactions** - Use `simulateTransaction` to validate
4. ✅ **Handle failures gracefully** - Account might not have authority
5. ✅ **Log useful info** - Help debug when tests fail

## 🚦 CI/CD

```yaml
# .github/workflows/integration.yml
test-integration:
  - name: Integration Tests (Mainnet Read-Only)
    run: pnpm test:integration
    env:
      SOLANA_RPC_URL: https://api.mainnet-beta.solana.com
```

No validator setup needed for CI! Tests run read-only against mainnet.
