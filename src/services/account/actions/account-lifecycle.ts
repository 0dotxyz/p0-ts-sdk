import {
  assertAccountExists,
  fetchEncodedAccount,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { BigNumber } from "bignumber.js";

import {
  AccountFlags,
  HealthCacheStatus,
  MakeAccountTransferToNewAccountTxParams,
  MakeCloseAccountIxParams,
  MakeCloseAccountTxParams,
  MakeCreateAccountIxParams,
  MakeCreateAccountTxParams,
  MakeSetupIxParams,
  MarginfiAccountType,
  PremiumRefreshParams,
} from "../types";
import {
  computeHealthAccounts,
  findRandomAvailableAccountIndex,
  getActiveBalances,
  needsPremiumRefresh,
} from "../utils";

import { decodeFeeStateRaw } from "~/accounts";
import { BUNDLE_TX_SIZE, DEFAULT_ADDRESS, MAX_ACCOUNT_LOCKS, PRIORITY_TX_SIZE } from "~/constants";
import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import instructions from "~/instructions";
import { BankType } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  fitsInOneTransaction,
  makeTransactionMessage,
  selectLutsForAccountAction,
  selectLutsForBanks,
  SolanaTransaction,
  TransactionFormat,
  TransactionType,
} from "~/services/transaction";
import { deriveFeeState, deriveMarginfiAccount } from "~/utils";

/**
 * Creates an instruction to close a Marginfi account.
 *
 * Generates the instruction needed to close an existing Marginfi account and reclaim rent.
 * The account must have no active balances before it can be closed.
 *
 * @param params - Configuration object
 * @param params.programAddress - The marginfi program address
 * @param params.marginfiAccount - The Marginfi account to close
 * @param params.authority - The account authority; signs and receives the rent
 * @returns Instruction to close the account
 */
export async function makeCloseMarginfiAccountIx({
  programAddress,
  marginfiAccount,
  authority,
}: MakeCloseAccountIxParams): Promise<Instruction> {
  return instructions.makeCloseAccountIx(programAddress, {
    marginfiAccount: marginfiAccount.address,
    authority,
    feePayer: authority,
  });
}

/**
 * Creates a transaction to close a Marginfi account.
 *
 * Generates a complete transaction to close an existing Marginfi account and reclaim rent.
 * The account must have no active balances before it can be closed.
 *
 * @param params - Configuration object
 * @param params.rpc - RPC client, for the blockhash
 * @param params.programAddress - The marginfi program address
 * @param params.marginfiAccount - The Marginfi account to close
 * @param params.authority - The account authority; signs, pays and receives the rent
 * @returns Transaction to close the account
 */
export async function makeCloseMarginfiAccountTx({
  rpc,
  txFormat,
  ...closeIxParams
}: MakeCloseAccountTxParams): Promise<SolanaTransaction> {
  const closeIx = await makeCloseMarginfiAccountIx(closeIxParams);
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  return {
    message: makeTransactionMessage({
      instructions: [closeIx],
      feePayer: closeIxParams.authority,
      latestBlockhash,
      txFormat,
    }),
    type: TransactionType.CLOSE_ACCOUNT,
  };
}

/**
 * Creates a transaction to transfer a Marginfi account to a new authority.
 *
 * Migrates the account's positions into a brand-new account (`newMarginfiAccount`)
 * owned by `newAuthority`; the old account is left disabled. The new-account
 * keypair signs to create itself, the current authority signs to authorize, and
 * `feePayer` pays. `globalFeeWallet` is read from the program's fee state.
 *
 * @param params - Configuration object
 * @param params.rpc - RPC client, for the fee state and the blockhash
 * @param params.programAddress - The marginfi program address
 * @param params.marginfiAccount - The account being transferred
 * @param params.authority - The account's current authority
 * @param params.newMarginfiAccount - Signer for the freshly generated destination account
 * @param params.newAuthority - The wallet that will own the new account
 * @param params.feePayer - Optional. Pays rent/fees. Defaults to `authority`.
 * @returns Transaction to transfer the account
 * @throws if the program's fee state account doesn't exist
 * @throws TransactionBuildingError (ACCOUNT_DISABLED) when the account is disabled, e.g. already
 * transferred
 */
