import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { QuoteResponse } from "@jup-ag/api";

import instructions from "~/instructions";
import { Amount, BankIntegrationMetadataMap, MarginfiProgram, MintData, Program } from "~/types";
import { MarginfiIdlType } from "~/idl";
import {
  AccountFlags,
  computeAccountValue,
  computeActiveEmodePairs,
  computeEmodeImpacts,
  computeFreeCollateral,
  computeFreeCollateralLegacy,
  computeHealthCheckAccounts,
  computeHealthComponents,
  computeHealthComponentsLegacy,
  computeHealthComponentsWithoutBiasLegacy,
  computeMaxBorrowForBank,
  computeMaxWithdrawForBank,
  computeNetApy,
  computeProjectedActiveBalancesNoCpi,
  computeProjectedActiveBanksNoCpi,
  decodeAccountRaw,
  getBalance,
  makeBeginFlashLoanIx,
  makeBorrowIx,
  MakeBorrowIxParams,
  makeBorrowTx,
  MakeBorrowTxParams,
  makeDepositIx,
  MakeDepositIxParams,
  makeDepositTx,
  MakeDepositTxParams,
  makeEndFlashLoanIx,
  makeFlashLoanTx,
  MakeFlashLoanTxParams,
  makeKaminoDepositTx,
  MakeKaminoDepositTxParams,
  makeKaminoWithdrawTx,
  MakeKaminoWithdrawTxParams,
  makeLoopTx,
  makePulseHealthIx,
  makeRepayIx,
  MakeRepayIxParams,
  makeRepayTx,
  MakeRepayTxParams,
  makeRepayWithCollatTx,
  MakeRepayWithCollatTxParams,
  makeSwapCollateralTx,
  MakeSwapCollateralTxParams,
  makeSwapDebtTx,
  MakeSwapDebtTxParams,
  makeWithdrawEmissionsIx,
  makeWithdrawIx,
  MakeWithdrawIxParams,
  makeWithdrawTx,
  MakeWithdrawTxParams,
  MarginfiAccountRaw,
  MarginfiAccountType,
  MarginRequirementType,
  MakeLoopTxParams,
  parseMarginfiAccountRaw,
  simulateAccountHealthCacheWithFallback,
  TransactionBuilderResult,
  MakeDriftDepositTxParams,
  makeDriftDepositTx,
  MakeDriftWithdrawTxParams,
  makeDriftWithdrawTx,
} from "~/services/account";
import {
  BankType,
  EmodeImpactStatus,
  EmodePair,
  ActionEmodeImpact,
  ActiveEmodePair,
} from "~/services/bank";
import { OraclePrice } from "~/services/price";
import {
  ExtendedTransaction,
  ExtendedV0Transaction,
  InstructionsWrapper,
  makeUnwrapSolIx,
  makeWrapSolIxs,
} from "~/services/transaction";

import { Balance } from "./balance";
import { Bank } from "./bank";
import { HealthCache } from "./health-cache";

// ----------------------------------------------------------------------------
// Client types
// ----------------------------------------------------------------------------

class MarginfiAccount implements MarginfiAccountType {
  constructor(
    public readonly address: PublicKey,
    public readonly group: PublicKey,
    public readonly authority: PublicKey,
    public readonly balances: Balance[],
    public readonly accountFlags: AccountFlags[],
    public readonly emissionsDestinationAccount: PublicKey,
    public healthCache: HealthCache
  ) {}

  /**
   * Fetches a marginfi account from on-chain data.
   *
   * @param address - The public key of the marginfi account
   * @param program - The Marginfi program instance
   *
   * @returns Promise resolving to a MarginfiAccount instance
   */
  static async fetch(address: PublicKey, program: MarginfiProgram): Promise<MarginfiAccount> {
    const data: MarginfiAccountRaw = await program.account.marginfiAccount.fetch(address);
    return MarginfiAccount.fromAccountParsed(address, data);
  }

  static decodeAccountRaw(encoded: Buffer, idl: MarginfiIdlType): MarginfiAccountRaw {
    return decodeAccountRaw(encoded, idl);
  }

  static fromAccountType(account: MarginfiAccountType) {
    return new MarginfiAccount(
      account.address,
      account.group,
      account.authority,
      account.balances.map((b) => Balance.fromBalanceType(b)),
      account.accountFlags,
      account.emissionsDestinationAccount,
      account.healthCache
    );
  }

