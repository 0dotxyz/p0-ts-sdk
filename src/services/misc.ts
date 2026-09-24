/**
 * Temporary Module for Functions Pending Refactoring
 *
 * This file serves as a temporary staging area for utility functions that need proper
 * categorization and relocation to their appropriate service modules. All functions
 * placed here should include:
 *
 * IMPORTANT: Do not add new features to functions in this file. Instead, refactor
 * them to their proper location first, then implement new functionality.
 */

import {
  parseBase64RpcAccount,
  type Address,
  type EncodedAccount,
  type GetMultipleAccountsApi,
  type Rpc,
  type Slot,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import { TOKEN_2022_PROGRAM_ID } from "~/constants";

export async function fetchProgramForMints(
  rpc: Rpc<GetMultipleAccountsApi>,
  mintAddresses: Address[]
) {
  const mintData: {
    mint: Address;
    program: Address;
  }[] = [];

  const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(rpc, mintAddresses);
  for (const account of accounts) {
    if (
      account &&
      (account.programAddress === TOKEN_PROGRAM_ADDRESS ||
        account.programAddress === TOKEN_2022_PROGRAM_ID)
    ) {
      mintData.push({ mint: account.address, program: account.programAddress });
    }
  }

  return mintData;
}

/* BATCH ACCOUNT FECTHING LOGIC */

const MAX_RETRIES = 3;

async function fetchAccountsInBatches(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number,
  maxAccountsChunkSize: number
): Promise<{ slot: Slot; accounts: (EncodedAccount | null)[] }> {
  let slot = 0n;
  const accounts: (EncodedAccount | null)[] = [];

  for (const batch of chunkArray(addresses, batchChunkSize)) {
    const chunks = chunkArray(batch, maxAccountsChunkSize);

    for (let attempt = 1; ; attempt++) {
      try {
        const responses = await Promise.all(
          chunks.map((chunk) =>
            rpc.getMultipleAccounts(chunk, { commitment: "confirmed", encoding: "base64" }).send()
          )
        );
        responses.forEach((response, chunkIndex) => {
          slot = response.context.slot > slot ? response.context.slot : slot;
          response.value.forEach((rpcAccount, index) => {
            const account = parseBase64RpcAccount(chunks[chunkIndex][index], rpcAccount);
            accounts.push(account.exists ? account : null);
          });
        });
        break;
      } catch {
        if (attempt === MAX_RETRIES) {
          throw new Error(`Failed to fetch account infos after ${MAX_RETRIES} retries`);
        }
      }
    }
  }

  return { slot, accounts };
}

export async function chunkedGetRawMultipleAccountInfos(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<[Slot, Map<Address, EncodedAccount>]> {
  const { slot, accounts } = await fetchAccountsInBatches(
    rpc,
    addresses,
    batchChunkSize,
    maxAccountsChunkSize
  );
  const accountInfoMap = new Map<Address, EncodedAccount>();

  for (const account of accounts) {
    if (account) {
      accountInfoMap.set(account.address, account);
    }
  }

  return [slot, accountInfoMap];
}

export async function chunkedGetRawMultipleAccountInfoOrderedWithNulls(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<(EncodedAccount | null)[]> {
  const { accounts } = await fetchAccountsInBatches(
    rpc,
    addresses,
    batchChunkSize,
    maxAccountsChunkSize
  );
  return accounts;
}

export async function chunkedGetRawMultipleAccountInfoOrdered(
  rpc: Rpc<GetMultipleAccountsApi>,
  addresses: Address[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<EncodedAccount[]> {
  const { accounts } = await fetchAccountsInBatches(
    rpc,
    addresses,
    batchChunkSize,
    maxAccountsChunkSize
  );
  return accounts.filter((account) => account !== null);
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
