import type { GetMultipleAccountsApi, Rpc } from "@solana/kit";

import { fetchDriftStates } from "./drift";
import { fetchJupLendStates } from "./juplend";
import { fetchKaminoStates } from "./kamino";

import { BankType } from "~/services/bank";
import { BankIntegrationMetadataMap } from "~/types";

/**
 * Fetches the venue state of every Kamino, Drift and JupLend bank in `banks`, keyed by bank
 * address: the `bankMetadataMap` the account actions take.
 */
export async function fetchBankIntegrationMetadata(
  rpc: Rpc<GetMultipleAccountsApi>,
  banks: BankType[]
): Promise<BankIntegrationMetadataMap> {
  const [kaminoStates, driftStates, jupLendStates] = await Promise.all([
    fetchKaminoStates(
      rpc,
      banks.flatMap(({ address, kaminoIntegrationAccounts: accounts }) =>
        accounts
          ? [
              {
                bankAddress: address,
                reserve: accounts.kaminoReserve,
                obligation: accounts.kaminoObligation,
              },
            ]
          : []
      )
    ),
    fetchDriftStates(
      rpc,
      banks.flatMap(({ address, driftIntegrationAccounts: accounts }) =>
        accounts
          ? [
              {
                bankAddress: address,
                spotMarket: accounts.driftSpotMarket,
                user: accounts.driftUser,
                userStats: accounts.driftUserStats,
              },
            ]
          : []
      )
    ),
    fetchJupLendStates(
      rpc,
      banks.flatMap(({ address, jupLendIntegrationAccounts: accounts }) =>
        accounts ? [{ bankAddress: address, lendingState: accounts.jupLendingState }] : []
      )
    ),
  ]);

  const metadata: BankIntegrationMetadataMap = {};
  for (const [bank, states] of Object.entries(kaminoStates))
    metadata[bank] = { kaminoStates: states };
  for (const [bank, states] of Object.entries(driftStates))
    metadata[bank] = { driftStates: states };
  for (const [bank, states] of Object.entries(jupLendStates))
    metadata[bank] = { jupLendStates: states };
  return metadata;
}
