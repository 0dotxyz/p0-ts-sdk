import { PublicKey } from "@solana/web3.js";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  InstructionsWrapper,
} from "@mrgnlabs/mrgn-common";

import { BankType } from "~/services/bank";
import { MarginfiProgram, MintData } from "~/types";
import instructions from "~/instructions";

import { MarginfiAccountType } from "../types";

/**
 * @deprecated Rewards are now distributed offchain. If you wish to get access to emission data, please reach out.
 */
export async function makeWithdrawEmissionsIx(
  program: MarginfiProgram,
  marginfiAccount: MarginfiAccountType,
  banks: Map<string, BankType>,
  mintDatas: Map<string, MintData>,
  bankAddress: PublicKey
): Promise<InstructionsWrapper> {
  const bank = banks.get(bankAddress.toBase58());
  if (!bank) throw Error(`Bank ${bankAddress.toBase58()} not found`);
  const mintData = mintDatas.get(bankAddress.toBase58());
  if (!mintData)
    throw Error(`Mint data for bank ${bankAddress.toBase58()} not found`);
  if (!mintData.emissionTokenProgram) {
    throw Error(
      `Emission token program not found for bank ${bankAddress.toBase58()}`
    );
  }

  let ixs = [];

  const userAta = getAssociatedTokenAddressSync(
    bank.emissionsMint,
    marginfiAccount.authority,
    true,
    mintData.emissionTokenProgram
  ); // We allow off curve addresses here to support Fuse.
  const createAtaIdempotentIx =
    createAssociatedTokenAccountIdempotentInstruction(
      marginfiAccount.authority,
      userAta,
      marginfiAccount.authority,
      bank.emissionsMint,
      mintData.emissionTokenProgram
    );
  ixs.push(createAtaIdempotentIx);

  const withdrawEmissionsIx =
    await instructions.makelendingAccountWithdrawEmissionIx(program, {
      marginfiAccount: marginfiAccount.address,
      destinationAccount: userAta,
      bank: bank.address,
      tokenProgram: mintData.emissionTokenProgram,
    });
  ixs.push(withdrawEmissionsIx);

  return { instructions: ixs, keys: [] };
}
