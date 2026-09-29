import {
  assertAccountExists,
  fetchEncodedAccount,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type ReadonlyUint8Array,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";
import { BigNumber } from "bignumber.js";

import { Balance } from "./balance";
import { HealthCache } from "./health-cache";

import {
  AccountFlags,
  computeAccountValue,
  computeActiveEmodePairs,
  computeEmodeImpacts,
  computeFreeCollateralFromBalances,
  ComputeFreeCollateralFromBalancesParams,
  computeFreeCollateralFromCache,
  computeHealthComponentsFromBalances,
  ComputeHealthComponentsFromBalancesParams,
  computeHealthComponentsFromCache,
  computeLiquidationPriceForBank,
  ComputeLiquidationPriceForBankParams,
  computeMaxBorrowForBank,
  ComputeMaxBorrowForBankParams,
  computeMaxDepositForBank,
  ComputeMaxDepositForBankParams,
  computeMaxWithdrawForBank,
  ComputeMaxWithdrawForBankParams,
  computeNetApy,
  ComputeNetApyParams,
  computeProjectedActiveBalancesNoCpi,
  computeProjectedActiveBanksNoCpi,
  decodeMarginfiAccount,
  getBalance,
  makeAccountTransferToNewAccountTx,
  MakeAccountTransferToNewAccountTxParams,
  makeBeginFlashLoanIx,
  makeBorrowIx,
  MakeBorrowIxParams,
  makeBorrowTx,
  MakeBorrowTxParams,
  makeBridgedLoopTx,
  MakeBridgedLoopTxParams,
  makeBridgedSwapCollateralTx,
  MakeBridgedSwapCollateralTxParams,
  makeBridgedSwapDebtTx,
  MakeBridgedSwapDebtTxParams,
  makeCloseMarginfiAccountIx,
  makeDepositIx,
  MakeDepositIxParams,
  makeDepositTx,
  MakeDepositTxParams,
  makeEndFlashLoanIx,
  makeFlashLoanTx,
  MakeFlashLoanTxParams,
  makeLoopTx,
  MakeLoopTxParams,
  makePulseHealthIx,
  makeRepayIx,
  MakeRepayIxParams,
  makeRepayTx,
  MakeRepayTxParams,
  makeRepayWithCollatTx,
  MakeRepayWithCollatTxParams,
  makeRollPtTx,
  MakeRollPtTxParams,
  makeSwapCollateralTx,
  MakeSwapCollateralTxParams,
  makeSwapDebtTx,
  MakeSwapDebtTxParams,
  makeTransferPositionsTx,
  MakeTransferPositionsTxParams,
  makeWithdrawIx,
  MakeWithdrawIxParams,
  makeWithdrawTx,
  MakeWithdrawTxParams,
  MarginfiAccountType,
  MarginRequirementType,
  simulateAccountHealthCacheWithFallback,
  SimulateAccountHealthCacheWithFallbackParams,
} from "~/services/account";
import { ActionEmodeImpact, BankType, EmodePair } from "~/services/bank";
import { makeUnwrapSolIx, makeWrapSolIxs } from "~/services/transaction";
import { Amount } from "~/types";

/**
 * A marginfi account: its balances, flags and health cache, with the SDK's account computations
 * and transaction builders bound to it.
 */
class MarginfiAccount implements MarginfiAccountType {
  constructor(
    public readonly address: Address,
    public readonly group: Address,
    public readonly authority: Address,
    public readonly balances: Balance[],
    public readonly accountFlags: AccountFlags[],
    public healthCache: HealthCache
  ) {}

  /**
   * Fetches and decodes the marginfi account at `address`.
   * @throws if the account doesn't exist or isn't a marginfi account
   */
  static async fetch(address: Address, rpc: Rpc<GetAccountInfoApi>): Promise<MarginfiAccount> {
    const account = await fetchEncodedAccount(rpc, address);
    assertAccountExists(account);
    return MarginfiAccount.fromBuffer(address, account.data);
  }

  /**
   * Decodes marginfi account data.
   * @throws if `data` isn't a marginfi account
   */
  static fromBuffer(address: Address, data: ReadonlyUint8Array): MarginfiAccount {
    return MarginfiAccount.fromAccountType(decodeMarginfiAccount(address, data));
  }

  /** Wraps a plain {@link MarginfiAccountType}. */
  static fromAccountType(account: MarginfiAccountType): MarginfiAccount {
    return new MarginfiAccount(
      account.address,
      account.group,
      account.authority,
      account.balances.map((b) => Balance.fromBalanceType(b)),
      account.accountFlags,
      account.healthCache
    );
  }

  /**
   * Simulates a health-cache refresh; returns a new account carrying the refreshed cache (or the
   * computed fallback) and the simulation error, if any. Doesn't mutate this account.
   */
  async simulateHealthCache(
    params: Omit<SimulateAccountHealthCacheWithFallbackParams, "marginfiAccount">
  ) {
    const { marginfiAccount, error } = await simulateAccountHealthCacheWithFallback({
      ...params,
      marginfiAccount: this,
    });

    return { account: MarginfiAccount.fromAccountType(marginfiAccount), error };
  }

  // ----------------------------------------------------------------------------
  // Attributes
  // ----------------------------------------------------------------------------

  /** Balances holding a position. */
  get activeBalances(): Balance[] {
    return this.balances.filter((b) => b.active);
  }

  /** The balance in `bankPk` (an empty one when the account holds none). */
  getBalance(bankPk: Address): Balance {
    return Balance.fromBalanceType(getBalance(bankPk, this.balances));
  }

  get isDisabled(): boolean {
    return this.accountFlags.includes(AccountFlags.ACCOUNT_DISABLED);
  }

  get isFlashLoanEnabled(): boolean {
    return this.accountFlags.includes(AccountFlags.ACCOUNT_IN_FLASHLOAN);
  }

  get isTransferAccountAuthorityEnabled(): boolean {
    return this.accountFlags.includes(AccountFlags.ACCOUNT_TRANSFER_AUTHORITY_ALLOWED);
  }

  /** Replaces the health cache (mutates; {@link simulateHealthCache} returns a copy instead). */
  setHealthCache(value: HealthCache) {
    this.healthCache = value;
  }

  // ----------------------------------------------------------------------------
  // Computations
  // ----------------------------------------------------------------------------

  /** Collateral (USD) not backing liabilities, from the health cache; `clamped` floors it at 0. */
  computeFreeCollateralFromCache(opts?: { clamped?: boolean }): BigNumber {
    return computeFreeCollateralFromCache(this, opts);
  }

  /** Collateral (USD) not backing liabilities at Initial weights, from the balances. */
  computeFreeCollateralFromBalances(
    params: Omit<ComputeFreeCollateralFromBalancesParams, "activeBalances">
  ): BigNumber {
    return computeFreeCollateralFromBalances({ ...params, activeBalances: this.activeBalances });
  }

  /** Weighted assets and liabilities (USD) for `marginRequirement`, from the health cache. */
  computeHealthComponentsFromCache(marginRequirement: MarginRequirementType): {
    assets: BigNumber;
    liabilities: BigNumber;
  } {
    return computeHealthComponentsFromCache(this, marginRequirement);
  }

  /** Weighted assets and liabilities (USD) from the balances, with conservative price bias. */
  computeHealthComponentsFromBalances(
    params: Omit<ComputeHealthComponentsFromBalancesParams, "activeBalances">
  ): { assets: BigNumber; liabilities: BigNumber } {
    return computeHealthComponentsFromBalances({ ...params, activeBalances: this.activeBalances });
  }

  /** Assets minus liabilities (USD), from the health cache. */
  computeAccountValue(): BigNumber {
    return computeAccountValue(this);
  }

  /** Net APY of all positions, weighted by USD value (0.05 = 5%). */
  computeNetApy(params: Omit<ComputeNetApyParams, "marginfiAccount" | "activeBalances">): number {
    return computeNetApy({
      ...params,
      marginfiAccount: this,
      activeBalances: this.activeBalances,
    });
  }

  /** Oracle price at which this account's position in `bank` gets liquidated, or `null` if none. */
  computeLiquidationPriceForBank(
    params: Omit<ComputeLiquidationPriceForBankParams, "marginfiAccount">
  ): number | null {
    return computeLiquidationPriceForBank({ ...params, marginfiAccount: this });
  }

  /**
   * Maximum borrow (UI units) from `bankAddress` given free collateral, existing deposits, risk
   * weights and emode. Liquidators: collateral received from liquidating isn't counted.
   */
  computeMaxBorrowForBank(params: Omit<ComputeMaxBorrowForBankParams, "account">): BigNumber {
    return computeMaxBorrowForBank({ ...params, account: this });
  }

  /** Maximum withdrawal (UI units) from `bankAddress` that keeps the account healthy. */
  computeMaxWithdrawForBank(params: Omit<ComputeMaxWithdrawForBankParams, "account">): BigNumber {
    return computeMaxWithdrawForBank({ ...params, account: this });
  }

  /** Maximum deposit (UI units): the bank's remaining deposit cap, capped by the wallet balance. */
  computeMaxDepositForBank(params: ComputeMaxDepositForBankParams): BigNumber {
    return computeMaxDepositForBank(params);
  }

  /** Emode pairs active for this account's collateral and liabilities. */
  computeActiveEmodePairs(emodePairs: EmodePair[]): EmodePair[] {
    const { liabilities, collateral } = this.emodePositions();
    return computeActiveEmodePairs(emodePairs, liabilities, collateral);
  }

  /** How borrowing, supplying, repaying or withdrawing each of `banks` would change emode. */
  computeEmodeImpacts(
    emodePairs: EmodePair[],
    banks: Address[]
  ): Record<string, ActionEmodeImpact> {
    const { liabilities, collateral } = this.emodePositions();
    return computeEmodeImpacts(emodePairs, liabilities, collateral, banks);
  }

  private emodePositions() {
    return {
      liabilities: this.activeBalances.filter((b) => b.liabilityShares.gt(0)).map((b) => b.bankPk),
      collateral: this.activeBalances.filter((b) => b.assetShares.gt(0)).map((b) => b.bankPk),
    };
  }

  /** Banks active after `instructions` run (marginfi instructions only, no CPI). */
  computeProjectedActiveBanksNoCpi(
    programAddress: Address,
    instructions: Instruction[]
  ): Address[] {
    return computeProjectedActiveBanksNoCpi({ account: this, instructions, programAddress });
  }

  /** Balances after `instructions` run (marginfi instructions only, no CPI), and the banks hit. */
  computeProjectedActiveBalancesNoCpi(
    programAddress: Address,
    instructions: Instruction[],
    banksMap: Map<string, BankType>,
    assetShareValueMultiplierByBank: Map<string, BigNumber>
  ) {
    const { projectedBalances, ...rest } = computeProjectedActiveBalancesNoCpi({
      account: this,
      instructions,
      programAddress,
      banksMap,
      assetShareValueMultiplierByBank,
    });
    return { ...rest, projectedBalances: projectedBalances.map(Balance.fromBalanceType) };
  }

  // ----------------------------------------------------------------------------
  // Actions (see the service builder of the same name for details)
  // ----------------------------------------------------------------------------

  async makeDepositIx(params: Omit<MakeDepositIxParams, "marginfiAccount">) {
    return makeDepositIx({ ...params, marginfiAccount: this });
  }

  async makeRepayIx(params: Omit<MakeRepayIxParams, "marginfiAccount">) {
    return makeRepayIx({ ...params, marginfiAccount: this });
  }

  async makeWithdrawIx(params: Omit<MakeWithdrawIxParams, "marginfiAccount">) {
    return makeWithdrawIx({ ...params, marginfiAccount: this });
  }

  async makeBorrowIx(params: Omit<MakeBorrowIxParams, "marginfiAccount">) {
    return makeBorrowIx({ ...params, marginfiAccount: this });
  }

  async makeDepositTx(params: Omit<MakeDepositTxParams, "marginfiAccount">) {
    return makeDepositTx({ ...params, marginfiAccount: this });
  }

  async makeRepayTx(params: Omit<MakeRepayTxParams, "marginfiAccount">) {
    return makeRepayTx({ ...params, marginfiAccount: this });
  }

  async makeWithdrawTx(params: Omit<MakeWithdrawTxParams, "marginfiAccount">) {
    return makeWithdrawTx({ ...params, marginfiAccount: this });
  }

  async makeBorrowTx(params: Omit<MakeBorrowTxParams, "marginfiAccount">) {
    return makeBorrowTx({ ...params, marginfiAccount: this });
  }

  /** Starts a flash loan that ends at transaction instruction `endIndex`. */
  async makeBeginFlashLoanIx(
    programAddress: Address,
    endIndex: number,
    authority: TransactionSigner
  ) {
    return makeBeginFlashLoanIx(programAddress, this.address, endIndex, authority);
  }

  /**
   * Ends a flash loan, health-checking the account with `projectedActiveBanks` active.
   * @throws Error if `bankMap` misses one of `projectedActiveBanks`
   */
  async makeEndFlashLoanIx(
    programAddress: Address,
    bankMap: Map<string, BankType>,
    projectedActiveBanks: Address[],
    authority: TransactionSigner
  ) {
    return makeEndFlashLoanIx(
      programAddress,
      this.address,
      this.group,
      bankMap,
      projectedActiveBanks,
      authority
    );
  }

  async makeFlashLoanTx(params: Omit<MakeFlashLoanTxParams, "marginfiAccount">) {
    return makeFlashLoanTx({ ...params, marginfiAccount: this });
  }

  async makeAccountTransferToNewAccountTx(
    params: Omit<MakeAccountTransferToNewAccountTxParams, "marginfiAccount">
  ) {
    return makeAccountTransferToNewAccountTx({ ...params, marginfiAccount: this });
  }

  /** Closes this (empty) account; `authority` signs and receives the rent. */
  async makeCloseAccountIx(programAddress: Address, authority: TransactionSigner) {
    return makeCloseMarginfiAccountIx({ programAddress, marginfiAccount: this, authority });
  }

  /**
   * Refreshes this account's on-chain health cache.
   * @throws Error if `bankMap` misses one of the account's active banks
   */
  async makePulseHealthIx(programAddress: Address, bankMap: Map<string, BankType>) {
    return makePulseHealthIx(programAddress, this, bankMap);
  }

  /** Surrounds `ix` with wrapping `amount` SOL (UI units) into wSOL and unwrapping it after. */
  async wrapInstructionForWSol(
    ix: Instruction,
    authority: TransactionSigner,
    amount: Amount = 0
  ): Promise<Instruction[]> {
    return [
      ...(await makeWrapSolIxs(authority, new BigNumber(amount))),
      ix,
      await makeUnwrapSolIx(authority),
    ];
  }

  async makeLoopTx(params: Omit<MakeLoopTxParams, "marginfiAccount">) {
    return makeLoopTx({ ...params, marginfiAccount: this });
  }

  async makeBridgedLoopTx(params: Omit<MakeBridgedLoopTxParams, "marginfiAccount">) {
    return makeBridgedLoopTx({ ...params, marginfiAccount: this });
  }

  async makeRepayWithCollatTx(params: Omit<MakeRepayWithCollatTxParams, "marginfiAccount">) {
    return makeRepayWithCollatTx({ ...params, marginfiAccount: this });
  }

  async makeSwapCollateralTx(params: Omit<MakeSwapCollateralTxParams, "marginfiAccount">) {
    return makeSwapCollateralTx({ ...params, marginfiAccount: this });
  }

  async makeBridgedSwapCollateralTx(
    params: Omit<MakeBridgedSwapCollateralTxParams, "marginfiAccount">
  ) {
    return makeBridgedSwapCollateralTx({ ...params, marginfiAccount: this });
  }

  async makeSwapDebtTx(params: Omit<MakeSwapDebtTxParams, "marginfiAccount">) {
    return makeSwapDebtTx({ ...params, marginfiAccount: this });
  }

  async makeBridgedSwapDebtTx(params: Omit<MakeBridgedSwapDebtTxParams, "marginfiAccount">) {
    return makeBridgedSwapDebtTx({ ...params, marginfiAccount: this });
  }

  async makeRollPtTx(params: Omit<MakeRollPtTxParams, "marginfiAccount">) {
    return makeRollPtTx({ ...params, marginfiAccount: this });
  }

  async makeTransferPositionsTx(params: Omit<MakeTransferPositionsTxParams, "marginfiAccount">) {
    return makeTransferPositionsTx({ ...params, marginfiAccount: this });
  }
}

export { MarginfiAccount };
