import { PublicKey } from "@solana/web3.js";
import { Address } from "@coral-xyz/anchor";

import { MarginfiProgram } from "~/types";

import { BankRaw } from "../types";

export const fetchBank = async (
  program: MarginfiProgram,
  bankAddress: Address
): Promise<{ address: PublicKey; data: BankRaw }> => {
  const address = new PublicKey(bankAddress);
  const data = await program.account.bank.fetch(address);

  if (!data) {
    throw new Error(`Bank ${address.toBase58()} not found`);
  }

  return { address, data };
};

export const fetchMultipleBanks = async (
  program: MarginfiProgram,
  opts?: { bankAddresses?: Address[]; groupAddress?: PublicKey }
): Promise<{ address: PublicKey; data: BankRaw }[]> => {
  let bankDatas: { address: PublicKey; data: BankRaw }[] = [];

  if (opts?.bankAddresses && opts.bankAddresses.length > 0) {
    const addresses = opts.bankAddresses;
    const data = await program.account.bank.fetchMultiple(addresses);

    data.forEach((d, idx) => {
      if (d && addresses[idx]) {
        bankDatas.push({ address: new PublicKey(addresses[idx]), data: d });
      } else {
        console.error(`Bank ${addresses[idx]} not found`);
      }
    });
  } else {
    const bankOpts = opts?.groupAddress
      ? [
          {
            memcmp: { offset: 8 + 32 + 1, bytes: opts.groupAddress.toBase58() },
          },
        ]
      : [];
    const data = await program.account.bank.all(bankOpts);
    bankDatas = data.map((d) => ({ address: d.publicKey, data: d.account }));
  }

  return bankDatas;
};
