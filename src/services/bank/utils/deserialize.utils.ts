import { address, type Address } from "@solana/kit";
import BigNumber from "bignumber.js";

import {
  AssetTag,
  BankConfigRaw,
  BankConfigType,
  BankRaw,
  BankType,
  EmodeEntryFlags,
  EmodeFlags,
  EmodeSettingsType,
  EmodeTag,
  InterestRateConfig,
  OperationalState,
  OracleSetup,
  RiskTier,
  BankConfigDto,
  BankTypeDto,
  EmodeSettingsDto,
  InterestRateConfigDto,
  EmodeSettingsRaw,
  BankRateLimiterRaw,
  BankRateLimiterType,
  RateLimitWindowType,
  BankRateLimiterDto,
  RateLimitWindowDto,
} from "../types";

import { OperationalStateRaw, OracleSetupRaw, RiskTierRaw } from "~/accounts";
import {
  DEFAULT_ORACLE_MAX_AGE,
  STAKED_ORACLE_DISABLED_FLAG,
  STAKED_ORACLE_USES_ONRAMP_FLAG,
} from "~/constants";
import type { RateLimitWindow } from "~/generated/marginfi";
import { wrappedI80F48toBigNumber } from "~/utils";

/*
 * Bank deserialization
 */

export function parseEmodeSettingsRaw(emodeSettingsRaw: EmodeSettingsRaw): EmodeSettingsType {
  const emodeTag = parseEmodeTag(emodeSettingsRaw.emodeTag);
  const timestamp = Number(emodeSettingsRaw.timestamp);
  const flags = getActiveEmodeFlags(emodeSettingsRaw.flags);
  const emodeEntries = emodeSettingsRaw.emodeConfig.entries
    .filter((entry) => entry.collateralBankEmodeTag !== 0)
    .map((entry) => {
      return {
        collateralBankEmodeTag: parseEmodeTag(entry.collateralBankEmodeTag),
        flags: getActiveEmodeEntryFlags(entry.flags),
        assetWeightInit: wrappedI80F48toBigNumber(entry.assetWeightInit),
        assetWeightMaint: wrappedI80F48toBigNumber(entry.assetWeightMaint),
      };
    });

  const emodeSettings: EmodeSettingsType = {
    emodeTag,
    timestamp,
    flags,
    emodeEntries,
  };

  return emodeSettings;
}

function parseRateLimitWindowRaw(window: RateLimitWindow): RateLimitWindowType {
  return {
    maxOutflow: new BigNumber(window.maxOutflow.toString()),
    windowDuration: Number(window.windowDuration),
    windowStart: Number(window.windowStart),
    prevWindowOutflow: new BigNumber(window.prevWindowOutflow.toString()),
    curWindowOutflow: new BigNumber(window.curWindowOutflow.toString()),
  };
}

export function parseBankRateLimiterRaw(rateLimiter: BankRateLimiterRaw): BankRateLimiterType {
  return {
    hourly: parseRateLimitWindowRaw(rateLimiter.hourly),
    daily: parseRateLimitWindowRaw(rateLimiter.daily),
  };
}

interface BankMetadata {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
}

