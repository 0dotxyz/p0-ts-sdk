import { createNoopSigner, type Address, type TransactionSigner } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import { MarginfiAccount } from "./account";
import { Balance } from "./balance";
import { Bank } from "./bank";
import { Project0Client } from "./client";
import { HealthCache } from "./health-cache";

import { WSOL_MINT } from "~/constants";
import {
  computeLowestEmodeWeights,
  computePremiumBreakdown,
  computePremiumImpact,
  computePremiumRatesByBank,
  createActiveEmodePairFromPairs,
  fetchGlobalFeeWallet,
  MakeBorrowIxOpts,
  MakeBridgedLoopTxParams,
  MakeBridgedSwapCollateralTxParams,
  MakeBridgedSwapDebtTxParams,
  MakeDepositIxOpts,
  MakeFlashLoanTxParams,
  MakeLoopTxParams,
  MakeRepayIxOpts,
  MakeRepayWithCollatTxParams,
  MakeRollPtTxParams,
  MakeSwapCollateralTxParams,
  MakeSwapDebtTxParams,
  MakeTransferAccountTxParams,
  MakeTransferPositionsTxParams,
  MakeWithdrawIxOpts,
  MarginRequirementType,
  OrderTriggerParams,
  PremiumAction,
  PremiumCollateralBreakdown,
  PremiumImpact,
} from "~/services/account";
import { ActionEmodeImpact, BankType, EmodePair, requireBank } from "~/services/bank";
import { isGroupRateLimiterEnabled } from "~/services/group";
import { fetchProgramForMints } from "~/services/misc";
import { TransactionFormat } from "~/services/transaction";
import { Amount, MintData } from "~/types";

/** Params every wrapped flow gets from the client and the wrapper's signer. */
type ClientFilled =
  | "programAddress"
  | "marginfiAccount"
  | "authority"
  | "rpc"
  | "bankMap"
  | "bankMetadataMap"
  | "assetShareValueMultiplierByBank"
  | "txFormat";

/**
 * A {@link MarginfiAccount} bound to a {@link Project0Client}: its builders and computations
 * take only what the action needs (bank, amount, options) and fill the rest from the client.
 * Transactions are signed by `signer`, a noop signer for the account's authority unless given one
 * (then sign with the wallet; pass a `KeyPairSigner` to sign with
 * `signTransactionMessageWithSigners`).
 */
export class MarginfiAccountWrapper {
  signer: TransactionSigner;

  constructor(
    private readonly account: MarginfiAccount,
    private readonly client: Project0Client,
    signer?: TransactionSigner
  ) {
    this.signer = signer ?? createNoopSigner(account.authority);
  }

  // ----------------------------------------------------------------------------
  // Account state
  // ----------------------------------------------------------------------------

  get address(): Address {
    return this.account.address;
  }

  get group(): Address {
    return this.account.group;
  }

