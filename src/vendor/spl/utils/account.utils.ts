import { struct, u32, u8 } from "@solana/buffer-layout";
import { publicKey, u64 } from "@solana/buffer-layout-utils";
import { AccountInfo, Commitment, Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

import { Account, AccountState, RawAccount } from "../types";
import {
  TokenAccountNotFoundError,
  TokenInvalidAccountError,
  TokenInvalidAccountOwnerError,
  TokenInvalidAccountSizeError,
} from "../errors";
import { MULTISIG_SIZE } from "./multisig.utils";
import { TOKEN_PROGRAM_ID } from "../constants";

export enum SplAccountType {
  Uninitialized,
  Mint,
  Account,
}

export const ACCOUNT_TYPE_SIZE = 1;

/** Buffer layout for de/serializing a token account */
export const AccountLayout = struct<RawAccount>([
  publicKey("mint"),
  publicKey("owner"),
  u64("amount"),
  u32("delegateOption"),
  publicKey("delegate"),
  u8("state"),
  u32("isNativeOption"),
  u64("isNative"),
  u64("delegatedAmount"),
  u32("closeAuthorityOption"),
  publicKey("closeAuthority"),
]);

/** Byte length of a token account */
export const ACCOUNT_SIZE = AccountLayout.span;

export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/**
 * Retrieve information about a token account
 *
 * @param connection Connection to use
 * @param address    Token account
 * @param commitment Desired level of commitment for querying the state
 * @param programId  SPL Token program account
 *
 * @return Token account information
 */
export async function getAccount(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment,
  programId = TOKEN_PROGRAM_ID
): Promise<Account> {
  const info = await connection.getAccountInfo(address, commitment);
  return unpackAccount(address, info, programId);
}

/**
 * Retrieve information about multiple token accounts in a single RPC call
 *
 * @param connection Connection to use
 * @param addresses  Token accounts
 * @param commitment Desired level of commitment for querying the state
 * @param programId  SPL Token program account
 *
 * @return Token account information
 */
export async function getMultipleAccounts(
  connection: Connection,
  addresses: PublicKey[],
  commitment?: Commitment,
  programId = TOKEN_PROGRAM_ID
): Promise<Account[]> {
  const infos = await connection.getMultipleAccountsInfo(addresses, commitment);
  return addresses.map((address, i) =>
    //@ts-ignore
    unpackAccount(address, infos[i], programId)
  );
}

/** Get the minimum lamport balance for a base token account to be rent exempt
 *
 * @param connection Connection to use
 * @param commitment Desired level of commitment for querying the state
 *
 * @return Amount of lamports required
 */
export async function getMinimumBalanceForRentExemptAccount(
  connection: Connection,
  commitment?: Commitment
): Promise<number> {
  return await getMinimumBalanceForRentExemptAccountWithExtensions(connection, [], commitment);
}

export enum ExtensionType {
  Uninitialized,
  TransferFeeConfig,
  TransferFeeAmount,
  MintCloseAuthority,
  ConfidentialTransferMint,
  ConfidentialTransferAccount,
  DefaultAccountState,
  ImmutableOwner,
  MemoTransfer,
  NonTransferable,
  InterestBearingMint,
}

export function getAccountLen(extensionTypes: ExtensionType[]): number {
  return getLen(extensionTypes, ACCOUNT_SIZE);
}

export const TYPE_SIZE = 2;
export const LENGTH_SIZE = 2;

function getLen(extensionTypes: ExtensionType[], baseSize: number): number {
  if (extensionTypes.length === 0) {
    return baseSize;
  } else {
    const accountLength = ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE;
    if (accountLength === MULTISIG_SIZE) {
      return accountLength + TYPE_SIZE;
    } else {
      return accountLength;
    }
  }
}

/** Get the minimum lamport balance for a rent-exempt token account with extensions
 *
 * @param connection Connection to use
 * @param extensions
 * @param commitment Desired level of commitment for querying the state
 *
 * @return Amount of lamports required
 */
export async function getMinimumBalanceForRentExemptAccountWithExtensions(
  connection: Connection,
  extensions: ExtensionType[],
  commitment?: Commitment
): Promise<number> {
  const accountLen = getAccountLen(extensions);
  return await connection.getMinimumBalanceForRentExemption(accountLen, commitment);
}

/**
 * Unpack a token account
 *
 * @param address   Token account
 * @param info      Token account data
 * @param programId SPL Token program account
 *
 * @return Unpacked token account
 */
export function unpackAccount(
  address: PublicKey,
  info: AccountInfo<Buffer> | null,
  programId = TOKEN_PROGRAM_ID
): Account {
  if (!info) throw new TokenAccountNotFoundError();
  if (!info.owner.equals(programId)) throw new TokenInvalidAccountOwnerError();
  if (info.data.length < ACCOUNT_SIZE) throw new TokenInvalidAccountSizeError();

  const rawAccount = AccountLayout.decode(info.data.slice(0, ACCOUNT_SIZE));
  let tlvData = Buffer.alloc(0);
  if (info.data.length > ACCOUNT_SIZE) {
    if (info.data.length === MULTISIG_SIZE) throw new TokenInvalidAccountSizeError();
    if (info.data[ACCOUNT_SIZE] != SplAccountType.Account) throw new TokenInvalidAccountError();
    tlvData = info.data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
  }

  return {
    address,
    mint: rawAccount.mint,
    owner: rawAccount.owner,
    amount: rawAccount.amount,
    delegate: rawAccount.delegateOption ? rawAccount.delegate : null,
    delegatedAmount: rawAccount.delegatedAmount,
    isInitialized: rawAccount.state !== AccountState.Uninitialized,
    isFrozen: rawAccount.state === AccountState.Frozen,
    isNative: !!rawAccount.isNativeOption,
    rentExemptReserve: rawAccount.isNativeOption ? rawAccount.isNative : null,
    closeAuthority: rawAccount.closeAuthorityOption ? rawAccount.closeAuthority : null,
    tlvData,
  };
}