export function parseBankRaw(
  address: Address,
  accountParsed: BankRaw,
  bankMetadata?: BankMetadata
): BankType {
  const flags = Number(accountParsed.flags);

  const mint = accountParsed.mint;
  const mintDecimals = accountParsed.mintDecimals;
  const group = accountParsed.group;

  const assetShareValue = wrappedI80F48toBigNumber(accountParsed.assetShareValue);
  const liabilityShareValue = wrappedI80F48toBigNumber(accountParsed.liabilityShareValue);

  const liquidityVault = accountParsed.liquidityVault;
  const liquidityVaultBump = accountParsed.liquidityVaultBump;
  const liquidityVaultAuthorityBump = accountParsed.liquidityVaultAuthorityBump;

  const insuranceVault = accountParsed.insuranceVault;
  const insuranceVaultBump = accountParsed.insuranceVaultBump;
  const insuranceVaultAuthorityBump = accountParsed.insuranceVaultAuthorityBump;

  const collectedInsuranceFeesOutstanding = wrappedI80F48toBigNumber(
    accountParsed.collectedInsuranceFeesOutstanding
  );

  const feeVault = accountParsed.feeVault;
  const feeVaultBump = accountParsed.feeVaultBump;
  const feeVaultAuthorityBump = accountParsed.feeVaultAuthorityBump;

  const collectedGroupFeesOutstanding = wrappedI80F48toBigNumber(
    accountParsed.collectedGroupFeesOutstanding
  );

  const config = parseBankConfigRaw(accountParsed.config);

  const lastUpdate = Number(accountParsed.lastUpdate);

  const totalAssetShares = wrappedI80F48toBigNumber(accountParsed.totalAssetShares);
  const totalLiabilityShares = wrappedI80F48toBigNumber(accountParsed.totalLiabilityShares);

  const emissionsActiveBorrowing = (flags & 1) > 0;
  const emissionsActiveLending = (flags & 2) > 0;
  const stakedOracleDisabled = (flags & STAKED_ORACLE_DISABLED_FLAG) > 0;
  const stakedOracleUsesOnramp = (flags & STAKED_ORACLE_USES_ONRAMP_FLAG) > 0;

  const emissionsRate = Number(accountParsed.emissionsRate);
  const emissionsMint = accountParsed.emissionsMint;
  const emissionsRemaining = wrappedI80F48toBigNumber(accountParsed.emissionsRemaining);

  const collectedProgramFeesOutstanding = wrappedI80F48toBigNumber(
    accountParsed.collectedProgramFeesOutstanding
  );

  const { oracleKey } = { oracleKey: config.oracleKeys[0] };
  const emode = parseEmodeSettingsRaw(accountParsed.emode);
  const rateLimiter = parseBankRateLimiterRaw(accountParsed.rateLimiter);

  const tokenSymbol = bankMetadata?.tokenSymbol;

  const feesDestinationAccount = accountParsed.feesDestinationAccount;
  const lendingPositionCount = new BigNumber(accountParsed.lendingPositionCount);
  const borrowingPositionCount = new BigNumber(accountParsed.borrowingPositionCount);

  let kaminoIntegrationAccounts,
    driftIntegrationAccounts,
    solendIntegrationAccounts,
    jupLendIntegrationAccounts,
    stakedIntegrationAccounts = undefined;

  switch (config.assetTag) {
    case AssetTag.KAMINO:
      kaminoIntegrationAccounts = {
        kaminoReserve: accountParsed.integrationAcc1,
        kaminoObligation: accountParsed.integrationAcc2,
      };
      break;
    case AssetTag.DRIFT:
      driftIntegrationAccounts = {
        driftSpotMarket: accountParsed.integrationAcc1,
        driftUser: accountParsed.integrationAcc2,
        driftUserStats: accountParsed.integrationAcc3,
      };
      break;
    case AssetTag.SOLEND:
      solendIntegrationAccounts = {
        solendReserve: accountParsed.integrationAcc1,
        solendObligation: accountParsed.integrationAcc2,
      };
      break;
    case AssetTag.JUPLEND:
      jupLendIntegrationAccounts = {
        jupLendingState: accountParsed.integrationAcc1,
        jupFTokenVault: accountParsed.integrationAcc2,
        jupFTokenAta: accountParsed.integrationAcc3,
      };
      break;
    case AssetTag.STAKED:
      stakedIntegrationAccounts = {
        validatorVoteAccount: accountParsed.integrationAcc1,
      };
      break;
    default:
      break;
  }

  return {
    address,
    group,
    mint,
    mintDecimals,
    assetShareValue,
    liabilityShareValue,
    liquidityVault,
    liquidityVaultBump,
    liquidityVaultAuthorityBump,
    insuranceVault,
    insuranceVaultBump,
    insuranceVaultAuthorityBump,
    collectedInsuranceFeesOutstanding,
    feeVault,
    feeVaultBump,
    feeVaultAuthorityBump,
    collectedGroupFeesOutstanding,
    lastUpdate,
    config,
    totalAssetShares,
    totalLiabilityShares,
    emissionsActiveBorrowing,
    emissionsActiveLending,
    stakedOracleDisabled,
    stakedOracleUsesOnramp,
    emissionsRate,
    emissionsMint,
    emissionsRemaining,
    collectedProgramFeesOutstanding,
    oracleKey,
    feesDestinationAccount,
    lendingPositionCount,
    borrowingPositionCount,
    emode,
    rateLimiter,
    tokenSymbol,
    kaminoIntegrationAccounts,
    driftIntegrationAccounts,
    solendIntegrationAccounts,
    jupLendIntegrationAccounts,
    stakedIntegrationAccounts,
  };
}