  get authority(): Address {
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

  /** The balance in `bankPk` (an empty one when the account holds none). */
  getBalance(bankPk: Address): Balance {
    return this.account.getBalance(bankPk);
  }

  /**
   * The client's bank at `bankAddress`, fetched when the client doesn't hold it.
   * @throws if it isn't in the client and doesn't exist on-chain
   */
  async getBankFromAddress(bankAddress: Address): Promise<BankType> {
    return this.client.bankMap.get(bankAddress) ?? Bank.fetch(bankAddress, this.client.rpc);
  }

  /** The client's mint data for `bank`, falling back to reading the mint's token program. */
  async getMintDataFromBank(bank: BankType): Promise<MintData> {
    const mintData = this.client.mintDataByBank.get(bank.address);
    if (mintData) return mintData;
    if (bank.mint === WSOL_MINT) return { mint: bank.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS };

    const [fetched] = await fetchProgramForMints(this.client.rpc, [bank.mint]);
    if (!fetched) {
      console.warn(`Could not fetch token program for mint ${bank.mint}, using the Token program`);
      return { mint: bank.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS };
    }
    return { mint: fetched.mint, tokenProgram: fetched.program };
  }

  private get context() {
    const txFormat: TransactionFormat = { version: 0, luts: this.client.addressLookupTables };
    return {
      programAddress: this.client.programAddress,
      authority: this.signer,
      rpc: this.client.rpc,
      bankMap: this.client.bankMap,
      bankMetadataMap: this.client.bankIntegrationMap,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      txFormat,
    };
  }

  private async lendingContext(bankAddress: Address) {
    const bank = await this.getBankFromAddress(bankAddress);
    const { tokenProgram } = await this.getMintDataFromBank(bank);
    return { ...this.context, bank, tokenProgram };
  }

  // ----------------------------------------------------------------------------
  // Lending actions
  // ----------------------------------------------------------------------------

  /**
   * Deposit instructions for `amount` (UI units) into `bankAddress`.
   * @throws Error if `amount` isn't positive
   */
  async makeDepositIx(bankAddress: Address, amount: Amount, opts: MakeDepositIxOpts = {}) {
    if (new BigNumber(amount).lte(0)) throw Error(`Deposit amount must be positive, got ${amount}`);
    return this.account.makeDepositIx({
      ...(await this.lendingContext(bankAddress)),
      amount,
      opts,
    });
  }

  /**
   * Repay instructions for `amount` (UI units) of `bankAddress`; `repayAll` closes the balance.
   * @throws Error if `amount` isn't positive without `repayAll`
   */
  async makeRepayIx(
    bankAddress: Address,
    amount: Amount,
    repayAll: boolean = false,
    opts: MakeRepayIxOpts = {}
  ) {
    if (!repayAll && new BigNumber(amount).lte(0)) {
      throw Error(`Repay amount must be positive, got ${amount}`);
    }
    return this.account.makeRepayIx({
      ...(await this.lendingContext(bankAddress)),
      amount,
      repayAll,
      opts,
    });
  }

  /**
   * Withdraw instructions for `amount` (UI units) from `bankAddress`; `withdrawAll` closes the
   * balance.
   * @throws Error if `amount` isn't positive without `withdrawAll`
   */
  async makeWithdrawIx(
    bankAddress: Address,
    amount: Amount,
    withdrawAll: boolean = false,
    opts: MakeWithdrawIxOpts = {}
  ) {
    if (!withdrawAll && new BigNumber(amount).lte(0)) {
      throw Error(`Withdraw amount must be positive, got ${amount}`);
    }
    return this.account.makeWithdrawIx({
      ...(await this.lendingContext(bankAddress)),
      amount,
      withdrawAll,
      opts,
    });
  }

  /**
   * Borrow instructions for `amount` (UI units) from `bankAddress`.
   * @throws Error if `amount` isn't positive
   */
  async makeBorrowIx(bankAddress: Address, amount: Amount, opts: MakeBorrowIxOpts = {}) {
    if (new BigNumber(amount).lte(0)) throw Error(`Borrow amount must be positive, got ${amount}`);
    return this.account.makeBorrowIx({ ...(await this.lendingContext(bankAddress)), amount, opts });
  }

  /** Deposit transaction for `amount` (UI units) into `bankAddress`. */
  async makeDepositTx(bankAddress: Address, amount: Amount, opts: MakeDepositIxOpts = {}) {
    return this.account.makeDepositTx({
      ...(await this.lendingContext(bankAddress)),
      amount,
      opts,
    });
  }

  /** Repay transaction for `amount` (UI units) of `bankAddress`; `repayAll` closes the balance. */
  async makeRepayTx(
    bankAddress: Address,
    amount: Amount,
    repayAll: boolean = false,
    opts: MakeRepayIxOpts = {}
  ) {
    return this.account.makeRepayTx({
      ...(await this.lendingContext(bankAddress)),
      amount,
      repayAll,
      opts,
    });
  }

  /**
   * Withdraw transaction for `amount` (UI units) from `bankAddress`; `withdrawAll` closes the
   * balance.
   */
  async makeWithdrawTx(
    bankAddress: Address,
    amount: Amount,
    withdrawAll: boolean = false,
    opts: MakeWithdrawIxOpts = {}
  ) {
    return this.account.makeWithdrawTx({
      ...(await this.lendingContext(bankAddress)),
      amount,
      withdrawAll,
      opts,
    });
  }

  /** Borrow transaction for `amount` (UI units) from `bankAddress`. */
  async makeBorrowTx(bankAddress: Address, amount: Amount, opts: MakeBorrowIxOpts = {}) {
    return this.account.makeBorrowTx({ ...(await this.lendingContext(bankAddress)), amount, opts });
  }

  // ----------------------------------------------------------------------------
  // Account and flash-loan actions
  // ----------------------------------------------------------------------------

  /** Starts a flash loan that ends at transaction instruction `endIndex`. */
  async makeBeginFlashLoanIx(endIndex: number) {
    return this.account.makeBeginFlashLoanIx(this.client.programAddress, endIndex, this.signer);
  }

  /**
   * Ends a flash loan, health-checking the account with `projectedActiveBanks` active.
   * @throws TransactionBuildingError (BANK_NOT_FOUND) if the client misses one of
   * `projectedActiveBanks`
   */
  async makeEndFlashLoanIx(projectedActiveBanks: Address[]) {
    return this.account.makeEndFlashLoanIx(
      this.client.programAddress,
      this.client.bankMap,
      projectedActiveBanks,
      this.signer
    );
  }

  /** Wraps `params.ixs` in a flash loan on this account. */
  async makeFlashLoanTx(params: Omit<MakeFlashLoanTxParams, ClientFilled>) {
    return this.account.makeFlashLoanTx({ ...this.context, ...params });
  }

  /**
   * Moves this account's positions to a new account owned by `newAuthority` and disables this one;
   * `feePayer` defaults to the signer.
   */
  async makeTransferAccountTx(params: Omit<MakeTransferAccountTxParams, ClientFilled>) {
    return this.account.makeTransferAccountTx({ ...this.context, ...params });
  }

  /** Closes this (empty) account; the signer receives the rent. */
  async makeCloseAccountIx() {
    return this.account.makeCloseAccountIx(this.client.programAddress, this.signer);
  }

  /** Refreshes this account's on-chain health cache. */
  async makePulseHealthIx() {
    return this.account.makePulseHealthIx(this.client.programAddress, this.client.bankMap);
  }

  // ----------------------------------------------------------------------------
  // Flows
  // ----------------------------------------------------------------------------

  /** Leverage loop: flash-borrow, swap into the deposit asset and deposit. */
  async makeLoopTx(params: Omit<MakeLoopTxParams, ClientFilled>) {
    return this.account.makeLoopTx({ ...this.context, ...params });
  }

  /** {@link makeLoopTx} with a bridged (double-hop) fallback when the direct swap doesn't fit. */
  async makeBridgedLoopTx(params: Omit<MakeBridgedLoopTxParams, ClientFilled | "oraclePrices">) {
    return this.account.makeBridgedLoopTx({
      ...this.context,
      oraclePrices: this.client.oraclePriceByBank,
      ...params,
    });
  }

  /** Repays debt with withdrawn collateral, swapped into the debt asset in a flash loan. */
  async makeRepayWithCollatTx(params: Omit<MakeRepayWithCollatTxParams, ClientFilled>) {
    return this.account.makeRepayWithCollatTx({ ...this.context, ...params });
  }

  /** Swaps one collateral position into another in a flash loan. */
  async makeSwapCollateralTx(params: Omit<MakeSwapCollateralTxParams, ClientFilled>) {
    return this.account.makeSwapCollateralTx({ ...this.context, ...params });
  }

  /** {@link makeSwapCollateralTx} with a bridged (double-hop) fallback. */
  async makeBridgedSwapCollateralTx(params: Omit<MakeBridgedSwapCollateralTxParams, ClientFilled>) {
    return this.account.makeBridgedSwapCollateralTx({ ...this.context, ...params });
  }

  /** Swaps one debt position into another in a flash loan. */
  async makeSwapDebtTx(params: Omit<MakeSwapDebtTxParams, ClientFilled>) {
    return this.account.makeSwapDebtTx({ ...this.context, ...params });
  }

  /** {@link makeSwapDebtTx} with a bridged (double-hop) fallback. */
  async makeBridgedSwapDebtTx(
    params: Omit<MakeBridgedSwapDebtTxParams, ClientFilled | "oraclePrices">
  ) {
    return this.account.makeBridgedSwapDebtTx({
      ...this.context,
      oraclePrices: this.client.oraclePriceByBank,
      ...params,
    });
  }

  /** Rolls a matured Exponent PT position into its next-maturity PT in a flash loan. */
  async makeRollPtTx(params: Omit<MakeRollPtTxParams, ClientFilled>) {
    return this.account.makeRollPtTx({ ...this.context, ...params });
  }

  /**
   * Moves the positions in `params.bankAddresses` to another account of the same authority in a
   * flash loan.
   * @throws Error if the client misses one of `params.bankAddresses`
   */
  async makeTransferPositionsTx(
    params: Omit<
      MakeTransferPositionsTxParams,
      ClientFilled | "tokenProgramsByBank" | "groupRateLimiterEnabled"
    >
  ) {
    const tokenProgramsByBank = new Map<string, Address>();
    for (const bankAddress of params.bankAddresses) {
      const bank = this.client.bankMap.get(bankAddress);
      if (!bank) throw new Error(`Bank ${bankAddress} not found`);
      tokenProgramsByBank.set(bankAddress, (await this.getMintDataFromBank(bank)).tokenProgram);
    }

    return this.account.makeTransferPositionsTx({
      ...this.context,
      tokenProgramsByBank,
      groupRateLimiterEnabled: isGroupRateLimiterEnabled(this.client.group.rateLimiter),
      ...params,
    });
  }

  // ----------------------------------------------------------------------------
  // Orders (take-profit / stop-loss)
  // ----------------------------------------------------------------------------

  /**
   * Place-order instruction for a take-profit / stop-loss on the `collateralBank` (asset side) /
   * `debtBank` (liability side) pair, for composing into a larger transaction.
   * @throws TransactionBuildingError (FEE_STATE_NOT_FOUND) if the program's fee state account
   * doesn't exist
   */
  async makePlaceOrderIx(collateralBank: Address, debtBank: Address, trigger: OrderTriggerParams) {
    const { programAddress, authority, rpc } = this.context;
    return this.account.makePlaceOrderIx({
      programAddress,
      authority,
      collateralBank,
      debtBank,
      trigger,
      globalFeeWallet: await fetchGlobalFeeWallet(rpc, programAddress),
    });
  }

  /** Close-order instruction for `order` (from `fetchOrdersForAccount` or `deriveOrderPda`). */
  async makeCloseOrderIx(order: Address) {
    const { programAddress, authority } = this.context;
    return this.account.makeCloseOrderIx({ programAddress, authority, order });
  }

  /** Transaction placing a take-profit / stop-loss order on the `collateralBank`/`debtBank` pair. */
  async makePlaceOrderTx(collateralBank: Address, debtBank: Address, trigger: OrderTriggerParams) {
    return this.account.makePlaceOrderTx({ ...this.context, collateralBank, debtBank, trigger });
  }

  /** Transaction replacing the pair's existing order with new thresholds. */
  async makeUpdateOrderTx(collateralBank: Address, debtBank: Address, trigger: OrderTriggerParams) {
    return this.account.makeUpdateOrderTx({ ...this.context, collateralBank, debtBank, trigger });
  }

  /** Transaction closing `order` (from `fetchOrdersForAccount` or `deriveOrderPda`). */
  async makeCloseOrderTx(order: Address) {
    return this.account.makeCloseOrderTx({ ...this.context, order });
  }

  // ----------------------------------------------------------------------------
  // Emode
  // ----------------------------------------------------------------------------

  /** Emode pairs active for this account, from the client's pairs. */
  getActiveEmodePairs(): EmodePair[] {
    return this.account.computeActiveEmodePairs(this.client.emodePairs);
  }

  /** The lowest emode weights of the active pairs, by collateral bank address. */
  getActiveEmodeWeightsByBank(): Map<
    string,
    { assetWeightInit: BigNumber; assetWeightMaint: BigNumber }
  > {
    return computeLowestEmodeWeights(this.getActiveEmodePairs());
  }

  /** How acting on each of the client's banks would change emode. */
  getEmodeImpacts(): Record<string, ActionEmodeImpact> {
    return this.account.computeEmodeImpacts(
      this.client.emodePairs,
      this.client.banks.map((b) => b.address)
    );
  }

  /** {@link MarginfiAccount.computeActiveEmodePairs} for a custom pair set. */
  computeActiveEmodePairs(emodePairs: EmodePair[]): EmodePair[] {
    return this.account.computeActiveEmodePairs(emodePairs);
  }

  /** {@link MarginfiAccount.computeEmodeImpacts} for a custom pair set. */
  computeEmodeImpacts(
    emodePairs: EmodePair[],
    banks: Address[]
  ): Record<string, ActionEmodeImpact> {
    return this.account.computeEmodeImpacts(emodePairs, banks);
  }

  // ----------------------------------------------------------------------------
  // Variable borrow premium — derived from client.group.premiumEntries + account balances
  // ----------------------------------------------------------------------------

  /**
   * Premium rate (APR fraction) each premium-active bank would charge this account for a borrow,
   * given its current collateral, by bank address. See {@link computePremiumRatesByBank}.
   */
  getPremiumRatesByBank(): Map<string, BigNumber> {
    return computePremiumRatesByBank(this.premiumRateParams());
  }

  /**
   * Per-collateral breakdown of the premium rate `liabilityBank` would charge this account.
   * See {@link computePremiumBreakdown}.
   */
  getPremiumBreakdown(liabilityBank: Address): PremiumCollateralBreakdown[] {
    return computePremiumBreakdown(this.premiumRateParams(), liabilityBank);
  }

  /**
   * How `actions` would change this account's premium rates and yearly premium.
   * See {@link computePremiumImpact}.
   */
  computePremiumImpact(actions: PremiumAction[]): PremiumImpact {
    return computePremiumImpact({ ...this.premiumRateParams(), actions });
  }

  private premiumRateParams() {
    return {
      activeBalances: this.account.activeBalances,
      banksMap: this.client.bankMap,
      oraclePricesByBank: this.client.oraclePriceByBank,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      premiumEntries: this.client.group.premiumEntries,
    };
  }

  // ----------------------------------------------------------------------------
  // Computations
  // ----------------------------------------------------------------------------

  /** {@link MarginfiAccount.simulateHealthCache} with the client's state. */
  async simulateHealthCache() {
    return this.account.simulateHealthCache({
      rpc: this.client.rpc,
      rpcEndpoint: this.client.rpcEndpoint,
      programAddress: this.client.programAddress,
      banksMap: this.client.bankMap,
      oraclePricesByBank: this.client.oraclePriceByBank,
      bankIntegrationMap: this.client.bankIntegrationMap,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank: this.getActiveEmodeWeightsByBank(),
    });
  }

  /** Net APY of all positions (0.05 = 5%). */
  computeNetApy(): number {
    return this.account.computeNetApy({
      banksMap: this.client.bankMap,
      oraclePricesByBank: this.client.oraclePriceByBank,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      activeEmodeWeightsByBank: this.getActiveEmodeWeightsByBank(),
    });
  }

  /** Assets minus liabilities (USD), from the health cache. */
  computeAccountValue(): BigNumber {
    return this.account.computeAccountValue();
  }

  /** Weighted assets and liabilities (USD) for `marginRequirement`, from the health cache. */
  computeHealthComponentsFromCache(marginRequirement: MarginRequirementType): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return this.account.computeHealthComponentsFromCache(marginRequirement);
  }

