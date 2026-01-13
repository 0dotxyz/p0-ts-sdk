import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { MarginfiAccountType } from "~/services/account";
import { BankType } from "~/services/bank";
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
  const kaminoBanks = allActiveBanks.filter((bank) => bank.config.assetTag === 3);

  if (kaminoBanks.length > 0) {
    const newBanksPkBase = newBanksPk.map((pk) => pk.toBase58());

    const banksToRefreshObligations = kaminoBanks.filter((bank) =>
      newBanksPkBase.includes(bank.address.toBase58())
    );

    const refreshReserveData = kaminoBanks
      .map((kaminoBank) => {
        const bankMetadata = bankMetadataMap?.[kaminoBank.address.toBase58()];
        if (!bankMetadata?.kaminoStates) return;

        const kaminoReserve = kaminoBank.kaminoReserve;
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
      const bankMetadata = bankMetadataMap?.[kaminoBank.address.toBase58()];
      if (!bankMetadata?.kaminoStates) continue;

      const kaminoReserve = kaminoBank.kaminoReserve;
      const lendingMarket = bankMetadata.kaminoStates.reserveState.lendingMarket;

      const obligationIx = makeRefreshObligationIx(
        lendingMarket,
        kaminoBank.kaminoObligation,
        kaminoReserve
      );
      ixs.push(obligationIx);
    }
  }

  return {
    instructions: ixs,
    keys: [],
  };
}
