import {
  AccountRole,
  assertAccountExists,
  fetchEncodedAccount,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import BigNumber from "bignumber.js";

import {
  HealthCacheStatus,
  MakeAccountTransferToNewAccountTxParams,
  MakeCloseAccountIxParams,
  MakeCloseAccountTxParams,
  MakeCreateAccountIxParams,
  MakeCreateAccountTxParams,
  MakeSetupIxParams,
  MarginfiAccountType,
} from "../types";
import { computeHealthAccountMetas, computeHealthCheckAccounts } from "../utils";

import { decodeFeeState } from "~/accounts";
import { DEFAULT_ADDRESS } from "~/constants";
import instructions from "~/instructions";
import { BankType } from "~/services/bank";
import { makeTransactionMessage, SolanaTransaction, TransactionType } from "~/services/transaction";
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
 */
export async function makeAccountTransferToNewAccountTx({
  rpc,
  programAddress,
  marginfiAccount,
  authority,
  newMarginfiAccount,
  newAuthority,
  feePayer = authority,
}: MakeAccountTransferToNewAccountTxParams): Promise<SolanaTransaction> {
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
    globalFeeWallet: decodeFeeState(feeStateAccount.data).globalFeeWallet,
    feeState: feeStateAddress,
  });

  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();

  return {
    message: makeTransactionMessage({ instructions: [transferIx], feePayer, latestBlockhash }),
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
 * @param params.rpc - RPC client, for the blockhash
 * @param params.programAddress - The marginfi program address
 * @param params.authority - Owner of the new account; signs and pays
 * @param params.group - The Marginfi group address
 * @param params.luts - Address lookup tables for the transaction
 * @param params.latestBlockhash - Optional recent blockhash (fetched if not provided)
 * @param params.accountIndex - Index in the account PDA seeds
 * @param params.thirdPartyId - Optional third-party id in the account PDA seeds
 * @returns Object containing the projected account and creation transaction
 */
export async function makeCreateAccountTxWithProjection(
  params: MakeCreateAccountTxParams
): Promise<{ account: MarginfiAccountType; tx: SolanaTransaction }> {
  const [marginfiAccountAddress] = await deriveMarginfiAccount(
    params.programAddress,
    params.group,
    params.authority.address,
    params.accountIndex,
    params.thirdPartyId
  );

  return {
    account: generateDummyAccount(params.group, params.authority.address, marginfiAccountAddress),
    tx: await makeCreateMarginfiAccountTx(params),
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

export async function makeCreateMarginfiAccountTx({
  rpc,
  luts,
  latestBlockhash,
  ...createIxParams
}: MakeCreateAccountTxParams): Promise<SolanaTransaction> {
  const initMarginfiAccountIx = await makeCreateMarginfiAccountIx(createIxParams);

  return {
    message: makeTransactionMessage({
      instructions: [initMarginfiAccountIx],
      feePayer: createIxParams.authority,
      latestBlockhash:
        latestBlockhash ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
      luts,
    }),
    type: TransactionType.CREATE_ACCOUNT,
  };
}

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

export async function makePulseHealthIx(
  programAddress: Address,
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  mandatoryBanks: Address[],
  excludedBanks: Address[]
): Promise<Instruction[]> {
  const healthAccounts = computeHealthCheckAccounts({
    account: marginfiAccount,
    banksMap: banks,
    mandatoryBanks,
    excludedBanks,
  });
  const accountMetas = computeHealthAccountMetas({ banksToInclude: healthAccounts });

  const ix = await instructions.makePulseHealthIx(
    programAddress,
    { marginfiAccount: marginfiAccount.address, group: marginfiAccount.group },
    accountMetas.map((address) => ({ address, role: AccountRole.READONLY }))
  );

  return [ix];
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
      assetShares: new BigNumber(0),
      liabilityShares: new BigNumber(0),
      emissionsOutstanding: new BigNumber(0),
      lastUpdate: 0,
    })),
    accountFlags: [],
    emissionsDestinationAccount: DEFAULT_ADDRESS,
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
  };
}
