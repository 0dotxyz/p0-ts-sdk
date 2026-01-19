import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { MarginfiAccountType } from "~/services/account";
import { BankType } from "~/services/bank";
import type { InstructionsWrapper } from "~/services/transaction/types";
import type { BankIntegrationMetadata, BankIntegrationMetadataMap } from "~/types";
import { makeUpdateSpotMarketIx } from "~/vendor/drift";

/**
 * Creates instructions to update Drift protocol spot market data.
 *
 * This function generates the necessary Solana instructions to refresh Drift spot market
 * cumulative interest for all active Drift banks in the marginfi account, excluding any
 * specified banks. This ensures market state and interest calculations are current before
 * executing transactions.
 *
 * @param marginfiAccount - The marginfi account containing active bank balances
 * @param bankMap - Map of bank addresses (base58) to bank instances
 * @param banksToExclude - Public keys of banks to exclude from the update
 * @param bankMetadataMap - Map containing Bank-specific metadata (Drift spot market states)
 * @returns InstructionsWrapper containing Drift spot market update instructions
 */
export function makeUpdateDriftMarketIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  banksToExclude: PublicKey[],
  bankMetadataMap: BankIntegrationMetadataMap
): InstructionsWrapper {
  const ixs: TransactionInstruction[] = [];

  const activeBanksPk = marginfiAccount.balances
    .filter((balance) => balance.active)
    .map((balance) => balance.bankPk);

  const banksToExcludeSet = new Set(banksToExclude.map((pk) => pk.toBase58()));

  const allActiveBanks = activeBanksPk
    .filter((pk) => !banksToExcludeSet.has(pk.toBase58()))
    .map((pk) => bankMap.get(pk.toBase58())!);

  // filter drift banks
  const driftBanks = allActiveBanks.filter((bank) => bank.config.assetTag === 4);

  if (driftBanks.length > 0) {
    const refreshReserveData = driftBanks
      .map((driftBank) => {
        const bankMetadata = bankMetadataMap?.[driftBank.address.toBase58()];
        if (!bankMetadata?.driftStates) return;
        const driftSpotMarket = bankMetadata.driftStates.spotMarketState;
        return driftSpotMarket;
      })
      .filter((bank): bank is NonNullable<typeof bank> => !!bank);

    //refresh obligations
    const updateDriftMarketIxs = refreshReserveData.map((market) =>
      makeUpdateSpotMarketIx({ spotMarket: market })
    );

    ixs.push(...updateDriftMarketIxs);
  }

  return {
    instructions: ixs,
    keys: [],
  };
}