  /** Collateral (USD) not backing liabilities, from the health cache. */
  computeFreeCollateralFromCache(opts?: { clamped?: boolean }): BigNumber {
    return this.account.computeFreeCollateralFromCache(opts);
  }

  /**
   * Oracle price at which the position in `bankAddress` gets liquidated, or `null` if none.
   * @throws if the client has no bank or oracle price for `bankAddress`
   */
  computeLiquidationPriceForBank(bankAddress: Address): number | null {
    const oraclePrice = this.client.oraclePriceByBank.get(bankAddress);
    if (!oraclePrice) throw new Error(`oracle price for bank ${bankAddress} not found`);

    return this.account.computeLiquidationPriceForBank({
      bank: requireBank(this.client.bankMap, bankAddress),
      oraclePrice,
      assetShareValueMultiplier: this.client.assetShareValueMultiplierByBank.get(bankAddress),
      activeEmodeWeights: this.getActiveEmodeWeightsByBank().get(bankAddress),
    });
  }

  /**
   * Maximum borrow (UI units) from `bankAddress`, with the bank's emode impact applied;
   * `ignoreBankLimits` skips the borrow cap, liquidity and rate-limiter clamps.
   */
  computeMaxBorrowForBank(
    bankAddress: Address,
    opts?: { volatilityFactor?: number; ignoreBankLimits?: boolean }
  ): BigNumber {
    const borrowImpact = this.getEmodeImpacts()[bankAddress]?.borrowImpact;

    return this.account.computeMaxBorrowForBank({
      banksMap: this.client.bankMap,
      oraclePricesByBank: this.client.oraclePriceByBank,
      bankAddress,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      emodeImpactStatus: borrowImpact?.status,
      activePair: borrowImpact?.activePair,
      volatilityFactor: opts?.volatilityFactor,
      groupRateLimiter: this.client.group.rateLimiter,
      ignoreBankLimits: opts?.ignoreBankLimits,
    });
  }