/*
 * DTO Bank deserialization
 */

export function dtoToBank(bankDto: BankTypeDto): BankType {
  return {
    address: address(bankDto.address),
    group: address(bankDto.group),
    mint: address(bankDto.mint),
    mintDecimals: bankDto.mintDecimals,
    assetShareValue: new BigNumber(bankDto.assetShareValue),
    liabilityShareValue: new BigNumber(bankDto.liabilityShareValue),
    liquidityVault: address(bankDto.liquidityVault),
    liquidityVaultBump: bankDto.liquidityVaultBump,
    liquidityVaultAuthorityBump: bankDto.liquidityVaultAuthorityBump,
    insuranceVault: address(bankDto.insuranceVault),
    insuranceVaultBump: bankDto.insuranceVaultBump,
    insuranceVaultAuthorityBump: bankDto.insuranceVaultAuthorityBump,
    collectedInsuranceFeesOutstanding: new BigNumber(bankDto.collectedInsuranceFeesOutstanding),
    feeVault: address(bankDto.feeVault),
    feeVaultBump: bankDto.feeVaultBump,
    feeVaultAuthorityBump: bankDto.feeVaultAuthorityBump,
    collectedGroupFeesOutstanding: new BigNumber(bankDto.collectedGroupFeesOutstanding),
    lastUpdate: bankDto.lastUpdate,
    config: dtoToBankConfig(bankDto.config),
    totalAssetShares: new BigNumber(bankDto.totalAssetShares),
    totalLiabilityShares: new BigNumber(bankDto.totalLiabilityShares),
    emissionsActiveBorrowing: bankDto.emissionsActiveBorrowing,
    emissionsActiveLending: bankDto.emissionsActiveLending,
    stakedOracleDisabled: bankDto.stakedOracleDisabled,
    stakedOracleUsesOnramp: bankDto.stakedOracleUsesOnramp,
    emissionsRate: bankDto.emissionsRate,
    emissionsMint: address(bankDto.emissionsMint),
    emissionsRemaining: new BigNumber(bankDto.emissionsRemaining),
    collectedProgramFeesOutstanding: new BigNumber(bankDto.collectedProgramFeesOutstanding ?? "0"),
    oracleKey: address(bankDto.oracleKey),
    emode: dtoToEmodeSettings(bankDto.emode),
    rateLimiter: bankDto.rateLimiter ? dtoToBankRateLimiter(bankDto.rateLimiter) : undefined,
    tokenSymbol: bankDto.tokenSymbol,
    feesDestinationAccount: bankDto.feesDestinationAccount
      ? address(bankDto.feesDestinationAccount)
      : undefined,
    lendingPositionCount: bankDto.lendingPositionCount
      ? new BigNumber(bankDto.lendingPositionCount)
      : undefined,
    borrowingPositionCount: bankDto.borrowingPositionCount
      ? new BigNumber(bankDto.borrowingPositionCount)
      : undefined,
    kaminoIntegrationAccounts: bankDto.kaminoIntegrationAccounts
      ? {
          kaminoReserve: address(bankDto.kaminoIntegrationAccounts.kaminoReserve),
          kaminoObligation: address(bankDto.kaminoIntegrationAccounts.kaminoObligation),
        }
      : undefined,
    driftIntegrationAccounts: bankDto.driftIntegrationAccounts
      ? {
          driftSpotMarket: address(bankDto.driftIntegrationAccounts.driftSpotMarket),
          driftUser: address(bankDto.driftIntegrationAccounts.driftUser),
          driftUserStats: address(bankDto.driftIntegrationAccounts.driftUserStats),
        }
      : undefined,
    solendIntegrationAccounts: bankDto.solendIntegrationAccounts
      ? {
          solendReserve: address(bankDto.solendIntegrationAccounts.solendReserve),
          solendObligation: address(bankDto.solendIntegrationAccounts.solendObligation),
        }
      : undefined,
    jupLendIntegrationAccounts: bankDto.jupLendIntegrationAccounts
      ? {
          jupLendingState: address(bankDto.jupLendIntegrationAccounts.jupLendingState),
          jupFTokenVault: address(bankDto.jupLendIntegrationAccounts.jupFTokenVault),
          jupFTokenAta: address(bankDto.jupLendIntegrationAccounts.jupFTokenAta),
        }
      : undefined,
    stakedIntegrationAccounts: bankDto.stakedIntegrationAccounts
      ? {
          validatorVoteAccount: address(bankDto.stakedIntegrationAccounts.validatorVoteAccount),
        }
      : undefined,
  };
}

