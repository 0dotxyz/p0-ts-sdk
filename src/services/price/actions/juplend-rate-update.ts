import type { Address, Instruction } from "@solana/kit";

import { MarginfiAccountType } from "~/services/account";
import { AssetTag, BankType, requireBank } from "~/services/bank";
import type { BankIntegrationMetadataMap } from "~/types";
import { makeUpdateJupLendRateIx } from "~/vendor/jup-lend";

/**
 * Creates instructions to refresh JupLend exchange rates.
 *
 * This function generates permissionless `update_rate` instructions for all active
 * JupLend banks in the marginfi account, excluding any specified banks. This ensures
 * exchange rates are current before risk-sensitive flows (liquidation, borrow,
 * non-JupLend withdraw where JupLend is collateral).
 *
 * Note: juplend_deposit and juplend_withdraw call updateRate internally,
 * so this is only needed for other flows.
 *
 * @param marginfiAccount - The marginfi account containing active bank balances
 * @param bankMap - Map of bank addresses to bank instances
 * @param banksToExclude - Addresses of banks to exclude from the update
 * @param bankMetadataMap - Map containing Bank-specific metadata (JupLend lending states)
 * @returns update_rate instructions
 * @throws if an active bank is missing from `bankMap`
 */
export function makeUpdateJupLendRateIxs(
  marginfiAccount: MarginfiAccountType,
  bankMap: Map<string, BankType>,
  banksToExclude: Address[],
  bankMetadataMap: BankIntegrationMetadataMap
): Instruction[] {
  const activeBanksPk = marginfiAccount.balances
    .filter((balance) => balance.active)
    .map((balance) => balance.bankPk);

  const banksToExcludeSet = new Set(banksToExclude);

  const allActiveBanks = activeBanksPk
    .filter((pk) => !banksToExcludeSet.has(pk))
    .map((pk) => requireBank(bankMap, pk));

  // filter juplend banks
  const jupLendBanks = allActiveBanks.filter((bank) => bank.config.assetTag === AssetTag.JUPLEND);

  return jupLendBanks
    .map((bank) => bankMetadataMap?.[bank.address]?.jupLendStates?.jupLendingState)
    .filter((lendingState): lendingState is NonNullable<typeof lendingState> => !!lendingState)
    .map(makeUpdateJupLendRateIx);
}
