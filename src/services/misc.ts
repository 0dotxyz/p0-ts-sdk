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

import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

import {
  BankIntegrationMetadata,
  BankIntegrationMetadataDto,
  BankIntegrationMetadataMap,
  BankIntegrationMetadataMapDto,
} from "~/types";

import {
  driftRewardsRawToDto,
  driftSpotMarketRawToDto,
  driftUserRawToDto,
  driftUserStatsRawToDto,
  dtoToDriftRewardsRaw,
  dtoToDriftSpotMarketRaw,
  dtoToDriftUserRaw,
  dtoToDriftUserStatsRaw,
  dtoToFarmRaw,
  dtoToObligationRaw,
  dtoToReserveRaw,
  farmRawToDto,
  obligationRawToDto,
  reserveRawToDto,
} from "../vendor";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "~/vendor/spl";

export function bankMetadataMapToDto(
  bankMetadataMap: BankIntegrationMetadataMap
): BankIntegrationMetadataMapDto {
  return Object.fromEntries(
    Object.entries(bankMetadataMap).map(([bankPk, bankMetadata]) => [
      bankPk,
      bankMetadataToDto(bankMetadata),
    ])
  );
}

export function dtoToBankMetadataMap(
  bankMetadataDto: BankIntegrationMetadataMapDto
): BankIntegrationMetadataMap {
  return Object.fromEntries(
    Object.entries(bankMetadataDto).map(([bankPk, bankMetadataDto]) => [
      bankPk,
      dtoToBankMetadata(bankMetadataDto),
    ])
  );
}

export function dtoToBankMetadata(
  bankMetadataDto: BankIntegrationMetadataDto
): BankIntegrationMetadata {
  return {
    kaminoStates: bankMetadataDto.kaminoStates
      ? {
          reserveState: dtoToReserveRaw(bankMetadataDto.kaminoStates.reserveState),
          obligationState: dtoToObligationRaw(bankMetadataDto.kaminoStates.obligationState),
          farmState: bankMetadataDto.kaminoStates.farmState
            ? dtoToFarmRaw(bankMetadataDto.kaminoStates.farmState)
            : undefined,
        }
      : undefined,
    driftStates: bankMetadataDto.driftStates
      ? {
          spotMarketState: dtoToDriftSpotMarketRaw(bankMetadataDto.driftStates.spotMarketState),
          userState: dtoToDriftUserRaw(bankMetadataDto.driftStates.userState),
          userRewards: bankMetadataDto.driftStates.userRewards.map(dtoToDriftRewardsRaw),
          userStatsState: bankMetadataDto.driftStates.userStatsState
            ? dtoToDriftUserStatsRaw(bankMetadataDto.driftStates.userStatsState)
            : undefined,
        }
      : undefined,
  };
}

export function bankMetadataToDto(
  bankMetadata: BankIntegrationMetadata
): BankIntegrationMetadataDto {
  return {
    kaminoStates: bankMetadata.kaminoStates
      ? {
          reserveState: reserveRawToDto(bankMetadata.kaminoStates.reserveState),
          obligationState: obligationRawToDto(bankMetadata.kaminoStates.obligationState),
          farmState: bankMetadata.kaminoStates.farmState
            ? farmRawToDto(bankMetadata.kaminoStates.farmState)
            : undefined,
        }
      : undefined,
    driftStates: bankMetadata.driftStates
      ? {
          spotMarketState: driftSpotMarketRawToDto(bankMetadata.driftStates.spotMarketState),
          userState: driftUserRawToDto(bankMetadata.driftStates.userState),
          userRewards: bankMetadata.driftStates.userRewards.map(driftRewardsRawToDto),
          userStatsState: bankMetadata.driftStates.userStatsState
            ? driftUserStatsRawToDto(bankMetadata.driftStates.userStatsState)
            : undefined,
        }
      : undefined,
  };
}

export async function fetchProgramForMints(connection: Connection, mintAddress: PublicKey[]) {
  const chunkSize = 100;
  const mintData: {
    mint: PublicKey;
    program: PublicKey;
  }[] = [];

  for (let i = 0; i < mintAddress.length; i += chunkSize) {
    const chunk = mintAddress.slice(i, i + chunkSize);
    const infos = await connection.getMultipleAccountsInfo(chunk);

    infos.forEach((info, idx) => {
      const mint = chunk[idx];
      if (info && mint) {
        const program = info.owner;
        if (program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID)) {
          mintData.push({ mint, program });
        }
      }
    });
  }

  return mintData;
}

/* BATCH ACCOUNT FECTHING LOGIC */

interface Result {
  jsonrpc: string;
  result: {
    context: { slot: number };
    value: Array<AccountInfo<string[]> | null>;
  };
}

