import { BigNumber } from "bignumber.js";

import {
  BankConfigFastOpt,
  BankConfigGovOpt,
  RiskTier,
  OperationalState,
  OracleSetup,
  BankTypeDto,
  BankType,
  EmodeSettingsDto,
  EmodeSettingsType,
  BankConfigType,
  BankConfigDto,
  InterestRateConfigDto,
  InterestRateConfig,
  InterestRateConfigOpt,
  BankRateLimiterType,
  RateLimitWindowType,
  BankRateLimiterDto,
  RateLimitWindowDto,
} from "../types";
import type { BankConfigFastRaw, BankConfigGovRaw } from "../types/raw-bank.types";

import { OperationalStateRaw, OracleSetupRaw, RiskTierRaw } from "~/accounts";
import type { InterestRateConfigCompactArgs } from "~/generated/marginfi";
import { bigNumberToWrappedI80F48 } from "~/utils";

const toWrappedI80F48 = (value: BigNumber | null) => value && bigNumberToWrappedI80F48(value);
const toBigInt = (value: BigNumber | null) => value && BigInt(value.toFixed());

export function serializeBankConfigFast(config: BankConfigFastOpt): BankConfigFastRaw {
  return {
    depositLimit: toBigInt(config.depositLimit),
    borrowLimit: toBigInt(config.borrowLimit),
    operationalState: config.operationalState && serializeOperationalState(config.operationalState),
    interestRateConfig:
      config.interestRateConfig && serializeInterestRateConfig(config.interestRateConfig),
    totalAssetValueInitLimit: toBigInt(config.totalAssetValueInitLimit),
    permissionlessBadDebtSettlement: config.permissionlessBadDebtSettlement,
    liquidationLiquidatorFee: null,
    liquidationInsuranceFee: null,
    circuitBreakerEnabled: null,
    cbDeviationBpsTiers: null,
    cbTierDurationsSeconds: null,
    cbEscalationWindowMult: null,
    cbEmaAlphaBps: null,
    cbWindowSeconds: null,
    cbWindowMaxUpBps: null,
    cbWindowMaxDownBps: null,
  };
}

export function serializeBankConfigGov(config: BankConfigGovOpt): BankConfigGovRaw {
  return {
    assetWeightInit: toWrappedI80F48(config.assetWeightInit),
    assetWeightMaint: toWrappedI80F48(config.assetWeightMaint),
    liabilityWeightInit: toWrappedI80F48(config.liabilityWeightInit),
    liabilityWeightMaint: toWrappedI80F48(config.liabilityWeightMaint),
    operationalState: config.operationalState && serializeOperationalState(config.operationalState),
    riskTier: config.riskTier && serializeRiskTier(config.riskTier),
    assetTag: config.assetTag,
    oracleMaxConfidence: config.oracleMaxConfidence,
    oracleMaxAge: config.oracleMaxAge,
    tokenlessRepaymentsAllowed: config.tokenlessRepaymentsAllowed,
    freezeSettings: config.freezeSettings,
  };
}

export function serializeInterestRateConfig(
  interestRateConfig: InterestRateConfigOpt
): InterestRateConfigCompactArgs {
  return {
    insuranceFeeFixedApr: bigNumberToWrappedI80F48(interestRateConfig.insuranceFeeFixedApr),
    insuranceIrFee: bigNumberToWrappedI80F48(interestRateConfig.insuranceIrFee),
    protocolFixedFeeApr: bigNumberToWrappedI80F48(interestRateConfig.protocolFixedFeeApr),
    protocolIrFee: bigNumberToWrappedI80F48(interestRateConfig.protocolIrFee),
    protocolOriginationFee: bigNumberToWrappedI80F48(interestRateConfig.protocolOriginationFee),
    zeroUtilRate: interestRateConfig.zeroUtilRate,
    hundredUtilRate: interestRateConfig.hundredUtilRate,
    // The on-chain curve is a fixed [RatePoint; 5]; unused slots are zero
    points: [
      ...interestRateConfig.points,
      ...Array.from({ length: 5 - interestRateConfig.points.length }, () => ({ util: 0, rate: 0 })),
    ],
  };
}

export function serializeRiskTier(riskTier: RiskTier): RiskTierRaw {
  switch (riskTier) {
    case RiskTier.Collateral:
      return RiskTierRaw.Collateral;
    case RiskTier.Isolated:
      return RiskTierRaw.Isolated;
    default:
      throw new Error(`Invalid risk tier "${riskTier}"`);
  }
}

export function serializeOperationalState(operationalState: OperationalState): OperationalStateRaw {
  switch (operationalState) {
    case OperationalState.Paused:
      return OperationalStateRaw.Paused;
    case OperationalState.Operational:
      return OperationalStateRaw.Operational;
    case OperationalState.ReduceOnly:
      return OperationalStateRaw.ReduceOnly;
    default:
      throw new Error(`Invalid operational state "${operationalState}"`);
  }
}

