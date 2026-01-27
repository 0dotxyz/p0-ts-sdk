import { Connection, PublicKey } from "@solana/web3.js";

import { Bank } from "~/models/bank";
import { AssetTag } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  ObligationRaw,
  ReserveRaw,
  FarmStateRaw,
  decodeKlendReserveData,
  decodeKlendObligationData,
  decodeFarmDataRaw,
} from "~/vendor/klend";

export interface KaminoMetadata {
  kaminoStates: {
    reserveState: ReserveRaw;
    obligationState: ObligationRaw;
    farmState?: FarmStateRaw;
  };
}

export interface FetchKaminoMetadataOptions {
  connection: Connection;
  banks: Bank[];
}

/**
 * Fetch Kamino reserve, obligation, and farm states for banks with Kamino integration
 *
 * This function:
 * 1. Filters banks that have Kamino reserves/obligations
 * 2. Batch fetches all reserve and obligation data in one RPC call
 * 3. Decodes reserve and obligation states
 * 4. Identifies farms from reserve.farmCollateral addresses
 * 5. Batch fetches and decodes farm states in a second RPC call
 * 6. Returns a complete map keyed by bank address
 *
 * @param options - Connection and banks to fetch metadata for
 * @returns Map of bank addresses to their complete Kamino metadata (reserve, obligation, farm)
 */
export async function fetchKaminoMetadata(
  options: FetchKaminoMetadataOptions
): Promise<Map<string, KaminoMetadata>> {
  const { connection, banks } = options;
  const kaminoMap = new Map<string, KaminoMetadata>();

  // Filter banks that have Kamino integration
  const kaminoBanks = banks.filter((b) => b.config.assetTag === AssetTag.KAMINO);

  if (kaminoBanks.length === 0) {
    return kaminoMap;
  }

  // Collect keys and track indices for parallel fetch
  const keysToFetch: PublicKey[] = [];
  const bankTuples: Array<{
    bankAddress: string;
    reserveIndex: number;
    obligationIndex: number;
  }> = [];

  for (const bank of kaminoBanks) {
    bankTuples.push({
      bankAddress: bank.address.toBase58(),
      reserveIndex: keysToFetch.length,
      obligationIndex: keysToFetch.length + 1,
    });
    const kaminoIntegrationAccounts = bank.kaminoIntegrationAccounts;

    if (kaminoIntegrationAccounts) {
      keysToFetch.push(
        kaminoIntegrationAccounts.kaminoReserve,
        kaminoIntegrationAccounts.kaminoObligation
      );
    } else {
      console.warn("Kamino data not found for bank: ", bank.address.toBase58());
    }
  }

  // Batch fetch all accounts in one RPC call
  const accountInfos = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    connection,
    keysToFetch.map((k) => k.toBase58())
  );

  // Decode and populate map, track farm collateral addresses
  const bankByFarmKey: Record<string, string> = {};

  for (const tuple of bankTuples) {
    const reserveInfo = accountInfos[tuple.reserveIndex];
    const obligationInfo = accountInfos[tuple.obligationIndex];

    if (!reserveInfo || !obligationInfo) {
      console.warn(`Missing Kamino account data for bank ${tuple.bankAddress}`);
      continue;
    }

    try {
      const reserveState = decodeKlendReserveData(reserveInfo.data);
      const obligationState = decodeKlendObligationData(obligationInfo.data);

      // Track farm collateral for second batch fetch
      if (!reserveState.farmCollateral.equals(new PublicKey("11111111111111111111111111111111"))) {
        bankByFarmKey[reserveState.farmCollateral.toBase58()] = tuple.bankAddress;
      }

      kaminoMap.set(tuple.bankAddress, {
        kaminoStates: {
          reserveState,
          obligationState,
          farmState: undefined,
        },
      });
    } catch (error) {
      console.warn(`Failed to decode Kamino data for bank ${tuple.bankAddress}:`, error);
    }
  }

  // Fetch farm states if any farm collateral keys were found
  if (Object.keys(bankByFarmKey).length > 0) {
    const farmKeys = Object.keys(bankByFarmKey);
    const farmStates = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(connection, farmKeys);

    // Add farm states to the corresponding banks
    for (let idx = 0; idx < farmKeys.length; idx++) {
      const farmState = farmStates[idx];
      if (!farmState) {
        continue;
      }

      const farmKey = farmKeys[idx];
      if (!farmKey) {
        console.error(`Farm key not found for index ${idx}`);
        continue;
      }

      const bankAddress = bankByFarmKey[farmKey];
      if (!bankAddress) {
        console.error(`Bank address not found for farm key ${farmKey}`);
        continue;
      }

      const kaminoMetadata = kaminoMap.get(bankAddress);
      if (!kaminoMetadata) {
        console.error(`Kamino metadata not found for bank ${bankAddress}`);
        continue;
      }

      try {
        const decodedFarmState = decodeFarmDataRaw(farmState.data);

        // Update the existing entry with farm state
        kaminoMap.set(bankAddress, {
          kaminoStates: {
            ...kaminoMetadata.kaminoStates,
            farmState: decodedFarmState,
          },
        });
      } catch (error) {
        console.warn(`Failed to decode farm state for bank ${bankAddress}:`, error);
      }
    }
  }

  return kaminoMap;
}
