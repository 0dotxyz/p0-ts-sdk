# Testing Guide for P0 TypeScript SDK

## Overview

The SDK uses a **two-tier testing strategy**:

1. **Unit Tests** - Fast, mocked, run in CI
2. **Integration Tests** - Real RPC calls, optional for CI

---

## 🎯 Proposal 1: Unit Tests with Mocks (RECOMMENDED)

**Best for:** CI/CD, rapid development, OSS contributions

### Structure
```
tests/
├── fixtures/           # Shared test data
│   └── banks.fixture.ts
├── unit/              # Unit tests (mocked)
│   ├── actions/
│   │   ├── deposit.test.ts
│   │   ├── borrow.test.ts
│   │   └── withdraw.test.ts
│   ├── models/
│   └── services/
└── integration/       # Integration tests (real RPC)
    └── deposit.integration.test.ts
```

### Run Unit Tests
```bash
# Fast, no RPC needed
pnpm test:unit

# Watch mode
pnpm test:unit --watch

# With coverage
pnpm test:unit --coverage
```

### Example Unit Test
```typescript
import { describe, it, expect, vi } from "vitest";
import { makeDepositIx } from "../../../src";
import { createMockConnection } from "../../fixtures/banks.fixture";

describe("Deposit", () => {
  it("should create deposit instruction", () => {
    const mockConnection = createMockConnection();
    // Test with mocked data
  });
});
```

**Pros:**
- ✅ Fast (milliseconds)
- ✅ No external dependencies
- ✅ Works in CI without RPC
- ✅ Easy for contributors

**Cons:**
- ❌ Doesn't catch RPC-level issues
- ❌ Mocks can drift from reality

---

## 🌐 Proposal 2: Integration Tests with Real RPC

**Best for:** Pre-release validation, catching real-world issues

### Setup

1. **Create `.env.test`:**
```bash
cp .env.test.example .env.test
```

2. **Option A: Local Validator (Fastest)**
```bash
# Terminal 1: Start validator
solana-test-validator

# Terminal 2: Run tests
SOLANA_RPC_URL=http://localhost:8899 pnpm test:integration
```

3. **Option B: Devnet (CI-friendly)**
```bash
# Free, public, but slower
export SOLANA_RPC_URL=https://api.devnet.solana.com
pnpm test:integration
```

4. **Option C: Mainnet Fork (Production-like)**
```bash
# Requires paid RPC (Helius, QuickNode, etc.)
export SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
pnpm test:integration
```

### Run Integration Tests
```bash
# With local validator
pnpm test:integration

# Skip if no RPC (uses vitest.skipIf)
pnpm test:integration  # Auto-skips if SOLANA_RPC_URL not set
```

**Pros:**
- ✅ Tests real blockchain behavior
- ✅ Catches RPC-level bugs
- ✅ High confidence

**Cons:**
- ❌ Slower (seconds per test)
- ❌ Requires RPC access
- ❌ Can be flaky (network issues)
- ❌ Costs money on mainnet

---

## 🏭 Proposal 3: Hybrid (INDUSTRY STANDARD) ⭐

**Best for:** Production SDKs (this is what Solana, Uniswap, Anchor do)

### Strategy

1. **Unit tests for logic** (90% of tests)
   - Instruction building
   - Calculations
   - Validation
   - Error handling

2. **Integration tests for critical paths** (10% of tests)
   - End-to-end deposit flow
   - Transaction simulation
   - Account creation

3. **CI Configuration**
```yaml
# .github/workflows/ci.yml
test:
  - name: Unit Tests
    run: pnpm test:unit
  
  - name: Integration Tests (with local validator)
    run: |
      solana-test-validator &
      sleep 5
      pnpm test:integration
```

### Recommended Split

**Unit Tests (Fast, Always Run):**
```typescript
✅ makeDepositIx() - instruction building
✅ computeHealthFactor() - calculations
✅ validateAmount() - input validation
✅ parseBankData() - data parsing
```

**Integration Tests (Slow, Optional):**
```typescript
✅ Full deposit transaction (e2e)
✅ Account creation flow
✅ Transaction simulation
❌ Skip in CI if too slow/expensive
```

---

## 📝 Writing Tests

