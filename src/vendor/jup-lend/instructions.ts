import {
  AccountMeta,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { JUP_LEND_PROGRAM_ID } from "./constants";

/**
 * Refresh JupLend exchange rates (permissionless crank).
 * Must run before risk-sensitive flows (liquidation, borrow, non-JupLend withdraw)
 * for every involved JupLend bank in the same tx.
 *
 * Note: juplend_deposit and juplend_withdraw call updateRate internally.
 */
const UPDATE_RATE_DISCRIMINATOR = Buffer.from([
  24, 225, 53, 189, 72, 212, 225, 178,
]);

export const makeUpdateJupLendRateIx = (
  lending: PublicKey,
  mint: PublicKey,
  fTokenMint: PublicKey,
  supplyTokenReservesLiquidity: PublicKey,
  rewardsRateModel: PublicKey
): TransactionInstruction => {
  const keys: AccountMeta[] = [
    // lending: writable (exchange prices are updated)
    { pubkey: lending, isSigner: false, isWritable: true },

    // mint: read-only
    { pubkey: mint, isSigner: false, isWritable: false },

    // fTokenMint: read-only
    { pubkey: fTokenMint, isSigner: false, isWritable: false },

    // supplyTokenReservesLiquidity: read-only
    { pubkey: supplyTokenReservesLiquidity, isSigner: false, isWritable: false },

    // rewardsRateModel: read-only
    { pubkey: rewardsRateModel, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: JUP_LEND_PROGRAM_ID,
    data: UPDATE_RATE_DISCRIMINATOR,
  });
};

const jupLendInstructions = {
  makeUpdateJupLendRateIx,
};

export default jupLendInstructions;
