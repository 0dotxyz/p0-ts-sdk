import type { Address, Instruction } from "@solana/kit";

import { MarginfiAccountType } from "~/services/account";
import { AssetTag, BankType, requireBank } from "~/services/bank";
import type { BankIntegrationMetadataMap } from "~/types";
import { makeUpdateSpotMarketCumulativeInterestIx } from "~/vendor/drift";

/**
 * Creates instructions to update Drift protocol spot market data.
 *
 * This function generates the necessary Solana instructions to refresh Drift spot market
 * cumulative interest for all active Drift banks in the marginfi account, excluding any
 * specified banks. This ensures market state and interest calculations are current before
 * executing transactions.
 *
 * @param marginfiAccount - The marginfi account containing active bank balances
 * @param bankMap - Map of bank addresses to bank instances
 * @param banksToExclude - Addresses of banks to exclude from the update
 * @param bankMetadataMap - Map containing Bank-specific metadata (Drift spot market states)
 * @returns Drift spot market update instructions
 * @throws if an active bank is missing from `bankMap`
 */
export async function makeUpdateDriftMarketIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  banksToExclude: Address[],
  bankMetadataMap: BankIntegrationMetadataMap
): Promise<Instruction[]> {
  const activeBanksPk = marginfiAccount.balances
    .filter((balance) => balance.active)
    .map((balance) => balance.bankPk);

  const banksToExcludeSet = new Set(banksToExclude);

  const allActiveBanks = activeBanksPk
    .filter((pk) => !banksToExcludeSet.has(pk))
    .map((pk) => requireBank(bankMap, pk));

  // filter drift banks
  const driftBanks = allActiveBanks.filter((bank) => bank.config.assetTag === AssetTag.DRIFT);

  const spotMarkets = driftBanks
    .map((driftBank) => bankMetadataMap?.[driftBank.address]?.driftStates?.spotMarketState)
    .filter((market): market is NonNullable<typeof market> => !!market);

  return Promise.all(spotMarkets.map(makeUpdateSpotMarketCumulativeInterestIx));
}
