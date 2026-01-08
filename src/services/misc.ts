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

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@mrgnlabs/mrgn-common";

import {
  BankIntegrationMetadata,
  BankIntegrationMetadataDto,
  BankIntegrationMetadataMap,
  BankIntegrationMetadataMapDto,
} from "~/types";

import {
  dtoToFarmRaw,
  dtoToObligationRaw,
  dtoToReserveRaw,
  farmRawToDto,
  obligationRawToDto,
  reserveRawToDto,
} from "../vendor";

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
          reserveState: dtoToReserveRaw(
            bankMetadataDto.kaminoStates.reserveState
          ),
          obligationState: dtoToObligationRaw(
            bankMetadataDto.kaminoStates.obligationState
          ),
          farmState: bankMetadataDto.kaminoStates.farmState
            ? dtoToFarmRaw(bankMetadataDto.kaminoStates.farmState)
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
          obligationState: obligationRawToDto(
            bankMetadata.kaminoStates.obligationState
          ),
          farmState: bankMetadata.kaminoStates.farmState
            ? farmRawToDto(bankMetadata.kaminoStates.farmState)
            : undefined,
        }
      : undefined,
  };
}

export async function fetchProgramForMints(
  connection: Connection,
  mintAddress: PublicKey[]
) {
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
        if (
          program.equals(TOKEN_PROGRAM_ID) ||
          program.equals(TOKEN_2022_PROGRAM_ID)
        ) {
          mintData.push({ mint, program });
        }
      }
    });
  }

  return mintData;
}
