import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Raw on-chain Lending account (integration_acc_1).
 *
 * This is the primary state account for a jup-lend market.
 * It holds the cToken (fToken) and underlying asset exchange rates
 * and is analogous to a Kamino Reserve or Drift SpotMarket.
 */
export interface JupLendingStateRaw {
  pubkey: PublicKey;
  mint: PublicKey;
  fTokenMint: PublicKey;
  lendingId: number;
  /** Number of decimals for the fToken, same as underlying asset */
  decimals: number;
  /** PDA of the rewards rate model used by get_rate instruction */
  rewardsRateModel: PublicKey;
  /** Exchange price for the underlying asset in the liquidity protocol (without rewards) */
  liquidityExchangePrice: BN;
  /** Exchange price between fToken and the underlying asset (with rewards) */
  tokenExchangePrice: BN;
  /** Timestamp when exchange prices were last updated */
  lastUpdateTimestamp: BN;
  tokenReservesLiquidity: PublicKey;
  supplyPositionOnLiquidity: PublicKey;
  bump: number;
}
