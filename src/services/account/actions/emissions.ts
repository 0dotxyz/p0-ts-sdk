import { PublicKey } from "@solana/web3.js";

import { BankType } from "~/services/bank";
import { InstructionsWrapper } from "~/services/transaction";
import { MarginfiProgram } from "~/types";
import instructions from "~/instructions";

import { MarginfiAccountType } from "../types";

/**
 * @deprecated Rewards are now distributed offchain. If you wish to get access to emission data, please reach out.
 */
export async function makeClearEmissionsIx(
  program: MarginfiProgram,
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  bankAddress: PublicKey
): Promise<InstructionsWrapper> {
  const bank = banks.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);

  const clearEmissionsIx = await instructions.makeLendingAccountClearEmissionsIx(program, {
    marginfiAccount: marginfiAccount.address,
    bank: bank.address,
  });

  return { instructions: [clearEmissionsIx], keys: [] };
}
