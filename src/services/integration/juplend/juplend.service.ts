import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { Bank } from "~/models/bank";
import { AssetTag } from "~/services/bank";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";
import { MintLayout } from "~/vendor/spl";
import {
  JupLendingState,
  JupLendingStateRaw,
  JupLendingRewardsRateModel,
  JupRateModel,
  JupTokenReserve,
  decodeJupLendingStateData,
  decodeJupLendingRewardsRateModelData,
  decodeJupTokenReserveData,
  decodeJupRateModelData,
  jupLendingStateRawToDto,
  jupLendingRewardsRateModelRawToDto,
  jupTokenReserveRawToDto,
  jupRateModelRawToDto,
  dtoToJupLendingStateRaw,
  dtoToJupLendingRewardsRateModelRaw,
  dtoToJupTokenReserveRaw,
  dtoToJupRateModelRaw,
  deriveJupLendRateModel,
} from "~/vendor/jup-lend";

import { JupLendStateJsonByBank } from "./juplend.types";

export interface JupLendMetadata {
  jupLendStates: {
    jupLendingState: JupLendingState;
    jupTokenReserveState: JupTokenReserve;
    jupRewardsRateModel: JupLendingRewardsRateModel | null;
    jupRateModel: JupRateModel | null;
    fTokenTotalSupply: BN;
  };
}

export interface FetchJupLendMetadataOptions {
  connection: Connection;
  banks: Bank[];
}

export interface JupLendBankInput {
  bankAddress: string;
  lendingState: string;
}

/**
 * Fetch JupLend Lending state, TokenReserve, and RewardsRateModel for banks with JupLend integration.
 *
 * This function:
 * 1. Filters banks that have JupLend integration accounts
 * 2. Batch fetches all Lending state accounts in one RPC call
 * 3. Decodes Lending states to extract TokenReserve and RewardsRateModel addresses
 * 4. Batch fetches TokenReserve and RewardsRateModel accounts in a second RPC call
 * 5. Returns a complete map keyed by bank address
 *
 * @param options - Connection and banks to fetch metadata for
 * @returns Map of bank addresses to their complete JupLend metadata
 */
export async function getJupLendMetadata(
  options: FetchJupLendMetadataOptions
): Promise<Map<string, JupLendMetadata>> {
  const jupLendBanks = options.banks.filter((b) => b.config.assetTag === AssetTag.JUPLEND);
  const DEFAULT_PUBKEY = PublicKey.default;

  const jupLendBankInputs: JupLendBankInput[] = jupLendBanks
    .map((bank) => {
      const accounts = bank.jupLendIntegrationAccounts;
      if (!accounts) {
        console.warn("JupLend data not found for bank: ", bank.address.toBase58());
        return null;
      }
      if (accounts.jupLendingState.equals(DEFAULT_PUBKEY)) {
        return null;
      }
      return {
        bankAddress: bank.address.toBase58(),
        lendingState: accounts.jupLendingState.toBase58(),
      };
    })
    .filter((b): b is JupLendBankInput => b !== null);

  const jupLendStatesDto = await getJupLendStatesDto(options.connection, jupLendBankInputs);

  const jupLendMetadataMap = new Map<string, JupLendMetadata>();
  for (const [bankAddress, state] of Object.entries(jupLendStatesDto)) {
    jupLendMetadataMap.set(bankAddress, {
      jupLendStates: {
        jupLendingState: dtoToJupLendingStateRaw(state.jupLendingState),
        jupTokenReserveState: dtoToJupTokenReserveRaw(state.jupTokenReserveState),
        jupRewardsRateModel: state.jupRewardsRateModel
          ? dtoToJupLendingRewardsRateModelRaw(state.jupRewardsRateModel)
          : null,
        jupRateModel: state.jupRateModel ? dtoToJupRateModelRaw(state.jupRateModel) : null,
        fTokenTotalSupply: new BN(state.fTokenTotalSupply),
      },
    });
  }

  return jupLendMetadataMap;
}

