import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BigNumber from "bignumber.js";
import BN from "bn.js";

import {
  AccountFlags,
  BalanceRaw,
  MakeAccountTransferToNewAccountTxParams,
  MakeCloseAccountIxParams,
  MakeCloseAccountTxParams,
  MakeSetupIxParams,
  MarginfiAccountRaw,
  MarginfiAccountType,
  PremiumRefreshParams,
} from "../types";
import {
  computeHealthAccountMetas,
  computeHealthCheckAccounts,
  needsPremiumRefresh,
  parseMarginfiAccountRaw,
} from "../utils";

import { BUNDLE_TX_SIZE, MAX_ACCOUNT_LOCKS, PRIORITY_TX_SIZE } from "~/constants";
import { TransactionBuildingError, TransactionBuildingErrorCode } from "~/errors";
import instructions from "~/instructions";
import { BankType } from "~/services/bank";
import { makeRefreshIntegrationBanksIxs } from "~/services/price";
import {
  addTransactionMetadata,
  ExtendedV0Transaction,
  fitsInOneTransaction,
  selectLutsForAccountAction,
  selectLutsForBanks,
  SolanaTransaction,
  TransactionType,
} from "~/services/transaction";
import { MarginfiProgram } from "~/types";
import { bigNumberToWrappedI80F48, deriveMarginfiAccount } from "~/utils";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "~/vendor/spl";

/**
 * Creates an instruction to close a Marginfi account.
 *
 * Generates the instruction needed to close an existing Marginfi account and reclaim rent.
 * The account must have no active balances before it can be closed.
 *
 * @param params - Configuration object
 * @param params.program - The Marginfi program instance
 * @param params.marginfiAccount - The Marginfi account to close
 * @param params.authority - The authority/owner of the account
 * @returns Instruction to close the account
 */
export async function makeCloseMarginfiAccountIx({
  program,
  marginfiAccount,
  authority,
}: MakeCloseAccountIxParams) {
  const closeIx = await instructions.makeCloseAccountIx(program, {
    marginfiAccount: marginfiAccount.address,
    feePayer: authority,
  });

  return closeIx;
}

/**
 * Creates a transaction to close a Marginfi account.
 *
 * Generates a complete transaction to close an existing Marginfi account and reclaim rent.
 * The account must have no active balances before it can be closed.
 *
 * @param params - Configuration object
 * @param params.connection - Solana connection instance
 * @param params.program - The Marginfi program instance
 * @param params.marginfiAccount - The Marginfi account to close
 * @param params.authority - The authority/owner of the account
 * @returns Versioned transaction to close the account
 */
export async function makeCloseMarginfiAccountTx({
  connection,
  program,
  marginfiAccount,
  authority,
}: MakeCloseAccountTxParams) {
  const closeIx = await instructions.makeCloseAccountIx(program, {
    marginfiAccount: marginfiAccount.address,
    feePayer: authority,
  });

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  const closeTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [closeIx],
        payerKey: authority,
        recentBlockhash: blockhash,
      }).compileToV0Message([])
    ),
    {
      signers: [],
      addressLookupTables: [],
      type: TransactionType.CLOSE_ACCOUNT,
    }
  );

  return closeTx;
}

/**
 * Creates a transaction to transfer a Marginfi account to a new authority.
 *
 * Migrates the account's positions into a brand-new account (`newMarginfiAccount`)
 * owned by `newAuthority`; the old account is left disabled. The new-account
 * keypair signs to create itself, the current authority (the program's provider
 * wallet) signs to authorize, and `feePayer` pays. `globalFeeWallet` is resolved
 * from the program's fee state — matching the marginfi implementation.
 *
 * @param params - Configuration object
 * @param params.connection - Solana connection instance
 * @param params.program - The Marginfi program instance
 * @param params.marginfiAccount - The account being transferred
 * @param params.newMarginfiAccount - Freshly generated keypair for the destination account
 * @param params.newAuthority - The wallet that will own the new account
 * @param params.feePayer - Optional. Pays rent/fees. A `PublicKey` signs via the
 *   wallet adapter; a `Keypair` is a separate fee payer that signs directly.
 *   Defaults to the account's current authority.
 * @returns Versioned transaction to transfer the account
 * @throws TransactionBuildingError (ACCOUNT_DISABLED) when the account is disabled, e.g. already transferred
 */
