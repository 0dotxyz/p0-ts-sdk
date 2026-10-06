import {
  fetchEncodedAccount,
  assertAccountExists,
  type Address,
  type GetAccountInfoApi,
  type ReadonlyUint8Array,
  type Rpc,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";

import {
  BankType,
  decodeBank,
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
  computeBankSupplyApy,
  computeBankBorrowApy,
  computeBankMetrics,
  ComputeBankMetricsParams,
  BankMetrics,
  isStandardBorrowable,
  isStandardDepositable,
  computeBankAvailableLiquidity,
  computeBankProjectedAvailableLiquidity,
  computeBankDepositCapRemaining,
  computeBankBorrowCapRemaining,
  computeBankRateLimitRemaining,
  computeVenueAvailableLiquidity,
  BankVenueStates,
  BankConfigType,
  BankRateLimiterType,
  RiskTier,
  AssetTag,
  BankConfigFlag,
  OracleSetup,
  InterestRateConfig,
  OperationalState,
  MarginRequirementType,
} from "../services";

import { EmodeSettings } from "./emode-settings";

import { BankMetadata } from "~/types";

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class Bank implements BankType {
  constructor(
    public readonly address: Address,
    public readonly mint: Address,
    public readonly mintDecimals: number,
    public readonly group: Address,
    public readonly assetShareValue: BigNumber,
    public readonly liabilityShareValue: BigNumber,
    public readonly liquidityVault: Address,
    public readonly liquidityVaultBump: number,
    public readonly liquidityVaultAuthorityBump: number,
    public readonly insuranceVault: Address,
    public readonly insuranceVaultBump: number,
    public readonly insuranceVaultAuthorityBump: number,
    public readonly collectedInsuranceFeesOutstanding: BigNumber,
    public readonly feeVault: Address,
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
    public readonly emissionsMint: Address,
    public readonly emissionsRemaining: BigNumber,
    public readonly collectedProgramFeesOutstanding: BigNumber,
    public readonly oracleKey: Address,
    public readonly emode: EmodeSettings,
    public readonly premiumTag: number,
    public readonly premiumActive: boolean,
    public readonly premiumActivatedAt: number,
    public readonly kaminoEmergency: boolean,
    public readonly rateLimiter?: BankRateLimiterType,
    public readonly kaminoIntegrationAccounts?: {
      kaminoReserve: Address;
      kaminoObligation: Address;
    },
    public readonly driftIntegrationAccounts?: {
      driftSpotMarket: Address;
      driftUser: Address;
      driftUserStats: Address;
    },
    public readonly solendIntegrationAccounts?: {
      solendReserve: Address;
      solendObligation: Address;
    },
    public readonly jupLendIntegrationAccounts?: {
      jupLendingState: Address;
      jupFTokenVault: Address;
      jupFTokenAta: Address;
    },
    public readonly feesDestinationAccount?: Address,
    public readonly lendingPositionCount?: BigNumber,
    public readonly borrowingPositionCount?: BigNumber,
    public readonly tokenSymbol?: string
  ) {}

  /**
   * Fetches and decodes the bank at `address`; `bankMetadata` supplies its token symbol.
   * @throws if the account doesn't exist or isn't a bank
   */
  static async fetch(
    address: Address,
    rpc: Rpc<GetAccountInfoApi>,
    bankMetadata?: BankMetadata
  ): Promise<Bank> {
    const account = await fetchEncodedAccount(rpc, address);
    assertAccountExists(account);
    return Bank.fromBuffer(address, account.data, bankMetadata);
  }

  /**
   * Decodes bank account data; `bankMetadata` supplies its token symbol.
   * @throws if `data` isn't a bank account
   */
  static fromBuffer(address: Address, data: ReadonlyUint8Array, bankMetadata?: BankMetadata): Bank {
    return Bank.fromBankType(decodeBank(address, data, bankMetadata));
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
      bankType.config.configFlags,
      bankType.config.scopeEntryIndex
    );
    return new Bank(
      bankType.address,
      bankType.mint,
      bankType.mintDecimals,
      bankType.group,
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
      bankType.collectedProgramFeesOutstanding,
      bankType.oracleKey,
      bankType.emode,
      bankType.premiumTag,
      bankType.premiumActive,
      bankType.premiumActivatedAt,
      bankType.kaminoEmergency,
      bankType.rateLimiter,
      bankType.kaminoIntegrationAccounts,
      bankType.driftIntegrationAccounts,
      bankType.solendIntegrationAccounts,
      bankType.jupLendIntegrationAccounts,
      bankType.feesDestinationAccount,
      bankType.lendingPositionCount,
      bankType.borrowingPositionCount,
      bankType.tokenSymbol
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

  /** Supply APY, compounded annually from the lending rate (0.05 = 5%). */
  computeSupplyApy(): number {
    return computeBankSupplyApy(this);
  }

  /** Borrow APY, compounded annually from the borrowing rate (0.05 = 5%). */
  computeBorrowApy(): number {
    return computeBankBorrowApy(this);
  }

  /** Every UI metric for this bank in one call; see {@link BankMetrics}. */
  computeMetrics(params: Omit<ComputeBankMetricsParams, "bank">): BankMetrics {
    return computeBankMetrics({ ...params, bank: this });
  }

  /** Whether the standard borrow instruction accepts this bank (DEFAULT/SOL, operational, cap > 0). */
  get isStandardBorrowable(): boolean {
    return isStandardBorrowable(this);
  }

  /** Whether the standard deposit instruction accepts this bank (DEFAULT/SOL, operational). */
  get isStandardDepositable(): boolean {
    return isStandardDepositable(this);
  }

  /** Liquidity (UI units) the vault can pay out: max(0, deposits - borrows). */
  computeAvailableLiquidity(assetShareValueMultiplier?: BigNumber): BigNumber {
    return computeBankAvailableLiquidity(this, assetShareValueMultiplier);
  }

  /** {@link computeAvailableLiquidity} net of the liquidity interest accrual drains before the tx lands. */
  computeProjectedAvailableLiquidity(assetShareValueMultiplier?: BigNumber): BigNumber {
    return computeBankProjectedAvailableLiquidity(this, assetShareValueMultiplier);
  }

  /** Remaining deposit capacity (UI units), `Infinity` when the deposit limit is inactive. */
  computeDepositCapRemaining(): number {
    return computeBankDepositCapRemaining(this);
  }

  /** Remaining borrow capacity (UI units), `Infinity` when the borrow limit is inactive. */
  computeBorrowCapRemaining(): number {
    return computeBankBorrowCapRemaining(this);
  }

  /** Remaining rate-limit outflow (UI units), or `null` when the bank has no rate limiter. */
  computeRateLimitRemaining(nowSeconds?: number): BigNumber | null {
    return computeBankRateLimitRemaining(this, nowSeconds);
  }

  /**
   * Idle liquidity (UI units) of the external venue backing an integrated bank, or `undefined`
   * for non-integrated banks or missing venue state.
   */
  computeVenueAvailableLiquidity(venueStates?: BankVenueStates): BigNumber | undefined {
    return computeVenueAvailableLiquidity(this, venueStates);
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
    public readonly oracleKeys: Address[],
    public readonly oracleMaxAge: number,
    public readonly interestRateConfig: InterestRateConfig,
    public readonly operationalState: OperationalState,
    public readonly oracleMaxConfidence: number,
    public readonly fixedPrice: BigNumber,
    public readonly configFlags?: BankConfigFlag,
    public readonly scopeEntryIndex?: number
  ) {}
}

export { Bank, BankConfig };