  /**
   * Maximum withdrawal (UI units) from `bankAddress` that keeps the account healthy;
   * `ignoreBankLimits` skips the liquidity and rate-limiter clamps.
   */
  computeMaxWithdrawForBank(
    bankAddress: Address,
    opts?: { volatilityFactor?: number; ignoreBankLimits?: boolean }
  ): BigNumber {
    const activePairs = this.getActiveEmodePairs();

    return this.account.computeMaxWithdrawForBank({
      banksMap: this.client.bankMap,
      oraclePricesByBank: this.client.oraclePriceByBank,
      bankAddress,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      activePair: activePairs.length > 0 ? createActiveEmodePairFromPairs(activePairs) : undefined,
      volatilityFactor: opts?.volatilityFactor,
      groupRateLimiter: this.client.group.rateLimiter,
      venueStates: this.client.bankIntegrationMap[bankAddress],
      ignoreBankLimits: opts?.ignoreBankLimits,
    });
  }

  /** Maximum deposit (UI units) into `bankAddress`: its remaining cap, capped by `walletBalance`. */
  computeMaxDepositForBank(
    bankAddress: Address,
    opts?: { walletBalance?: BigNumber | number }
  ): BigNumber {
    return this.account.computeMaxDepositForBank({
      banksMap: this.client.bankMap,
      bankAddress,
      assetShareValueMultiplierByBank: this.client.assetShareValueMultiplierByBank,
      walletBalance: opts?.walletBalance,
    });
  }

  // ----------------------------------------------------------------------------
  // Access
  // ----------------------------------------------------------------------------

  getUnderlyingAccount(): MarginfiAccount {
    return this.account;
  }

  getClient(): Project0Client {
    return this.client;
  }
}