export async function makeAccountTransferToNewAccountTx({
  rpc,
  programAddress,
  marginfiAccount,
  authority,
  newMarginfiAccount,
  newAuthority,
  feePayer = authority,
  txFormat,
}: MakeAccountTransferToNewAccountTxParams): Promise<SolanaTransaction> {
  if (marginfiAccount.accountFlags.includes(AccountFlags.ACCOUNT_DISABLED)) {
    throw TransactionBuildingError.accountDisabled(marginfiAccount.address);
  }

  const [feeStateAddress] = await deriveFeeState(programAddress);
  const feeStateAccount = await fetchEncodedAccount(rpc, feeStateAddress);
  assertAccountExists(feeStateAccount);

  const transferIx = await instructions.makeAccountTransferToNewAccountIx(programAddress, {
    group: marginfiAccount.group,
    oldMarginfiAccount: marginfiAccount.address,
    newMarginfiAccount,
    authority,
    feePayer,
    newAuthority,
    globalFeeWallet: decodeFeeStateRaw(feeStateAccount.data).globalFeeWallet,
    feeState: feeStateAddress,
  });

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  return {
    message: makeTransactionMessage({
      instructions: [transferIx],
      feePayer,
      latestBlockhash,
      txFormat,
    }),
    type: TransactionType.TRANSFER_AUTH,
  };
}

/**
 * Creates a new Marginfi account transaction with a projected account instance.
 *
 * Generates a transaction to create a new Marginfi account and returns a projected account instance
 * that can be used for operations before the account actually exists on-chain.
 *
 * @param params - Configuration object
 * @param params.rpc - RPC client, for the blockhash and, without `accountIndex`, a free index
 * @param params.programAddress - The marginfi program address
 * @param params.authority - Owner of the new account; signs and pays
 * @param params.group - The Marginfi group address
 * @param params.txFormat - Message version, with the lookup tables for v0
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.accountIndex - Optional index in the account PDA seeds; a random free one when
 * omitted
 * @param params.thirdPartyId - Optional third-party id in the account PDA seeds
 * @returns Object containing the projected account and creation transaction
 * @throws Error if `accountIndex` is omitted and no free index is found
 */
export async function makeCreateAccountTxWithProjection(
  params: MakeCreateAccountTxParams
): Promise<{ account: MarginfiAccountType; tx: SolanaTransaction }> {
  const accountIndex =
    params.accountIndex ??
    (await findRandomAvailableAccountIndex(
      params.rpc,
      params.programAddress,
      params.group,
      params.authority.address,
      params.thirdPartyId
    ));
  const [marginfiAccountAddress] = await deriveMarginfiAccount(
    params.programAddress,
    params.group,
    params.authority.address,
    accountIndex,
    params.thirdPartyId
  );

  return {
    account: generateDummyAccount(params.group, params.authority.address, marginfiAccountAddress),
    tx: await makeCreateMarginfiAccountTx({ ...params, accountIndex }),
  };
}

/**
 * Creates a new Marginfi account instruction with a projected account instance.
 *
 * Generates an instruction to create a new Marginfi account and returns a projected account instance
 * that can be used for operations before the account actually exists on-chain.
 *
 * @param params - Configuration object
 * @param params.programAddress - The marginfi program address
 * @param params.authority - Owner of the new account; signs and pays
 * @param params.group - The Marginfi group address
 * @param params.accountIndex - Index in the account PDA seeds
 * @param params.thirdPartyId - Optional third-party id in the account PDA seeds
 * @returns Object containing the projected account and creation instruction
 */
export async function makeCreateAccountIxWithProjection(
  params: MakeCreateAccountIxParams
): Promise<{ account: MarginfiAccountType; ix: Instruction }> {
  const [marginfiAccountAddress] = await deriveMarginfiAccount(
    params.programAddress,
    params.group,
    params.authority.address,
    params.accountIndex,
    params.thirdPartyId
  );

  return {
    account: generateDummyAccount(params.group, params.authority.address, marginfiAccountAddress),
    ix: await makeCreateMarginfiAccountIx(params),
  };
}

/**
 * Builds a transaction around {@link makeCreateMarginfiAccountIx}. Without `accountIndex` a random
 * free index is picked via `rpc`; use {@link makeCreateAccountTxWithProjection} to learn the new
 * account's address. The authority pays and signs; `latestBlockhash` is fetched when omitted.
 * @throws Error if `accountIndex` is omitted and no free index is found
 */