export async function makeAccountTransferToNewAccountTx({
  connection,
  program,
  marginfiAccount,
  newMarginfiAccount,
  newAuthority,
  feePayer,
}: MakeAccountTransferToNewAccountTxParams): Promise<ExtendedV0Transaction> {
  if (marginfiAccount.accountFlags.includes(AccountFlags.ACCOUNT_DISABLED)) {
    throw TransactionBuildingError.accountDisabled(marginfiAccount.address.toBase58());
  }

  const feePayerKey =
    feePayer instanceof Keypair ? feePayer.publicKey : (feePayer ?? marginfiAccount.authority);

  const [feeStateKey] = PublicKey.findProgramAddressSync(
    [Buffer.from("feestate", "utf-8")],
    program.programId
  );
  const feeState = await program.account.feeState.fetch(feeStateKey);

  const transferIx = await instructions.makeAccountTransferToNewAccountIx(program, {
    oldMarginfiAccount: marginfiAccount.address,
    newMarginfiAccount: newMarginfiAccount.publicKey,
    newAuthority,
    globalFeeWallet: feeState.globalFeeWallet,
    feePayer: feePayerKey,
  });

  const {
    value: { blockhash },
  } = await connection.getLatestBlockhashAndContext("confirmed");

  // The new-account keypair always signs; a separate fee-payer Keypair signs too.
  // A PublicKey fee payer (or the default authority) signs via the wallet adapter.
  const signers: Signer[] = [newMarginfiAccount];
  if (feePayer instanceof Keypair) signers.push(feePayer);

  const transferTx = addTransactionMetadata(
    new VersionedTransaction(
      new TransactionMessage({
        instructions: [transferIx],
        payerKey: feePayerKey,
        recentBlockhash: blockhash,
      }).compileToV0Message([])
    ),
    {
      signers,
      addressLookupTables: [],
      type: TransactionType.TRANSFER_AUTH,
    }
  );

  return transferTx;
}

/**
 * Creates a new Marginfi account transaction with a projected account instance.
 *
 * Generates a transaction to create a new Marginfi account and returns a projected account instance
 * that can be used for operations before the account actually exists on-chain.
 *
 * @param props - Configuration object
 * @param props.program - The Marginfi program instance
 * @param props.authority - The authority public key for the new account
 * @param props.group - The Marginfi group public key
 * @param props.addressLookupTables - Address lookup tables for the transaction
 * @returns Object containing the projected account and creation transaction
 */
export async function makeCreateAccountTxWithProjection(props: {
  program: MarginfiProgram;
  authority: PublicKey;
  group: PublicKey;
  addressLookupTables: AddressLookupTableAccount[];
  accountIndex: number;
  thirdPartyId?: number;
}): Promise<{ account: MarginfiAccountType; tx: SolanaTransaction }> {
  const [marginfiAccountAddress] = deriveMarginfiAccount(
    props.program.programId,
    props.group,
    props.authority,
    props.accountIndex,
    props.thirdPartyId
  );

  const account = generateDummyAccount(props.group, props.authority, marginfiAccountAddress);
  const tx = await makeCreateMarginfiAccountTx(
    props.program,
    props.authority,
    props.group,
    props.addressLookupTables,
    props.accountIndex,
    props.thirdPartyId
  );

  return {
    account,
    tx,
  };
}

/**
 * Creates a new Marginfi account instruction with a projected account instance.
 *
 * Generates an instruction to create a new Marginfi account and returns a projected account instance
 * that can be used for operations before the account actually exists on-chain.
 *
 * @param props - Configuration object
 * @param props.program - The Marginfi program instance
 * @param props.authority - The authority public key for the new account
 * @param props.group - The Marginfi group public key
 * @returns Object containing the projected account and creation instruction
 */
export async function makeCreateAccountIxWithProjection(props: {
  program: MarginfiProgram;
  authority: PublicKey;
  group: PublicKey;
  accountIndex: number;
  thirdPartyId?: number;
}): Promise<{ account: MarginfiAccountType; ix: TransactionInstruction }> {
  const [marginfiAccountAddress] = deriveMarginfiAccount(
    props.program.programId,
    props.group,
    props.authority,
    props.accountIndex,
    props.thirdPartyId
  );

  const account = generateDummyAccount(props.group, props.authority, marginfiAccountAddress);
  const ix = await makeCreateMarginfiAccountIx(
    props.program,
    props.authority,
    props.group,
    props.accountIndex,
    props.thirdPartyId
  );

  return {
    account,
    ix,
  };
}

