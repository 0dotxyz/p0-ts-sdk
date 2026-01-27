import {
  AccountMeta,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { DRIFT_PROGRAM_ID } from "./constants";

/**
 * Update Drift spot market cumulative interest
 * This instruction should be called periodically to update the cumulative interest
 * for a spot market based on current utilization and interest rates.
 */
const UPDATE_SPOT_MARKET_CUMULATIVE_INTEREST_DISCRIMINATOR = Buffer.from([
  39, 166, 139, 243, 158, 165, 155, 225,
]);

export const makeUpdateSpotMarketCumulativeInterestIx = (
  state: PublicKey,
  spotMarket: PublicKey,
  oracle: PublicKey,
  spotMarketVault: PublicKey
): TransactionInstruction => {
  const keys: AccountMeta[] = [
    // state: read-only, not a signer
    { pubkey: state, isSigner: false, isWritable: false },

    // spotMarket: writable, not a signer (being updated)
    { pubkey: spotMarket, isSigner: false, isWritable: true },

    // oracle: read-only, not a signer
    { pubkey: oracle, isSigner: false, isWritable: false },

    // spotMarketVault: read-only, not a signer
    { pubkey: spotMarketVault, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: DRIFT_PROGRAM_ID,
    data: UPDATE_SPOT_MARKET_CUMULATIVE_INTEREST_DISCRIMINATOR,
  });
};

const driftInstructions = {
  makeUpdateSpotMarketCumulativeInterestIx,
};

export default driftInstructions;
