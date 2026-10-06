import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { TransactionBuildingError } from "~/errors";
import { MarginfiAccountType } from "~/services/account";
import { AssetTag, BankType } from "~/services/bank";
import { InstructionsWrapper } from "~/services/transaction";
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
 * @param bankMap - Map of bank addresses (base58) to bank instances
 * @param newBanksPk - Public keys of new banks being added to the account
 * @param bankMetadataMap - Map containing Bank-specific metadata (reserve states, lending markets)
 * @returns InstructionsWrapper containing refresh reserve and obligation instructions
 * @throws TransactionBuildingError (KAMINO_RESERVE_NOT_FOUND) when a Kamino bank has no reserve state in `bankMetadataMap`
 */
export function makeRefreshKaminoBanksIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  newBanksPk: PublicKey[],
  bankMetadataMap: BankIntegrationMetadataMap
): InstructionsWrapper {
  const ixs: TransactionInstruction[] = [];

  const activeBanksPk = marginfiAccount.balances
    .filter((balance) => balance.active)
    .map((balance) => balance.bankPk);

  const allActiveBanks = [
    ...new Set([
      ...activeBanksPk.map((pk) => pk.toBase58()),
      ...newBanksPk.map((pk) => pk.toBase58()),
    ]).values(),
  ].map((pk) => bankMap.get(pk)!);

  // filter kamino banks
  const kaminoBanks = allActiveBanks.filter((bank) => bank.config.assetTag === AssetTag.KAMINO);

  if (kaminoBanks.length > 0) {
    const newBanksPkBase = newBanksPk.map((pk) => pk.toBase58());

    const refreshes = kaminoBanks.map((kaminoBank) => {
      const kaminoStates = bankMetadataMap[kaminoBank.address.toBase58()]?.kaminoStates;
      if (!kaminoStates || !kaminoBank.kaminoIntegrationAccounts) {
        throw TransactionBuildingError.kaminoReserveNotFound(
          kaminoBank.address.toBase58(),
          kaminoBank.mint.toBase58(),
          kaminoBank.tokenSymbol
        );
      }
      return {
        bank: kaminoBank.address.toBase58(),
        reserve: kaminoBank.kaminoIntegrationAccounts.kaminoReserve,
        obligation: kaminoBank.kaminoIntegrationAccounts.kaminoObligation,
        lendingMarket: kaminoStates.reserveState.lendingMarket,
      };
    });

    ixs.push(makeRefreshReservesBatchIx(refreshes));

    for (const { bank, reserve, obligation, lendingMarket } of refreshes) {
      if (newBanksPkBase.includes(bank)) {
        ixs.push(makeRefreshObligationIx(lendingMarket, obligation, reserve));
      }
    }
  }

  return {
    instructions: ixs,
    keys: [],
  };
}