export async function makeCreateMarginfiAccountTx(
  program: MarginfiProgram,
  authority: PublicKey,
  groupAddress: PublicKey,
  addressLookupTables: AddressLookupTableAccount[],
  accountIndex: number,
  thirdPartyId?: number
): Promise<SolanaTransaction> {
  const [marginfiAccountAddress] = deriveMarginfiAccount(
    program.programId,
    groupAddress,
    authority,
    accountIndex,
    thirdPartyId
  );

  const initMarginfiAccountIx = await instructions.makeInitMarginfiAccountPdaIx(
    program,
    {
      marginfiGroup: groupAddress,
      marginfiAccount: marginfiAccountAddress,
      authority,
      feePayer: authority,
    },
    {
      accountIndex,
      thirdPartyId,
    }
  );

  const ixs = [initMarginfiAccountIx];

  const signers: Keypair[] = [];

  const tx = new Transaction().add(...ixs);
  tx.feePayer = authority;
  const solanaTx = addTransactionMetadata(tx, {
    signers,
    addressLookupTables,
    type: TransactionType.CREATE_ACCOUNT,
  });

  return solanaTx;
}

export async function makeCreateMarginfiAccountIx(
  program: MarginfiProgram,
  authority: PublicKey,
  groupAddress: PublicKey,
  accountIndex: number,
  thirdPartyId?: number
): Promise<TransactionInstruction> {
  const [marginfiAccountAddress] = deriveMarginfiAccount(
    program.programId,
    groupAddress,
    authority,
    accountIndex,
    thirdPartyId
  );

  const initMarginfiAccountIx = await instructions.makeInitMarginfiAccountPdaIx(
    program,
    {
      marginfiGroup: groupAddress,
      marginfiAccount: marginfiAccountAddress,
      authority,
      feePayer: authority,
    },
    {
      accountIndex,
      thirdPartyId,
    }
  );

  return initMarginfiAccountIx;
}

export async function makeSetupIx({ connection, authority, tokens }: MakeSetupIxParams) {
  try {
    // Filter out duplicate mints
    const uniqueTokens = tokens.filter(
      (token, index, self) => index === self.findIndex((t) => t.mint.equals(token.mint))
    );

    const userAtas = uniqueTokens.map((token) => {
      return getAssociatedTokenAddressSync(
        new PublicKey(token.mint),
        authority,
        true,
        token.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
      );
    });

    const ixs = [];
    const userAtaAis = await connection.getMultipleAccountsInfo(userAtas);

    for (const [i, userAta] of userAtaAis.entries()) {
      // Index against `uniqueTokens` (which `userAtas` was derived from) — not `tokens` — so a
      // duplicate mint in the input doesn't misalign the ATA address with the mint and produce
      // an invalid-seeds create.
      const token = uniqueTokens[i];
      const userAtaAddress = userAtas[i];
      if (userAta === null && token && userAtaAddress) {
        ixs.push(
          createAssociatedTokenAccountIdempotentInstruction(
            authority,
            userAtaAddress,
            authority,
            new PublicKey(token.mint),
            token.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : undefined
          )
        );
      }
    }

    return ixs;
  } catch (error) {
    console.error("[makeSetupIx] Failed to create setup instructions:", error);
    return [];
  }
}

export async function makePulseHealthIx(
  program: MarginfiProgram,
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  mandatoryBanks: PublicKey[],
  excludedBanks: PublicKey[]
) {
  const healthAccounts = computeHealthCheckAccounts({
    account: marginfiAccount,
    banksMap: banks,
    mandatoryBanks,
    excludedBanks,
  });
  const accountMetas = computeHealthAccountMetas({ banksToInclude: healthAccounts });

  // const sortIx = await instructions.makeLendingAccountSortBalancesIx(program, {
  //   marginfiAccount: marginfiAccountPk,
  // });

  const ix = await instructions.makePulseHealthIx(
    program,
    {
      marginfiAccount: marginfiAccount.address,
      group: marginfiAccount.group,
    },
    accountMetas.map((account) => ({
      pubkey: account,
      isSigner: false,
      isWritable: false,
    }))
  );

  return { instructions: [ix], keys: [] };
}

/**
 * Integration refreshes plus `pulse_health`, placed after a deposit or repay so the program
 * rewrites the account's variable borrow premium rates from its collateral after the action.
 * See {@link needsPremiumRefresh} for when it's needed.
 *
 * Best-effort: returns no instructions when a bank to refresh has no venue state in
 * `bankMetadataMap`, since `pulse_health` skips the premium write when a leg can't be priced.
 *
 * @param program - The Marginfi program instance
 * @param state - The account (before the action), bank map and venue state
 * @param mandatoryBanks - Banks the action opens (the deposited bank)
 * @param excludedBanks - Banks the action closes (fully repaid banks)
 * @returns Instructions to append after the action
 */
export async function makePremiumRefreshIxs(
  program: MarginfiProgram,
  { marginfiAccount, bankMap, bankMetadataMap }: PremiumRefreshParams,
  mandatoryBanks: PublicKey[],
  excludedBanks: PublicKey[]
): Promise<TransactionInstruction[]> {
  let refreshIxs: TransactionInstruction[];
  try {
    refreshIxs = makeRefreshIntegrationBanksIxs(
      marginfiAccount,
      bankMap,
      [],
      bankMetadataMap,
      mandatoryBanks
    ).instructions;
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
    program,
    marginfiAccount,
    bankMap,
    mandatoryBanks,
    excludedBanks
  );
  return [...refreshIxs, ...pulseIxs.instructions];
}