function dtoToRateLimitWindow(window: RateLimitWindowDto): RateLimitWindowType {
  return {
    maxOutflow: new BigNumber(window.maxOutflow),
    windowDuration: window.windowDuration,
    windowStart: window.windowStart,
    prevWindowOutflow: new BigNumber(window.prevWindowOutflow),
    curWindowOutflow: new BigNumber(window.curWindowOutflow),
  };
}

export function dtoToBankRateLimiter(rateLimiter: BankRateLimiterDto): BankRateLimiterType {
  return {
    hourly: dtoToRateLimitWindow(rateLimiter.hourly),
    daily: dtoToRateLimitWindow(rateLimiter.daily),
  };
}

export function dtoToEmodeSettings(emodeSettingsDto: EmodeSettingsDto): EmodeSettingsType {
  return {
    emodeTag: emodeSettingsDto.emodeTag,
    timestamp: emodeSettingsDto.timestamp,
    flags: emodeSettingsDto.flags,
    emodeEntries: emodeSettingsDto.emodeEntries.map((entry) => {
      return {
        collateralBankEmodeTag: entry.collateralBankEmodeTag,
        flags: entry.flags,
        assetWeightInit: new BigNumber(entry.assetWeightInit),
        assetWeightMaint: new BigNumber(entry.assetWeightMaint),
      };
    }),
  };
}

export function dtoToBankConfig(bankConfigDto: BankConfigDto): BankConfigType {
  return {
    assetWeightInit: new BigNumber(bankConfigDto.assetWeightInit),
    assetWeightMaint: new BigNumber(bankConfigDto.assetWeightMaint),
    liabilityWeightInit: new BigNumber(bankConfigDto.liabilityWeightInit),
    liabilityWeightMaint: new BigNumber(bankConfigDto.liabilityWeightMaint),
    depositLimit: new BigNumber(bankConfigDto.depositLimit),
    borrowLimit: new BigNumber(bankConfigDto.borrowLimit),
    riskTier: bankConfigDto.riskTier,
    operationalState: bankConfigDto.operationalState,
    totalAssetValueInitLimit: new BigNumber(bankConfigDto.totalAssetValueInitLimit),
    assetTag: bankConfigDto.assetTag,
    configFlags: bankConfigDto.configFlags,
    oracleSetup: bankConfigDto.oracleSetup,
    oracleKeys: bankConfigDto.oracleKeys.map((key) => address(key)),
    oracleMaxAge: bankConfigDto.oracleMaxAge,
    interestRateConfig: dtoToInterestRateConfig(bankConfigDto.interestRateConfig),
    oracleMaxConfidence: bankConfigDto.oracleMaxConfidence,
    fixedPrice: new BigNumber(bankConfigDto.fixedPrice),
    scopeEntryIndex: bankConfigDto.scopeEntryIndex,
  };
}

