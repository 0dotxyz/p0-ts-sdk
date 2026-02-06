import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { MarginfiIdlType } from "~/idl";
import { nativeToUi } from "~/utils";
import { MarginfiProgram } from "~/types";

import {
  BankType,
  BankRaw,
  decodeBankRaw,
  parseBankRaw,
  OraclePrice,
  PriceBias,
  getPrice,
  getTotalAssetQuantity,
  getTotalLiabilityQuantity,
  getAssetQuantity,
  getLiabilityQuantity,
  getAssetShares,
  getLiabilityShares,
  computeAssetUsdValue,
  ComputeAssetUsdValueParams,
  computeLiabilityUsdValue,
  ComputeLiabilityUsdValueParams,
  computeUsdValue,
  ComputeUsdValueParams,
  getAssetWeight,
  GetAssetWeightParams,
  getLiabilityWeight,
  computeTvl,
  computeInterestRates,
  computeBaseInterestRate,
  computeUtilizationRate,
  computeRemainingCapacity,
  BankConfigType,
  RiskTier,
  AssetTag,
  BankConfigFlag,
  OracleSetup,
  InterestRateConfig,
  OperationalState,
  BankConfigRaw,
  parseBankConfigRaw,
  MarginRequirementType,
} from "../services";
import { EmodeSettings } from "./emode-settings";

const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_YEAR = SECONDS_PER_DAY * 365.25;