export async function makeCreateMarginfiAccountTx({
  rpc,
  txFormat,
  latestBlockhash,
  accountIndex,
  ...createIxParams
}: MakeCreateAccountTxParams): Promise<SolanaTransaction> {
  const initMarginfiAccountIx = await makeCreateMarginfiAccountIx({
    ...createIxParams,
    accountIndex:
      accountIndex ??
      (await findRandomAvailableAccountIndex(
        rpc,
        createIxParams.programAddress,
        createIxParams.group,
        createIxParams.authority.address,
        createIxParams.thirdPartyId
      )),
  });

  return {
    message: makeTransactionMessage({
      instructions: [initMarginfiAccountIx],
      feePayer: createIxParams.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      txFormat,
    }),
    type: TransactionType.CREATE_ACCOUNT,
  };
}

/**
 * Creates a marginfi account at its PDA (`group`, authority, `accountIndex`, `thirdPartyId`). The
 * authority owns the account, pays its rent and signs.
 */
export async function makeCreateMarginfiAccountIx({
  programAddress,
  authority,
  group,
  accountIndex,
  thirdPartyId,
}: MakeCreateAccountIxParams): Promise<Instruction> {
  const [marginfiAccount] = await deriveMarginfiAccount(
    programAddress,
    group,
    authority.address,
    accountIndex,
    thirdPartyId
  );

  return instructions.makeInitMarginfiAccountPdaIx(programAddress, {
    marginfiGroup: group,
    marginfiAccount,
    authority,
    feePayer: authority,
    accountIndex,
    thirdPartyId: thirdPartyId ?? null,
  });
}

export async function makeSetupIx({
  rpc,
  authority,
  tokens,
}: MakeSetupIxParams): Promise<Instruction[]> {
  try {
    // Filter out duplicate mints
    const uniqueTokens = tokens.filter(
      (token, index, self) => index === self.findIndex((t) => t.mint === token.mint)
    );

    const userAtas = await Promise.all(
      uniqueTokens.map(
        async ({ mint, tokenProgram }) =>
          (await findAssociatedTokenPda({ mint, owner: authority.address, tokenProgram }))[0]
      )
    );
    const { value: userAtaAis } = await rpc
      .getMultipleAccounts(userAtas, { encoding: "base64" })
      .send();

    return uniqueTokens.flatMap(({ mint, tokenProgram }, i) =>
      userAtaAis[i] === null
        ? [
            getCreateAssociatedTokenIdempotentInstruction({
              payer: authority,
              ata: userAtas[i],
              owner: authority.address,
              mint,
              tokenProgram,
            }),
          ]
        : []
    );
  } catch (error) {
    console.error("[makeSetupIx] Failed to create setup instructions:", error);
    return [];
  }
}

/**
 * Refreshes `marginfiAccount`'s on-chain health cache from its active banks, plus
 * `mandatoryBanks` and minus `excludedBanks` (the positions an action in the same transaction
 * opens or closes).
 * @throws Error if `bankMap` misses one of the banks
 */
export async function makePulseHealthIx(
  programAddress: Address,
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  mandatoryBanks: Address[],
  excludedBanks: Address[]
): Promise<Instruction[]> {
  const activeBanks = getActiveBalances(marginfiAccount.balances)
    .map((b) => b.bankPk)
    .filter((bank) => !excludedBanks.includes(bank));
  const ix = await instructions.makePulseHealthIx(
    programAddress,
    { marginfiAccount: marginfiAccount.address, group: marginfiAccount.group },
    computeHealthAccounts(bankMap, [...activeBanks, ...mandatoryBanks])
  );

  return [ix];
}

/**
 * Integration refreshes plus `pulse_health`, placed after a deposit or repay so the program
 * rewrites the account's variable borrow premium rates from its collateral after the action.
 * See {@link needsPremiumRefresh} for when it's needed.
 *
 * Best-effort: returns no instructions when a bank to refresh has no venue state in
 * `bankMetadataMap`, since `pulse_health` skips the premium write when a leg can't be priced.
 *
 * @param programAddress - The marginfi program address
 * @param state - The account (before the action), bank map and venue state
 * @param mandatoryBanks - Banks the action opens (the deposited bank)
 * @param excludedBanks - Banks the action closes (fully repaid banks)
 * @returns Instructions to append after the action
 */
