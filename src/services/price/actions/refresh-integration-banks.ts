import { PublicKey } from "@solana/web3.js";

import { MarginfiAccountType } from "~/services/account";
import { BankType } from "~/services/bank";
import type { InstructionsWrapper } from "~/services/transaction/types";
import type { BankIntegrationMetadataMap } from "~/types";

import { makeUpdateDriftMarketIxs } from "./drift-market-update";
import { makeUpdateJupLendRateIxs } from "./juplend-rate-update";
import { makeRefreshKaminoBanksIxs } from "./klend-reserve-refresh";

/**
 * Groups the per-integration refresh/update instructions (Kamino reserve refresh,
 * Drift spot market update, JupLend rate update) into a single wrapper.
 *
 * JupLend and Drift action instructions update their own bank via CPI, so the bank
 * being acted on is excluded from those updates. Kamino has no such CPI, so the
 * action bank must be explicitly included in the refresh set instead.
 *
 * @param marginfiAccount - The marginfi account containing active bank balances
 * @param bankMap - Map of bank addresses (base58) to bank instances
 * @param banksToExclude - Banks skipped for the JupLend/Drift updates (their CPI already updates them)
 * @param bankMetadataMap - Map containing Bank-specific metadata (integration states)
 * @param kaminoNewBanksPk - Banks to union into the Kamino refresh set, defaults to `banksToExclude`
 * @returns InstructionsWrapper with instructions ordered kamino -> drift -> juplend
 */
export function makeRefreshIntegrationBanksIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  banksToExclude: PublicKey[],
  bankMetadataMap: BankIntegrationMetadataMap,
  kaminoNewBanksPk: PublicKey[] = banksToExclude
): InstructionsWrapper {
  const kaminoRefreshIxs = makeRefreshKaminoBanksIxs(
    marginfiAccount,
    bankMap,
    kaminoNewBanksPk,
    bankMetadataMap
  );

  const updateDriftMarketIxs = makeUpdateDriftMarketIxs(
    marginfiAccount,
    bankMap,
    banksToExclude,
    bankMetadataMap
  );

  const updateJupLendRateIxs = makeUpdateJupLendRateIxs(
    marginfiAccount,
    bankMap,
    banksToExclude,
    bankMetadataMap
  );

  return {
    instructions: [
      ...kaminoRefreshIxs.instructions,
      ...updateDriftMarketIxs.instructions,
      ...updateJupLendRateIxs.instructions,
    ],
    keys: [...kaminoRefreshIxs.keys, ...updateDriftMarketIxs.keys, ...updateJupLendRateIxs.keys],
  };
}