/**
 * Appends the premium refresh ({@link makePremiumRefreshIxs}) to a deposit or repay that lands in
 * one transaction, and picks the lookup tables to compile it with. The refresh is left out when
 * `opts.skipPremiumRefresh` is set, no premium-bearing debt remains, venue state is missing, or
 * it would push the transaction past MAX_TX_SIZE / MAX_ACCOUNT_LOCKS.
 *
 * @param params - The builder's params: account (before the action), bank map, venue state,
 * acted-on bank, authority and lookup tables
 * @param actionIxs - The action's instructions
 * @param mandatoryBanks - Banks the action opens (the deposited bank)
 * @param excludedBanks - Banks the action closes (fully repaid banks)
 * @returns The transaction's instructions and lookup tables
 */
export async function appendPremiumRefresh(
  params: PremiumRefreshParams & {
    program: MarginfiProgram;
    bank: BankType;
    authority: PublicKey;
    luts: AddressLookupTableAccount[];
    opts?: { skipPremiumRefresh?: boolean };
  },
  actionIxs: TransactionInstruction[],
  mandatoryBanks: PublicKey[],
  excludedBanks: PublicKey[]
): Promise<{ instructions: TransactionInstruction[]; luts: AddressLookupTableAccount[] }> {
  const { marginfiAccount, bankMap, bank, luts } = params;
  const actionOnly = { instructions: actionIxs, luts: selectLutsForBanks(luts, [bank]) };
  if (
    params.opts?.skipPremiumRefresh ||
    !needsPremiumRefresh(marginfiAccount, bankMap, excludedBanks)
  ) {
    return actionOnly;
  }

  const premiumIxs = await makePremiumRefreshIxs(
    params.program,
    params,
    mandatoryBanks,
    excludedBanks
  );
  const withPremium = {
    instructions: [...actionIxs, ...premiumIxs],
    luts: selectLutsForAccountAction(luts, bank, marginfiAccount.balances, bankMap),
  };
  // Leaves room for what the send pipeline appends: compute-budget and priority-fee ixs, and in
  // bundles a Jito tip, which lock the ComputeBudget program, tip account and System program
  const fits =
    premiumIxs.length > 0 &&
    fitsInOneTransaction(withPremium.instructions, {
      payerKey: params.authority,
      luts: withPremium.luts,
      sizeMargin: PRIORITY_TX_SIZE + BUNDLE_TX_SIZE,
      maxAccountLocks: MAX_ACCOUNT_LOCKS - 3,
    });
  return fits ? withPremium : actionOnly;
}

export function generateDummyAccount(
  group: PublicKey,
  authority: PublicKey,
  accountKey: PublicKey
) {
  // create a dummy account with 15 empty balances to be used in other transactions
  const dummyWrappedI80F48 = bigNumberToWrappedI80F48(new BigNumber(0));
  const dummyBalances: BalanceRaw[] = Array(15).fill({
    active: false,
    bankPk: new PublicKey("11111111111111111111111111111111"),
    tag: 0,
    assetShares: dummyWrappedI80F48,
    liabilityShares: dummyWrappedI80F48,
    premiumRateSnapshot: 0,
    premiumOutstanding: dummyWrappedI80F48,
    lastUpdate: new BN(0),
  });
  const rawAccount: MarginfiAccountRaw = {
    group: group,
    authority: authority,
    lendingAccount: { balances: dummyBalances, lastTagUsed: 0 },
    healthCache: {
      assetValue: {
        value: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      liabilityValue: {
        value: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      timestamp: new BN(0),
      flags: 0,
      prices: [],
      assetValueMaint: bigNumberToWrappedI80F48(new BigNumber(0)),
      liabilityValueMaint: bigNumberToWrappedI80F48(new BigNumber(0)),
      assetValueEquity: bigNumberToWrappedI80F48(new BigNumber(0)),
      liabilityValueEquity: bigNumberToWrappedI80F48(new BigNumber(0)),
      errIndex: 0,
      internalErr: 0,
      internalBankruptcyErr: 0,
      internalLiqErr: 0,
      mrgnErr: 0,
    },
    emissionsDestinationAccount: new PublicKey("11111111111111111111111111111111"),
    accountFlags: new BN([0, 0, 0]),
    activeOrders: 0,
  };

  return parseMarginfiAccountRaw(accountKey, rawAccount);
}
