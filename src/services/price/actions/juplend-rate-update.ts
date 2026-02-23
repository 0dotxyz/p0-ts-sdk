import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { MarginfiAccountType } from "~/services/account";
import { AssetTag, BankType } from "~/services/bank";
import type { InstructionsWrapper } from "~/services/transaction/types";
import type { BankIntegrationMetadataMap } from "~/types";
import { makeUpdateJupLendRate } from "~/vendor/jup-lend";

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
 * @param bankMap - Map of bank addresses (base58) to bank instances
 * @param banksToExclude - Public keys of banks to exclude from the update
 * @param bankMetadataMap - Map containing Bank-specific metadata (JupLend lending states)
 * @returns InstructionsWrapper containing update_rate instructions
 */
export function makeUpdateJupLendRateIxs(
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
    .map((pk) => bankMap.get(pk.toBase58())!)
    .filter(Boolean);

  // filter juplend banks
  const jupLendBanks = allActiveBanks.filter((bank) => bank.config.assetTag === AssetTag.JUPLEND);

  if (jupLendBanks.length > 0) {
    const updateRateIxs = jupLendBanks
      .map((bank) => {
        const bankMetadata = bankMetadataMap?.[bank.address.toBase58()];
        if (!bankMetadata?.jupLendStates) return;
        return makeUpdateJupLendRate({
          lendingState: bankMetadata.jupLendStates.jupLendingState,
        });
      })
      .filter((ix): ix is TransactionInstruction => !!ix);

    ixs.push(...updateRateIxs);
  }

  return {
    instructions: ixs,
    keys: [],
  };
}
