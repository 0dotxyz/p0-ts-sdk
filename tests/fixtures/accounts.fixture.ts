import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { MarginfiAccountType, BankType, OraclePrice, RiskTier } from "../../src";

/**
 * Realistic test fixtures based on actual mainnet data
 * These can be used for unit testing calculations without network calls
 */

export const TEST_ADDRESSES = {
  GROUP: new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8"),
  PROGRAM: new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
  
  // Real mainnet banks
  SOL_BANK: new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh"),
  USDC_BANK: new PublicKey("2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB"),
  USDT_BANK: new PublicKey("BQ7RWaJfcw2fWfNWwdXtdgDcWJHLk7MsH7rUHzxtA9F3"),
  
  // Mints
  SOL_MINT: new PublicKey("So11111111111111111111111111111111111111112"),
  USDC_MINT: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT_MINT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
};

/**
 * Create a minimal mock BankType for testing
 */
export function createMockBank(overrides?: Partial<BankType>): BankType {
  return {
    address: TEST_ADDRESSES.SOL_BANK,
    mint: TEST_ADDRESSES.SOL_MINT,
    mintDecimals: 9,
    group: TEST_ADDRESSES.GROUP,
    
    config: {
      assetWeightInit: new BigNumber(0.75), // 75% LTV
      assetWeightMaint: new BigNumber(0.85), // 85% liquidation
      liabilityWeightInit: new BigNumber(1.25),
      liabilityWeightMaint: new BigNumber(1.15),
      depositLimit: new BigNumber(1_000_000),
      borrowLimit: new BigNumber(500_000),
      riskTier: RiskTier.Collateral,
      interestRateConfig: {
        optimalUtilizationRate: new BigNumber(0.8),
        plateauInterestRate: new BigNumber(0.1),
        maxInterestRate: new BigNumber(3),
        insuranceFeeFixedApr: new BigNumber(0),
        insuranceIrFee: new BigNumber(0),
        protocolFixedFeeApr: new BigNumber(0.01),
        protocolIrFee: new BigNumber(0.05),
      },
      operationalState: 0, // Operational
      oracleSetup: 0,
      oracleKeys: [PublicKey.default],
      totalAssetValueInitLimit: new BigNumber(0),
      oracleMaxAge: 60,
      permissionlessBadDebtSettlement: null,
    },
    
    emissionsRate: new BigNumber(0),
    emissionsMint: PublicKey.default,
    emissionsRemaining: new BigNumber(0),
    
    totalAssetShares: new BigNumber(1_000_000),
    totalLiabilityShares: new BigNumber(300_000),
    lastUpdate: new BigNumber(Date.now() / 1000),
    
    emode: null,
    
    ...overrides,
  } as BankType;
}

/**
 * Create a mock MarginfiAccount with balances
 */
export function createMockAccount(balances?: Array<{
  bankPk: PublicKey;
  assetShares: BigNumber;
  liabilityShares: BigNumber;
}>): MarginfiAccountType {
  const fullBalances = (balances || []).map(b => ({
    ...b,
    active: true,
    emissionsOutstanding: new BigNumber(0),
    lastUpdate: Math.floor(Date.now() / 1000),
  }));
  
  return {
    address: PublicKey.default,
    group: TEST_ADDRESSES.GROUP,
    authority: PublicKey.default,
    balances: fullBalances,
    accountFlags: [],
    emissionsDestinationAccount: PublicKey.default,
    healthCache: null as any, // Not needed for unit tests
  } as MarginfiAccountType;
}

/**
 * Create mock oracle price
 */
export function createMockOraclePrice(price: number = 100): OraclePrice {
  return {
    priceRealtime: {
      price: new BigNumber(price),
      confidence: new BigNumber(price * 0.01), // 1% confidence
      lowestPrice: new BigNumber(price * 0.99),
      highestPrice: new BigNumber(price * 1.01),
    },
    priceWeighted: {
      price: new BigNumber(price),
      confidence: new BigNumber(price * 0.01),
      lowestPrice: new BigNumber(price * 0.99),
      highestPrice: new BigNumber(price * 1.01),
    },
    timestamp: new BigNumber(Date.now() / 1000),
  };
}

/**
 * Scenario: Healthy account with SOL collateral, wants to borrow USDC
 */
export function createHealthyAccountScenario() {
  const solBank = createMockBank({
    address: TEST_ADDRESSES.SOL_BANK,
    mint: TEST_ADDRESSES.SOL_MINT,
    mintDecimals: 9,
  });
  
  const usdcBank = createMockBank({
    address: TEST_ADDRESSES.USDC_BANK,
    mint: TEST_ADDRESSES.USDC_MINT,
    mintDecimals: 6,
    config: {
      ...createMockBank().config,
      assetWeightInit: new BigNumber(0.9), // Stablecoin
      assetWeightMaint: new BigNumber(0.95),
    },
  });
  
  const account = createMockAccount([
    {
      bankPk: TEST_ADDRESSES.SOL_BANK,
      assetShares: new BigNumber(10_000_000_000), // 10 SOL deposited
      liabilityShares: new BigNumber(0),
    },
  ]);
  
  const oraclePrices = new Map<string, OraclePrice>([
    [TEST_ADDRESSES.SOL_BANK.toBase58(), createMockOraclePrice(150)], // $150/SOL
    [TEST_ADDRESSES.USDC_BANK.toBase58(), createMockOraclePrice(1)], // $1/USDC
  ]);
  
  const banks = new Map<string, BankType>([
    [TEST_ADDRESSES.SOL_BANK.toBase58(), solBank],
    [TEST_ADDRESSES.USDC_BANK.toBase58(), usdcBank],
  ]);
  
  return { account, banks, oraclePrices, solBank, usdcBank };
}

/**
 * Scenario: Account with existing borrows, wants to withdraw
 */
export function createAccountWithBorrowsScenario() {
  const solBank = createMockBank({
    address: TEST_ADDRESSES.SOL_BANK,
    mint: TEST_ADDRESSES.SOL_MINT,
    mintDecimals: 9,
  });
  
  const usdcBank = createMockBank({
    address: TEST_ADDRESSES.USDC_BANK,
    mint: TEST_ADDRESSES.USDC_MINT,
    mintDecimals: 6,
  });
  
  const account = createMockAccount([
    {
      bankPk: TEST_ADDRESSES.SOL_BANK,
      assetShares: new BigNumber(20_000_000_000), // 20 SOL deposited
      liabilityShares: new BigNumber(0),
    },
    {
      bankPk: TEST_ADDRESSES.USDC_BANK,
      assetShares: new BigNumber(0),
      liabilityShares: new BigNumber(1000_000_000), // 1000 USDC borrowed
    },
  ]);
  
  const oraclePrices = new Map<string, OraclePrice>([
    [TEST_ADDRESSES.SOL_BANK.toBase58(), createMockOraclePrice(150)],
    [TEST_ADDRESSES.USDC_BANK.toBase58(), createMockOraclePrice(1)],
  ]);
  
  const banks = new Map<string, BankType>([
    [TEST_ADDRESSES.SOL_BANK.toBase58(), solBank],
    [TEST_ADDRESSES.USDC_BANK.toBase58(), usdcBank],
  ]);
  
  return { account, banks, oraclePrices, solBank, usdcBank };
}
