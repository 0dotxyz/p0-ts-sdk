import type { Address, Instruction } from "@solana/kit";

import { TransactionBuildingError } from "~/errors";
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
 * @throws TransactionBuildingError (BANK_NOT_FOUND) if an active or new bank is missing from
 * `bankMap`
 * @throws TransactionBuildingError (KAMINO_RESERVE_NOT_FOUND) when a Kamino bank has no reserve
 * state in `bankMetadataMap`
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
    requireBank(bankMap, pk, () => TransactionBuildingError.bankNotFound(pk))
  );

  // filter kamino banks
  const kaminoBanks = allActiveBanks.filter((bank) => bank.config.assetTag === AssetTag.KAMINO);

  if (kaminoBanks.length > 0) {
    const refreshes = kaminoBanks.map((kaminoBank) => {
      const kaminoStates = bankMetadataMap[kaminoBank.address]?.kaminoStates;
      if (!kaminoStates || !kaminoBank.kaminoIntegrationAccounts) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          kaminoBank.address,
          kaminoBank.mint,
          kaminoBank.tokenSymbol
        );
      }
      return {
        bank: kaminoBank.address,
        reserve: kaminoBank.kaminoIntegrationAccounts.kaminoReserve,
        obligation: kaminoBank.kaminoIntegrationAccounts.kaminoObligation,
        lendingMarket: kaminoStates.reserveState.lendingMarket,
      };
    });

    ixs.push(makeRefreshReservesBatchIx(refreshes));

    for (const { bank, reserve, obligation, lendingMarket } of refreshes) {
      if (newBanksPk.includes(bank)) {
        ixs.push(makeRefreshObligationIx(lendingMarket, obligation, reserve));
      }
    }
  }

  return ixs;
}