export async function getJupLendStatesDto(
  connection: Connection,
  jupLendBanks: JupLendBankInput[]
): Promise<JupLendStateJsonByBank> {
  const DEFAULT_PUBKEY_BASE = PublicKey.default.toBase58();

  const validBanks = jupLendBanks.filter((bank) => bank.lendingState !== DEFAULT_PUBKEY_BASE);

  if (validBanks.length === 0) {
    return {};
  }

  // ── Pass 1: fetch all Lending state accounts ──────────────────────────────
  const lendingStateKeys = validBanks.map((b) => b.lendingState);
  const lendingStateResults = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    connection,
    lendingStateKeys
  );

  const rawLendingStatesMap: Record<string, JupLendingStateRaw> = {};

  for (const [index, bank] of validBanks.entries()) {
    const account = lendingStateResults[index];
    if (!account) {
      console.warn("JupLend Lending state account not found for bank:", bank.bankAddress);
      continue;
    }
    try {
      const lendingState = decodeJupLendingStateData(
        account.data,
        new PublicKey(bank.lendingState)
      );
      rawLendingStatesMap[bank.bankAddress] = lendingState;
    } catch (e) {
      console.warn("Failed to decode JupLend Lending state for bank:", bank.bankAddress, e);
    }
  }

  if (Object.keys(rawLendingStatesMap).length === 0) {
    return {};
  }

  // ── Pass 2: fetch TokenReserve + RewardsRateModel + fToken mint + RateModel from addresses on Lending state ──
  const bankAddresses = Object.keys(rawLendingStatesMap);
  const secondPassKeys: string[] = [];

  for (const bankAddress of bankAddresses) {
    const lendingState = rawLendingStatesMap[bankAddress]!;
    secondPassKeys.push(lendingState.tokenReservesLiquidity.toBase58());
    secondPassKeys.push(lendingState.rewardsRateModel.toBase58());
    secondPassKeys.push(lendingState.fTokenMint.toBase58());
    const [rateModelPda] = deriveJupLendRateModel(lendingState.mint);
    secondPassKeys.push(rateModelPda.toBase58());
  }

  const secondPassResults = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(
    connection,
    secondPassKeys
  );

  const jupLendStatesMap: JupLendStateJsonByBank = {};

  for (const [i, bankAddress] of bankAddresses.entries()) {
    const lendingState = rawLendingStatesMap[bankAddress]!;
    const tokenReserveAccount = secondPassResults[i * 4];
    const rewardsRateModelAccount = secondPassResults[i * 4 + 1];
    const fTokenMintAccount = secondPassResults[i * 4 + 2];
    const rateModelAccount = secondPassResults[i * 4 + 3];

    if (!tokenReserveAccount) {
      console.warn("JupLend TokenReserve account not found for bank:", bankAddress);
      continue;
    }

    if (!fTokenMintAccount) {
      console.warn("JupLend fToken mint account not found for bank:", bankAddress);
      continue;
    }

    let tokenReserveState: JupTokenReserve;
    try {
      tokenReserveState = decodeJupTokenReserveData(
        tokenReserveAccount.data,
        lendingState.tokenReservesLiquidity
      );
    } catch (e) {
      console.warn("Failed to decode JupLend TokenReserve for bank:", bankAddress, e);
      continue;
    }

    let fTokenTotalSupply: bigint;
    try {
      const rawMint = MintLayout.decode(fTokenMintAccount.data);
      fTokenTotalSupply = rawMint.supply;
    } catch (e) {
      console.warn("Failed to decode JupLend fToken mint for bank:", bankAddress, e);
      continue;
    }

    let rewardsRateModel: JupLendingRewardsRateModel | null = null;
    if (rewardsRateModelAccount && !lendingState.rewardsRateModel.equals(PublicKey.default)) {
      try {
        rewardsRateModel = decodeJupLendingRewardsRateModelData(
          rewardsRateModelAccount.data,
          lendingState.rewardsRateModel
        );
      } catch (e) {
        console.warn("Failed to decode JupLend RewardsRateModel for bank:", bankAddress, e);
      }
    }

    let rateModel: JupRateModel | null = null;
    if (rateModelAccount) {
      try {
        const [rateModelPda] = deriveJupLendRateModel(lendingState.mint);
        rateModel = decodeJupRateModelData(rateModelAccount.data, rateModelPda);
      } catch (e) {
        console.warn("Failed to decode JupLend RateModel for bank:", bankAddress, e);
      }
    }

    jupLendStatesMap[bankAddress] = {
      jupLendingState: jupLendingStateRawToDto(lendingState),
      jupTokenReserveState: jupTokenReserveRawToDto(tokenReserveState),
      jupRewardsRateModel: rewardsRateModel
        ? jupLendingRewardsRateModelRawToDto(rewardsRateModel)
        : null,
      jupRateModel: rateModel ? jupRateModelRawToDto(rateModel) : null,
      fTokenTotalSupply: fTokenTotalSupply.toString(),
    };
  }

  return jupLendStatesMap;
}
