import {
  fetchEncodedAccount,
  getBase58Decoder,
  parseBase64RpcAccount,
  type Address,
  type Base58EncodedBytes,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetProgramAccountsApi,
  type GetProgramAccountsMemcmpFilter,
  type Rpc,
} from "@solana/kit";

import { BankType } from "../types";

import { decodeBank } from "./deserialize.utils";

import { BANK_DISCRIMINATOR } from "~/accounts";
import { BankIntegrationMetadataMap } from "~/types";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/utils";
import { fetchDriftStates } from "~/vendor/drift";
import { fetchJupLendStates } from "~/vendor/jup-lend";
import { fetchKaminoStates } from "~/vendor/klend";

export const fetchBank = async (
  rpc: Rpc<GetAccountInfoApi>,
  bankAddress: Address
): Promise<BankType> => {
  const account = await fetchEncodedAccount(rpc, bankAddress);

  if (!account.exists) {
    throw new Error(`Bank ${bankAddress} not found`);
  }

  return decodeBank(bankAddress, account.data);
};

export const fetchMultipleBanks = async (
  rpc: Rpc<GetMultipleAccountsApi & GetProgramAccountsApi>,
  programAddress: Address,
  opts?: { bankAddresses?: Address[]; groupAddress?: Address }
): Promise<BankType[]> => {
  const banks: BankType[] = [];

  if (opts?.bankAddresses && opts.bankAddresses.length > 0) {
    const addresses = opts.bankAddresses;
    const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(rpc, addresses);

    accounts.forEach((account, idx) => {
      if (account) {
        banks.push(decodeBank(account.address, account.data));
      } else {
        console.error(`Bank ${addresses[idx]} not found`);
      }
    });
  } else {
    const filters: GetProgramAccountsMemcmpFilter[] = [
      {
        memcmp: {
          offset: 0n,
          bytes: getBase58Decoder().decode(BANK_DISCRIMINATOR) as Base58EncodedBytes,
          encoding: "base58",
        },
      },
    ];
    if (opts?.groupAddress) {
      filters.push({
        memcmp: { offset: 8n + 32n + 1n, bytes: opts.groupAddress, encoding: "base58" },
      });
    }
    const accounts = await rpc
      .getProgramAccounts(programAddress, { encoding: "base64", filters })
      .send();
    for (const { pubkey, account } of accounts) {
      banks.push(decodeBank(pubkey, parseBase64RpcAccount(pubkey, account).data));
    }
  }

  return banks;
};

/**
 * Fetches the venue state of every Kamino, Drift and JupLend bank in `banks`, keyed by bank
 * address: the `bankMetadataMap` the account actions take.
 * @throws if a fetched venue account isn't the account it should be
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