export function serializeOracleSetup(oracleSetup: OracleSetup): OracleSetupRaw {
  switch (oracleSetup) {
    case OracleSetup.None:
      return OracleSetupRaw.None;
    case OracleSetup.PythLegacy:
      return OracleSetupRaw.PythLegacy;
    case OracleSetup.SwitchboardV2:
      return OracleSetupRaw.SwitchboardV2;
    case OracleSetup.PythPushOracle:
      return OracleSetupRaw.PythPushOracle;
    case OracleSetup.SwitchboardPull:
      return OracleSetupRaw.SwitchboardPull;
    case OracleSetup.StakedWithPythPush:
      return OracleSetupRaw.StakedWithPythPush;
    case OracleSetup.KaminoPythPush:
      return OracleSetupRaw.KaminoPythPush;
    case OracleSetup.KaminoSwitchboardPull:
      return OracleSetupRaw.KaminoSwitchboardPull;
    case OracleSetup.Fixed:
      return OracleSetupRaw.Fixed;
    case OracleSetup.DriftPythPull:
      return OracleSetupRaw.DriftPythPull;
    case OracleSetup.DriftSwitchboardPull:
      return OracleSetupRaw.DriftSwitchboardPull;
    case OracleSetup.SolendPythPull:
      return OracleSetupRaw.SolendPythPull;
    case OracleSetup.SolendSwitchboardPull:
      return OracleSetupRaw.SolendSwitchboardPull;
    case OracleSetup.FixedKamino:
      return OracleSetupRaw.FixedKamino;
    case OracleSetup.FixedDrift:
      return OracleSetupRaw.FixedDrift;
    case OracleSetup.JuplendPythPull:
      return OracleSetupRaw.JuplendPythPull;
    case OracleSetup.JuplendSwitchboardPull:
      return OracleSetupRaw.JuplendSwitchboardPull;
    case OracleSetup.FixedJuplend:
      return OracleSetupRaw.FixedJuplend;
    case OracleSetup.Scope:
      return OracleSetupRaw.Scope;
    case OracleSetup.ScopeKamino:
      return OracleSetupRaw.ScopeKamino;
    case OracleSetup.ScopeJuplend:
      return OracleSetupRaw.ScopeJuplend;
    case OracleSetup.PythMSOL:
      return OracleSetupRaw.PythMSOL;
    case OracleSetup.KaminoMSOL:
      return OracleSetupRaw.KaminoMSOL;
    case OracleSetup.JuplendMSOL:
      return OracleSetupRaw.JuplendMSOL;
    case OracleSetup.PythLST:
      return OracleSetupRaw.PythLST;
    case OracleSetup.KaminoLST:
      return OracleSetupRaw.KaminoLST;
    case OracleSetup.JuplendLST:
      return OracleSetupRaw.JuplendLST;
    case OracleSetup.PTPyth:
      return OracleSetupRaw.PTPyth;
    case OracleSetup.PTFixed:
      return OracleSetupRaw.PTFixed;
    default:
      throw new Error(`Invalid oracle setup "${oracleSetup}"`);
  }
}

export function toBankDto(bank: BankType): BankTypeDto {
  return {
    address: bank.address,
    group: bank.group,
    mint: bank.mint,
    mintDecimals: bank.mintDecimals,
    assetShareValue: bank.assetShareValue.toString(),
    liabilityShareValue: bank.liabilityShareValue.toString(),
    liquidityVault: bank.liquidityVault,
    liquidityVaultBump: bank.liquidityVaultBump,
    liquidityVaultAuthorityBump: bank.liquidityVaultAuthorityBump,
    insuranceVault: bank.insuranceVault,
    insuranceVaultBump: bank.insuranceVaultBump,
    insuranceVaultAuthorityBump: bank.insuranceVaultAuthorityBump,
    collectedInsuranceFeesOutstanding: bank.collectedInsuranceFeesOutstanding.toString(),
    feeVault: bank.feeVault,
    feeVaultBump: bank.feeVaultBump,
    feeVaultAuthorityBump: bank.feeVaultAuthorityBump,
    collectedGroupFeesOutstanding: bank.collectedGroupFeesOutstanding.toString(),
    lastUpdate: bank.lastUpdate,
    config: toBankConfigDto(bank.config),
    totalAssetShares: bank.totalAssetShares.toString(),
    totalLiabilityShares: bank.totalLiabilityShares.toString(),
    emissionsActiveBorrowing: bank.emissionsActiveBorrowing,
    emissionsActiveLending: bank.emissionsActiveLending,
    stakedOracleDisabled: bank.stakedOracleDisabled,
    stakedOracleUsesOnramp: bank.stakedOracleUsesOnramp,
    emissionsRate: bank.emissionsRate,
    emissionsMint: bank.emissionsMint,
    emissionsRemaining: bank.emissionsRemaining.toString(),
    collectedProgramFeesOutstanding: bank.collectedProgramFeesOutstanding.toString(),
    oracleKey: bank.oracleKey,
    emode: toEmodeSettingsDto(bank.emode),
    premiumTag: bank.premiumTag,
    premiumActive: bank.premiumActive,
    premiumActivatedAt: bank.premiumActivatedAt,
    rateLimiter: bank.rateLimiter ? toBankRateLimiterDto(bank.rateLimiter) : undefined,
    tokenSymbol: bank.tokenSymbol,
    feesDestinationAccount: bank.feesDestinationAccount,
    lendingPositionCount: bank.lendingPositionCount?.toString(),
    borrowingPositionCount: bank.borrowingPositionCount?.toString(),
    kaminoIntegrationAccounts: bank.kaminoIntegrationAccounts,
    driftIntegrationAccounts: bank.driftIntegrationAccounts,
    solendIntegrationAccounts: bank.solendIntegrationAccounts,
    jupLendIntegrationAccounts: bank.jupLendIntegrationAccounts,
    stakedIntegrationAccounts: bank.stakedIntegrationAccounts,
  };
}

