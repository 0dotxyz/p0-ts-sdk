import type { Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";

import {
  AccountFlags,
  AppendPremiumRefreshParams,
  MakeCloseAccountIxParams,
  MakeCloseAccountTxParams,
  MakeCreateAccountIxParams,
  MakeCreateAccountTxParams,
  MakeCreateMissingAtaIxsParams,
  MakePremiumRefreshIxsParams,
  MakePulseHealthIxParams,
  MakeTransferAccountIxParams,
  MakeTransferAccountTxParams,
  MarginfiAccountType,
} from "../types";
import {
  computeHealthAccounts,
  fetchGlobalFeeWallet,
  findRandomAvailableAccountIndex,
  generateDummyMarginfiAccount,
  getActiveBalances,
  needsPremiumRefresh,
} from "../utils";

import { BUNDLE_TX_SIZE, MAX_ACCOUNT_LOCKS, PRIORITY_TX_SIZE } from "~/constants";
import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import instructions from "~/instructions";
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
import { deriveMarginfiAccount } from "~/utils";

/**
 * Closes `marginfiAccount` and returns its rent to the authority, who signs and pays. The program
 * rejects the close while the account has active balances or is disabled.
 */
export async function makeCloseAccountIx({
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
 * Builds a close transaction around {@link makeCloseAccountIx}. The authority pays and signs;
 * `latestBlockhash` is fetched when omitted.
 * @throws TransactionBuildingError (ACCOUNT_DISABLED) if the account is disabled, e.g. transferred
 * @throws TransactionBuildingError (ACCOUNT_NOT_EMPTY) if the account has active balances
 */
export async function makeCloseAccountTx(
  params: MakeCloseAccountTxParams
): Promise<SolanaTransaction> {
  const { rpc, txFormat, latestBlockhash, ...closeIxParams } = params;
  const { marginfiAccount } = params;
  if (marginfiAccount.accountFlags.includes(AccountFlags.ACCOUNT_DISABLED)) {
    throw TransactionBuildingError.accountDisabled(marginfiAccount.address);
  }
  const activeBanks = getActiveBalances(marginfiAccount.balances).map((b) => b.bankPk);
  if (activeBanks.length > 0) {
    throw TransactionBuildingError.accountNotEmpty(marginfiAccount.address, activeBanks);
  }

  const closeIx = await makeCloseAccountIx(closeIxParams);

  return {
    message: makeTransactionMessage({
      instructions: [closeIx],
      feePayer: params.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      txFormat,
    }),
    type: TransactionType.CLOSE_ACCOUNT,
  };
}

/**
 * Moves `marginfiAccount`'s positions into a new account owned by `newAuthority`, at the PDA of
 * (`group`, `newAuthority`, `accountIndex`, `thirdPartyId`), and disables the old account. The
 * authority signs; `feePayer` pays the new account's rent and the program's flat transfer fee.
 */
export async function makeTransferAccountIx({
  programAddress,
  marginfiAccount,
  authority,
  newAuthority,
  accountIndex,
  thirdPartyId,
  feePayer = authority,
  globalFeeWallet,
}: MakeTransferAccountIxParams): Promise<Instruction> {
  const [newMarginfiAccount] = await deriveMarginfiAccount(
    programAddress,
    marginfiAccount.group,
    newAuthority,
    accountIndex,
    thirdPartyId
  );

  return instructions.makeAccountTransferToNewAccountPdaIx(programAddress, {
    group: marginfiAccount.group,
    oldMarginfiAccount: marginfiAccount.address,
    newMarginfiAccount,
    authority,
    feePayer,
    newAuthority,
    globalFeeWallet,
    accountIndex,
    thirdPartyId: thirdPartyId ?? null,
  });
}

/**
 * Builds a transfer transaction around {@link makeTransferAccountIx}, reading the global fee
 * wallet from the program's fee state. Without `accountIndex` a random free index under
 * `newAuthority` is picked via `rpc`. `feePayer` pays; `latestBlockhash` is fetched when omitted.
 * @throws TransactionBuildingError (ACCOUNT_DISABLED) if the account is disabled, e.g. already
 * transferred
 * @throws TransactionBuildingError (FEE_STATE_NOT_FOUND) if the program's fee state account
 * doesn't exist
 * @throws Error if `accountIndex` is omitted and no free index is found
 */
export async function makeTransferAccountTx(
  params: MakeTransferAccountTxParams
): Promise<SolanaTransaction> {
  const { rpc, txFormat, latestBlockhash, accountIndex, ...transferIxParams } = params;
  const { programAddress, marginfiAccount, newAuthority, thirdPartyId } = params;
  const feePayer = params.feePayer ?? params.authority;
  if (marginfiAccount.accountFlags.includes(AccountFlags.ACCOUNT_DISABLED)) {
    throw TransactionBuildingError.accountDisabled(marginfiAccount.address);
  }

  const transferIx = await makeTransferAccountIx({
    ...transferIxParams,
    accountIndex:
      accountIndex ??
      (await findRandomAvailableAccountIndex(
        rpc,
        programAddress,
        marginfiAccount.group,
        newAuthority,
        thirdPartyId
      )),
    globalFeeWallet: await fetchGlobalFeeWallet(rpc, programAddress),
  });

  return {
    message: makeTransactionMessage({
      instructions: [transferIx],
      feePayer,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      txFormat,
    }),
    type: TransactionType.TRANSFER_AUTH,
  };
}

/**
 * {@link makeCreateAccountTx} plus the new account as an empty account
 * ({@link generateDummyMarginfiAccount}), to build further actions against before it exists
 * on-chain.
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
    account: generateDummyMarginfiAccount(
      params.group,
      params.authority.address,
      marginfiAccountAddress
    ),
    tx: await makeCreateAccountTx({ ...params, accountIndex }),
  };
}

/**
 * {@link makeCreateAccountIx} plus the new account as an empty account
 * ({@link generateDummyMarginfiAccount}), to build further actions against before it exists
 * on-chain.
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
    account: generateDummyMarginfiAccount(
      params.group,
      params.authority.address,
      marginfiAccountAddress
    ),
    ix: await makeCreateAccountIx(params),
  };
}

/**
 * Builds a create transaction around {@link makeCreateAccountIx}. Without `accountIndex` a random
 * free index is picked via `rpc`; use {@link makeCreateAccountTxWithProjection} to learn the new
 * account's address. The authority pays and signs; `latestBlockhash` is fetched when omitted.
 * @throws Error if `accountIndex` is omitted and no free index is found
 */
export async function makeCreateAccountTx({
  rpc,
  txFormat,
  latestBlockhash,
  accountIndex,
  ...createIxParams
}: MakeCreateAccountTxParams): Promise<SolanaTransaction> {
  const createIx = await makeCreateAccountIx({
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
      instructions: [createIx],
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
export async function makeCreateAccountIx({
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

/**
 * Creates the authority's associated token accounts for `tokens` that don't exist yet (one per
 * mint), paid by the authority.
 */
export async function makeCreateMissingAtaIxs({
  rpc,
  authority,
  tokens,
}: MakeCreateMissingAtaIxsParams): Promise<Instruction[]> {
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
}

/**
 * Refreshes `marginfiAccount`'s on-chain health cache from its active banks. Permissionless: no
 * signer needed.
 * @throws TransactionBuildingError (BANK_NOT_FOUND) if `bankMap` misses one of the banks
 */
export async function makePulseHealthIx({
  programAddress,
  marginfiAccount,
  bankMap,
  opts = {},
}: MakePulseHealthIxParams): Promise<Instruction> {
  const activeBanks =
    opts.activeBanks ?? getActiveBalances(marginfiAccount.balances).map((b) => b.bankPk);

  return instructions.makePulseHealthIx(
    programAddress,
    { marginfiAccount: marginfiAccount.address, group: marginfiAccount.group },
    computeHealthAccounts(bankMap, activeBanks)
  );
}

/**
 * Integration refreshes plus `pulse_health`, placed after a deposit or repay so the program
 * rewrites the account's variable borrow premium rates from its collateral after the action.
 * See {@link needsPremiumRefresh} for when it's needed.
 *
 * Best-effort: returns no instructions when a bank to refresh has no venue state in
 * `bankMetadataMap`, since `pulse_health` skips the premium write when a leg can't be priced.
 */
export async function makePremiumRefreshIxs({
  programAddress,
  marginfiAccount,
  bankMap,
  bankMetadataMap,
  mandatoryBanks,
  excludedBanks,
}: MakePremiumRefreshIxsParams): Promise<Instruction[]> {
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
  const activeBanks = [
    ...getActiveBalances(marginfiAccount.balances)
      .map((b) => b.bankPk)
      .filter((bank) => !excludedBanks.includes(bank)),
    ...mandatoryBanks,
  ];
  const pulseIx = await makePulseHealthIx({
    programAddress,
    marginfiAccount,
    bankMap,
    opts: { activeBanks },
  });
  return [...refreshIxs, pulseIx];
}

/**
 * Appends the premium refresh ({@link makePremiumRefreshIxs}) to a deposit or repay that lands in
 * one transaction, and picks the lookup tables to compile it with. The refresh is left out when
 * `opts.skipPremiumRefresh` is set, no premium-bearing debt remains, venue state is missing, or
 * it would push the transaction past its size limit or MAX_ACCOUNT_LOCKS.
 * @returns The transaction's instructions and format (with the lookup tables it needs)
 */
export async function appendPremiumRefresh(
  params: AppendPremiumRefreshParams
): Promise<{ instructions: Instruction[]; txFormat: TransactionFormat }> {
  const { actionIxs, marginfiAccount, bankMap, bank, txFormat, excludedBanks } = params;
  const actionOnly = { instructions: actionIxs, txFormat: selectLutsForBanks(txFormat, [bank]) };
  if (
    params.opts?.skipPremiumRefresh ||
    !needsPremiumRefresh(marginfiAccount, bankMap, excludedBanks)
  ) {
    return actionOnly;
  }

  const premiumIxs = await makePremiumRefreshIxs(params);
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