interface BankMetadata {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
}

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class Bank implements BankType {
  constructor(
    public readonly address: PublicKey,
    public readonly mint: PublicKey,
    public readonly mintDecimals: number,
    public readonly group: PublicKey,
    public readonly mintRate: number | null,
    public readonly mintPrice: number,
    public readonly assetShareValue: BigNumber,
    public readonly liabilityShareValue: BigNumber,
    public readonly liquidityVault: PublicKey,
    public readonly liquidityVaultBump: number,
    public readonly liquidityVaultAuthorityBump: number,
    public readonly insuranceVault: PublicKey,
    public readonly insuranceVaultBump: number,
    public readonly insuranceVaultAuthorityBump: number,
    public readonly collectedInsuranceFeesOutstanding: BigNumber,
    public readonly feeVault: PublicKey,
    public readonly feeVaultBump: number,
    public readonly feeVaultAuthorityBump: number,
    public readonly collectedGroupFeesOutstanding: BigNumber,
    public readonly lastUpdate: number,
    public config: BankConfig,
    public readonly totalAssetShares: BigNumber,
    public readonly totalLiabilityShares: BigNumber,
    public readonly emissionsActiveBorrowing: boolean,
    public readonly emissionsActiveLending: boolean,
    public readonly emissionsRate: number,
    public readonly emissionsMint: PublicKey,
    public readonly emissionsRemaining: BigNumber,
    public readonly oracleKey: PublicKey,
    public readonly emode: EmodeSettings,
    public readonly kaminoIntegrationAccounts?: {
      kaminoReserve: PublicKey;
      kaminoObligation: PublicKey;
    },
    public readonly driftIntegrationAccounts?: {
      driftSpotMarket: PublicKey;
      driftUser: PublicKey;
      driftUserStats: PublicKey;
    },
    public readonly solendIntegrationAccounts?: {
      solendReserve: PublicKey;
      solendObligation: PublicKey;
    },
    public readonly feesDestinationAccount?: PublicKey,
    public readonly lendingPositionCount?: BigNumber,
    public readonly borrowingPositionCount?: BigNumber,
    public readonly tokenSymbol?: string
  ) {}

  static async fetch(
    address: PublicKey,
    program: MarginfiProgram,
    bankMetadata?: BankMetadata
  ): Promise<Bank> {
    const data: BankRaw = await program.account.bank.fetch(address);
    return Bank.fromAccountParsed(address, data, bankMetadata);
  }

  static decodeBankRaw(encoded: Buffer, idl: MarginfiIdlType): BankRaw {
    return decodeBankRaw(encoded, idl);
  }

  static fromBuffer(bankPk: PublicKey, rawData: Buffer, idl: MarginfiIdlType): Bank {
    const accountParsed = Bank.decodeBankRaw(rawData, idl);
    return Bank.fromAccountParsed(bankPk, accountParsed);
  }

  static fromBankType(bankType: BankType): Bank {
    const config = new BankConfig(
      bankType.config.assetWeightInit,
      bankType.config.assetWeightMaint,
      bankType.config.liabilityWeightInit,
      bankType.config.liabilityWeightMaint,
      bankType.config.depositLimit,
      bankType.config.borrowLimit,
      bankType.config.riskTier,
      bankType.config.totalAssetValueInitLimit,
      bankType.config.assetTag,
      bankType.config.oracleSetup,
      bankType.config.oracleKeys,
      bankType.config.oracleMaxAge,
      bankType.config.interestRateConfig,
      bankType.config.operationalState,
      bankType.config.oracleMaxConfidence,
      bankType.config.fixedPrice,
      bankType.config.configFlags
    );
    return new Bank(
      bankType.address,
      bankType.mint,
      bankType.mintDecimals,
      bankType.group,
      bankType.mintRate,
      bankType.mintPrice,
      bankType.assetShareValue,
      bankType.liabilityShareValue,
      bankType.liquidityVault,
      bankType.liquidityVaultBump,
      bankType.liquidityVaultAuthorityBump,
      bankType.insuranceVault,
      bankType.insuranceVaultBump,
      bankType.insuranceVaultAuthorityBump,
      bankType.collectedInsuranceFeesOutstanding,
      bankType.feeVault,
      bankType.feeVaultBump,
      bankType.feeVaultAuthorityBump,
      bankType.collectedGroupFeesOutstanding,
      bankType.lastUpdate,
      config,
      bankType.totalAssetShares,
      bankType.totalLiabilityShares,
      bankType.emissionsActiveBorrowing,
      bankType.emissionsActiveLending,
      bankType.emissionsRate,
      bankType.emissionsMint,
      bankType.emissionsRemaining,
      bankType.oracleKey,
      bankType.emode,
      bankType.kaminoIntegrationAccounts,
      bankType.driftIntegrationAccounts,
      bankType.solendIntegrationAccounts,
      bankType.feesDestinationAccount,
      bankType.lendingPositionCount,
      bankType.borrowingPositionCount,
      bankType.tokenSymbol
    );
  }

  static fromAccountParsed(
    address: PublicKey,
    accountParsed: BankRaw,
    bankMetadata?: BankMetadata
  ): Bank {
    const props = parseBankRaw(address, accountParsed, bankMetadata);
    return new Bank(
      props.address,
      props.mint,
      props.mintDecimals,
      props.group,
      props.mintRate,
      props.mintPrice,
      props.assetShareValue,
      props.liabilityShareValue,
      props.liquidityVault,
      props.liquidityVaultBump,
      props.liquidityVaultAuthorityBump,
      props.insuranceVault,
      props.insuranceVaultBump,
      props.insuranceVaultAuthorityBump,
      props.collectedInsuranceFeesOutstanding,
      props.feeVault,
      props.feeVaultBump,
      props.feeVaultAuthorityBump,
      props.collectedGroupFeesOutstanding,
      props.lastUpdate,
      props.config,
      props.totalAssetShares,
      props.totalLiabilityShares,
      props.emissionsActiveBorrowing,
      props.emissionsActiveLending,
      props.emissionsRate,
      props.emissionsMint,
      props.emissionsRemaining,
      props.oracleKey,
      props.emode,
      props.kaminoIntegrationAccounts,
      props.driftIntegrationAccounts,
      props.solendIntegrationAccounts,
      props.feesDestinationAccount,
      props.lendingPositionCount,
      props.borrowingPositionCount,
      props.tokenSymbol
    );
  }

  static withEmodeWeights(
    bank: Bank,
    emodeWeights: { assetWeightMaint: BigNumber; assetWeightInit: BigNumber }
  ): Bank {
    const newBank = Object.create(Bank.prototype);

    Object.assign(newBank, bank);

    newBank.config = Object.assign({}, bank.config);
    newBank.config.assetWeightInit = BigNumber.max(
      bank.config.assetWeightInit,
      emodeWeights.assetWeightInit
    );
    newBank.config.assetWeightMaint = BigNumber.max(
      bank.config.assetWeightMaint,
      emodeWeights.assetWeightMaint
    );

    return newBank;
  }

  static getPrice(
    oraclePrice: OraclePrice,
    priceBias: PriceBias = PriceBias.None,
    weightedPrice: boolean = false
  ): BigNumber {
    return getPrice(oraclePrice, priceBias, weightedPrice);
  }

  static computeQuantityFromUsdValue(
    oraclePrice: OraclePrice,
    usdValue: BigNumber,
    priceBias: PriceBias,
    weightedPrice: boolean
  ): BigNumber {
    const price = getPrice(oraclePrice, priceBias, weightedPrice);
    return usdValue.div(price);
  }

  getTotalAssetQuantity(): BigNumber {
    return getTotalAssetQuantity(this);
  }

  getTotalLiabilityQuantity(): BigNumber {
    return getTotalLiabilityQuantity(this);
  }

  getAssetQuantity(assetShares: BigNumber): BigNumber {
    return getAssetQuantity(this, assetShares);
  }

  getLiabilityQuantity(liabilityShares: BigNumber): BigNumber {
    return getLiabilityQuantity(this, liabilityShares);
  }

  getAssetShares(assetQuantity: BigNumber): BigNumber {
    return getAssetShares(this, assetQuantity);
  }

  getLiabilityShares(liabilityQuantity: BigNumber): BigNumber {
    return getLiabilityShares(this, liabilityQuantity);
  }

  computeAssetUsdValue(params: Omit<ComputeAssetUsdValueParams, "bank">): BigNumber {
    return computeAssetUsdValue({
      bank: this,
      ...params,
    });
  }

  computeLiabilityUsdValue(params: Omit<ComputeLiabilityUsdValueParams, "bank">): BigNumber {
    return computeLiabilityUsdValue({
      bank: this,
      ...params,
    });
  }

  computeUsdValue(params: Omit<ComputeUsdValueParams, "bank">): BigNumber {
    return computeUsdValue({
      bank: this,
      ...params,
    });
  }

  getAssetWeight(params: Omit<GetAssetWeightParams, "bank">): BigNumber {
    return getAssetWeight({
      bank: this,
      ...params,
    });
  }

  getLiabilityWeight(marginRequirementType: MarginRequirementType): BigNumber {
    return getLiabilityWeight(this.config, marginRequirementType);
  }

  computeTvl(oraclePrice: OraclePrice): BigNumber {
    return computeTvl(this, oraclePrice);
  }

  computeInterestRates(): {
    lendingRate: BigNumber;
    borrowingRate: BigNumber;
  } {
    return computeInterestRates(this);
  }

  computeBaseInterestRate(): BigNumber {
    return computeBaseInterestRate(this);
  }

  computeUtilizationRate(): BigNumber {
    return computeUtilizationRate(this);
  }

  computeRemainingCapacity(): {
    depositCapacity: BigNumber;
    borrowCapacity: BigNumber;
  } {
    return computeRemainingCapacity(this);
  }
}

