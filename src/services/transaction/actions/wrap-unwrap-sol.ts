import type { Instruction, TransactionSigner } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import BigNumber from "bignumber.js";

import { WSOL_MINT } from "~/constants";
import { uiToNative } from "~/utils";

export async function makeUnwrapSolIx(wallet: TransactionSigner): Promise<Instruction> {
  const [address] = await findAssociatedTokenPda({
    mint: WSOL_MINT,
    owner: wallet.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return getCloseAccountInstruction({
    account: address,
    destination: wallet.address,
    owner: wallet,
  });
}

export async function makeWrapSolIxs(
  wallet: TransactionSigner,
  amount: BigNumber
): Promise<Instruction[]> {
  const [address] = await findAssociatedTokenPda({
    mint: WSOL_MINT,
    owner: wallet.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const ixs: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: wallet,
      ata: address,
      owner: wallet.address,
      mint: WSOL_MINT,
    }),
  ];

  if (amount.gt(0)) {
    const nativeAmount = uiToNative(amount, 9) + 10_000n;
    ixs.push(
      getTransferSolInstruction({ source: wallet, destination: address, amount: nativeAmount }),
      getSyncNativeInstruction({ account: address })
    );
  }

  return ixs;
}
