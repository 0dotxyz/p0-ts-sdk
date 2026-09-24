import type { Address, Instruction } from "@solana/kit";

import { makeUpdateDriftMarketIxs } from "./drift-market-update";
import { makeUpdateJupLendRateIxs } from "./juplend-rate-update";
import { makeRefreshKaminoBanksIxs } from "./klend-reserve-refresh";

import { MarginfiAccountType } from "~/services/account";
import { BankType } from "~/services/bank";
import type { BankIntegrationMetadataMap } from "~/types";

/**
 * Groups the per-integration refresh/update instructions (Kamino reserve refresh,
 * Drift spot market update, JupLend rate update).
 *
 * JupLend and Drift action instructions update their own bank via CPI, so the bank
 * being acted on is excluded from those updates. Kamino has no such CPI, so the
 * action bank must be explicitly included in the refresh set instead.
 *
 * @param marginfiAccount - The marginfi account containing active bank balances
 * @param bankMap - Map of bank addresses to bank instances
 * @param banksToExclude - Banks skipped for the JupLend/Drift updates (their CPI already updates them)
 * @param bankMetadataMap - Map containing Bank-specific metadata (integration states)
 * @param kaminoNewBanksPk - Banks to union into the Kamino refresh set, defaults to `banksToExclude`
 * @returns Instructions ordered kamino -> drift -> juplend
 * @throws if an active bank is missing from `bankMap`
 */
export async function makeRefreshIntegrationBanksIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  banksToExclude: Address[],
  bankMetadataMap: BankIntegrationMetadataMap,
  kaminoNewBanksPk: Address[] = banksToExclude
): Promise<Instruction[]> {
  return [
    ...makeRefreshKaminoBanksIxs(marginfiAccount, bankMap, kaminoNewBanksPk, bankMetadataMap),
    ...(await makeUpdateDriftMarketIxs(marginfiAccount, bankMap, banksToExclude, bankMetadataMap)),
    ...makeUpdateJupLendRateIxs(marginfiAccount, bankMap, banksToExclude, bankMetadataMap),
  ];
}