class BankConfig implements BankConfigType {
  constructor(
    public assetWeightInit: BigNumber,
    public assetWeightMaint: BigNumber,
    public readonly liabilityWeightInit: BigNumber,
    public readonly liabilityWeightMaint: BigNumber,
    public readonly depositLimit: BigNumber,
    public readonly borrowLimit: BigNumber,
    public readonly riskTier: RiskTier,
    public readonly totalAssetValueInitLimit: BigNumber,
    public readonly assetTag: AssetTag,
    public readonly oracleSetup: OracleSetup,
    public readonly oracleKeys: PublicKey[],
    public readonly oracleMaxAge: number,
    public readonly interestRateConfig: InterestRateConfig,
    public readonly operationalState: OperationalState,
    public readonly oracleMaxConfidence: number,
    public readonly fixedPrice: BigNumber,
    public readonly configFlags?: BankConfigFlag
  ) {}

  static fromAccountParsed(bankConfigRaw: BankConfigRaw): BankConfig {
    const bankConfig = parseBankConfigRaw(bankConfigRaw);
    return new BankConfig(
      bankConfig.assetWeightInit,
      bankConfig.assetWeightMaint,
      bankConfig.liabilityWeightInit,
      bankConfig.liabilityWeightMaint,
      bankConfig.depositLimit,
      bankConfig.borrowLimit,
      bankConfig.riskTier,
      bankConfig.totalAssetValueInitLimit,
      bankConfig.assetTag,
      bankConfig.oracleSetup,
      bankConfig.oracleKeys,
      bankConfig.oracleMaxAge,
      bankConfig.interestRateConfig,
      bankConfig.operationalState,
      bankConfig.oracleMaxConfidence,
      bankConfig.fixedPrice,
      bankConfig.configFlags
    );
  }
}

export { Bank, BankConfig };