export function dtoToInterestRateConfig(
  interestRateConfigDto: InterestRateConfigDto
): InterestRateConfig {
  return {
    // fall back to the pre-0.1.9 field names so old serialized DTOs still convert
    placeholder0: new BigNumber(
      interestRateConfigDto.placeholder0 ?? interestRateConfigDto.optimalUtilizationRate ?? 0
    ),
    placeholder1: new BigNumber(
      interestRateConfigDto.placeholder1 ?? interestRateConfigDto.plateauInterestRate ?? 0
    ),
    placeholder2: new BigNumber(
      interestRateConfigDto.placeholder2 ?? interestRateConfigDto.maxInterestRate ?? 0
    ),
    insuranceFeeFixedApr: new BigNumber(interestRateConfigDto.insuranceFeeFixedApr),
    insuranceIrFee: new BigNumber(interestRateConfigDto.insuranceIrFee),
    protocolFixedFeeApr: new BigNumber(interestRateConfigDto.protocolFixedFeeApr),
    protocolIrFee: new BigNumber(interestRateConfigDto.protocolIrFee),
    protocolOriginationFee: new BigNumber(interestRateConfigDto.protocolOriginationFee),
    zeroUtilRate: interestRateConfigDto.zeroUtilRate,
    hundredUtilRate: interestRateConfigDto.hundredUtilRate,
    points: interestRateConfigDto.points,
    curveType: interestRateConfigDto.curveType,
  };
}

/*
 * Bank config deserialization
 */

export function parseBankConfigRaw(bankConfigRaw: BankConfigRaw): BankConfigType {
  const assetWeightInit = wrappedI80F48toBigNumber(bankConfigRaw.assetWeightInit);
  const assetWeightMaint = wrappedI80F48toBigNumber(bankConfigRaw.assetWeightMaint);
  const liabilityWeightInit = wrappedI80F48toBigNumber(bankConfigRaw.liabilityWeightInit);
  const liabilityWeightMaint = wrappedI80F48toBigNumber(bankConfigRaw.liabilityWeightMaint);
  const depositLimit = BigNumber(bankConfigRaw.depositLimit.toString());
  const borrowLimit = BigNumber(bankConfigRaw.borrowLimit.toString());
  const riskTier = parseRiskTier(bankConfigRaw.riskTier);
  const operationalState = parseOperationalState(bankConfigRaw.operationalState);
  const totalAssetValueInitLimit = BigNumber(bankConfigRaw.totalAssetValueInitLimit.toString());
  const assetTag = bankConfigRaw.assetTag as AssetTag;
  const configFlags = bankConfigRaw.configFlags;
  const oracleSetup = parseOracleSetup(bankConfigRaw.oracleSetup);
  const oracleKeys = bankConfigRaw.oracleKeys;
  const oracleMaxAge =
    bankConfigRaw.oracleMaxAge === 0 && oracleSetup !== OracleSetup.Scope
      ? DEFAULT_ORACLE_MAX_AGE
      : bankConfigRaw.oracleMaxAge;
  const interestRateConfig = {
    insuranceFeeFixedApr: wrappedI80F48toBigNumber(
      bankConfigRaw.interestRateConfig.insuranceFeeFixedApr
    ),
    placeholder2: wrappedI80F48toBigNumber(bankConfigRaw.interestRateConfig.placeholder2),
    insuranceIrFee: wrappedI80F48toBigNumber(bankConfigRaw.interestRateConfig.insuranceIrFee),
    placeholder0: wrappedI80F48toBigNumber(bankConfigRaw.interestRateConfig.placeholder0),
    placeholder1: wrappedI80F48toBigNumber(bankConfigRaw.interestRateConfig.placeholder1),
    protocolFixedFeeApr: wrappedI80F48toBigNumber(
      bankConfigRaw.interestRateConfig.protocolFixedFeeApr
    ),
    protocolIrFee: wrappedI80F48toBigNumber(bankConfigRaw.interestRateConfig.protocolIrFee),
    protocolOriginationFee: wrappedI80F48toBigNumber(
      bankConfigRaw.interestRateConfig.protocolOriginationFee
    ),
    zeroUtilRate: bankConfigRaw.interestRateConfig.zeroUtilRate,
    hundredUtilRate: bankConfigRaw.interestRateConfig.hundredUtilRate,
    points: bankConfigRaw.interestRateConfig.points,
    curveType: bankConfigRaw.interestRateConfig.curveType,
  };
  const oracleMaxConfidence = bankConfigRaw.oracleMaxConfidence;
  const fixedPrice = wrappedI80F48toBigNumber(bankConfigRaw.fixedPrice);
  const scopeEntryIndex = bankConfigRaw.scopeEntryIndex;

  return {
    assetWeightInit,
    assetWeightMaint,
    liabilityWeightInit,
    liabilityWeightMaint,
    depositLimit,
    borrowLimit,
    riskTier,
    operationalState,
    totalAssetValueInitLimit,
    assetTag,
    configFlags,
    oracleSetup,
    oracleKeys,
    oracleMaxAge,
    interestRateConfig,
    oracleMaxConfidence,
    fixedPrice,
    scopeEntryIndex,
  };
}

