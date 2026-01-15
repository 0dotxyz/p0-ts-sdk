import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BigNumber from "bignumber.js";

import { uiToNative } from "~/utils";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
} from "~/vendor/spl";

export function makeUnwrapSolIx(walletAddress: PublicKey): TransactionInstruction {
  const address = getAssociatedTokenAddressSync(NATIVE_MINT, walletAddress, true); // We allow off curve addresses here to support Fuse.
  return createCloseAccountInstruction(address, walletAddress, walletAddress);
}

export function makeWrapSolIxs(
  walletAddress: PublicKey,
  amount: BigNumber
): TransactionInstruction[] {
  const address = getAssociatedTokenAddressSync(NATIVE_MINT, walletAddress, true);
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(
      walletAddress,
      address,
      walletAddress,
      NATIVE_MINT
    ),
  ];

  if (amount.gt(0)) {
    const nativeAmount = uiToNative(amount, 9).toNumber() + 10000;
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: walletAddress,
        toPubkey: address,
        lamports: nativeAmount,
      }),
      createSyncNativeInstruction(address)
    );
  }

  return ixs;
}