export async function makePremiumRefreshIxs(
  programAddress: Address,
  { marginfiAccount, bankMap, bankMetadataMap }: PremiumRefreshParams,
  mandatoryBanks: Address[],
  excludedBanks: Address[]
): Promise<Instruction[]> {
  let refreshIxs: Instruction[];
  try {
    refreshIxs = await makeRefreshIntegrationBanksIxs(
      marginfiAccount,
      bankMap,
      [],
      bankMetadataMap,
      mandatoryBanks
    );
  } catch (error) {
    // A missing refresh only costs the rate update; it must not block the deposit or repay
    if (
      error instanceof TransactionBuildingError &&
      (error.code === TransactionBuildingErrorCode.KAMINO_RESERVE_NOT_FOUND ||
        error.code === TransactionBuildingErrorCode.DRIFT_STATE_NOT_FOUND ||
        error.code === TransactionBuildingErrorCode.JUPLEND_STATE_NOT_FOUND)
    ) {
      return [];
    }
    throw error;
  }
  const pulseIxs = await makePulseHealthIx(
    programAddress,
    marginfiAccount,
    bankMap,
    mandatoryBanks,
    excludedBanks
  );
  return [...refreshIxs, ...pulseIxs];
}

/**
 * Appends the premium refresh ({@link makePremiumRefreshIxs}) to a deposit or repay that lands in
 * one transaction, and picks the lookup tables to compile it with. The refresh is left out when
 * `opts.skipPremiumRefresh` is set, no premium-bearing debt remains, venue state is missing, or
 * it would push the transaction past its size limit or MAX_ACCOUNT_LOCKS.
 *
 * @param params - The builder's params: account (before the action), bank map, venue state,
 * acted-on bank, authority and transaction format
 * @param actionIxs - The action's instructions
 * @param mandatoryBanks - Banks the action opens (the deposited bank)
 * @param excludedBanks - Banks the action closes (fully repaid banks)
 * @returns The transaction's instructions and format (with the lookup tables it needs)
 */
export async function appendPremiumRefresh(
  params: PremiumRefreshParams & {
    programAddress: Address;
    bank: BankType;
    authority: TransactionSigner;
    txFormat: TransactionFormat;
    opts?: { skipPremiumRefresh?: boolean };
  },
  actionIxs: Instruction[],
  mandatoryBanks: Address[],
  excludedBanks: Address[]
): Promise<{ instructions: Instruction[]; txFormat: TransactionFormat }> {
  const { marginfiAccount, bankMap, bank, txFormat } = params;
  const actionOnly = { instructions: actionIxs, txFormat: selectLutsForBanks(txFormat, [bank]) };
  if (
    params.opts?.skipPremiumRefresh ||
    !needsPremiumRefresh(marginfiAccount, bankMap, excludedBanks)
  ) {
    return actionOnly;
  }

  const premiumIxs = await makePremiumRefreshIxs(
    params.programAddress,
    params,
    mandatoryBanks,
    excludedBanks
  );
  const withPremium = {
    instructions: [...actionIxs, ...premiumIxs],
    txFormat: selectLutsForAccountAction(txFormat, bank, marginfiAccount.balances, bankMap),
  };
  // Leaves room for what the send pipeline may append: compute-budget and priority-fee ixs, and
  // in bundles a Jito tip, which lock the ComputeBudget program, tip account and System program
  const fits =
    premiumIxs.length > 0 &&
    fitsInOneTransaction(withPremium.instructions, {
      feePayer: params.authority,
      txFormat: withPremium.txFormat,
      sizeMargin: PRIORITY_TX_SIZE + BUNDLE_TX_SIZE,
      maxAccountLocks: MAX_ACCOUNT_LOCKS - 3,
    });
  return fits ? withPremium : actionOnly;
}

export function generateDummyAccount(
  group: Address,
  authority: Address,
  accountKey: Address
): MarginfiAccountType {
  // an empty account with 15 empty balances, to build transactions before it exists on-chain
  return {
    address: accountKey,
    group,
    authority,
    balances: Array.from({ length: 15 }, () => ({
      active: false,
      bankPk: DEFAULT_ADDRESS,
      tag: 0,
      assetShares: new BigNumber(0),
      liabilityShares: new BigNumber(0),
      premiumRate: new BigNumber(0),
      premiumOutstanding: new BigNumber(0),
      lastUpdate: 0,
    })),
    accountFlags: [],
    healthCache: {
      assetValue: new BigNumber(0),
      liabilityValue: new BigNumber(0),
      assetValueMaint: new BigNumber(0),
      liabilityValueMaint: new BigNumber(0),
      assetValueEquity: new BigNumber(0),
      liabilityValueEquity: new BigNumber(0),
      timestamp: new BigNumber(0),
      flags: [],
      prices: [],
      simulationStatus: HealthCacheStatus.UNSET,
    },
    activeOrders: 0,
  };
}
