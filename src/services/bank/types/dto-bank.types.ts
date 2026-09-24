import {
  AssetTag,
  BankConfigFlag,
  EmodeEntryFlags,
  EmodeFlags,
  EmodeTag,
  OperationalState,
  OracleSetup,
  RiskTier,
} from "./bank.types";

/*
 * Bank types Dto
 */
export interface RatePointDto {
  util: number;
  rate: number;
}

export interface InterestRateConfigDto {
  // DEPRECATED legacy 3-point curve params (see InterestRateConfig in bank.types.ts)
  placeholder0: string;
  placeholder1: string;
  placeholder2: string;
  /** @deprecated pre-0.1.9 name for placeholder0 — only present on old serialized DTOs */
  optimalUtilizationRate?: string;
  /** @deprecated pre-0.1.9 name for placeholder1 — only present on old serialized DTOs */
  plateauInterestRate?: string;
  /** @deprecated pre-0.1.9 name for placeholder2 — only present on old serialized DTOs */
  maxInterestRate?: string;

  // Fees
  insuranceFeeFixedApr: string;
  insuranceIrFee: string;
  protocolFixedFeeApr: string;
  protocolIrFee: string;
  protocolOriginationFee: string;

  zeroUtilRate: number;
  hundredUtilRate: number;
  points: RatePointDto[];
  curveType: number;
}

export interface BankConfigDto {
  assetWeightInit: string;
  assetWeightMaint: string;

  liabilityWeightInit: string;
  liabilityWeightMaint: string;

  depositLimit: string;
  borrowLimit: string;

  riskTier: RiskTier;
  totalAssetValueInitLimit: string;
  assetTag: AssetTag;
  configFlags?: BankConfigFlag;

  interestRateConfig: InterestRateConfigDto;
  operationalState: OperationalState;

  oracleSetup: OracleSetup;
  oracleKeys: string[];
  oracleMaxAge: number;
  oracleMaxConfidence: number;
  fixedPrice: string;
  scopeEntryIndex?: number;
}

export interface RateLimitWindowDto {
  maxOutflow: string;
  windowDuration: number;
  windowStart: number;
  prevWindowOutflow: string;
  curWindowOutflow: string;
}

export interface BankRateLimiterDto {
  hourly: RateLimitWindowDto;
  daily: RateLimitWindowDto;
}

export interface EmodeEntryDto {
  collateralBankEmodeTag: EmodeTag;
  flags: EmodeEntryFlags[];
  assetWeightInit: string;
  assetWeightMaint: string;
}

export interface EmodeSettingsDto {
  emodeTag: EmodeTag;
  timestamp: number;
  flags: EmodeFlags[];
  emodeEntries: EmodeEntryDto[];
}

export interface BankTypeDto {
  address: string;
  tokenSymbol?: string;
  group: string;
  mint: string;
  mintDecimals: number;

  assetShareValue: string;
  liabilityShareValue: string;

  liquidityVault: string;
  liquidityVaultBump: number;
  liquidityVaultAuthorityBump: number;

  insuranceVault: string;
  insuranceVaultBump: number;
  insuranceVaultAuthorityBump: number;
  collectedInsuranceFeesOutstanding: string;

  feeVault: string;
  feeVaultBump: number;
  feeVaultAuthorityBump: number;
  collectedGroupFeesOutstanding: string;

  lastUpdate: number;

  config: BankConfigDto;

  totalAssetShares: string;
  totalLiabilityShares: string;

  emissionsActiveBorrowing: boolean;
  emissionsActiveLending: boolean;
  emissionsRate: number;
  emissionsMint: string;
  emissionsRemaining: string;
  collectedProgramFeesOutstanding?: string;

  stakedOracleDisabled?: boolean;
  stakedOracleUsesOnramp?: boolean;

  oracleKey: string;
  pythShardId?: number;
  emode: EmodeSettingsDto;
  rateLimiter?: BankRateLimiterDto;
  feesDestinationAccount?: string;
  lendingPositionCount?: string;
  borrowingPositionCount?: string;

  kaminoIntegrationAccounts?: {
    kaminoReserve: string;
    kaminoObligation: string;
  };
  driftIntegrationAccounts?: {
    driftSpotMarket: string;
    driftUser: string;
    driftUserStats: string;
  };
  solendIntegrationAccounts?: {
    solendReserve: string;
    solendObligation: string;
  };
  jupLendIntegrationAccounts?: {
    jupLendingState: string;
    jupFTokenVault: string;
    jupFTokenAta: string;
  };
  stakedIntegrationAccounts?: {
    validatorVoteAccount: string;
  };
}