export function parseRiskTier(riskTierRaw: RiskTierRaw): RiskTier {
  switch (riskTierRaw) {
    case RiskTierRaw.Collateral:
      return RiskTier.Collateral;
    case RiskTierRaw.Isolated:
      return RiskTier.Isolated;
    default:
      throw new Error(`Invalid risk tier "${riskTierRaw}"`);
  }
}

export function parseOperationalState(operationalStateRaw: OperationalStateRaw): OperationalState {
  switch (operationalStateRaw) {
    case OperationalStateRaw.Paused:
      return OperationalState.Paused;
    case OperationalStateRaw.Operational:
      return OperationalState.Operational;
    case OperationalStateRaw.ReduceOnly:
      return OperationalState.ReduceOnly;
    case OperationalStateRaw.KilledByBankruptcy:
      return OperationalState.KilledByBankruptcy;
    case OperationalStateRaw.Uninitialized:
      return OperationalState.Uninitialized;
    case OperationalStateRaw.ReduceOnlyWithBorrowingPower:
      return OperationalState.ReduceOnlyWithBorrowingPower;
    case OperationalStateRaw.CircuitBroken:
      return OperationalState.CircuitBroken;
    default:
      throw new Error(`Invalid operational state "${operationalStateRaw}"`);
  }
}