function toRateLimitWindowDto(window: RateLimitWindowType): RateLimitWindowDto {
  return {
    maxOutflow: window.maxOutflow.toString(),
    windowDuration: window.windowDuration,
    windowStart: window.windowStart,
    prevWindowOutflow: window.prevWindowOutflow.toString(),
    curWindowOutflow: window.curWindowOutflow.toString(),
  };
}

export function toBankRateLimiterDto(rateLimiter: BankRateLimiterType): BankRateLimiterDto {
  return {
    hourly: toRateLimitWindowDto(rateLimiter.hourly),
    daily: toRateLimitWindowDto(rateLimiter.daily),
  };
}

export function toEmodeSettingsDto(emodeSettings: EmodeSettingsType): EmodeSettingsDto {
  return {
    emodeTag: emodeSettings.emodeTag,
    timestamp: emodeSettings.timestamp,
    flags: emodeSettings.flags,
    emodeEntries: emodeSettings.emodeEntries.map((entry) => {
      return {
        collateralBankEmodeTag: entry.collateralBankEmodeTag,
        flags: entry.flags,
        assetWeightInit: entry.assetWeightInit.toString(),
        assetWeightMaint: entry.assetWeightMaint.toString(),
      };
    }),
  };
}

export function toBankConfigDto(bankConfig: BankConfigType): BankConfigDto {
  return {
    assetWeightInit: bankConfig.assetWeightInit.toString(),
    assetWeightMaint: bankConfig.assetWeightMaint.toString(),
    liabilityWeightInit: bankConfig.liabilityWeightInit.toString(),
    liabilityWeightMaint: bankConfig.liabilityWeightMaint.toString(),
    depositLimit: bankConfig.depositLimit.toString(),
    borrowLimit: bankConfig.borrowLimit.toString(),
    riskTier: bankConfig.riskTier,
    operationalState: bankConfig.operationalState,
    totalAssetValueInitLimit: bankConfig.totalAssetValueInitLimit.toString(),
    assetTag: bankConfig.assetTag,
    oracleSetup: bankConfig.oracleSetup,
    oracleKeys: bankConfig.oracleKeys,
    oracleMaxAge: bankConfig.oracleMaxAge,
    interestRateConfig: toInterestRateConfigDto(bankConfig.interestRateConfig),
    configFlags: bankConfig.configFlags,
    oracleMaxConfidence: bankConfig.oracleMaxConfidence,
    fixedPrice: bankConfig.fixedPrice.toString(),
    scopeEntryIndex: bankConfig.scopeEntryIndex,
  };
}

export function toInterestRateConfigDto(interestRateConfig: InterestRateConfig): InterestRateConfigDto {
  return {
    placeholder0: interestRateConfig.placeholder0.toString(),
    placeholder1: interestRateConfig.placeholder1.toString(),
    placeholder2: interestRateConfig.placeholder2.toString(),
    insuranceFeeFixedApr: interestRateConfig.insuranceFeeFixedApr.toString(),
    insuranceIrFee: interestRateConfig.insuranceIrFee.toString(),
    protocolFixedFeeApr: interestRateConfig.protocolFixedFeeApr.toString(),
    protocolIrFee: interestRateConfig.protocolIrFee.toString(),
    protocolOriginationFee: interestRateConfig.protocolOriginationFee.toString(),
    zeroUtilRate: interestRateConfig.zeroUtilRate,
    hundredUtilRate: interestRateConfig.hundredUtilRate,
    points: interestRateConfig.points,
    curveType: interestRateConfig.curveType,
  };
}
