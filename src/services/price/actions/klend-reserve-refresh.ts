import type { Address, Instruction } from "@solana/kit";

import { MarginfiAccountType } from "~/services/account";
import { AssetTag, BankType, requireBank } from "~/services/bank";
import { BankIntegrationMetadataMap } from "~/types";
import { makeRefreshObligationIx, makeRefreshReservesBatchIx } from "~/vendor/klend";

/**
 * Creates instructions to refresh Kamino lending protocol reserves and obligations.
 *
 * This function generates the necessary Solana instructions to update Kamino (Klend) reserve
 * data and refresh obligations for all active Kamino banks in the marginfi account, plus any
 * new banks being added. This ensures price and state data is current before executing transactions.
 *
 * @param marginfiAccount - The marginfi account containing active bank balances
 * @param bankMap - Map of bank addresses to bank instances
 * @param newBanksPk - Addresses of new banks being added to the account
 * @param bankMetadataMap - Map containing Bank-specific metadata (reserve states, lending markets)
 * @returns Refresh reserve and obligation instructions
 * @throws if an active or new bank is missing from `bankMap`
 */
export function makeRefreshKaminoBanksIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  newBanksPk: Address[],
  bankMetadataMap: BankIntegrationMetadataMap
): Instruction[] {
  const ixs: Instruction[] = [];

  const activeBanksPk = marginfiAccount.balances
    .filter((balance) => balance.active)
    .map((balance) => balance.bankPk);

  const allActiveBanks = [...new Set([...activeBanksPk, ...newBanksPk]).values()].map((pk) =>
    requireBank(bankMap, pk)
  );

  // filter kamino banks
  const kaminoBanks = allActiveBanks.filter((bank) => bank.config.assetTag === AssetTag.KAMINO);

  if (kaminoBanks.length > 0) {
    const banksToRefreshObligations = kaminoBanks.filter((bank) =>
      newBanksPk.includes(bank.address)
    );

    const refreshReserveData = kaminoBanks
      .map((kaminoBank) => {
        const bankMetadata = bankMetadataMap?.[kaminoBank.address];
        if (!bankMetadata?.kaminoStates) return;
        if (!kaminoBank.kaminoIntegrationAccounts) return;

        const kaminoReserve = kaminoBank.kaminoIntegrationAccounts.kaminoReserve;
        const lendingMarket = bankMetadata.kaminoStates.reserveState.lendingMarket;

        return {
          reserve: kaminoReserve,
          lendingMarket,
        };
      })
      .filter((bank): bank is NonNullable<typeof bank> => !!bank);

    //refresh obligations
    const reserveIx = makeRefreshReservesBatchIx(refreshReserveData);

    ixs.push(reserveIx);

    for (const kaminoBank of banksToRefreshObligations) {
      const bankMetadata = bankMetadataMap?.[kaminoBank.address];
      if (!bankMetadata?.kaminoStates) continue;
      if (!kaminoBank.kaminoIntegrationAccounts) continue;

      const kaminoReserve = kaminoBank.kaminoIntegrationAccounts.kaminoReserve;
      const lendingMarket = bankMetadata.kaminoStates.reserveState.lendingMarket;

      const obligationIx = makeRefreshObligationIx(
        lendingMarket,
        kaminoBank.kaminoIntegrationAccounts.kaminoObligation,
        kaminoReserve
      );
      ixs.push(obligationIx);
    }
  }

  return ixs;
}