  /**
   * Creates a MarginfiAccount instance from parsed account data.
   *
   * @param marginfiAccountPk - The public key of the marginfi account
   * @param accountData - The raw account data from the program
   *
   * @returns A new MarginfiAccount instance
   */
  static fromAccountParsed(marginfiAccountPk: PublicKey, accountData: MarginfiAccountRaw) {
    const props = parseMarginfiAccountRaw(marginfiAccountPk, accountData);
    return new MarginfiAccount(
      props.address,
      props.group,
      props.authority,
      props.balances.map((b) => Balance.fromBalanceType(b)),
      props.accountFlags,
      props.emissionsDestinationAccount,
      HealthCache.fromHealthCacheType(props.healthCache)
    );
  }

  /**
   * Simulates and updates the health cache for this account.
   *
   * Fetches current oracle prices and computes fresh health values. Returns a new
   * account instance with updated health cache (does not mutate this instance).
   *
   * @param program - The Marginfi program instance
   * @param bankMap - Map of all available banks
   * @param oraclePrices - Map of current oracle prices
   * @param bankMetadataMap - Bank integration metadata
   *
   * @returns Object containing the updated account and any errors
   */
  async simulateHealthCache(
    program: Program<MarginfiIdlType>,
    bankMap: Map<string, Bank>,
    oraclePrices: Map<string, OraclePrice>,
    bankMetadataMap: BankIntegrationMetadataMap
  ) {
    const accountWithHealthCache = await simulateAccountHealthCacheWithFallback({
      program,
      bankMap,
      oraclePrices,
      marginfiAccount: this,
      bankMetadataMap: bankMetadataMap,
    });

    return {
      account: MarginfiAccount.fromAccountType(accountWithHealthCache.marginfiAccount),
      error: accountWithHealthCache.error,
    };
  }

  static fromAccountDataRaw(marginfiAccountPk: PublicKey, rawData: Buffer, idl: MarginfiIdlType) {
    const marginfiAccountData = MarginfiAccount.decodeAccountRaw(rawData, idl);
    return MarginfiAccount.fromAccountParsed(marginfiAccountPk, marginfiAccountData);
  }
  // ----------------------------------------------------------------------------
  // Attributes
  // ----------------------------------------------------------------------------

  /**
   * Gets all balances that are currently active (non-zero).
   *
   * @returns Array of active Balance instances
   */
  get activeBalances(): Balance[] {
    return this.balances.filter((b) => b.active);
  }

  /**
   * Gets the balance for a specific bank.
   *
   * @param bankPk - The public key of the bank
   *
   * @returns The Balance instance for the bank (may be empty)
   */
  getBalance(bankPk: PublicKey): Balance {
    return Balance.fromBalanceType(getBalance(bankPk, this.balances));
  }

  /**
   * Checks if the account is disabled.
   *
   * @returns True if the account is disabled, false otherwise
   */
  get isDisabled(): boolean {
    return this.accountFlags.includes(AccountFlags.ACCOUNT_DISABLED);
  }

  /**
   * Checks if the account is currently in a flash loan.
   *
   * @returns True if a flash loan is active, false otherwise
   */
  get isFlashLoanEnabled(): boolean {
    return this.accountFlags.includes(AccountFlags.ACCOUNT_IN_FLASHLOAN);
  }

  /**
   * Checks if account authority transfer is enabled.
   *
   * @returns True if authority transfer is allowed, false otherwise
   */
  get isTransferAccountAuthorityEnabled(): boolean {
    return this.accountFlags.includes(AccountFlags.ACCOUNT_TRANSFER_AUTHORITY_ALLOWED);
  }

  /**
   * Sets the health cache for this account.
   *
   * Note: This mutates the account instance. Consider using simulateHealthCache()
   * for a pure functional approach that returns a new account instance.
   *
   * @param value - The new health cache to set
   */
  setHealthCache(value: HealthCache) {
    this.healthCache = value;
  }

  /**
   * Computes free collateral using cached health values.
   *
   * Free collateral represents the amount of collateral that is not backing any liabilities.
   *
   * @param opts - Optional configuration
   * @param opts.clamped - If true, clamps negative values to zero
   *
   * @returns The free collateral amount in USD
   */
  computeFreeCollateral(opts?: { clamped?: boolean }): BigNumber {
    return computeFreeCollateral(this, opts);
  }

  computeFreeCollateralLegacy(
    banks: Map<string, BankType>,
    oraclePrices: Map<string, OraclePrice>,
    opts?: { clamped?: boolean }
  ): BigNumber {
    return computeFreeCollateralLegacy(this.activeBalances, banks, oraclePrices, opts);
  }

