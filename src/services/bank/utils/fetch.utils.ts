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

import { BankRaw } from "../types";

import { BANK_DISCRIMINATOR, decodeBank } from "~/accounts";
import { chunkedGetRawMultipleAccountInfoOrderedWithNulls } from "~/services/misc";

export const fetchBank = async (
  rpc: Rpc<GetAccountInfoApi>,
  bankAddress: Address
): Promise<{ address: Address; data: BankRaw }> => {
  const account = await fetchEncodedAccount(rpc, bankAddress);

  if (!account.exists) {
    throw new Error(`Bank ${bankAddress} not found`);
  }

  return { address: bankAddress, data: decodeBank(account.data) };
};

export const fetchMultipleBanks = async (
  rpc: Rpc<GetMultipleAccountsApi & GetProgramAccountsApi>,
  programAddress: Address,
  opts?: { bankAddresses?: Address[]; groupAddress?: Address }
): Promise<{ address: Address; data: BankRaw }[]> => {
  const bankDatas: { address: Address; data: BankRaw }[] = [];

  if (opts?.bankAddresses && opts.bankAddresses.length > 0) {
    const addresses = opts.bankAddresses;
    const accounts = await chunkedGetRawMultipleAccountInfoOrderedWithNulls(rpc, addresses);

    accounts.forEach((account, idx) => {
      if (account) {
        bankDatas.push({ address: account.address, data: decodeBank(account.data) });
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
      bankDatas.push({
        address: pubkey,
        data: decodeBank(parseBase64RpcAccount(pubkey, account).data),
      });
    }
  }

  return bankDatas;
};