export function parseOracleSetup(oracleSetupRaw: OracleSetupRaw): OracleSetup {
  switch (oracleSetupRaw) {
    case OracleSetupRaw.None:
      return OracleSetup.None;
    case OracleSetupRaw.PythLegacy:
      return OracleSetup.PythLegacy;
    case OracleSetupRaw.SwitchboardV2:
      return OracleSetup.SwitchboardV2;
    case OracleSetupRaw.PythPushOracle:
      return OracleSetup.PythPushOracle;
    case OracleSetupRaw.SwitchboardPull:
      return OracleSetup.SwitchboardPull;
    case OracleSetupRaw.StakedWithPythPush:
      return OracleSetup.StakedWithPythPush;
    case OracleSetupRaw.KaminoPythPush:
      return OracleSetup.KaminoPythPush;
    case OracleSetupRaw.KaminoSwitchboardPull:
      return OracleSetup.KaminoSwitchboardPull;
    case OracleSetupRaw.Fixed:
      return OracleSetup.Fixed;
    case OracleSetupRaw.DriftPythPull:
      return OracleSetup.DriftPythPull;
    case OracleSetupRaw.DriftSwitchboardPull:
      return OracleSetup.DriftSwitchboardPull;
    case OracleSetupRaw.SolendPythPull:
      return OracleSetup.SolendPythPull;
    case OracleSetupRaw.SolendSwitchboardPull:
      return OracleSetup.SolendSwitchboardPull;
    case OracleSetupRaw.FixedKamino:
      return OracleSetup.FixedKamino;
    case OracleSetupRaw.FixedDrift:
      return OracleSetup.FixedDrift;
    case OracleSetupRaw.JuplendPythPull:
      return OracleSetup.JuplendPythPull;
    case OracleSetupRaw.JuplendSwitchboardPull:
      return OracleSetup.JuplendSwitchboardPull;
    case OracleSetupRaw.FixedJuplend:
      return OracleSetup.FixedJuplend;
    case OracleSetupRaw.Scope:
      return OracleSetup.Scope;
    case OracleSetupRaw.PythMSOL:
      return OracleSetup.PythMSOL;
    case OracleSetupRaw.KaminoMSOL:
      return OracleSetup.KaminoMSOL;
    case OracleSetupRaw.JuplendMSOL:
      return OracleSetup.JuplendMSOL;
    case OracleSetupRaw.PythLST:
      return OracleSetup.PythLST;
    case OracleSetupRaw.KaminoLST:
      return OracleSetup.KaminoLST;
    case OracleSetupRaw.JuplendLST:
      return OracleSetup.JuplendLST;
    case OracleSetupRaw.PTPyth:
      return OracleSetup.PTPyth;
    case OracleSetupRaw.PTFixed:
      return OracleSetup.PTFixed;
    default:
      return OracleSetup.Unknown;
  }
}

/**
 * Get all active EMode flags as an array of flag names
 */
export function getActiveEmodeFlags(flags: bigint): EmodeFlags[] {
  const activeFlags: EmodeFlags[] = [];

  for (const flagName in EmodeFlags) {
    const flag = EmodeFlags[flagName];

    if (typeof flag === "number" && hasEmodeFlag(flags, flag)) {
      activeFlags.push(flag);
    }
  }

  return activeFlags;
}

/**
 * Check if a specific EMode flag is set
 */
export function hasEmodeFlag(flags: bigint, flag: number): boolean {
  return (flags & BigInt(flag)) !== 0n;
}

/**
 * Get all active EMode entry flags as an array of flag names
 */
export function getActiveEmodeEntryFlags(flags: number): EmodeEntryFlags[] {
  const activeFlags: EmodeEntryFlags[] = [];

  for (const flagName in EmodeEntryFlags) {
    const flag = EmodeEntryFlags[flagName];

    if (typeof flag === "number" && hasEmodeEntryFlag(flags, flag)) {
      activeFlags.push(flag);
    }
  }

  return activeFlags;
}

/**
 * Check if a specific EMode entry flag is set
 */
export function hasEmodeEntryFlag(flags: number, flag: number): boolean {
  return (flags & flag) === flag;
}

/**
 * Parse a raw EMode tag number into the corresponding EmodeTag enum value
 */
export function parseEmodeTag(emodeTagRaw: number): EmodeTag {
  switch (emodeTagRaw) {
    case 501:
      return EmodeTag.SOL;
    case 502:
      return EmodeTag.SOL_T2;
    case 1571:
      return EmodeTag.LST_T1;
    case 1572:
      return EmodeTag.LST_T2;
    case 15787:
      return EmodeTag.LST_PT;
    case 619:
      return EmodeTag.JLP;
    case 57481:
      return EmodeTag.STABLE_T1;
    case 57482:
      return EmodeTag.STABLE_T2;
    case 871:
      return EmodeTag.BTC_T1;
    case 872:
      return EmodeTag.BTC_T2;
    case 47050:
      return EmodeTag.HYUSD;
    case 8747:
      return EmodeTag.PT_HYUSD;
    case 0:
    default:
      return EmodeTag.UNSET;
  }
}