  /**
   * Computes health components using cached health values.
   *
   * Returns weighted asset and liability values based on the margin requirement type.
   *
   * @param marginReqType - The margin requirement type (Initial, Maintenance, or Equity)
   *
   * @returns Object containing assets and liabilities values in USD
   */
  computeHealthComponents(marginReqType: MarginRequirementType): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeHealthComponents(this, marginReqType);
  }

  computeHealthComponentsLegacy(
    banks: Map<string, Bank>,
    oraclePrices: Map<string, OraclePrice>,
    marginReqType: MarginRequirementType,
    excludedBanks: PublicKey[] = []
  ): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeHealthComponentsLegacy(
      this.activeBalances,
      banks,
      oraclePrices,
      marginReqType,
      excludedBanks
    );
  }

  computeHealthComponentsWithoutBiasLegacy(
    banks: Map<string, Bank>,
    oraclePrices: Map<string, OraclePrice>,
    marginReqType: MarginRequirementType
  ): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeHealthComponentsWithoutBiasLegacy(
      this.activeBalances,
      banks,
      oraclePrices,
      marginReqType
    );
  }

  /**
   * Computes the total account value (equity).
   *
   * Account value is calculated as total assets minus total liabilities.
   *
   * @returns The account value in USD
   */
  computeAccountValue(): BigNumber {
    return computeAccountValue(this);
  }

  /**
   * Computes the net APY (Annual Percentage Yield) for this account.
   *
   * Takes into account all active positions and their respective interest rates.
   *
   * @param banks - Map of all available banks
   * @param oraclePrices - Map of oracle prices for all assets
   *
   * @returns The net APY as a decimal (e.g., 0.05 = 5%)
   */
  computeNetApy(banks: Map<string, BankType>, oraclePrices: Map<string, OraclePrice>): number {
    return computeNetApy(this, this.activeBalances, banks, oraclePrices);
  }

  /**
   * Calculates the maximum amount that can be borrowed from a bank.
   *
   * Takes into account:
   * - Free collateral available
   * - Existing deposits in the bank
   * - Risk weights and oracle prices
   * - E-mode configurations if applicable
   *
   * Formula:
   * q = (min(fc, ucb) / (price_lowest_bias * deposit_weight)) + (fc - min(fc, ucb)) / (price_highest_bias * liab_weight)
   * where fc = free collateral, ucb = untied collateral for bank
   *
   * @param banks - Map of all available banks
   * @param oraclePrices - Map of oracle prices
   * @param bankAddress - The bank to borrow from
   * @param opts - Optional configuration for e-mode and volatility
   *
   * @returns Maximum borrowable amount in UI units
   *
   * @remarks
   * NOTE FOR LIQUIDATORS: This function doesn't account for collateral received when liquidating.
   *
   * @see {@link computeMaxBorrowForBank} for implementation details
   */
  computeMaxBorrowForBank(
    banks: Map<string, BankType>,
    oraclePrices: Map<string, OraclePrice>,
    bankAddress: PublicKey,
    opts?: {
      emodeImpactStatus?: EmodeImpactStatus;
      volatilityFactor?: number;
      activePair?: ActiveEmodePair;
    }
  ): BigNumber {
    return computeMaxBorrowForBank(this, banks, oraclePrices, bankAddress, opts);
  }

  /**
   * Calculates the maximum amount that can be withdrawn from a bank without borrowing.
   *
   * Ensures the account remains healthy after withdrawal by checking collateral requirements.
   *
   * @param banks - Map of all available banks
   * @param oraclePrices - Map of oracle prices
   * @param bankAddress - The bank to withdraw from
   * @param opts - Optional configuration for e-mode and volatility
   *
   * @returns Maximum withdrawable amount in UI units
   *
   * @see {@link computeMaxWithdrawForBank} for implementation details
   */
  computeMaxWithdrawForBank(
    banks: Map<string, BankType>,
    oraclePrices: Map<string, OraclePrice>,
    bankAddress: PublicKey,
    opts?: {
      volatilityFactor?: number;
      activePair?: ActiveEmodePair;
    }
  ): BigNumber {
    return computeMaxWithdrawForBank(this, banks, oraclePrices, bankAddress, opts);
  }

  /**
   * Gets the banks required for health check calculations.
   *
   * Returns banks that have active balances, plus any mandatory banks, minus excluded banks.
   *
   * @param banks - Map of all available banks
   * @param mandatoryBanks - Banks to always include
   * @param excludedBanks - Banks to exclude
   *
   * @returns Array of banks needed for health checks
   */
  getHealthCheckAccounts(
    banks: Map<string, BankType>,
    mandatoryBanks: PublicKey[] = [],
    excludedBanks: PublicKey[] = []
  ): BankType[] {
    return computeHealthCheckAccounts(this.balances, banks, mandatoryBanks, excludedBanks);
  }

  /**
   * Determines which E-mode pairs are currently active for this account.
   *
   * E-mode (Efficiency Mode) allows for higher leverage when borrowing and lending
   * related assets (e.g., different stablecoins).
   *
   * @param emodePairs - All available E-mode pairs to check
   *
   * @returns Array of active E-mode pairs, or empty array if no E-mode is active
   */
  computeActiveEmodePairs(emodePairs: EmodePair[]): EmodePair[] {
    const activeLiabilities = this.activeBalances
      .filter((balance) => balance.liabilityShares.gt(0))
      .map((balance) => balance.bankPk);
    const activeCollateral = this.activeBalances
      .filter((balance) => balance.assetShares.gt(0))
      .map((balance) => balance.bankPk);
    return computeActiveEmodePairs(emodePairs, activeLiabilities, activeCollateral);
  }

  /**
   * Calculates how different actions would affect E-mode status.
   *
   * For each bank, simulates:
   * - Borrowing (for banks not currently borrowed from)
   * - Supplying (for supported collateral banks)
   * - Repaying (for banks with active liabilities)
   * - Withdrawing (for banks with active collateral)
   *
   * @param emodePairs - All available E-mode pairs
   * @param banks - Array of bank PublicKeys to analyze
   *
   * @returns Object mapping bank addresses to their action impact analysis
   */
  computeEmodeImpacts(
    emodePairs: EmodePair[],
    banks: PublicKey[]
  ): Record<string, ActionEmodeImpact> {
    const activeLiabilities = this.activeBalances
      .filter((balance) => balance.liabilityShares.gt(0))
      .map((balance) => balance.bankPk);
    const activeCollateral = this.activeBalances
      .filter((balance) => balance.assetShares.gt(0))
      .map((balance) => balance.bankPk);

    return computeEmodeImpacts(emodePairs, activeLiabilities, activeCollateral, banks);
  }

  // ----------------------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------------------

  /**
   * Creates a deposit instruction for this marginfi account.
   *
   * @param params - Deposit instruction parameters
   * @returns Promise resolving to InstructionsWrapper containing the deposit instructions
   *
   * @see {@link makeDepositIx} for detailed implementation and additional options
   */
  async makeDepositIx(
    params: Omit<MakeDepositIxParams, "accountAddress" | "authority" | "group">
  ): Promise<InstructionsWrapper> {
    return makeDepositIx({
      ...params,
      accountAddress: this.address,
      authority: this.authority,
      group: this.group,
    });
  }

  /**
   * Creates a repay instruction for this marginfi account.
   *
   * @param params - Repay instruction parameters
   * @returns Promise resolving to InstructionsWrapper containing the repay instructions
   *
   * @see {@link makeRepayIx} for detailed implementation
   */
  async makeRepayIx(
    params: Omit<MakeRepayIxParams, "accountAddress" | "authority">
  ): Promise<InstructionsWrapper> {
    return makeRepayIx({
      ...params,
      accountAddress: this.address,
      authority: this.authority,
    });
  }

  /**
   * Creates a withdraw instruction for this marginfi account.
   *
   * @param params - Withdraw instruction parameters
   * @returns Promise resolving to InstructionsWrapper containing the withdraw instructions
   *
   * @see {@link makeWithdrawIx} for detailed implementation
   */
  async makeWithdrawIx(
    params: Omit<MakeWithdrawIxParams, "marginfiAccount" | "authority">
  ): Promise<InstructionsWrapper> {
    return makeWithdrawIx({
      ...params,
      marginfiAccount: this,
      authority: this.authority,
    });
  }

  /**
   * Creates a borrow instruction for this marginfi account.
   *
   * @param params - Borrow instruction parameters
   * @returns Promise resolving to InstructionsWrapper containing the borrow instructions
   *
   * @see {@link makeBorrowIx} for detailed implementation
   */
  async makeBorrowIx(
    params: Omit<MakeBorrowIxParams, "marginfiAccount" | "authority">
  ): Promise<InstructionsWrapper> {
    return makeBorrowIx({
      ...params,
      marginfiAccount: this,
      authority: this.authority,
    });
  }

  /**
   * Creates a withdraw emissions instruction.
   *
   * @deprecated Rewards are now distributed offchain. If you wish to get access to emission data, please reach out.
   *
   * @param program - The Marginfi program instance
   * @param banks - Map of all available banks
   * @param mintDatas - Map of mint data for token programs
   * @param bankAddress - The bank to withdraw emissions from
   *
   * @returns Promise resolving to InstructionsWrapper containing the withdraw emissions instructions
   *
   * @see {@link makeWithdrawEmissionsIx} for implementation
   */
  async makeWithdrawEmissionsIx(
    program: MarginfiProgram,
    banks: Map<string, Bank>,
    mintDatas: Map<string, MintData>,
    bankAddress: PublicKey
  ): Promise<InstructionsWrapper> {
    return makeWithdrawEmissionsIx(program, this, banks, mintDatas, bankAddress);
  }

  /**
   * Creates an instruction to begin a flash loan.
   *
   * Flash loans allow borrowing assets within a single transaction, which must be
   * repaid before the transaction completes.
   *
   * @param params - Begin flash loan instruction parameters
   * @returns Promise resolving to InstructionsWrapper containing the begin flash loan instruction
   *
   * @see {@link makeBeginFlashLoanIx} for implementation
   */
  async makeBeginFlashLoanIx(
    program: MarginfiProgram,
    endIndex: number,
    authority?: PublicKey
  ): Promise<InstructionsWrapper> {
    return await makeBeginFlashLoanIx(program, this.address, endIndex, authority);
  }

  /**
   * Creates an instruction to end a flash loan.
   *
   * Validates that all required banks are available and constructs the end flash loan
   * instruction with proper health checks.
   *
   * @param program - The Marginfi program instance
   * @param bankMap - Map of all available banks
   * @param projectedActiveBanks - Banks that will be active after the flash loan
   * @param authority - Optional authority override (defaults to account authority)
   *
   * @returns Promise resolving to InstructionsWrapper containing the end flash loan instruction
   *
   * @throws {Error} If any projected active bank is not found in bankMap
   *
   * @see {@link makeEndFlashLoanIx} for implementation
   */
  async makeEndFlashLoanIx(
    program: MarginfiProgram,
    bankMap: Map<string, Bank>,
    projectedActiveBanks: PublicKey[],
    authority?: PublicKey
  ): Promise<InstructionsWrapper> {
    // Pre-validate all banks exist before processing
    const missingBanks = projectedActiveBanks.filter((account) => !bankMap.get(account.toBase58()));
    if (missingBanks.length > 0) {
      throw Error(
        `Banks not found for flashloan end operation: ${missingBanks.map((b) => b.toBase58()).join(", ")}`
      );
    }

    const banks = projectedActiveBanks.map((account) => bankMap.get(account.toBase58())!);

    return makeEndFlashLoanIx(program, this.address, banks, authority);
  }

  /**
   * Creates an instruction to transfer this account to a new authority.
   *
   * Transfers ownership of the marginfi account to a new authority and account address.
   *
   * @param program - The Marginfi program instance
   * @param newMarginfiAccount - The new marginfi account public key
   * @param newAuthority - The new authority public key
   *
   * @returns Promise resolving to InstructionsWrapper containing the transfer instruction
   *
   * @see {@link makeAccountTransferToNewAccountIx} for implementation
   */
  async makeAccountTransferToNewAccountIx(
    program: MarginfiProgram,
    newMarginfiAccount: PublicKey,
    newAuthority: PublicKey
  ): Promise<InstructionsWrapper> {
    const accountTransferToNewAccountIx = await instructions.makeAccountTransferToNewAccountIx(
      program,
      {
        oldMarginfiAccount: this.address,
        newMarginfiAccount,
        newAuthority,
        feePayer: this.authority,
      }
    );
    return { instructions: [accountTransferToNewAccountIx], keys: [] };
  }

  /**
   * Creates an instruction to close this marginfi account.
   *
   * Closes the account and returns rent to the fee payer. The account must have
   * no active balances before closing.
   *
   * @param program - The Marginfi program instance
   *
   * @returns Promise resolving to InstructionsWrapper containing the close account instruction
   *
   * @see {@link makeCloseAccountIx} for implementation
   */
  async makeCloseAccountIx(program: MarginfiProgram): Promise<InstructionsWrapper> {
    const ix = await instructions.makeCloseAccountIx(program, {
      marginfiAccount: this.address,
      feePayer: this.authority,
    });
    return { instructions: [ix], keys: [] };
  }

  /**
   * Creates an instruction to update the account's health cache.
   *
   * Pulses the health of the account to ensure the cached health values are current.
   *
   * @param program - The Marginfi program instance
   * @param banks - Map of all available banks
   * @param mandatoryBanks - Banks that must be included in health calculation
   * @param excludedBanks - Banks to exclude from health calculation
   *
   * @returns Promise resolving to InstructionsWrapper containing the pulse health instruction
   *
   * @see {@link makePulseHealthIx} for implementation
   */
  async makePulseHealthIx(
    program: MarginfiProgram,
    banks: Map<string, Bank>,
    mandatoryBanks: PublicKey[],
    excludedBanks: PublicKey[]
  ) {
    return makePulseHealthIx(
      program,
      this.address,
      banks,
      this.balances,
      mandatoryBanks,
      excludedBanks
    );
  }

  /**
   * Computes which banks will be active after executing the given instructions.
   *
   * Analyzes transaction instructions to determine which banks will have active
   * balances, without making CPI calls.
   *
   * @param program - The Marginfi program instance
   * @param instructions - Transaction instructions to analyze
   *
   * @returns Array of PublicKeys for banks that will be active
   *
   * @see {@link computeProjectedActiveBanksNoCpi} for implementation
   */
  computeProjectedActiveBanksNoCpi(
    program: MarginfiProgram,
    instructions: TransactionInstruction[]
  ): PublicKey[] {
    return computeProjectedActiveBanksNoCpi(this.balances, instructions, program);
  }

  /**
   * Computes projected active balances after executing the given instructions.
   *
   * Simulates the effect of instructions on account balances without making CPI calls.
   * Returns the projected balances and which banks will be impacted.
   *
   * @param program - The Marginfi program instance
   * @param instructions - Transaction instructions to simulate
   * @param bankMap - Map of all available banks
   *
   * @returns Object containing projected balances and impacted banks
   *
   * @see {@link computeProjectedActiveBalancesNoCpi} for implementation
   */
  computeProjectedActiveBalancesNoCpi(
    program: MarginfiProgram,
    instructions: TransactionInstruction[],
    bankMap: Map<string, BankType>
  ): {
    projectedBalances: Balance[];
    impactedAssetsBanks: string[];
    impactedLiabilityBanks: string[];
  } {
    const { projectedBalances, ...rest } = computeProjectedActiveBalancesNoCpi(
      this.balances,
      instructions,
      program,
      bankMap
    );

    return {
      projectedBalances: projectedBalances.map(Balance.fromBalanceType),
      ...rest,
    };
  }

  /**
   * Wraps an instruction with SOL wrapping and unwrapping instructions.
   *
   * Useful for instructions that need native SOL to be converted to wSOL.
   * Automatically unwraps wSOL back to SOL after the instruction executes.
   *
   * @param ix - The instruction to wrap
   * @param amount - The amount of SOL to wrap (defaults to 0)
   *
   * @returns Array of instructions: [wrap SOL, original instruction, unwrap SOL]
   *
   * @see {@link makeWrapSolIxs} and {@link makeUnwrapSolIx} for wrap/unwrap implementation
   */
  wrapInstructionForWSol(
    ix: TransactionInstruction,
    amount: Amount = new BigNumber(0)
  ): TransactionInstruction[] {
    return [
      ...makeWrapSolIxs(this.authority, new BigNumber(amount)),
      ix,
      makeUnwrapSolIx(this.authority),
    ];
  }

  /**
   * Creates a loop transaction to leverage a position.
   *
   * A loop transaction:
   * 1. Deposits initial collateral (if in DEPOSIT mode)
   * 2. Borrows assets via flashloan
   * 3. Swaps borrowed assets to deposit asset (via Jupiter)
   * 4. Deposits swapped assets as additional collateral
   *
   * This creates a leveraged position by recursively depositing and borrowing.
   *
   * @param params - Loop transaction parameters
   * @param params.connection - Solana connection instance
   * @param params.oraclePrices - Map of current oracle prices
   * @param params.depositOpts - Deposit configuration (bank, amount, mode)
   * @param params.borrowOpts - Borrow configuration (bank, amount)
   * @param params.swapOpts - Jupiter swap configuration (slippage, fees)
   * @param params.addressLookupTableAccounts - Address lookup tables
   * @param params.overrideInferAccounts - Optional account overrides
   * @param params.additionalIxs - Additional instructions to include
   * @param params.crossbarUrl - Crossbar URL for oracle updates
   *
   * @returns Object containing transactions array, action index, and swap quote
   *
   * @throws {TransactionBuildingError} If swap exceeds transaction size limits
   *
   * @see {@link makeLoopTx} for detailed implementation
   */
  async makeLoopTx(params: Omit<MakeLoopTxParams, "marginfiAccount">): Promise<{
    transactions: ExtendedV0Transaction[];
    actionTxIndex: number;
    quoteResponse: QuoteResponse | undefined;
  }> {
    return makeLoopTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a transaction to repay debt using collateral.
   *
   * A repay with collateral transaction:
   * 1. Withdraws collateral from the account via flashloan
   * 2. Swaps collateral to debt asset (via Jupiter)
   * 3. Repays the debt with swapped assets
   *
   * This allows users to close or reduce positions without external funds.
   *
   * @param params - Repay with collateral transaction parameters
   * @param params.connection - Solana connection instance
   * @param params.oraclePrices - Map of current oracle prices
   * @param params.withdrawOpts - Withdraw configuration (bank, amount)
   * @param params.repayOpts - Repay configuration (bank, optional amount)
   * @param params.swapOpts - Jupiter swap configuration
   * @param params.addressLookupTableAccounts - Address lookup tables
   * @param params.overrideInferAccounts - Optional account overrides
   * @param params.additionalIxs - Additional instructions to include
   * @param params.crossbarUrl - Crossbar URL for oracle updates
   *
   * @returns Object containing transactions array, action index, and swap details
   *
   * @throws {TransactionBuildingError} If swap exceeds transaction size limits
   * @throws {TransactionBuildingError} If Kamino reserve not found
   *
   * @see {@link makeRepayWithCollatTx} for detailed implementation
   */
  async makeRepayWithCollatTx(
    params: Omit<MakeRepayWithCollatTxParams, "marginfiAccount">
  ): Promise<{
    transactions: ExtendedV0Transaction[];
    swapQuote: QuoteResponse | undefined;
    amountToRepay: number;
  }> {
    return makeRepayWithCollatTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a transaction to swap one collateral position to another using a flash loan.
   *
   * A swap collateral transaction:
   * 1. Withdraws existing collateral via flash loan
   * 2. Swaps collateral to new asset (via Jupiter)
   * 3. Deposits swapped assets as new collateral
   *
   * This allows users to change their collateral type (e.g., JitoSOL -> mSOL) without
   * withdrawing and affecting their health during the swap.
   *
   * @param params - Swap collateral transaction parameters
   * @param params.connection - Solana connection instance
   * @param params.oraclePrices - Map of current oracle prices
   * @param params.withdrawOpts - Withdraw configuration (bank, amount, tokenProgram)
   * @param params.depositOpts - Deposit configuration (bank, tokenProgram)
   * @param params.swapOpts - Jupiter swap configuration
   * @param params.addressLookupTableAccounts - Address lookup tables
   * @param params.overrideInferAccounts - Optional account overrides
   * @param params.additionalIxs - Additional instructions to include
   * @param params.crossbarUrl - Crossbar URL for oracle updates
   *
   * @returns Object containing transactions array, action index, and swap quote
   *
   * @throws {TransactionBuildingError} If swap exceeds transaction size limits
   * @throws {TransactionBuildingError} If Kamino reserve not found
   *
   * @see {@link makeSwapCollateralTx} for detailed implementation
   */
  async makeSwapCollateralTx(params: Omit<MakeSwapCollateralTxParams, "marginfiAccount">): Promise<{
    transactions: ExtendedV0Transaction[];
    actionTxIndex: number;
    quoteResponse: QuoteResponse | undefined;
  }> {
    return makeSwapCollateralTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a transaction to swap one debt position to another using a flash loan.
   *
   * A swap debt transaction:
   * 1. Borrows new asset via flash loan (new debt)
   * 2. Swaps new asset to old debt asset (via Jupiter)
   * 3. Repays old debt with swapped assets
   *
   * This allows users to change their debt type (e.g., USDC debt -> SOL debt) without
   * repaying and affecting their health during the swap.
   *
   * @param params - Swap debt transaction parameters
   * @param params.connection - Solana connection instance
   * @param params.oraclePrices - Map of current oracle prices
   * @param params.repayOpts - Repay configuration (bank, amount, tokenProgram)
   * @param params.borrowOpts - Borrow configuration (bank, tokenProgram)
   * @param params.swapOpts - Jupiter swap configuration
   * @param params.addressLookupTableAccounts - Address lookup tables
   * @param params.overrideInferAccounts - Optional account overrides
   * @param params.additionalIxs - Additional instructions to include
   * @param params.crossbarUrl - Crossbar URL for oracle updates
   *
   * @returns Object containing transactions array, action index, and swap quote
   *
   * @throws {TransactionBuildingError} If swap exceeds transaction size limits
   *
   * @see {@link makeSwapDebtTx} for detailed implementation
   */
  async makeSwapDebtTx(params: Omit<MakeSwapDebtTxParams, "marginfiAccount">): Promise<{
    transactions: ExtendedV0Transaction[];
    actionTxIndex: number;
    quoteResponse: QuoteResponse | undefined;
  }> {
    return makeSwapDebtTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a deposit transaction.
   *
   * @param params - Parameters for the deposit transaction
   * @returns Promise resolving to an ExtendedTransaction
   *
   * @see {@link makeDepositTx} for detailed implementation
   */
  async makeDepositTx(
    params: Omit<MakeDepositTxParams, "accountAddress" | "authority" | "group">
  ): Promise<ExtendedTransaction> {
    return makeDepositTx({
      ...params,
      accountAddress: this.address,
      authority: this.authority,
      group: this.group,
    });
  }

  /**
   * Creates a Drift deposit transaction.
   *
   * @param params - Parameters for the Drift deposit transaction
   * @returns Promise resolving to an ExtendedV0Transaction
   *
   * @see {@link makeDriftDepositTx} for detailed implementation
   */
  async makeDriftDepositTx(
    params: Omit<MakeDriftDepositTxParams, "accountAddress" | "authority" | "group">
  ): Promise<ExtendedV0Transaction> {
    return makeDriftDepositTx({
      ...params,
      accountAddress: this.address,
      authority: this.authority,
      group: this.group,
    });
  }

  /**
   * Creates a Kamino deposit transaction.
   *
   * @param params - Parameters for the Kamino deposit transaction
   * @returns Promise resolving to an ExtendedV0Transaction
   *
   * @see {@link makeKaminoDepositTx} for detailed implementation
   */
  async makeKaminoDepositTx(
    params: Omit<MakeKaminoDepositTxParams, "accountAddress" | "authority" | "group">
  ): Promise<ExtendedV0Transaction> {
    return makeKaminoDepositTx({
      ...params,
      accountAddress: this.address,
      authority: this.authority,
      group: this.group,
    });
  }

  /**
   * Creates a borrow transaction.
   *
   * @param params - Parameters for the borrow transaction
   * @returns Promise resolving to a TransactionBuilderResult
   *
   * @see {@link makeBorrowTx} for detailed implementation
   */
  async makeBorrowTx(
    params: Omit<MakeBorrowTxParams, "marginfiAccount">
  ): Promise<TransactionBuilderResult> {
    return makeBorrowTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a repay transaction.
   *
   * @param params - Parameters for the repay transaction
   * @returns Promise resolving to an ExtendedTransaction
   *
   * @see {@link makeRepayTx} for detailed implementation
   */
  async makeRepayTx(
    params: Omit<MakeRepayTxParams, "accountAddress" | "authority">
  ): Promise<ExtendedTransaction> {
    return makeRepayTx({
      ...params,
      accountAddress: this.address,
      authority: this.authority,
    });
  }

  /**
   * Creates a withdraw transaction.
   *
   * @param params - Parameters for the withdraw transaction
   * @returns Promise resolving to a TransactionBuilderResult
   *
   * @see {@link makeWithdrawTx} for detailed implementation
   */
  async makeWithdrawTx(
    params: Omit<MakeWithdrawTxParams, "marginfiAccount">
  ): Promise<TransactionBuilderResult> {
    return makeWithdrawTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a Drift withdraw transaction.
   *
   * @param params - Parameters for the Drift withdraw transaction
   * @returns Promise resolving to an ExtendedV0Transaction
   *
   * @see {@link makeDriftWithdrawTx} for detailed implementation
   */
  async makeDriftWithdrawTx(
    params: Omit<MakeDriftWithdrawTxParams, "marginfiAccount">
  ): Promise<TransactionBuilderResult> {
    return makeDriftWithdrawTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a Kamino withdraw transaction.
   *
   * @param params - Parameters for the Kamino withdraw transaction
   * @returns Promise resolving to a TransactionBuilderResult
   *
   * @see {@link makeKaminoWithdrawTx} for detailed implementation
   */
  async makeKaminoWithdrawTx(
    params: Omit<MakeKaminoWithdrawTxParams, "marginfiAccount">
  ): Promise<TransactionBuilderResult> {
    return makeKaminoWithdrawTx({
      ...params,
      marginfiAccount: this,
    });
  }

  /**
   * Creates a flash loan transaction.
   *
   * @param params - Parameters for the flash loan transaction
   * @returns Promise resolving to flash loan transaction details
   *
   * @see {@link makeFlashLoanTx} for detailed implementation
   */
  async makeFlashLoanTx(params: Omit<MakeFlashLoanTxParams, "marginfiAccount">) {
    return makeFlashLoanTx({
      ...params,
      marginfiAccount: this,
    });
  }
}

export { MarginfiAccount };
