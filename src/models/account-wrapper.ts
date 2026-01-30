import { PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { QuoteResponse } from "@jup-ag/api";

import { Amount, BankIntegrationMetadataMap, MintData } from "~/types";
import { TOKEN_PROGRAM_ID } from "~/vendor/spl";
import {
  InstructionsWrapper,
  ExtendedV0Transaction,
  ExtendedTransaction,
} from "~/services/transaction";
import {
  MakeBorrowIxOpts,
  MakeDepositIxOpts,
  MakeFlashLoanTxParams,
  MakeLoopTxParams,
  MakeRepayIxOpts,
  MakeRepayWithCollatTxParams,
  MakeSwapCollateralTxParams,
  MakeSwapDebtTxParams,
  MakeWithdrawIxOpts,
  MarginRequirementType,
  TransactionBuilderResult,
} from "~/services/account";
import { fetchProgramForMints } from "~/services/misc";
import {
  BankType,
  EmodeImpactStatus,
  EmodePair,
  ActionEmodeImpact,
  ActiveEmodePair,
  fetchBank,
} from "~/services/bank";

import { MarginfiAccount } from "./account";
import { Project0Client } from "./client";
import { Balance } from "./balance";
import { HealthCache } from "./health-cache";
import { Bank } from "./bank";
import { NATIVE_MINT } from "~/vendor/spl";
import { ReserveRaw } from "~/vendor/klend";
import { DriftRewards, DriftSpotMarket } from "~/vendor/drift";

/**
 * Wrapper around MarginfiAccount that auto-injects client data for cleaner API.
 *
 * Instead of:
 *   await account.makeDepositIx(program, banks, mintDatas, amount, bankAddress)
 *
 * Use:
 *   await wrappedAccount.makeDepositIx(amount, bankAddress)
 *
 * The wrapper handles all the boilerplate of looking up banks, mint data, etc.
 */
export class MarginfiAccountWrapper {
  constructor(
    private readonly account: MarginfiAccount,
    private readonly client: Project0Client
  ) {}

  // ----------------------------------------------------------------------------
  // Delegate state access to underlying account
  // ----------------------------------------------------------------------------

  get address(): PublicKey {
    return this.account.address;
  }

  get group(): PublicKey {
    return this.account.group;
  }

  get authority(): PublicKey {
    return this.account.authority;
  }

  get balances(): Balance[] {
    return this.account.balances;
  }

  get activeBalances(): Balance[] {
    return this.account.activeBalances;
  }

  get accountFlags(): number[] {
    return this.account.accountFlags;
  }

  get emissionsDestinationAccount(): PublicKey {
    return this.account.emissionsDestinationAccount;
  }

  get healthCache(): HealthCache {
    return this.account.healthCache;
  }

  get isDisabled(): boolean {
    return this.account.isDisabled;
  }

  get isFlashLoanEnabled(): boolean {
    return this.account.isFlashLoanEnabled;
  }

  get isTransferAccountAuthorityEnabled(): boolean {
    return this.account.isTransferAccountAuthorityEnabled;
  }

  getBalance(bankPk: PublicKey): Balance {
    return this.account.getBalance(bankPk);
  }

  async getBankFromAddress(bankAddress: PublicKey): Promise<BankType> {
    const bank = this.client.bankMap.get(bankAddress.toBase58());
    if (!bank) {
      const bankData = await fetchBank(this.client.program, bankAddress);
      const bank = Bank.fromAccountParsed(bankAddress, bankData.data);
      return bank;
    } else {
      return bank;
    }
  }

  async getMintDataFromBank(bank: BankType): Promise<MintData> {
    let mintData = this.client.mintDataByBank.get(bank.address.toBase58());

    if (!mintData) {
      // For native SOL (wrapped SOL), use TOKEN_PROGRAM_ID directly
      if (bank.mint.equals(NATIVE_MINT)) {
        mintData = {
          mint: bank.mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        };
      } else {
        // Try to fetch token program for other mints
        const connection = this.client.program.provider.connection;
        const fetchedMintData = await fetchProgramForMints(connection, [bank.mint]);
        const fetched = fetchedMintData[0];
        if (!fetched) {
          // Fallback to TOKEN_PROGRAM_ID for standard tokens
          console.warn(
            `Could not fetch token program for mint ${bank.mint.toBase58()}, using TOKEN_PROGRAM_ID`
          );
          mintData = {
            mint: bank.mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          };
        } else {
          mintData = {
            mint: fetched.mint,
            tokenProgram: fetched.program,
          };
        }
      }
    }
    return mintData;
  }

  // ----------------------------------------------------------------------------
  // Wrapped transaction methods - clean API without boilerplate
  // ----------------------------------------------------------------------------

  /**
   * Creates a deposit instruction with auto-injected client data.
   *
   * Automatically looks up bank and mint data from the client.
   *
   * @param bankAddress - Bank address to deposit to
   * @param amount - Amount to deposit in UI units
   * @param opts - Optional configuration for wrapping SOL and overrides
   */
  async makeDepositIx(
    bankAddress: PublicKey,
    amount: Amount,
    opts: MakeDepositIxOpts = {}
  ): Promise<InstructionsWrapper> {
    if (new BigNumber(amount).lte(0)) {
      throw Error(`Deposit amount must be positive, got ${amount}`);
    }
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeDepositIx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      opts,
    });
  }

  /**
   * Creates a repay instruction with auto-injected client data.
   *
   * Automatically looks up bank and mint data from the client.
   *
   * @param bankAddress - Bank address to repay to
   * @param amount - Amount to repay in UI units
   * @param repayAll - If true, repays the entire borrowed position
   * @param opts - Optional configuration for wrapping SOL and overrides
   */
  async makeRepayIx(
    bankAddress: PublicKey,
    amount: Amount,
    repayAll: boolean = false,
    opts: MakeRepayIxOpts = {}
  ): Promise<InstructionsWrapper> {
    if (!repayAll && new BigNumber(amount).lte(0)) {
      throw Error(`Repay amount must be positive, got ${amount}`);
    }
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeRepayIx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      repayAll,
      opts,
    });
  }

  /**
   * Creates a withdraw instruction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, and metadata from the client.
   *
   * @param bankAddress - Bank address to withdraw from
   * @param amount - Amount to withdraw in UI units
   * @param withdrawAll - If true, withdraws the entire collateral position
   * @param opts - Optional configuration for unwrapping SOL and overrides
   */
  async makeWithdrawIx(
    bankAddress: PublicKey,
    amount: Amount,
    withdrawAll: boolean = false,
    opts: MakeWithdrawIxOpts = {}
  ): Promise<InstructionsWrapper> {
    if (!withdrawAll && new BigNumber(amount).lte(0)) {
      throw Error(`Withdraw amount must be positive, got ${amount}`);
    }
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeWithdrawIx({
      program: this.client.program,
      bank,
      bankMap: this.client.bankMap,
      tokenProgram: mintData.tokenProgram,
      amount,
      withdrawAll,
      bankMetadataMap: this.client.bankIntegrationMap,
      opts,
    });
  }

  /**
   * Creates a borrow instruction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, and metadata from the client.
   *
   * @param bankAddress - Bank address to borrow from
   * @param amount - Amount to borrow in UI units
   * @param opts - Optional configuration for unwrapping SOL and overrides
   */
  async makeBorrowIx(
    bankAddress: PublicKey,
    amount: Amount,
    opts: MakeBorrowIxOpts = {}
  ): Promise<InstructionsWrapper> {
    if (new BigNumber(amount).lte(0)) {
      throw Error(`Borrow amount must be positive, got ${amount}`);
    }
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeBorrowIx({
      program: this.client.program,
      bank,
      bankMap: this.client.bankMap,
      tokenProgram: mintData.tokenProgram,
      amount,
      opts,
    });
  }

  /**
   * Creates a withdraw emissions instruction with auto-injected client data.
   *
   * @param bankAddress - Bank address to withdraw emissions from
   */
  async makeWithdrawEmissionsIx(bankAddress: PublicKey): Promise<InstructionsWrapper> {
    return this.account.makeWithdrawEmissionsIx(
      this.client.program,
      this.client.bankMap,
      this.client.mintDataByBank,
      bankAddress
    );
  }

  /**
   * Creates a begin flash loan instruction.
   *
   * @param endIndex - End index for the flash loan
   * @param authority - Optional authority override
   */
  async makeBeginFlashLoanIx(
    endIndex: number,
    authority?: PublicKey
  ): Promise<InstructionsWrapper> {
    return this.account.makeBeginFlashLoanIx(this.client.program, endIndex, authority);
  }

  /**
   * Creates an end flash loan instruction with auto-injected client data.
   *
   * @param projectedActiveBanks - Array of active bank public keys after flash loan
   * @param authority - Optional authority override
   */
  async makeEndFlashLoanIx(
    projectedActiveBanks: PublicKey[],
    authority?: PublicKey
  ): Promise<InstructionsWrapper> {
    return this.account.makeEndFlashLoanIx(
      this.client.program,
      this.client.bankMap,
      projectedActiveBanks,
      authority
    );
  }

  /**
   * Creates an account transfer instruction.
   *
   * @param newMarginfiAccount - New account public key
   * @param newAuthority - New authority public key
   */
  async makeAccountTransferToNewAccountIx(
    newMarginfiAccount: PublicKey,
    newAuthority: PublicKey
  ): Promise<InstructionsWrapper> {
    return this.account.makeAccountTransferToNewAccountIx(
      this.client.program,
      newMarginfiAccount,
      newAuthority
    );
  }

  /**
   * Creates a close account instruction.
   */
  async makeCloseAccountIx(): Promise<InstructionsWrapper> {
    return this.account.makeCloseAccountIx(this.client.program);
  }

  /**
   * Creates a pulse health instruction with auto-injected client data.
   *
   * @param mandatoryBanks - Array of mandatory bank public keys
   * @param excludedBanks - Array of excluded bank public keys
   */
  async makePulseHealthIx(mandatoryBanks: PublicKey[], excludedBanks: PublicKey[]) {
    return this.account.makePulseHealthIx(
      this.client.program,
      this.client.bankMap,
      mandatoryBanks,
      excludedBanks
    );
  }

  /**
   * Creates a loop transaction (leverage) with auto-injected client data.
   *
   * Auto-injects: program, marginfiAccount, bankMap, oraclePrices, bankMetadataMap, addressLookupTables
   *
   * @param params - Loop transaction parameters (user provides: connection, depositOpts, borrowOpts, swapOpts, etc.)
   */
  async makeLoopTx(
    params: Omit<
      MakeLoopTxParams,
      | "program"
      | "marginfiAccount"
      | "bankMap"
      | "oraclePrices"
      | "bankMetadataMap"
      | "addressLookupTableAccounts"
    >
  ): Promise<{
    transactions: ExtendedV0Transaction[];
    actionTxIndex: number;
    quoteResponse: QuoteResponse | undefined;
  }> {
    const fullParams: MakeLoopTxParams = {
      ...params,
      program: this.client.program,
      marginfiAccount: this.account,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      addressLookupTableAccounts: this.client.addressLookupTables,
    };
    return this.account.makeLoopTx(fullParams);
  }

  /**
   * Creates a repay with collateral transaction with auto-injected client data.
   *
   * Auto-injects: program, marginfiAccount, bankMap, oraclePrices, bankMetadataMap, addressLookupTables
   *
   * @param params - Repay with collateral parameters (user provides: connection, withdrawOpts, repayOpts, swapOpts, etc.)
   */
  async makeRepayWithCollatTx(
    params: Omit<
      MakeRepayWithCollatTxParams,
      | "program"
      | "marginfiAccount"
      | "bankMap"
      | "oraclePrices"
      | "bankMetadataMap"
      | "addressLookupTableAccounts"
    >
  ): Promise<{
    transactions: ExtendedV0Transaction[];
    swapQuote: QuoteResponse | undefined;
    amountToRepay: number;
  }> {
    const fullParams: MakeRepayWithCollatTxParams = {
      ...params,
      program: this.client.program,
      marginfiAccount: this.account,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      addressLookupTableAccounts: this.client.addressLookupTables,
    };
    return this.account.makeRepayWithCollatTx(fullParams);
  }

  /**
   * Creates a swap collateral transaction with auto-injected client data.
   *
   * Swaps one collateral type for another (e.g., JitoSOL -> mSOL) using a flash loan
   * so account health is not affected during the swap.
   *
   * Auto-injects: program, marginfiAccount, bankMap, oraclePrices, bankMetadataMap, addressLookupTables
   *
   * @param params - Swap collateral parameters (user provides: connection, withdrawOpts, depositOpts, swapOpts, etc.)
   */
  async makeSwapCollateralTx(
    params: Omit<
      MakeSwapCollateralTxParams,
      | "program"
      | "marginfiAccount"
      | "bankMap"
      | "oraclePrices"
      | "bankMetadataMap"
      | "addressLookupTableAccounts"
    >
  ): Promise<{
    transactions: ExtendedV0Transaction[];
    actionTxIndex: number;
    quoteResponse: QuoteResponse | undefined;
  }> {
    const fullParams: MakeSwapCollateralTxParams = {
      ...params,
      program: this.client.program,
      marginfiAccount: this.account,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      addressLookupTableAccounts: this.client.addressLookupTables,
    };
    return this.account.makeSwapCollateralTx(fullParams);
  }

  /**
   * Creates a swap debt transaction with auto-injected client data.
   *
   * Swaps one debt type for another (e.g., USDC debt -> SOL debt) using a flash loan
   * so account health is not affected during the swap.
   *
   * Auto-injects: program, marginfiAccount, bankMap, oraclePrices, bankMetadataMap, addressLookupTables
   *
   * @param params - Swap debt parameters (user provides: connection, repayOpts, borrowOpts, swapOpts, etc.)
   */
  async makeSwapDebtTx(
    params: Omit<
      MakeSwapDebtTxParams,
      | "program"
      | "marginfiAccount"
      | "bankMap"
      | "oraclePrices"
      | "bankMetadataMap"
      | "addressLookupTableAccounts"
    >
  ): Promise<{
    transactions: ExtendedV0Transaction[];
    actionTxIndex: number;
    quoteResponse: QuoteResponse | undefined;
  }> {
    const fullParams: MakeSwapDebtTxParams = {
      ...params,
      program: this.client.program,
      marginfiAccount: this.account,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      addressLookupTableAccounts: this.client.addressLookupTables,
    };
    return this.account.makeSwapDebtTx(fullParams);
  }

  /**
   * Creates a deposit transaction with auto-injected client data.
   *
   * Automatically looks up bank and mint data, then builds and wraps instruction in a transaction.
   *
   * @param bankAddress - Bank address to deposit to
   * @param amount - Amount to deposit in UI units
   * @param opts - Optional configuration for wrapping SOL and overrides
   * @returns Promise resolving to an ExtendedTransaction
   */
  async makeDepositTx(
    bankAddress: PublicKey,
    amount: Amount,
    opts: MakeDepositIxOpts = {}
  ): Promise<ExtendedTransaction> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeDepositTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      luts: this.client.addressLookupTables,
      opts,
    });
  }

  /**
   * Creates a Kamino deposit transaction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, and connection.
   *
   * @param bankAddress - Bank address to deposit to
   * @param amount - Amount to deposit in UI units
   * @param spotMarket - Drift spot market data
   * @param opts - Optional configuration
   * @returns Promise resolving to an ExtendedV0Transaction
   */
  async makeDriftDepositTx(
    bankAddress: PublicKey,
    amount: Amount,
    spotMarket: DriftSpotMarket,
    opts: MakeDepositIxOpts = {}
  ): Promise<ExtendedV0Transaction> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeDriftDepositTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      driftMarketIndex: spotMarket.marketIndex,
      driftOracle: spotMarket.oracle,
      luts: this.client.addressLookupTables,
      connection: this.client.program.provider.connection,
      opts,
    });
  }

  /**
   * Creates a Kamino deposit transaction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, and connection.
   *
   * @param bankAddress - Bank address to deposit to
   * @param amount - Amount to deposit in UI units
   * @param reserve - Kamino reserve data
   * @param opts - Optional configuration
   * @returns Promise resolving to an ExtendedV0Transaction
   */
  async makeKaminoDepositTx(
    bankAddress: PublicKey,
    amount: Amount,
    reserve: ReserveRaw,
    opts: MakeDepositIxOpts = {}
  ): Promise<ExtendedV0Transaction> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeKaminoDepositTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      reserve,
      luts: this.client.addressLookupTables,
      connection: this.client.program.provider.connection,
      opts,
    });
  }

  /**
   * Creates a borrow transaction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, metadata, and oracle prices.
   *
   * @param bankAddress - Bank address to borrow from
   * @param amount - Amount to borrow in UI units
   * @param opts - Optional configuration
   * @returns Promise resolving to a TransactionBuilderResult
   */
  async makeBorrowTx(
    bankAddress: PublicKey,
    amount: Amount,
    opts: MakeBorrowIxOpts = {}
  ): Promise<TransactionBuilderResult> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeBorrowTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      authority: this.account.authority,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      luts: this.client.addressLookupTables,
      connection: this.client.program.provider.connection,
      opts,
    });
  }

  /**
   * Creates a repay transaction with auto-injected client data.
   *
   * Automatically looks up bank and mint data.
   *
   * @param bankAddress - Bank address to repay to
   * @param amount - Amount to repay in UI units
   * @param repayAll - If true, repays the entire borrowed position
   * @param opts - Optional configuration
   * @returns Promise resolving to an ExtendedTransaction
   */
  async makeRepayTx(
    bankAddress: PublicKey,
    amount: Amount,
    repayAll: boolean = false,
    opts: MakeRepayIxOpts = {}
  ): Promise<ExtendedTransaction> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeRepayTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      repayAll,
      luts: this.client.addressLookupTables,
      opts,
    });
  }

  /**
   * Creates a withdraw transaction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, metadata, and oracle prices.
   *
   * @param bankAddress - Bank address to withdraw from
   * @param amount - Amount to withdraw in UI units
   * @param withdrawAll - If true, withdraws the entire collateral position
   * @param opts - Optional configuration
   * @returns Promise resolving to a TransactionBuilderResult
   */
  async makeWithdrawTx(
    bankAddress: PublicKey,
    amount: Amount,
    withdrawAll: boolean = false,
    opts: MakeWithdrawIxOpts = {}
  ): Promise<TransactionBuilderResult> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeWithdrawTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      authority: this.account.authority,
      withdrawAll,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      luts: this.client.addressLookupTables,
      connection: this.client.program.provider.connection,
      opts,
    });
  }

  /**
   * Creates a Drift withdraw transaction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, metadata, and oracle prices.
   *
   * @param bankAddress - Bank address to withdraw from
   * @param amount - Amount to withdraw in UI units
   * @param driftSpotMarket - Drift spot market data
   * @param withdrawAll - If true, withdraws the entire collateral position
   * @param opts - Optional configuration
   * @returns Promise resolving to a TransactionBuilderResult
   */
  async makeDriftWithdrawTx(
    bankAddress: PublicKey,
    amount: Amount,
    driftSpotMarket: DriftSpotMarket,
    userRewards: DriftRewards[],
    withdrawAll: boolean = false,
    opts: MakeWithdrawIxOpts = {}
  ): Promise<TransactionBuilderResult> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeDriftWithdrawTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      authority: this.account.authority,
      driftSpotMarket,
      userRewards,
      withdrawAll,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      luts: this.client.addressLookupTables,
      connection: this.client.program.provider.connection,
      opts,
    });
  }

  /**
   * Creates a Kamino withdraw transaction with auto-injected client data.
   *
   * Automatically looks up bank, mint data, metadata, and oracle prices.
   *
   * @param bankAddress - Bank address to withdraw from
   * @param amount - Amount to withdraw in UI units
   * @param reserve - Kamino reserve data
   * @param withdrawAll - If true, withdraws the entire collateral position
   * @param opts - Optional configuration
   * @returns Promise resolving to a TransactionBuilderResult
   */
  async makeKaminoWithdrawTx(
    bankAddress: PublicKey,
    amount: Amount,
    reserve: any,
    withdrawAll: boolean = false,
    opts: MakeWithdrawIxOpts = {}
  ): Promise<TransactionBuilderResult> {
    // Try to get bank from client, fallback to fetching it
    const bank = await this.getBankFromAddress(bankAddress);

    // Try to get mint data from cache, fallback to fetching it
    const mintData = await this.getMintDataFromBank(bank);

    return this.account.makeKaminoWithdrawTx({
      program: this.client.program,
      bank,
      tokenProgram: mintData.tokenProgram,
      amount,
      authority: this.account.authority,
      reserve,
      withdrawAll,
      bankMap: this.client.bankMap,
      oraclePrices: this.client.oraclePriceByBank,
      bankMetadataMap: this.client.bankIntegrationMap,
      luts: this.client.addressLookupTables,
      connection: this.client.program.provider.connection,
      opts,
    });
  }

  /**
   * Creates a flash loan transaction with auto-injected client data.
   *
   * Auto-injects: program, marginfiAccount
   *
   * @param params - Flash loan transaction parameters (user provides: ixs, endIndex, etc.)
   * @returns Promise resolving to flash loan transaction details
   */
  async makeFlashLoanTx(params: Omit<MakeFlashLoanTxParams, "program" | "marginfiAccount">) {
    return this.account.makeFlashLoanTx({
      ...params,
      program: this.client.program,
    });
  }

  // ----------------------------------------------------------------------------
  // Computation methods with auto-injected client data
  // ----------------------------------------------------------------------------

  /**
   * Simulates health cache update with auto-injected client data.
   *
   * @param bankMetadataMap - Bank metadata map (required for simulation)
   */
  async simulateHealthCache(bankMetadataMap: BankIntegrationMetadataMap) {
    return this.account.simulateHealthCache(
      this.client.program,
      this.client.bankMap,
      this.client.oraclePriceByBank,
      bankMetadataMap
    );
  }

  /**
   * Computes net APY with auto-injected client data.
   */
  computeNetApy(): number {
    return this.account.computeNetApy(this.client.bankMap, this.client.oraclePriceByBank);
  }

  /**
   * Computes account value (equity) with auto-injected client data.
   */
  computeAccountValue(): BigNumber {
    return this.account.computeAccountValue();
  }

  /**
   * Computes health components with auto-injected client data.
   *
   * @param marginRequirement - Margin requirement type
   */
  computeHealthComponents(marginRequirement: MarginRequirementType): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return this.account.computeHealthComponents(marginRequirement);
  }

  /**
   * Computes free collateral with auto-injected client data.
   *
   * @param opts - Optional configuration
   */
  computeFreeCollateral(opts?: { clamped?: boolean }): BigNumber {
    return this.account.computeFreeCollateral(opts);
  }

  /**
   * Computes max borrow for a bank with auto-injected client data.
   *
   * @param bankAddress - Bank address to check max borrow for
   * @param opts - Optional configuration for emode and volatility
   */
  computeMaxBorrowForBank(
    bankAddress: PublicKey,
    opts?: {
      emodeImpactStatus?: EmodeImpactStatus;
      volatilityFactor?: number;
      activePair?: ActiveEmodePair;
    }
  ): BigNumber {
    return this.account.computeMaxBorrowForBank(
      this.client.bankMap,
      this.client.oraclePriceByBank,
      bankAddress,
      opts
    );
  }

  /**
   * Computes max withdraw for a bank with auto-injected client data.
   *
   * @param bankAddress - Bank address to check max withdraw for
   * @param opts - Optional configuration for volatility and emode
   */
  computeMaxWithdrawForBank(
    bankAddress: PublicKey,
    opts?: {
      volatilityFactor?: number;
      activePair?: ActiveEmodePair;
    }
  ): BigNumber {
    return this.account.computeMaxWithdrawForBank(
      this.client.bankMap,
      this.client.oraclePriceByBank,
      bankAddress,
      opts
    );
  }

  /**
   * Computes active emode pairs.
   *
   * @param emodePairs - All available emode pairs
   */
  computeActiveEmodePairs(emodePairs: EmodePair[]): EmodePair[] {
    return this.account.computeActiveEmodePairs(emodePairs);
  }

  /**
   * Computes emode impacts.
   *
   * @param emodePairs - All available emode pairs
   * @param banks - Array of bank addresses to analyze
   */
  computeEmodeImpacts(
    emodePairs: EmodePair[],
    banks: PublicKey[]
  ): Record<string, ActionEmodeImpact> {
    return this.account.computeEmodeImpacts(emodePairs, banks);
  }

  /**
   * Gets health check accounts with auto-injected client data.
   *
   * @param mandatoryBanks - Array of mandatory bank public keys (default: [])
   * @param excludedBanks - Array of excluded bank public keys (default: [])
   */
  getHealthCheckAccounts(
    mandatoryBanks: PublicKey[] = [],
    excludedBanks: PublicKey[] = []
  ): BankType[] {
    return this.account.getHealthCheckAccounts(this.client.bankMap, mandatoryBanks, excludedBanks);
  }

  // ----------------------------------------------------------------------------
  // Helper methods
  // ----------------------------------------------------------------------------

  /**
   * Gets the underlying MarginfiAccount instance.
   * Useful for advanced operations that need direct access.
   */
  getUnderlyingAccount(): MarginfiAccount {
    return this.account;
  }

  /**
   * Gets the client instance.
   */
  getClient(): Project0Client {
    return this.client;
  }
}
