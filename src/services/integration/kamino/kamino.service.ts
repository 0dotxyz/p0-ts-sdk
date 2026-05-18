import { Connection, PublicKey } from "@solana/web3.js";

import { Bank } from "~/models/bank";
import { AssetTag } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import {
  decodeKlendReserveData,
  decodeFarmDataRaw,
  dtoToKaminoFarm,
  dtoToKaminoReserve,
  kaminoFarmFromRaw,
  kaminoFarmToDto,
  kaminoReserveFromRaw,
  kaminoReserveToDto,
  KaminoFarm,
  KaminoReserve,
} from "~/vendor/klend";
import { KaminoStateJsonByBank } from "./kamino.types";

export interface KaminoMetadata {
  kaminoStates: {
    reserveState: KaminoReserve;
    farmState?: KaminoFarm;
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
 * Fetch Kamino reserve and farm states for banks with Kamino integration,
 * projecting directly into slim {@link KaminoReserve}/{@link KaminoFarm}
 * structures suitable for storage and transport.
 *
 * This function:
 * 1. Filters banks that have Kamino reserves
 * 2. Batch fetches all reserve data in one RPC call
 * 3. Decodes reserves and projects slim states
 * 4. Identifies farms from reserve.farmCollateral addresses
 * 5. Batch fetches and decodes farm states in a second RPC call
 * 6. Returns a complete map keyed by bank address
 *
 * @param options - Connection and banks to fetch metadata for
 * @returns Map of bank addresses to their slim Kamino metadata
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
        reserveState: dtoToKaminoReserve(state.reserveState),
        ...(state.farmState && { farmState: dtoToKaminoFarm(state.farmState) }),
      },
    });
  }
  return kaminoMetadataMap;
}

/**
 * Fetch and decode Kamino reserves (and any associated farms), returning
 * JSON-friendly slim DTOs for transport across the network.
 */
export async function getKaminoStatesDto(
  connection: Connection,
  kaminoBanks: KaminoBankInput[]
): Promise<KaminoStateJsonByBank> {
  const DEFAULT_PUBKEY = PublicKey.default;
  const DEFAULT_PUBKEY_BASE = DEFAULT_PUBKEY.toBase58();

  const dtoStates: KaminoStateJsonByBank = {};
  const bankByFarmKey: Record<string, string> = {};

  const validBanks = kaminoBanks.filter((bank) => bank.reserve !== DEFAULT_PUBKEY_BASE);

  if (validBanks.length === 0) {
    return {};
  }

  const reserveKeys: string[] = validBanks.map((bank) => bank.reserve);
  const reserveResults = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    connection,
    reserveKeys
  );

  for (const [index, bank] of validBanks.entries()) {
    const reserveAccount = reserveResults[index];
    if (!reserveAccount) {
      continue;
    }

    const reserveRaw = decodeKlendReserveData(reserveAccount.data);
    const reserveSlim = kaminoReserveFromRaw(reserveRaw);

    if (!reserveRaw.farmCollateral.equals(DEFAULT_PUBKEY)) {
      bankByFarmKey[reserveRaw.farmCollateral.toBase58()] = bank.bankAddress;
    }

    dtoStates[bank.bankAddress] = { reserveState: kaminoReserveToDto(reserveSlim) };
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
      const dtoState = dtoStates[bankKey];
      if (!dtoState) {
        console.error(`Kamino state not found for bank key ${bankKey}, skipping farm state`);
        continue;
      }

      const farmRaw = decodeFarmDataRaw(farmState.data);
      dtoStates[bankKey] = {
        ...dtoState,
        farmState: kaminoFarmToDto(kaminoFarmFromRaw(farmRaw)),
      };
    }
  }

  return dtoStates;
}
