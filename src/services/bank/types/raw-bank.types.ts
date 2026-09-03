import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { WrappedI80F48 } from "~/types";

// ----------------------------------------------------------------------------
// On-chain types
// ----------------------------------------------------------------------------

interface BankRaw {
  group: PublicKey;
  mint: PublicKey;
  mintDecimals: number;

  assetShareValue: WrappedI80F48;
  liabilityShareValue: WrappedI80F48;

  liquidityVault: PublicKey;
  liquidityVaultBump: number;
  liquidityVaultAuthorityBump: number;

  insuranceVault: PublicKey;
  insuranceVaultBump: number;
  insuranceVaultAuthorityBump: number;
  collectedInsuranceFeesOutstanding: WrappedI80F48;

  feeVault: PublicKey;
  feeVaultBump: number;
  feeVaultAuthorityBump: number;
  collectedGroupFeesOutstanding: WrappedI80F48;

  lastUpdate: BN;

  config: BankConfigRaw;

  totalLiabilityShares: WrappedI80F48;
  totalAssetShares: WrappedI80F48;

  flags: BN;
  emissionsRate: BN;
  emissionsRemaining: WrappedI80F48;
  emissionsMint: PublicKey;

  /**
   * Fees collected and pending withdraw for the `FeeState.global_fee_wallet`'s canonical ATA for `mint`
   */
  collectedProgramFeesOutstanding?: WrappedI80F48;

  /**
   * Integration account slot 1 (default Pubkey for non-integrations).
   * - Kamino: reserve
   * - Drift: spot market
   * - Solend: reserve
   */
  integrationAcc1: PublicKey;
  /**
   * Integration account slot 2 (default Pubkey for non-integrations).
   * - Kamino: obligation
   * - Drift: user
   * - Solend: obligation
   */
  integrationAcc2: PublicKey;
  /**
   * Integration account slot 3 (default Pubkey for non-integrations).
   * - Drift: user stats
   * - JupLend: withdraw intermediary ATA (ATA of liquidity_vault_authority for bank mint)
   */
  integrationAcc3: PublicKey;

  /**
   * Rate limiter for controlling withdraw/borrow outflow.
   * Tracks net outflow (outflows - inflows) in native tokens.
   */
  rateLimiter?: BankRateLimiterRaw;

  emode: EmodeSettingsRaw;
  feesDestinationAccount?: PublicKey;
  cache?: BankCacheRaw;
  lendingPositionCount?: number;
  borrowingPositionCount?: number;
}

interface BankCacheRaw {
  baseRate: number;
  lendingRate: number;
  borrowingRate: number;
  interestAccumulatedFor: number;
  accumulatedSinceLastUpdate: WrappedI80F48;
  lastOraclePrice: WrappedI80F48;
  lastOraclePriceTimestamp: BN;
  lastOraclePriceConfidence: WrappedI80F48;
  liqCacheFlags: number;
  liquidationPriceRt: WrappedI80F48;
  liquidationPriceRtConfidence: WrappedI80F48;
  liquidationPriceTwap: WrappedI80F48;
  liquidationPriceTwapConfidence: WrappedI80F48;
}

/**
 * A sliding window rate limiter that tracks net outflow over a time window.
 * Net outflow = (withdraws + borrows) - (deposits + repays).
 */
interface RateLimitWindowRaw {
  maxOutflow: BN;
  windowDuration: BN;
  windowStart: BN;
  prevWindowOutflow: BN;
  curWindowOutflow: BN;
}

interface BankRateLimiterRaw {
  hourly: RateLimitWindowRaw;
  daily: RateLimitWindowRaw;
}

interface BankConfigRaw {
  assetWeightInit: WrappedI80F48;
  assetWeightMaint: WrappedI80F48;

  liabilityWeightInit: WrappedI80F48;
  liabilityWeightMaint: WrappedI80F48;

  depositLimit: BN;
  interestRateConfig: InterestRateConfigRaw;
  operationalState: OperationalStateRaw;

  oracleSetup: OracleSetupRaw;
  oracleKeys: PublicKey[];

  borrowLimit: BN;
  riskTier: RiskTierRaw;
  assetTag: number;
  configFlags?: number;

  totalAssetValueInitLimit: BN;
  oracleMaxAge: number;
  scopeEntryIndex?: number;
  oracleMaxConfidence: number;
  fixedPrice: WrappedI80F48;
}

interface BankConfigOptRaw {
  assetWeightInit: WrappedI80F48 | null;
  assetWeightMaint: WrappedI80F48 | null;

  liabilityWeightInit: WrappedI80F48 | null;
  liabilityWeightMaint: WrappedI80F48 | null;

  depositLimit: BN | null;
  borrowLimit: BN | null;
  operationalState: OperationalStateRaw | null;
  interestRateConfig: InterestRateConfigOptRaw | null;

  riskTier: RiskTierRaw | null;
  assetTag: number | null;
  totalAssetValueInitLimit: BN | null;

