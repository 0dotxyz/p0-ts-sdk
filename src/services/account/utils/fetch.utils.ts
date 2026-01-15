import { Connection, PublicKey } from "@solana/web3.js";

import { deriveMarginfiAccount } from "~/utils";
import { BankIntegrationMetadataMap, MarginfiProgram } from "~/types";
import { BankType } from "~/services/bank";

import {
  HealthCacheSimulationError,
  MarginfiAccountRaw,
  MarginfiAccountType,
} from "../types";
import { simulateAccountHealthCache } from "../services";

import { parseMarginfiAccountRaw } from "./deserialize.utils";

export const fetchMarginfiAccountAddresses = async (
  program: MarginfiProgram,
  authority: PublicKey,
  group: PublicKey
): Promise<PublicKey[]> => {
  const marginfiAccounts = (
    await program.account.marginfiAccount.all([
      {
        memcmp: {
          bytes: group.toBase58(),
          offset: 8, // marginfiGroup is the first field in the account, so only offset is the discriminant
        },
      },
      {
        memcmp: {
          bytes: authority.toBase58(),
          offset: 8 + 32, // authority is the second field in the account after the authority, so offset by the discriminant and a pubkey
        },
      },
    ])
  ).map((a) => a.publicKey);

  return marginfiAccounts;
};

export const fetchMarginfiAccountData = async (
  program: MarginfiProgram,
  marginfiAccountPk: PublicKey,
  bankMap: Map<string, BankType>,
  bankMetadataMap?: BankIntegrationMetadataMap
): Promise<{
  marginfiAccount: MarginfiAccountType;
  error?: HealthCacheSimulationError;
}> => {
  const marginfiAccountRaw: MarginfiAccountRaw =
    await program.account.marginfiAccount.fetch(marginfiAccountPk, "confirmed");
  const marginfiAccount = parseMarginfiAccountRaw(
    marginfiAccountPk,
    marginfiAccountRaw
  );

  try {
    const simulatedAccount = await simulateAccountHealthCache({
      program,
      bankMap,
      marginfiAccountPk,
      balances: marginfiAccount.balances,
      bankMetadataMap,
    });

    const marginfiAccountWithCache = parseMarginfiAccountRaw(
      marginfiAccountPk,
      simulatedAccount
    );

    return { marginfiAccount: marginfiAccountWithCache };
  } catch (e) {
    console.error("Error simulating account health cache", e);
    if (e instanceof HealthCacheSimulationError) {
      return { marginfiAccount, error: e };
    }
    return { marginfiAccount };
  }
};

function randomDistinctIndices(count: number, maxExclusive: number): number[] {
  const chosen = new Set<number>();
  while (chosen.size < count) {
    chosen.add(Math.floor(Math.random() * maxExclusive));
  }
  return [...chosen];
}

/**
 * Generates a random available account index that doesn't collide with existing accounts.
 * Account indices are 0-255 (u8 range).
 *
 * @param connection - Solana connection
 * @param programId - MarginFi program ID
 * @param group - MarginFi group public key
 * @param authority - User's wallet public key
 * @param thirdPartyId - Third party ID (default 0)
 * @returns A random available account index (0-255)
 */
export async function findRandomAvailableAccountIndex(
  connection: Connection,
  programId: PublicKey,
  group: PublicKey,
  authority: PublicKey,
  thirdPartyId: number = 0
): Promise<number> {
  const MAX_INDEX = 255; // u8 range: 0-255
  const BATCH_SIZE = 16; // 16 or 32 is fine
  const MAX_ATTEMPTS = 8; // realisticly all accounts will be found in the first attempt

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. Pick a random batch of distinct indices in [0, 255]
    const indices = randomDistinctIndices(
      Math.min(BATCH_SIZE, MAX_INDEX),
      MAX_INDEX
    );

    // 2. Derive PDAs for these indices
    const pdas = indices.map(
      (i) =>
        deriveMarginfiAccount(programId, group, authority, i, thirdPartyId)[0]
    );

    // 3. Check which PDAs exist on-chain
    const accountInfos = await connection.getMultipleAccountsInfo(pdas);

    // 4. Find the first index whose PDA doesn't exist yet
    for (let i = 0; i < indices.length; i++) {
      const indice = indices[i];
      if (accountInfos[i] === null && indice !== undefined) {
        // This index is free right now
        return indice;
      }
    }
  }

  // If we get here, indices are taken, (create custom error)
  throw new Error("Unable to find free index after many attempts");
}
