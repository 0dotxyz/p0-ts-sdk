import { address, getBase64Encoder } from "@solana/kit";

import accountFixtures from "../fixtures/mainnet-accounts.json";
import bankFixtures from "../fixtures/mainnet-banks.json";

import type { MarginfiAccountType } from "~/services/account";
import { decodeMarginfiAccount } from "~/services/account/utils/deserialize.utils";
import type { BankType } from "~/services/bank";
import { decodeBank } from "~/services/bank/utils/deserialize.utils";

const base64 = getBase64Encoder();

// Recorded mainnet banks by the first word of their label: default, sol, staked, kamino, drift,
// juplend
export const mainnetBanks: Record<string, BankType> = Object.fromEntries(
  bankFixtures.map(({ label, address: bankAddress, data }) => [
    label.split(" ")[0],
    decodeBank(address(bankAddress), base64.encode(data)),
  ])
);

export const mainnetBankMap = new Map(
  Object.values(mainnetBanks).map((bank) => [bank.address as string, bank])
);

// A recorded mainnet account with an asset in the default bank and a liability in the SOL bank.
// Its positions in banks `bankMap` doesn't hold are dropped, so every active bank is loaded.
export function mainnetAccount(
  bankMap: Map<string, BankType> = mainnetBankMap
): MarginfiAccountType {
  const { address: accountAddress, data } = accountFixtures[1];
  const account = decodeMarginfiAccount(address(accountAddress), base64.encode(data));
  return {
    ...account,
    balances: account.balances.filter((balance) => !balance.active || bankMap.has(balance.bankPk)),
  };
}