  oracleMaxConfidence: number | null;
  oracleMaxAge: number | null;
  permissionlessBadDebtSettlement: boolean | null;
  freezeSettings: boolean | null;
  tokenlessRepaymentsAllowed: boolean | null;

  liquidationLiquidatorFee: number | null;
  liquidationInsuranceFee: number | null;

  circuitBreakerEnabled: boolean | null;
  cbDeviationBpsTiers: number[] | null;
  cbTierDurationsSeconds: number[] | null;
  cbEscalationWindowMult: number | null;
  cbEmaAlphaBps: number | null;
  cbWindowSeconds: number | null;
  cbWindowMaxUpBps: number | null;
  cbWindowMaxDownBps: number | null;
}

interface BankConfigCompactRaw extends Omit<
  BankConfigRaw,
  "oracleKeys" | "oracleSetup" | "fixedPrice" | "interestRateConfig"
> {
  interestRateConfig: InterestRateConfigCompactRaw;
}

type RiskTierRaw = { collateral: Record<string, never> } | { isolated: Record<string, never> };

type OperationalStateRaw =
  | { paused: Record<string, never> }
  | { operational: Record<string, never> }
  | { reduceOnly: Record<string, never> }
  | { killedByBankruptcy: Record<string, never> }
  | { uninitialized: Record<string, never> }
  | { reduceOnlyWithBorrowingPower: Record<string, never> }
  | { circuitBroken: Record<string, never> };

interface RatePointRaw {
  util: number;
  rate: number;
}

interface InterestRateConfigRaw {
  // DEPRECATED legacy 3-point curve params (see InterestRateConfig in bank.types.ts)
  placeholder0: WrappedI80F48;
  placeholder1: WrappedI80F48;
  placeholder2: WrappedI80F48;

  // Fees
  insuranceFeeFixedApr: WrappedI80F48;
  insuranceIrFee: WrappedI80F48;
  protocolFixedFeeApr: WrappedI80F48;
  protocolIrFee: WrappedI80F48;
  protocolOriginationFee: WrappedI80F48;

  zeroUtilRate: number;
  hundredUtilRate: number;
  points: RatePointRaw[];
  curveType: number;
}

interface InterestRateConfigCompactRaw extends Omit<
  InterestRateConfigRaw,
  "placeholder0" | "placeholder1" | "placeholder2" | "curveType"
> {}

interface InterestRateConfigOptRaw extends InterestRateConfigCompactRaw {}

type OracleSetupRaw =
  | { none: Record<string, never> }
  | { pythLegacy: Record<string, never> }
  | { switchboardV2: Record<string, never> }
  | { pythPushOracle: Record<string, never> }
  | { switchboardPull: Record<string, never> }
  | { stakedWithPythPush: Record<string, never> }
  | { kaminoPythPush: Record<string, never> }
  | { kaminoSwitchboardPull: Record<string, never> }
  | { fixed: Record<string, never> }
  | { driftPythPull: Record<string, never> }
  | { driftSwitchboardPull: Record<string, never> }
  | { solendPythPull: Record<string, never> }
  | { solendSwitchboardPull: Record<string, never> }
  | { fixedKamino: Record<string, never> }
  | { fixedDrift: Record<string, never> }
  | { juplendPythPull: Record<string, never> }
  | { juplendSwitchboardPull: Record<string, never> }
  | { fixedJuplend: Record<string, never> }
  | { scope: Record<string, never> }
  | { pythMsol: Record<string, never> }
  | { kaminoMsol: Record<string, never> }
  | { juplendMsol: Record<string, never> }
  | { pythLst: Record<string, never> }
  | { kaminoLst: Record<string, never> }
  | { juplendLst: Record<string, never> }
  | { ptPyth: Record<string, never> }
  | { ptFixed: Record<string, never> };

interface OracleConfigOptRaw {
  setup: OracleSetupRaw;
  keys: PublicKey[];
}

interface BankMetadataRaw {
  bank: PublicKey;
  placeholder: BN;
  ticker: number[];
  description: number[];
  dataBlob: number[];
  endDescriptionByte: number;
  endDataBlob: number;
  endTickerByte: number;
  bump: number;
  pad0: number[];
}

interface EmodeEntryRaw {
  collateralBankEmodeTag: number;
  flags: number;
  assetWeightInit: WrappedI80F48;
  assetWeightMaint: WrappedI80F48;
}

export interface EmodeSettingsRaw {
  emodeTag: number;
  timestamp: BN;
  flags: BN;
  emodeConfig: EmodeConfigRaw;
}

export interface EmodeConfigRaw {
  entries: EmodeEntryRaw[];
}

export type {
  BankRaw,
  BankRateLimiterRaw,
  RateLimitWindowRaw,
  BankConfigRaw,
  BankConfigCompactRaw,
  BankMetadataRaw,
  RiskTierRaw,
  RatePointRaw,
  InterestRateConfigRaw,
  InterestRateConfigCompactRaw,
  InterestRateConfigOptRaw,
  OracleSetupRaw,
  OperationalStateRaw,
  OracleConfigOptRaw,
  BankConfigOptRaw,
};