export async function chunkedGetRawMultipleAccountInfos(
  connection: Connection,
  pks: string[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<[number, Map<string, AccountInfo<Buffer>>]> {
  const accountInfoMap = new Map<string, AccountInfo<Buffer>>();
  let contextSlot = 0;

  const batches = chunkArray(pks, batchChunkSize);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const batchRequest = chunkArray(batch, maxAccountsChunkSize).map((pubkeys) => ({
      methodName: "getMultipleAccounts",
      args: connection._buildArgs([pubkeys], "confirmed", "base64"),
    }));

    let accountInfos: Array<AccountInfo<string[]> | null> = [];
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries && accountInfos.length === 0) {
      try {
        accountInfos = await connection
          // @ts-ignore
          ._rpcBatchRequest(batchRequest)
          .then((batchResults: Result[]) => {
            contextSlot = Math.max(...batchResults.map((res) => res.result.context.slot));

            const accounts = batchResults.reduce(
              (acc, res) => {
                acc.push(...res.result.value);
                return acc;
              },
              [] as Result["result"]["value"]
            );

            return accounts;
          });
      } catch (error) {
        retries++;
      }
    }

    if (accountInfos.length === 0) {
      throw new Error(`Failed to fetch account infos after ${maxRetries} retries`);
    }

    accountInfos.forEach((item, index) => {
      const publicKey = batch[index];
      if (item) {
        accountInfoMap.set(publicKey, {
          ...item,
          owner: new PublicKey(item.owner),
          data: Buffer.from(item.data[0], "base64"),
        });
      }
    });
  }

  return [contextSlot, accountInfoMap];
}

export async function chunkedGetRawMultipleAccountInfoOrderedWithNulls(
  connection: Connection,
  pks: string[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<Array<AccountInfo<Buffer> | null>> {
  const allAccountInfos: Array<AccountInfo<Buffer> | null> = [];

  const batches = chunkArray(pks, batchChunkSize);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const batchRequest = chunkArray(batch, maxAccountsChunkSize).map((pubkeys) => ({
      methodName: "getMultipleAccounts",
      args: connection._buildArgs([pubkeys], "confirmed", "base64"),
    }));

    let accountInfos: Array<AccountInfo<string[]> | null> = [];
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries && accountInfos.length === 0) {
      try {
        accountInfos = await connection
          // @ts-ignore
          ._rpcBatchRequest(batchRequest)
          .then((batchResults: Result[]) => {
            const accounts = batchResults.reduce(
              (acc, res) => {
                acc.push(...res.result.value);
                return acc;
              },
              [] as Result["result"]["value"]
            );

            return accounts;
          });
      } catch (error) {
        retries++;
      }
    }

    if (accountInfos.length === 0) {
      throw new Error(`Failed to fetch account infos after ${maxRetries} retries`);
    }

    accountInfos.forEach((item) => {
      if (item) {
        allAccountInfos.push({
          ...item,
          owner: new PublicKey(item.owner),
          data: Buffer.from(item.data[0], "base64"),
        });
      } else {
        allAccountInfos.push(null);
      }
    });
  }

  return allAccountInfos;
}

export async function chunkedGetRawMultipleAccountInfoOrdered(
  connection: Connection,
  pks: string[],
  batchChunkSize: number = 1000,
  maxAccountsChunkSize: number = 100
): Promise<Array<AccountInfo<Buffer>>> {
  const allAccountInfos: Array<AccountInfo<Buffer>> = [];

  const batches = chunkArray(pks, batchChunkSize);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const batchRequest = chunkArray(batch, maxAccountsChunkSize).map((pubkeys) => ({
      methodName: "getMultipleAccounts",
      args: connection._buildArgs([pubkeys], "confirmed", "base64"),
    }));

    let accountInfos: Array<AccountInfo<string[]> | null> = [];
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries && accountInfos.length === 0) {
      try {
        accountInfos = await connection
          // @ts-ignore
          ._rpcBatchRequest(batchRequest)
          .then((batchResults: Result[]) => {
            const accounts = batchResults.reduce(
              (acc, res) => {
                acc.push(...res.result.value);
                return acc;
              },
              [] as Result["result"]["value"]
            );

            return accounts;
          });
      } catch (error) {
        retries++;
      }
    }

    if (accountInfos.length === 0) {
      throw new Error(`Failed to fetch account infos after ${maxRetries} retries`);
    }

    accountInfos.forEach((item) => {
      if (item) {
        allAccountInfos.push({
          ...item,
          owner: new PublicKey(item.owner),
          data: Buffer.from(item.data[0], "base64"),
        });
      }
    });
  }

  return allAccountInfos;
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
