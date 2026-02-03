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
  reserveRawToDto,
  obligationRawToDto,
  farmRawToDto,
  dtoToReserveRaw,
  dtoToObligationRaw,
  dtoToFarmRaw,
} from "~/vendor/klend";
import { KaminoStateJsonByBank } from "./kamino.types";

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

export interface KaminoBankInput {
  bankAddress: string;
  reserve: string;
  obligation: string;
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
export async function getKaminoMetadata(
  options: FetchKaminoMetadataOptions
): Promise<Map<string, KaminoMetadata>> {
  const kaminoBanks = options.banks.filter((b) => b.config.assetTag === AssetTag.KAMINO);
  const DEFAULT_PUBKEY = PublicKey.default;

  const kaminoBankInputs: KaminoBankInput[] = kaminoBanks
    .map((bank) => {
      const accounts = bank.kaminoIntegrationAccounts;
      if (!accounts) {
        console.warn("Kamino data not found for bank: ", bank.address.toBase58());
        return null;
      }
      const reserveKey = accounts.kaminoReserve;
      const obligationKey = accounts.kaminoObligation;
      if (reserveKey.equals(DEFAULT_PUBKEY) || obligationKey.equals(DEFAULT_PUBKEY)) {
        return null;
      }
      return {
        bankAddress: bank.address.toBase58(),
        reserve: reserveKey.toBase58(),
        obligation: obligationKey.toBase58(),
      };
    })
    .filter((b): b is KaminoBankInput => b !== null);

  const kaminoStates = await getKaminoStatesDto(options.connection, kaminoBankInputs);

  const kaminoMetadataMap = new Map<string, KaminoMetadata>();
  for (const [bankAddress, state] of Object.entries(kaminoStates)) {
    kaminoMetadataMap.set(bankAddress, {
      kaminoStates: {
        reserveState: dtoToReserveRaw(state.reserveState),
        obligationState: dtoToObligationRaw(state.obligationState),
        farmState: state.farmState ? dtoToFarmRaw(state.farmState) : undefined,
      },
    });
  }
  return kaminoMetadataMap;
}

export async function getKaminoStatesDto(
  connection: Connection,
  kaminoBanks: KaminoBankInput[]
): Promise<KaminoStateJsonByBank> {
  const DEFAULT_PUBKEY = PublicKey.default;
  const DEFAULT_PUBKEY_BASE = DEFAULT_PUBKEY.toBase58();

  const kaminoStatesMap: KaminoStateJsonByBank = {};
  const bankByFarmKey: Record<string, string> = {};

  // Filter banks with valid (non-default) reserve and obligation addresses
  const validBanks = kaminoBanks.filter(
    (bank) => bank.reserve !== DEFAULT_PUBKEY_BASE && bank.obligation !== DEFAULT_PUBKEY_BASE
  );

  // Early return if no valid banks
  if (validBanks.length === 0) {
    return {};
  }

  // Flatten all keys for batch fetching
  const allKeys: string[] = validBanks.flatMap((bank) => [bank.reserve, bank.obligation]);

  const allResults = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(connection, allKeys);

  // Process results - they come in pairs (reserve, obligation)
  for (const [index, bank] of validBanks.entries()) {
    const reserveAccount = allResults[index * 2];
    const obligationAccount = allResults[index * 2 + 1];

    if (!reserveAccount || !obligationAccount) {
      continue;
    }

    const reserveState = decodeKlendReserveData(reserveAccount.data);
    const obligationState = decodeKlendObligationData(obligationAccount.data);

    const hasFarmState = !reserveState.farmCollateral.equals(DEFAULT_PUBKEY);

    if (hasFarmState) {
      bankByFarmKey[reserveState.farmCollateral.toBase58()] = bank.bankAddress;
    }

    kaminoStatesMap[bank.bankAddress] = {
      reserveState: reserveRawToDto(reserveState),
      obligationState: obligationRawToDto(obligationState),
    };
  }

  const allFarmKeys = Object.keys(bankByFarmKey);

  if (allFarmKeys.length > 0) {
    const farmStates = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
      connection,
      allFarmKeys
    );

    for (const [idx, farmKey] of allFarmKeys.entries()) {
      const farmState = farmStates[idx];
      if (!farmState) {
        continue;
      }

      const bankKey = bankByFarmKey[farmKey]!;
      const kaminoState = kaminoStatesMap[bankKey];

      if (!kaminoState) {
        // This should not happen - reserve was decoded successfully earlier
        console.error(`Kamino state not found for bank key ${bankKey}, skipping farm state`);
        continue;
      }

      const decodedFarmState = decodeFarmDataRaw(farmState.data);

      kaminoStatesMap[bankKey] = {
        ...kaminoState,
        farmState: farmRawToDto(decodedFarmState),
      };
    }
  }

  return kaminoStatesMap;
}