### Unit Test Template
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FIXTURES, createMockConnection } from "../../fixtures/banks.fixture";

describe("Feature Name", () => {
  let mockConnection: any;

  beforeEach(() => {
    mockConnection = createMockConnection();
    vi.clearAllMocks();
  });

  it("should do something", () => {
    // Arrange
    const input = "test";
    
    // Act
    const result = yourFunction(input);
    
    // Assert
    expect(result).toBe("expected");
  });
});
```

### Integration Test Template
```typescript
import { describe, it, expect } from "vitest";
import { Connection } from "@solana/web3.js";

describe("Feature Integration", () => {
  it.skipIf(!process.env.SOLANA_RPC_URL)("should work with real RPC", async () => {
    const connection = new Connection(process.env.SOLANA_RPC_URL!);
    // Test with real RPC
  });
});
```

---

## 🎨 Fixtures & Mocks

### Bank Fixtures (`tests/fixtures/banks.fixture.ts`)
```typescript
export const FIXTURES = {
  SOL_BANK: { address: "...", mint: "..." },
  USDC_BANK: { address: "...", mint: "..." },
};

export function createMockConnection() {
  return {
    getAccountInfo: vi.fn().mockResolvedValue(mockData),
    // ... other methods
  };
}
```

### Usage
```typescript
import { FIXTURES, createMockConnection } from "../fixtures/banks.fixture";

const connection = createMockConnection();
const bank = FIXTURES.SOL_BANK;
```

---

## 🚀 Best Practices

### 1. Environment Variables
```typescript
// ✅ Good: Provide defaults, skip gracefully
const RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8899";

// ✅ Good: Skip integration tests if no RPC
it.skipIf(!process.env.SOLANA_RPC_URL)("test name", () => {});

// ❌ Bad: Hard-code RPC URLs
const connection = new Connection("https://api.mainnet-beta.solana.com");
```

### 2. Test Isolation
```typescript
// ✅ Good: Each test is independent
beforeEach(() => {
  vi.clearAllMocks();
});

// ❌ Bad: Tests depend on each other
let sharedState;
it("test 1", () => { sharedState = 1; });
it("test 2", () => { expect(sharedState).toBe(1); });
```

### 3. Use Real Constants
```typescript
// ✅ Good: Use actual mainnet addresses for fixtures
export const FIXTURES = {
  SOL_BANK: new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh"),
};

// ❌ Bad: Fake addresses
export const FIXTURES = {
  SOL_BANK: new PublicKey("11111111111111111111111111111111"),
};
```

---

## 📊 Coverage Goals

```bash
# Run with coverage
pnpm test:coverage

# Target coverage:
# - Statements: > 70%
# - Branches: > 60%
# - Functions: > 70%
# - Lines: > 70%
```

---

## 🔧 CI/CD Integration

### GitHub Actions Example
```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    
    # Always run unit tests
    - name: Unit Tests
      run: pnpm test:unit --coverage
    
    # Optional: Run integration tests with local validator
    - name: Setup Solana
      uses: metaplex-foundation/actions/install-solana@v1
      with:
        version: 1.17.0
    
    - name: Start Local Validator
      run: solana-test-validator &
    
    - name: Integration Tests
      run: pnpm test:integration
      env:
        SOLANA_RPC_URL: http://localhost:8899
```

---

## 📚 Examples from Industry

### Similar SDKs Testing Approaches:

**@solana/web3.js**
- Unit tests with mocks
- Integration tests with local validator
- CI runs both

**@coral-xyz/anchor**
- Unit tests for TypeScript client
- Integration tests with `anchor test`
- Uses local validator

**@uniswap/v3-sdk**
- Unit tests with hardhat
- Integration tests on fork
- Extensive fixtures

---

## ✅ My Recommendation: **Proposal 3 (Hybrid)**

Start with:
1. ✅ Unit tests for all logic (use mocks)
2. ✅ Integration tests for 2-3 critical flows
3. ✅ CI runs unit tests always
4. ✅ CI runs integration tests with local validator (optional)
5. ✅ Developers can run integration tests against devnet/mainnet

This gives you:
- Fast feedback loop
- High confidence
- Low CI costs
- Easy for contributors
